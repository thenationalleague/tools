#!/usr/bin/env python3

from __future__ import annotations
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Optional, List, Dict

import feedparser
import requests
from bs4 import BeautifulSoup

VERSION = "v1.22"

ROOT = Path(__file__).resolve().parents[2]

CLUBS_META_JSON = ROOT / "assets" / "data" / "clubs-meta.json"
OUT_JSON = ROOT / "assets" / "data" / "club-news.json"

MAX_ITEMS = 30
TIMEOUT = (5, 10)  # (connect timeout, read timeout)
SLEEP_BETWEEN = 0.15

UA = "Mozilla/5.0 (compatible; NL-ClubNewsBot/1.22)"

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

def iso_z(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def now_z():
    return iso_z(datetime.now(timezone.utc))

def domain_to_base(domain: str) -> str:
    if domain.startswith("http"):
        return domain.rstrip("/")
    return f"https://{domain}".rstrip("/")

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
                name=c.get("name","").strip(),
                code=c.get("code","").strip(),
                short=c.get("short","").strip(),
                domain=c.get("domain","").strip(),
            )
        )
    return clubs

def try_fetch(session, url):
    try:
        return session.get(url, timeout=TIMEOUT, allow_redirects=True)
    except:
        return None

def discover_feed(session, base):
    r = try_fetch(session, base)
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
        r = try_fetch(session, url)
        if r and r.text and ("<rss" in r.text.lower() or "<feed" in r.text.lower()):
            return url
    return None

def main():
    clubs = load_clubs()
    session = requests.Session()
    session.headers.update({"User-Agent": UA})

    all_items = []
    sources = []

    for club in clubs:
        base = domain_to_base(club.domain)
        feed = discover_feed(session, base) or try_common(session, base)

        ok = False
        count = 0
        error = ""

        if feed:
            r = try_fetch(session, feed)
            if r and r.content:
                fp = feedparser.parse(r.content)
                for e in fp.entries:
                    title = (e.get("title") or "").strip()
                    link = (e.get("link") or "").strip()
                    dt = parse_date(e)
                    if title and link and dt:
                        all_items.append({
                            "club": club.name,
                            "code": club.code,
                            "short": club.short,
                            "domain": club.domain,
                            "title": title,
                            "url": link,
                            "published": iso_z(dt)
                        })
                ok = True
                count = len(fp.entries)

        sources.append({
            "club": club.name,
            "domain": club.domain,
            "feed": feed or "",
            "ok": ok,
            "count": count,
            "error": error
        })

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

if __name__ == "__main__":
    main()
