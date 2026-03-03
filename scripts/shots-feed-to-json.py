#!/usr/bin/env python3
# shots-feed-to-json.py (v1.3)
#
# v1.3:
# - Stops using /feed/ (blocked by WAF)
# - Scrapes a server-rendered tag archive (default: /tag/aldershot/)
# - Paginates /page/2/, /page/3/ until no more posts or MAX_ITEMS reached
# - Writes assets/data/shots-feed.json for your widget

import json
import os
import re
import time
from datetime import datetime, timezone
from html import unescape
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

VERSION = "v1.3"

# Use a tag page that loads in normal browsers (server-rendered list of posts).
# You can override in workflow/env via SHOTS_TAG_URL.
TAG_URL_DEFAULT = "https://www.theshots.co.uk/tag/aldershot/"
TAG_URL = os.environ.get("SHOTS_TAG_URL", TAG_URL_DEFAULT)

OUT_PATH = "assets/data/shots-feed.json"
MAX_ITEMS = int(os.environ.get("SHOTS_MAX_ITEMS", "60"))

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36 "
)

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def strip_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())

def clamp(s: str, n: int) -> str:
    s = strip_ws(s)
    if len(s) <= n:
        return s
    return (s[: n - 1].rstrip() + "…")

def safe_mkdirs(path: str) -> None:
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)

def fetch_html(url: str, tries: int = 5) -> str:
    sess = requests.Session()
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "keep-alive",
        "Referer": "https://www.theshots.co.uk/",
    }

    last_err = None
    for i in range(tries):
        try:
            r = sess.get(url, headers=headers, timeout=25, allow_redirects=True)
            if r.status_code == 200 and r.text and r.text.strip():
                return r.text
            last_err = RuntimeError(f"HTTP {r.status_code}")
        except Exception as e:
            last_err = e

        time.sleep([2, 5, 10, 20, 30][min(i, 4)])

    raise RuntimeError(f"Failed to fetch HTML after {tries} tries: {last_err}")

def parse_tag_page(html: str, base_url: str):
    """
    Tag archive layout (from theshots.co.uk tag pages) is typically:
      ## <a href="post">TITLE</a>
      ##### DD/MM/YYYY
      Excerpt ... Read more
    We collect title/link/date/excerpt.
    """
    soup = BeautifulSoup(html, "html.parser")

    items = []
    seen_links = set()

    # The page uses H2 for post headings in the archive list (observed).
    for h2 in soup.find_all("h2"):
        a = h2.find("a", href=True)
        if not a:
            continue

        title = strip_ws(a.get_text(" ", strip=True))
        link = a["href"].strip()
        if not link:
            continue

        link = urljoin(base_url, link)

        if link in seen_links:
            continue

        # Date is often the next H5 (#####) after the H2.
        date_text = ""
        nxt = h2.find_next()
        # scan forward a few elements to find an H5 with a date-like string
        for _ in range(0, 8):
            if not nxt:
                break
            if getattr(nxt, "name", "") == "h5":
                date_text = strip_ws(nxt.get_text(" ", strip=True))
                break
            nxt = nxt.find_next()

        # Excerpt usually appears in the paragraph text following.
        # Grab text until "Read more" and clamp.
        excerpt = ""
        p = h2.find_next("p")
        if p:
            raw = p.get_text(" ", strip=True)
            raw = unescape(raw)
            raw = raw.replace("Read more", "").strip()
            excerpt = clamp(strip_ws(raw), 220)

        items.append({
            "title": title,
            "link": link,
            "date": date_text,   # keep as displayed (DD/MM/YYYY) to avoid parse edge cases
            "excerpt": excerpt
        })
        seen_links.add(link)

    # Detect pagination: presence of "»" link or /page/2/ etc.
    next_url = None
    for a in soup.find_all("a", href=True):
        txt = strip_ws(a.get_text(" ", strip=True))
        href = a["href"].strip()

        # WordPress commonly uses “Next” or “»”
        if txt in ("»", "Next", "Next »"):
            next_url = urljoin(base_url, href)
            break

    return items, next_url

def build_from_tag_archive(start_url: str, max_items: int):
    all_items = []
    url = start_url
    pages = 0

    while url and len(all_items) < max_items and pages < 20:
        pages += 1
        html = fetch_html(url)
        items, next_url = parse_tag_page(html, url)

        if not items:
            break

        # Append new items, de-dupe by link
        known = {x["link"] for x in all_items}
        for it in items:
            if it["link"] not in known:
                all_items.append(it)
                known.add(it["link"])
            if len(all_items) >= max_items:
                break

        # Stop if pagination doesn't advance
        if next_url == url:
            break

        url = next_url

    return all_items

def main():
    items = build_from_tag_archive(TAG_URL, MAX_ITEMS)

    payload = {
        "version": VERSION,
        "source": TAG_URL,
        "generatedAt": now_utc_iso(),
        "items": items
    }

    safe_mkdirs(OUT_PATH)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"[shots-feed-to-json] wrote {OUT_PATH} ({len(items)} items) from {TAG_URL}")

if __name__ == "__main__":
    main()
