#!/usr/bin/env python3
"""
Club News Aggregator (v1.20)
- Reads nl-tools/assets/data/clubs-meta.json (your source of truth)
- Extracts club name + domain (and keeps code/short/colors available for later)
- Discovers RSS/Atom feeds for each domain (homepage <link rel="alternate">)
- Falls back to common feed URLs if discovery fails
- Pulls items, normalises, sorts by published date
- Writes nl-tools/assets/data/club-news.json (latest 30 items)

Output JSON:
{
  "version": "v1.20",
  "generatedAt": "2026-03-02T16:00:00Z",
  "maxItems": 30,
  "sources": [{club,domain,feed,ok,count,error}, ...],
  "items": [
    {club,code,short,domain,title,url,published}
  ]
}
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Optional, List, Dict, Tuple

import feedparser
import requests
from bs4 import BeautifulSoup


VERSION = "v1.20"

ROOT = Path(__file__).resolve().parents[1]
CLUBS_META_JSON = ROOT / "assets" / "data" / "clubs-meta.json"
OUT_JSON = ROOT / "assets" / "data" / "club-news.json"

MAX_ITEMS = 30
REQUEST_TIMEOUT = 20
SLEEP_BETWEEN = 0.35

UA = "NL-ClubNewsBot/1.20 (+https://github.com/rckd-nl/nl-tools; GitHub Actions feed aggregation)"

COMMON_FEED_PATHS = [
    "/feed/",
    "/rss",
    "/rss/",
    "/rss.xml",
    "/feed.xml",
    "/atom.xml",
    "/?feed=rss",
    "/?feed=rss2",
    "/?feed=atom",
]


@dataclass
class Club:
    name: str
    code: str
    short: str
    domain: str


def iso_z(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_z() -> str:
    return iso_z(datetime.now(timezone.utc))


def safe_url(url: str) -> str:
    # Some feeds contain whitespace or tracking params; keep it minimal and safe.
    url = (url or "").strip()
    return url


def parse_any_date(entry) -> Optional[datetime]:
    # feedparser may provide multiple fields
    for key in ("published_parsed", "updated_parsed"):
        v = entry.get(key)
        if v:
            try:
                return datetime(*v[:6], tzinfo=timezone.utc)
            except Exception:
                pass

    # Try raw strings
    for key in ("published", "updated", "date"):
        v = entry.get(key)
        if v:
            try:
                dt = parsedate_to_datetime(v)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)
            except Exception:
                pass

    return None


def domain_to_base(domain: str) -> str:
    domain = domain.strip()
    if domain.startswith("http://") or domain.startswith("https://"):
        return domain.rstrip("/")
    return f"https://{domain}".rstrip("/")


def discover_feed_url(base_url: str) -> Optional[str]:
    """
    Attempts to find RSS/Atom via <link rel="alternate" type="application/rss+xml|application/atom+xml" href="...">
    """
    try:
        r = requests.get(base_url, headers={"User-Agent": UA}, timeout=REQUEST_TIMEOUT)
        if r.status_code >= 400 or not r.text:
            return None
        soup = BeautifulSoup(r.text, "lxml")

        links = soup.find_all("link", attrs={"rel": re.compile(r"\balternate\b", re.I)})
        candidates: List[str] = []
        for ln in links:
            t = (ln.get("type") or "").lower().strip()
            href = (ln.get("href") or "").strip()
            if not href:
                continue
            if "rss" in t or "atom" in t or "xml" in t:
                candidates.append(href)

        if not candidates:
            return None

        # Prefer RSS then Atom
        def score(u: str) -> int:
            ul = u.lower()
            if "rss" in ul:
                return 0
            if "atom" in ul:
                return 1
            return 2

        candidates.sort(key=score)
        href = candidates[0]
        if href.startswith("//"):
            return "https:" + href
        if href.startswith("http://") or href.startswith("https://"):
            return href
        return base_url.rstrip("/") + (href if href.startswith("/") else "/" + href)
    except Exception:
        return None


def try_common_feed_urls(base_url: str) -> Optional[str]:
    for p in COMMON_FEED_PATHS:
        u = base_url.rstrip("/") + p
        try:
            r = requests.get(u, headers={"User-Agent": UA}, timeout=REQUEST_TIMEOUT)
            if r.status_code < 400 and (r.text or "").strip():
                # quick check it looks like xml/feed
                head = (r.text[:2000] or "").lower()
                if "<rss" in head or "<feed" in head:
                    return u
        except Exception:
            continue
        time.sleep(0.08)
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
    # Stable sort by name (helps diffs)
    clubs.sort(key=lambda x: x.name.lower())
    return clubs


def parse_feed_items(feed_url: str) -> List[Dict]:
    fp = feedparser.parse(feed_url)
    items: List[Dict] = []
    for e in (fp.entries or []):
        title = (e.get("title") or "").strip()
        link = safe_url(e.get("link") or "")
        dt = parse_any_date(e)

        if not title or not link or not dt:
            continue

        items.append(
            {
                "title": title,
                "url": link,
                "published": iso_z(dt),
            }
        )
    return items


def main() -> int:
    clubs = load_clubs()

    all_items: List[Dict] = []
    sources: List[Dict] = []

    session = requests.Session()
    session.headers.update({"User-Agent": UA})

    for club in clubs:
        base = domain_to_base(club.domain)

        feed_url = None
        error = ""
        ok = False
        count = 0

        try:
            # discovery
            feed_url = discover_feed_url(base)
            if not feed_url:
                feed_url = try_common_feed_urls(base)

            if not feed_url:
                raise RuntimeError("No feed discovered (and no common feed URL matched)")

            items = parse_feed_items(feed_url)
            count = len(items)
            ok = True

            for it in items:
                all_items.append(
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

        except Exception as ex:
            error = str(ex)

        sources.append(
            {
                "club": club.name,
                "domain": club.domain,
                "feed": feed_url or "",
                "ok": ok,
                "count": count,
                "error": error,
            }
        )

        time.sleep(SLEEP_BETWEEN)

    # Sort newest first
    def key_pub(x: Dict) -> Tuple[int, str]:
        # Convert to sortable; if somehow malformed, drop to bottom
        try:
            dt = datetime.strptime(x["published"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            return (0, dt.isoformat())
        except Exception:
            return (1, "")

    all_items.sort(key=lambda x: key_pub(x)[1], reverse=True)

    # Dedupe by URL (keep newest instance)
    seen = set()
    deduped: List[Dict] = []
    for it in all_items:
        u = it.get("url", "")
        if not u or u in seen:
            continue
        seen.add(u)
        deduped.append(it)

    deduped = deduped[:MAX_ITEMS]

    out = {
        "version": VERSION,
        "generatedAt": now_z(),
        "maxItems": MAX_ITEMS,
        "sources": sources,
        "items": deduped,
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote: {OUT_JSON} ({len(deduped)} items)")
    return 0


if __name__ == "__main__":
  raise SystemExit(main())
