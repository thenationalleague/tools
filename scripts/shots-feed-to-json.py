#!/usr/bin/env python3
# shots-feed-to-json.py (v1.0)
#
# Fetches The Shots RSS and writes a JSON file for front-end widgets.
# Output: nl-tools/assets/data/shots-feed.json

import json
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
import re

import requests
from bs4 import BeautifulSoup

VERSION = "v1.0"

FEED_URL = "https://www.theshots.co.uk/feed/"
OUT_PATH = "assets/data/shots-feed.json"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36 "
)

def strip_html(html: str) -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    txt = soup.get_text(" ", strip=True)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt

def clamp(s: str, n: int) -> str:
    s = (s or "").strip()
    if len(s) <= n:
        return s
    return (s[: n - 1].rstrip() + "…")

def fetch_with_retry(url: str, tries: int = 5) -> str:
    sess = requests.Session()
    headers = {
        "User-Agent": UA,
        "Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
        "Accept-Language": "en-GB,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "keep-alive",
    }

    last_err = None
    for i in range(tries):
        try:
            r = sess.get(url, headers=headers, timeout=25)
            if r.status_code == 200 and r.text.strip():
                return r.text
            last_err = RuntimeError(f"HTTP {r.status_code}")
        except Exception as e:
            last_err = e

        # backoff: 2s, 5s, 10s, 20s, 30s
        time.sleep([2, 5, 10, 20, 30][min(i, 4)])

    raise RuntimeError(f"Failed to fetch RSS after {tries} tries: {last_err}")

def parse_rss(xml_text: str, max_items: int = 50):
    soup = BeautifulSoup(xml_text, "xml")
    items = []
    for item in soup.find_all("item")[:max_items]:
        title = (item.title.get_text(strip=True) if item.title else "").strip()
        link = (item.link.get_text(strip=True) if item.link else "").strip()
        pub = (item.pubDate.get_text(strip=True) if item.pubDate else "").strip()

        content = ""
        c = item.find("content:encoded")
        if c and c.get_text(strip=False):
            content = c.get_text(strip=False)
        elif item.description and item.description.get_text(strip=False):
            content = item.description.get_text(strip=False)

        excerpt = clamp(strip_html(unescape(content)), 220)

        iso = ""
        if pub:
            try:
                dt = parsedate_to_datetime(pub)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                iso = dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            except Exception:
                iso = ""

        if title and link:
            items.append({
                "title": title,
                "link": link,
                "date": iso,
                "excerpt": excerpt,
            })

    return items

def main():
    xml = fetch_with_retry(FEED_URL)
    items = parse_rss(xml, max_items=60)

    payload = {
        "version": VERSION,
        "source": FEED_URL,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "items": items,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"Wrote {OUT_PATH} ({len(items)} items)")

if __name__ == "__main__":
    main()
