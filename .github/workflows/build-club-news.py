#!/usr/bin/env python3
"""
Club News Aggregator (v1.26)

Reads:  assets/data/clubs-meta.json
Writes: assets/data/club-news.json
Also:   assets/data/club-news-failures.json  (only failures for easy debugging)

Fixes vs v1.24:
- Avoids accidentally selecting WordPress oEmbed XML as a "feed"
- Uses urljoin() for correct relative URL handling (fixes "domainupdates.atom" bugs)
- Adds FEED_OVERRIDES for manual per-domain feeds
- Keeps hard per-club timeout so no hangs (DNS etc)
"""

from __future__ import annotations

import json
import re
import signal
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Optional, List, Dict, Tuple
from urllib.parse import urljoin

import feedparser
import requests
from bs4 import BeautifulSoup


VERSION = "v1.26"

# parents[0]=workflows, [1]=.github, [2]=repo root
ROOT = Path(__file__).resolve().parents[2]

CLUBS_META_JSON = ROOT / "assets" / "data" / "clubs-meta.json"
OUT_JSON = ROOT / "assets" / "data" / "club-news.json"
FAIL_JSON = ROOT / "assets" / "data" / "club-news-failures.json"

MAX_ITEMS = 30
REQ_TIMEOUT = (4, 10)          # (connect, read)
CLUB_HARD_TIMEOUT_SECS = 16    # whole club (dns+html+feed+parse)
SLEEP_BETWEEN = 0.10

UA = "Mozilla/5.0 (compatible; NL-ClubNewsBot/1.26; +https://rckd-nl.github.io/nl-tools/)"

COMMON_FEED_PATHS = [
    "/feed/",
    "/news/feed/",
    "/rss",
    "/rss/",
    "/rss.xml",
    "/feed.xml",
    "/atom.xml",
    "/?feed=rss",
    "/?feed=rss2",
    "/?feed=atom",
]

# Manual per-domain overrides (only needed for stubborn sites).
# Add to this list as you discover reliable feeds.
FEED_OVERRIDES: Dict[str, str] = {
    # Example fix patterns:
    # "maidenheadunitedfc.org": "https://maidenheadunitedfc.org/updates.atom",
    # "rochdaleafc.co.uk": "https://rochdaleafc.co.uk/feed/",
    # "theshots.co.uk": "https://theshots.co.uk/feed/",
}


@dataclass(frozen=True)
class Club:
    name: str
    code: str
    short: str
    domain: str


class HardTimeout(Exception):
    pass


def _alarm_handler(signum, frame):
    raise HardTimeout("Hard timeout reached")


def iso_z(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_z() -> str:
    return iso_z(datetime.now(timezone.utc))


def domain_to_base(domain: str) -> str:
    d = (domain or "").strip()
    if not d:
        return ""
    if d.startswith("http://") or d.startswith("https://"):
        return d.rstrip("/")
    return ("https://" + d).rstrip("/")


def parse_any_date(entry: dict) -> Optional[datetime]:
    for k in ("published_parsed", "updated_parsed"):
        v = entry.get(k)
        if v:
            try:
                return datetime(*v[:6], tzinfo=timezone.utc)
            except Exception:
                pass

    for k in ("published", "updated", "date"):
        v = entry.get(k)
        if v:
            try:
                dt = parsedate_to_datetime(v)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)
            except Exception:
                pass

    return None


def load_clubs() -> List[Club]:
    if not CLUBS_META_JSON.exists():
        raise FileNotFoundError(f"Missing clubs-meta.json at: {CLUBS_META_JSON}")

    data = json.loads(CLUBS_META_JSON.read_text(encoding="utf-8"))
    clubs_raw = data.get("clubs", [])

    clubs: List[Club] = []
    for c in clubs_raw:
        domain = (c.get("domain") or "").strip()
        if not domain:
            continue
        clubs.append(
            Club(
                name=(c.get("name") or "").strip(),
                code=(c.get("code") or "").strip(),
                short=(c.get("short") or "").strip(),
                domain=domain,
            )
        )

    clubs.sort(key=lambda x: x.name.lower())
    return clubs


def session_get(session: requests.Session, url: str) -> Optional[requests.Response]:
    try:
        return session.get(
            url,
            timeout=REQ_TIMEOUT,
            allow_redirects=True,
            headers={
                "User-Agent": UA,
                "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
            },
        )
    except Exception:
        return None


def looks_like_oembed(href: str) -> bool:
    h = (href or "").lower()
    # Most of your false "feeds" were wp-json/oembed endpoints
    if "wp-json/oembed" in h:
        return True
    if "/oembed" in h and "format=xml" in h:
        return True
    return False


def discover_feed_url(session: requests.Session, base_url: str) -> Optional[str]:
    r = session_get(session, base_url)
    if not r or r.status_code >= 400 or not (r.text or "").strip():
        return None

    soup = BeautifulSoup(r.text, "lxml")
    links = soup.find_all("link", attrs={"rel": re.compile(r"\balternate\b", re.I)})

    candidates: List[Tuple[int, str]] = []
    for ln in links:
        t = (ln.get("type") or "").lower().strip()
        href = (ln.get("href") or "").strip()
        if not href:
            continue

        # ignore oEmbed XML that masquerades as "xml"
        if looks_like_oembed(href):
            continue

        # only accept actual rss/atom-ish types, not "xml" generically
        if ("rss" in t) or ("atom" in t):
            abs_url = urljoin(base_url + "/", href)
            score = 0 if "rss" in t else 1
            candidates.append((score, abs_url))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


def try_common_feed_urls(session: requests.Session, base_url: str) -> Optional[str]:
    for p in COMMON_FEED_PATHS:
        u = base_url.rstrip("/") + p
        r = session_get(session, u)
        if not r or r.status_code >= 400:
            continue
        head = (r.text or "")[:2500].lower()
        if "<rss" in head or "<feed" in head:
            return u
    return None


def fetch_and_parse_feed(session: requests.Session, feed_url: str) -> List[Dict]:
    r = session_get(session, feed_url)
    if not r or r.status_code >= 400 or not (r.content or b""):
        return []

    fp = feedparser.parse(r.content)
    out: List[Dict] = []
    for e in (fp.entries or []):
        title = (e.get("title") or "").strip()
        link = (e.get("link") or "").strip()
        dt = parse_any_date(e)

        if not title or not link or not dt:
            continue

        out.append({"title": title, "url": link, "published": iso_z(dt)})

    return out


def process_one_club(session: requests.Session, club: Club) -> Tuple[List[Dict], Dict]:
    base = domain_to_base(club.domain)
    feed_url = ""
    ok = False
    error = ""

    # hard timeout per club (covers DNS stalls too)
    signal.signal(signal.SIGALRM, _alarm_handler)
    signal.alarm(CLUB_HARD_TIMEOUT_SECS)

    try:
        # manual override first
        if club.domain in FEED_OVERRIDES:
            feed_url = FEED_OVERRIDES[club.domain].strip()
        else:
            feed_url = discover_feed_url(session, base) or try_common_feed_urls(session, base) or ""

        if not feed_url:
            raise RuntimeError("No feed found")

        items = fetch_and_parse_feed(session, feed_url)

        # If we found a feed but got zero usable items, mark as not OK
        # (usually means it isn't really a feed, or entries lack dates)
        if len(items) == 0:
            raise RuntimeError("Feed returned 0 usable items")

        ok = True

        club_items: List[Dict] = []
        for it in items:
            club_items.append(
                {
                    "club": club.name,
                    "code": club.code,
                    "short": club.short,
                    "domain": club.domain,
                    "title": it["title"],
                    "url": it["url"],
                    "published": it["published"],
                }
            )

        return club_items, {
            "club": club.name,
            "domain": club.domain,
            "feed": feed_url,
            "ok": True,
            "count": len(items),
            "error": "",
        }

    except HardTimeout:
        error = f"Hard timeout after {CLUB_HARD_TIMEOUT_SECS}s"
        return [], {
            "club": club.name,
            "domain": club.domain,
            "feed": feed_url,
            "ok": False,
            "count": 0,
            "error": error,
        }

    except Exception as ex:
        error = str(ex)
        return [], {
            "club": club.name,
            "domain": club.domain,
            "feed": feed_url,
            "ok": False,
            "count": 0,
            "error": error,
        }

    finally:
        signal.alarm(0)


def main() -> int:
    clubs = load_clubs()

    session = requests.Session()
    session.trust_env = False

    all_items: List[Dict] = []
    sources: List[Dict] = []

    total = len(clubs)
    print(f"[{VERSION}] Clubs: {total}", flush=True)

    for i, club in enumerate(clubs, start=1):
        print(f"[{i}/{total}] {club.name} ({club.domain})", flush=True)
        club_items, src = process_one_club(session, club)
        sources.append(src)
        all_items.extend(club_items)
        time.sleep(SLEEP_BETWEEN)

    all_items.sort(key=lambda x: x.get("published", ""), reverse=True)

    # dedupe by URL
    seen = set()
    deduped: List[Dict] = []
    for it in all_items:
        u = it.get("url", "")
        if not u or u in seen:
            continue
        seen.add(u)
        deduped.append(it)

    deduped = deduped[:MAX_ITEMS]

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "version": VERSION,
                "generatedAt": now_z(),
                "maxItems": MAX_ITEMS,
                "sources": sources,
                "items": deduped,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    failures = [s for s in sources if not s.get("ok")]
    FAIL_JSON.write_text(
        json.dumps(
            {
                "version": VERSION,
                "generatedAt": now_z(),
                "failures": failures,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    ok_count = sum(1 for s in sources if s.get("ok"))
    print(f"Done. Sources OK: {ok_count}/{total}. Items written: {len(deduped)}. Failures: {len(failures)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
