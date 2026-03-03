#!/usr/bin/env python3
# debug-club-news.py (v0.1)
#
# Runs targeted diagnostics for ONE club domain.
# Prints:
# - Which URLs were tried
# - HTTP status, final URL, key headers
# - Content-type sniffing + first 600 chars
# - Whether RSS/Atom parse yields items
# - Whether WP REST posts are accessible
#
# Usage (GitHub Actions):
# - workflow_dispatch input "domain"
# - or env DEBUG_DOMAIN=theshots.co.uk

import os
import re
import sys
import json
from datetime import datetime, timezone
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

VERSION = "v0.1"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36 "
    f"(nl-tools club-news debug/{VERSION})"
)

TIMEOUT = 25

HEADERS = {
    "User-Agent": UA,
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
CLUBS_META = os.path.join(REPO_ROOT, "assets", "data", "clubs-meta.json")


def iso_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def hr(title: str):
    print("\n" + "=" * 90)
    print(title)
    print("=" * 90)


def short(s: str, n: int = 600) -> str:
    s = (s or "").replace("\r", "")
    if len(s) <= n:
        return s
    return s[:n] + "\n…(truncated)…"


def safe_get(url: str):
    # retry once
    last_exc = None
    for attempt in range(2):
        try:
            r = requests.get(url, timeout=TIMEOUT, headers=HEADERS, allow_redirects=True)
            return r
        except Exception as e:
            last_exc = e
    raise last_exc


def looks_like_rss_or_atom(text: str) -> bool:
    t = (text or "").lstrip().lower()
    return t.startswith("<?xml") and ("<rss" in t or "<feed" in t)


def parse_rss_or_atom(xml_text: str) -> int:
    soup = BeautifulSoup(xml_text, "xml")
    items = soup.find_all("item")
    if items:
        return len(items)
    entries = soup.find_all("entry")
    if entries:
        return len(entries)
    return 0


def wp_rest_posts(base: str, per_page: int = 5):
    url = base.rstrip("/") + "/wp-json/wp/v2/posts?per_page=" + str(per_page)
    r = safe_get(url)
    ok = (r.status_code == 200)
    count = 0
    title0 = ""
    if ok:
        try:
            data = r.json()
            if isinstance(data, list):
                count = len(data)
                if count:
                    t = data[0].get("title")
                    if isinstance(t, dict):
                        title0 = (t.get("rendered") or "").strip()
        except Exception:
            ok = False
    return (url, r.status_code, ok, count, title0, r.headers.get("content-type", ""))


def dump_response(label: str, r: requests.Response):
    print(f"\n--- {label} ---")
    print(f"GET: {r.url}")
    print(f"STATUS: {r.status_code}")
    print(f"CONTENT-TYPE: {r.headers.get('content-type','')}")
    print(f"SERVER: {r.headers.get('server','')}")
    print(f"CF-RAY: {r.headers.get('cf-ray','')}")
    print(f"LOCATION: {r.headers.get('location','')}")
    print("BODY (first 600 chars):")
    print(short(r.text, 600))


def find_club_by_domain(meta: dict, domain: str):
    domain = (domain or "").strip().lower()
    if domain.startswith("www."):
        domain2 = domain[4:]
    else:
        domain2 = domain
    clubs = meta.get("clubs", [])
    for c in clubs:
        d = (c.get("domain") or "").strip().lower()
        if d == domain or d == domain2 or (d.startswith("www.") and d[4:] == domain2):
            return c
    return None


def main():
    domain = (os.environ.get("DEBUG_DOMAIN") or "").strip()
    if not domain:
        print("Missing DEBUG_DOMAIN env var", file=sys.stderr)
        sys.exit(1)

    hr(f"Club news debug {VERSION} — {domain}")
    print(f"generatedAt: {iso_now()}")

    club = None
    if os.path.exists(CLUBS_META):
        try:
            with open(CLUBS_META, "r", encoding="utf-8") as f:
                meta = json.load(f)
            club = find_club_by_domain(meta, domain)
        except Exception:
            club = None

    if club:
        print(f"\nclubs-meta match: {club.get('name','')} (domain={club.get('domain','')})")
    else:
        print("\nclubs-meta match: (none) — continuing anyway")

    base = "https://" + domain.lstrip("/")
    hr("1) Home page check")
    try:
        r = safe_get(base + "/")
        dump_response("HOME", r)
    except Exception as e:
        print(f"HOME request exception: {type(e).__name__}: {e}")

    hr("2) Feed endpoint sweep")
    # These cover typical WP feed variants (and some WAFs only block /feed/)
    feed_candidates = [
        base.rstrip("/") + "/feed/",
        base.rstrip("/") + "/feed",
        base.rstrip("/") + "/?feed=rss2",
        base.rstrip("/") + "/?feed=rss",
        base.rstrip("/") + "/?feed=atom",
        base.rstrip("/") + "/index.php?feed=rss2",
        base.rstrip("/") + "/index.php?feed=rss",
        base.rstrip("/") + "/index.php?feed=atom",
        base.rstrip("/") + "/news/feed/",
        base.rstrip("/") + "/category/news/feed/",
    ]

    for u in feed_candidates:
        try:
            r = safe_get(u)
            dump_response("FEED TRY", r)

            if r.status_code == 200:
                is_xmlish = looks_like_rss_or_atom(r.text)
                item_count = parse_rss_or_atom(r.text) if is_xmlish else 0
                print(f"RSS/Atom sniff: {is_xmlish} | parsed items/entries: {item_count}")

            # stop early if we clearly got a valid feed with items
            if r.status_code == 200 and looks_like_rss_or_atom(r.text) and parse_rss_or_atom(r.text) >= 1:
                print("\n✅ Found a working feed with parseable items. Stopping feed sweep early.")
                break

        except Exception as e:
            print(f"\n--- FEED TRY ---\nGET: {u}\nEXCEPTION: {type(e).__name__}: {e}")

    hr("3) WordPress REST fallback test")
    try:
        url, status, ok, count, title0, ctype = wp_rest_posts(base, per_page=5)
        print(f"GET: {url}")
        print(f"STATUS: {status}")
        print(f"CONTENT-TYPE: {ctype}")
        print(f"OK JSON LIST: {ok}")
        print(f"POST COUNT (first page): {count}")
        if title0:
            print(f"FIRST TITLE (rendered): {title0[:140]}")
    except Exception as e:
        print(f"WP REST exception: {type(e).__name__}: {e}")

    hr("4) Pitchero /news scrape probe (for client-rendered pages)")
    news_url = base.rstrip("/") + "/news"
    try:
        r = safe_get(news_url)
        dump_response("/news", r)

        html = r.text or ""
        # anchors
        soup = BeautifulSoup(html, "html.parser")
        a_links = []
        for a in soup.find_all("a", href=True):
            href = (a.get("href") or "").strip()
            if href.startswith("/news/") and href.endswith(".html"):
                a_links.append(urljoin(news_url, href))

        # regex scan
        rx_links = [urljoin(news_url, rel) for rel in re.findall(r'(/news/[^"\']+?\.html)', html)]

        # dedupe preserve
        seen = set()
        merged = []
        for x in (a_links + rx_links):
            if x in seen:
                continue
            seen.add(x)
            merged.append(x)

        print(f"\nFound /news/*.html via <a>: {len(a_links)}")
        print(f"Found /news/*.html via regex: {len(rx_links)}")
        print(f"Unique merged: {len(merged)}")
        for u in merged[:10]:
            print(" - " + u)

        if merged:
            hr("4b) Fetch first article for og:title + published")
            ar = safe_get(merged[0])
            dump_response("ARTICLE", ar)

    except Exception as e:
        print(f"Pitchero probe exception: {type(e).__name__}: {e}")

    hr("Done")


if __name__ == "__main__":
    main()
