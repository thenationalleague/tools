#!/usr/bin/env python3
# build-club-news.py (v1.29)
#
# v1.29:
# - Adds FEED_OVERRIDES (Aldershot + Altrincham included)
# - Pitchero handling is scrape-only (NO pitchero.com RSS guesses)
# - Keeps WP REST fallback
# - Writes club-news.json + club-news-failures.json

import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

VERSION = "v1.29"

UA = (
    "nl-tools club-news builder/"
    + VERSION
    + " (+https://rckd-nl.github.io/nl-tools/)"
)

DEFAULT_TIMEOUT = 25
MAX_ITEMS_GLOBAL = 30
MAX_ITEMS_PER_CLUB = 12  # hard cap; global list still trimmed to MAX_ITEMS_GLOBAL

# ---- Feed overrides (domain -> feed URL) ----
# Add more here as we solve clubs.
FEED_OVERRIDES = {
    # Solved
    "theshots.co.uk": "https://www.theshots.co.uk/feed/",
    "altrinchamfc.com": "https://altrinchamfc.com/blogs/news.atom",

    # Next batch placeholders (fill these as we confirm)
    # "bostonunited.co.uk": "PITCHERO_SCRAPE",
    # "brackleytownfc.com": "https://example.com/feed/",
    # "braintreetownfc.org": "https://example.com/rss.xml",
    # "telfordunited.com": "https://example.com/feed/",
}

# ---- Paths (relative to this file) ----
HERE = os.path.dirname(os.path.abspath(__file__))
CLUBS_META = os.path.join(HERE, "clubs-meta.json")
OUT_JSON = os.path.join(HERE, "club-news.json")
OUT_FAIL = os.path.join(HERE, "club-news-failures.json")


@dataclass
class SourceResult:
    club: str
    domain: str
    feed: str
    ok: bool
    count: int
    error: str


def iso_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def norm_space(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def absolutize(base: str, href: str) -> str:
    if not href:
        return ""
    return urljoin(base, href)


def safe_get(url: str, timeout=DEFAULT_TIMEOUT) -> requests.Response:
    return requests.get(
        url,
        timeout=timeout,
        headers={"User-Agent": UA, "Accept": "*/*"},
        allow_redirects=True,
    )


def looks_like_pitchero(html_text: str) -> bool:
    t = (html_text or "").lower()
    return ("pitchero" in t) or ("pitch hero ltd" in t)


def parse_rss_or_atom(xml_text: str, base_url: str) -> list[dict]:
    """
    Returns list of {title,url,published_raw}
    Tries RSS 2.0 and Atom-ish structures.
    """
    items = []
    soup = BeautifulSoup(xml_text, "xml")

    # RSS items
    for it in soup.find_all("item"):
        title = norm_space(it.title.get_text()) if it.title else ""
        link = norm_space(it.link.get_text()) if it.link else ""
        pub = ""
        if it.pubDate and it.pubDate.get_text():
            pub = norm_space(it.pubDate.get_text())
        elif it.find("dc:date") and it.find("dc:date").get_text():
            pub = norm_space(it.find("dc:date").get_text())

        if link:
            link = absolutize(base_url, link)

        items.append({"title": title, "url": link, "published_raw": pub})

    # Atom entries
    if not items:
        for ent in soup.find_all("entry"):
            title = norm_space(ent.title.get_text()) if ent.title else ""
            link = ""
            l = ent.find("link")
            if l and l.get("href"):
                link = norm_space(l.get("href"))
            updated = ""
            if ent.updated and ent.updated.get_text():
                updated = norm_space(ent.updated.get_text())
            elif ent.published and ent.published.get_text():
                updated = norm_space(ent.published.get_text())

            if link:
                link = absolutize(base_url, link)

            items.append({"title": title, "url": link, "published_raw": updated})

    return items


def parse_date_any(s: str) -> str:
    """
    Returns ISO Z if parseable, else "".
    Accepts ISO8601, RFC822-ish pubDate, dd/mm/yyyy.
    """
    s = (s or "").strip()
    if not s:
        return ""

    # ISO already
    if re.match(r"^\d{4}-\d{2}-\d{2}T", s):
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        except Exception:
            pass

    # dd/mm/yyyy
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        dt = datetime(y, mo, d, 0, 0, 0, tzinfo=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")

    # RFC822-ish (forgiving)
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except Exception:
        return ""


def wp_rest_posts(base: str, per_page: int = 10) -> list[dict]:
    """
    WordPress REST API posts (fallback).
    """
    api = base.rstrip("/") + "/wp-json/wp/v2/posts"
    r = safe_get(api + f"?per_page={per_page}&_embed=1")
    if r.status_code != 200:
        return []
    try:
        data = r.json()
    except Exception:
        return []

    out = []
    for p in data:
        title = ""
        if isinstance(p.get("title"), dict):
            title = unescape(norm_space(p["title"].get("rendered", "")))
        link = norm_space(p.get("link", ""))

        dt = ""
        dg = p.get("date_gmt") or ""
        if dg:
            try:
                dt0 = datetime.fromisoformat(dg)
                dt = dt0.replace(tzinfo=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            except Exception:
                dt = ""
        out.append({"title": title, "url": link, "published": dt})
    return out


def try_feed(url: str) -> tuple[bool, str, list[dict], str]:
    """
    Returns (ok, final_url, usable_items, error)
    usable_items: {title,url,published}
    """
    try:
        r = safe_get(url)
        if r.status_code != 200:
            return (False, url, [], f"HTTP {r.status_code}")
        items = parse_rss_or_atom(r.text, r.url)
        usable = []
        for it in items:
            title = norm_space(it.get("title", ""))
            link = norm_space(it.get("url", ""))
            pub = parse_date_any(it.get("published_raw", ""))
            if title and link:
                usable.append({"title": title, "url": link, "published": pub})
        return (True, r.url, usable, "")
    except Exception as e:
        return (False, url, [], f"{type(e).__name__}: {e}")


def pitchero_list_links(news_url: str, limit: int = 15) -> list[str]:
    """
    Scrape /news listing for article links.
    Pitchero custom domains commonly use: /news/some-slug-1234567.html
    """
    r = safe_get(news_url)
    if r.status_code != 200:
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    links = []
    for a in soup.find_all("a", href=True):
        href = (a["href"] or "").strip()
        if not href:
            continue

        if re.search(r"^/news/.+\.html$", href):
            links.append(urljoin(news_url, href))
            continue

        if href.startswith("http"):
            try:
                if urlparse(href).netloc == urlparse(news_url).netloc:
                    if "/news/" in href and href.endswith(".html"):
                        links.append(href)
            except Exception:
                pass

    # de-dupe preserve order
    seen = set()
    out = []
    for u in links:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
        if len(out) >= limit:
            break
    return out


def pitchero_article_meta(url: str) -> tuple[str, str]:
    """
    Fetch a Pitchero article and pull title + published time.
    """
    r = safe_get(url)
    if r.status_code != 200:
        return ("", "")

    soup = BeautifulSoup(r.text, "html.parser")

    # Title
    title = ""
    ogt = soup.find("meta", attrs={"property": "og:title"})
    if ogt and ogt.get("content"):
        title = norm_space(ogt["content"])
    if not title and soup.title:
        title = norm_space(soup.title.get_text())

    # Published
    published = ""
    ogp = soup.find("meta", attrs={"property": "article:published_time"})
    if ogp and ogp.get("content"):
        published = parse_date_any(ogp["content"])
    if not published:
        tm = soup.find("time")
        if tm and (tm.get("datetime") or tm.get_text()):
            published = parse_date_any(tm.get("datetime") or tm.get_text())

    return (title, published)


def build_for_club(club: dict) -> tuple[SourceResult, list[dict]]:
    name = club.get("name", "")
    code = club.get("code", "")
    short = club.get("short", "") or name
    domain = (club.get("domain") or "").strip()
    base = "https://" + domain.lstrip("/")

    if not domain:
        return (SourceResult(name, domain, "", False, 0, "No domain"), [])

    # ---- 0) Hard overrides first ----
    ov = FEED_OVERRIDES.get(domain)
    if ov:
        if ov == "PITCHERO_SCRAPE":
            # Forced pitchero scrape mode for this domain
            return pitchero_scrape(name, code, short, domain, base)

        ok, final_url, items, err = try_feed(ov)
        if ok and len(items) > 0:
            return (
                SourceResult(name, domain, final_url, True, len(items), ""),
                [
                    {
                        "club": name,
                        "code": code,
                        "short": short,
                        "domain": domain,
                        "title": it["title"],
                        "url": it["url"],
                        "published": it["published"] or "",
                    }
                    for it in items[:MAX_ITEMS_PER_CLUB]
                ],
            )
        # Override exists but didn’t yield items
        # Fall through to other strategies but record the error context
        override_err = err or "Feed returned 0 usable items"
    else:
        override_err = ""

    # ---- 1) Try common feed endpoints ----
    candidate_feeds = [
        base.rstrip("/") + "/feed/",
        base.rstrip("/") + "/rss.xml",
        base.rstrip("/") + "/rss",
        base.rstrip("/") + "/news-rss.xml",
        base.rstrip("/") + "/news/rss.xml",
        base.rstrip("/") + "/news/feed/",
    ]

    best_feed = ""
    last_err = override_err or "No feed found"

    for f in candidate_feeds:
        ok, final_url, items, err = try_feed(f)
        if ok and len(items) > 0:
            best_feed = final_url
            return (
                SourceResult(name, domain, best_feed, True, len(items), ""),
                [
                    {
                        "club": name,
                        "code": code,
                        "short": short,
                        "domain": domain,
                        "title": it["title"],
                        "url": it["url"],
                        "published": it["published"] or "",
                    }
                    for it in items[:MAX_ITEMS_PER_CLUB]
                ],
            )
        if ok and len(items) == 0:
            last_err = "Feed returned 0 usable items"
            best_feed = final_url
        elif err:
            last_err = "Feed request failed"

    # ---- 2) WordPress REST fallback ----
    try:
        r = safe_get(base.rstrip("/") + "/wp-json/")
        if r.status_code == 200 and ("wp/v2" in (r.text or "")):
            posts = wp_rest_posts(base, per_page=MAX_ITEMS_PER_CLUB)
            if posts:
                return (
                    SourceResult(name, domain, base.rstrip("/") + "/wp-json/wp/v2/posts", True, len(posts), ""),
                    [
                        {
                            "club": name,
                            "code": code,
                            "short": short,
                            "domain": domain,
                            "title": p["title"],
                            "url": p["url"],
                            "published": p["published"] or "",
                        }
                        for p in posts[:MAX_ITEMS_PER_CLUB]
                    ],
                )
    except Exception:
        pass

    # ---- 3) Pitchero scrape fallback (custom domain) ----
    # IMPORTANT: we do NOT use pitchero.com RSS. Only scrape the club's domain.
    try:
        news_url = base.rstrip("/") + "/news"
        r = safe_get(news_url)
        if r.status_code == 200 and looks_like_pitchero(r.text):
            return pitchero_scrape(name, code, short, domain, base)
    except Exception:
        pass

    # ---- fail ----
    return (SourceResult(name, domain, best_feed, False, 0, last_err), [])


def pitchero_scrape(name: str, code: str, short: str, domain: str, base: str) -> tuple[SourceResult, list[dict]]:
    news_url = base.rstrip("/") + "/news"
    links = pitchero_list_links(news_url, limit=MAX_ITEMS_PER_CLUB)
    items = []
    for u in links:
        t, p = pitchero_article_meta(u)
        if t and u:
            items.append(
                {
                    "club": name,
                    "code": code,
                    "short": short,
                    "domain": domain,
                    "title": t,
                    "url": u,
                    "published": p or "",
                }
            )
        time.sleep(0.15)

    if items:
        return (SourceResult(name, domain, "pitchero:/news (scrape)", True, len(items), ""), items)

    return (SourceResult(name, domain, "pitchero:/news (scrape)", False, 0, "Pitchero scrape returned 0 usable items"), [])


def main():
    if not os.path.exists(CLUBS_META):
        print(f"Missing clubs-meta.json at {CLUBS_META}", file=sys.stderr)
        sys.exit(1)

    with open(CLUBS_META, "r", encoding="utf-8") as f:
        meta = json.load(f)

    clubs = meta.get("clubs", [])
    if not isinstance(clubs, list) or not clubs:
        print("clubs-meta.json has no clubs[]", file=sys.stderr)
        sys.exit(1)

    all_items = []
    sources = []
    failures = []

    total = len(clubs)
    ok_sources = 0

    for i, club in enumerate(clubs, start=1):
        name = club.get("name", "")
        domain = club.get("domain", "")
        print(f"[{i}/{total}] {name} ({domain})")

        src, items = build_for_club(club)

        sources.append(
            {
                "club": src.club,
                "domain": src.domain,
                "feed": src.feed,
                "ok": src.ok,
                "count": src.count,
                "error": src.error,
            }
        )

        if src.ok:
            ok_sources += 1
        else:
            failures.append(
                {
                    "club": src.club,
                    "domain": src.domain,
                    "feed": src.feed,
                    "ok": False,
                    "count": 0,
                    "error": src.error,
                }
            )

        all_items.extend(items)

        # be polite
        time.sleep(0.35)

    # sort newest-first (missing dates go last)
    def sort_key(it):
        p = it.get("published") or ""
        return p if p else "0000-00-00T00:00:00Z"

    all_items.sort(key=sort_key, reverse=True)

    out = {
        "version": VERSION,
        "generatedAt": iso_now(),
        "maxItems": MAX_ITEMS_GLOBAL,
        "sources": sources,
        "items": all_items[:MAX_ITEMS_GLOBAL],
    }

    out_fail = {
        "version": VERSION,
        "generatedAt": iso_now(),
        "failures": failures,
    }

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    with open(OUT_FAIL, "w", encoding="utf-8") as f:
        json.dump(out_fail, f, ensure_ascii=False, indent=2)

    print(f"Done. Sources OK: {ok_sources}/{total}. Items written: {len(out['items'])}")


if __name__ == "__main__":
    main()
