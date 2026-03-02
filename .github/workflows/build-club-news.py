#!/usr/bin/env python3

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

import feedparser
import requests
from bs4 import BeautifulSoup

VERSION = "v1.24"

# parents[0]=workflows, [1]=.github, [2]=repo root
ROOT = Path(__file__).resolve().parents[2]

CLUBS_META_JSON = ROOT / "assets" / "data" / "clubs-meta.json"
OUT_JSON = ROOT / "assets" / "data" / "club-news.json"

MAX_ITEMS = 30
REQ_TIMEOUT = (4, 8)  # (connect, read)
CLUB_HARD_TIMEOUT_SECS = 14
SLEEP_BETWEEN = 0.1

UA = "Mozilla/5.0 (compatible; NL-ClubNewsBot/1.24)"

COMMON_FEED_PATHS = [
    "/feed/",
    "/rss",
    "/rss.xml",
    "/feed.xml",
    "/atom.xml",
    "/?feed=rss",
    "/?feed=rss2",
]


@dataclass(frozen=True)
class Club:
    name: str
    code: str
    short: str
    domain: str


class HardTimeout(Exception):
    pass


def alarm_handler(signum, frame):
    raise HardTimeout("Hard timeout reached")


def iso_z(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_z():
    return iso_z(datetime.now(timezone.utc))


def domain_to_base(domain: str) -> str:
    d = domain.strip()
    if d.startswith("http"):
        return d.rstrip("/")
    return f"https://{d}".rstrip("/")


def parse_date(entry):
    for key in ("published_parsed", "updated_parsed"):
        if entry.get(key):
            return datetime(*entry[key][:6], tzinfo=timezone.utc)
    for key in ("published", "updated"):
        if entry.get(key):
            try:
                return parsedate_to_datetime(entry[key]).astimezone(timezone.utc)
            except:
                pass
    return None


def load_clubs():
    data = json.loads(CLUBS_META_JSON.read_text(encoding="utf-8"))
    clubs = []
    for c in data.get("clubs", []):
        if not c.get("domain"):
            continue
        clubs.append(
            Club(
                name=c.get("name", "").strip(),
                code=c.get("code", "").strip(),
                short=c.get("short", "").strip(),
                domain=c.get("domain", "").strip(),
            )
        )
    clubs.sort(key=lambda x: x.name.lower())
    return clubs


def safe_get(session, url):
    try:
        return session.get(url, timeout=REQ_TIMEOUT, allow_redirects=True)
    except:
        return None


def discover_feed(session, base):
    r = safe_get(session, base)
    if not r or not r.text:
        return None

    soup = BeautifulSoup(r.text, "lxml")
    for link in soup.find_all("link", rel=re.compile("alternate", re.I)):
        t = (link.get("type") or "").lower()
        href = link.get("href")
        if href and ("rss" in t or "atom" in t or "xml" in t):
            if href.startswith("http"):
                return href
            return base + href
    return None


def try_common(session, base):
    for p in COMMON_FEED_PATHS:
        url = base + p
        r = safe_get(session, url)
        if r and r.text and ("<rss" in r.text.lower() or "<feed" in r.text.lower()):
            return url
    return None


def process_club(session, club: Club):
    base = domain_to_base(club.domain)
    feed = ""
    items = []
    ok = False
    error = ""

    signal.signal(signal.SIGALRM, alarm_handler)
    signal.alarm(CLUB_HARD_TIMEOUT_SECS)

    try:
        feed = discover_feed(session, base) or try_common(session, base)
        if not feed:
            raise RuntimeError("No feed found")

        r = safe_get(session, feed)
        if not r:
            raise RuntimeError("Feed request failed")

        fp = feedparser.parse(r.content)
        for e in fp.entries:
            title = (e.get("title") or "").strip()
            link = (e.get("link") or "").strip()
            dt = parse_date(e)
            if title and link and dt:
                items.append({
                    "club": club.name,
                    "code": club.code,
                    "short": club.short,
                    "domain": club.domain,
                    "title": title,
                    "url": link,
                    "published": iso_z(dt)
                })

        ok = True

    except HardTimeout:
        error = "Hard timeout"
    except Exception as ex:
        error = str(ex)
    finally:
        signal.alarm(0)

    return items, {
        "club": club.name,
        "domain": club.domain,
        "feed": feed or "",
        "ok": ok,
        "count": len(items),
        "error": error
    }


def main():
    clubs = load_clubs()
    session = requests.Session()
    session.headers.update({"User-Agent": UA})
    session.trust_env = False

    all_items = []
    sources = []

    total = len(clubs)
    print(f"[v{VERSION}] Processing {total} clubs", flush=True)

    for i, club in enumerate(clubs, start=1):
        print(f"[{i}/{total}] {club.name}", flush=True)
        items, src = process_club(session, club)
        all_items.extend(items)
        sources.append(src)
        time.sleep(SLEEP_BETWEEN)

    all_items.sort(key=lambda x: x["published"], reverse=True)
    all_items = all_items[:MAX_ITEMS]

    OUT_JSON.write_text(json.dumps({
        "version": VERSION,
        "generatedAt": now_z(),
        "maxItems": MAX_ITEMS,
        "sources": sources,
        "items": all_items
    }, indent=2), encoding="utf-8")

    print(f"Done. Sources OK: {sum(s['ok'] for s in sources)}/{total}. Items written: {len(all_items)}", flush=True)


if __name__ == "__main__":
    main()
