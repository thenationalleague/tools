#!/usr/bin/env python3
# build-club-news.py (v1.32)
#
# v1.32:
# - Pitchero scraping now uses month archive pages (/news?month=YYYY-MM) because /news is JS-driven
# - Keeps FEED_OVERRIDES (Aldershot + Altrincham + Boston included)
# - Keeps WP REST fallback
# - Improves per-club log lines so Actions output shows progress clearly
# - MAX_ITEMS_GLOBAL = 100

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

VERSION = "v1.32"

UA = (
    "nl-tools club-news builder/"
    + VERSION
    + " (+https://rckd-nl.github.io/nl-tools/)"
)

DEFAULT_TIMEOUT = 25
MAX_ITEMS_GLOBAL = 100
MAX_ITEMS_PER_CLUB = 20  # hard cap; global list still trimmed to MAX_ITEMS_GLOBAL

# ---- Feed overrides (domain -> feed URL) ----
FEED_OVERRIDES = {
    # Solved
    "theshots.co.uk": "https://www.theshots.co.uk/feed/",
    "altrinchamfc.com": "https://altrinchamfc.com/blogs/news.atom",

    # Pitchero custom-domain sites (scrape-only)
    "bostonunited.co.uk": "PITCHERO_SCRAPE",
}

# ---- Paths (repo-root aware) ----
# This script lives in .github/workflows/, so we anchor paths to repo root.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

CLUBS_META = os.path.join(REPO_ROOT, "assets", "data", "clubs-meta.json")
OUT_JSON = os.path.join(REPO_ROOT, "assets", "data", "club-news.json")
OUT_FAIL = os.path.join(REPO_ROOT, "assets", "data", "club-news-failures.json")


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


def month_key(dt: datetime) -> str:
    return f"{dt.year:04d}-{dt.month:02d}"


def add_months(dt: datetime, delta_months: int) -> datetime:
    """
    Move dt by delta_months, keeping day=1 to avoid month length issues.
    """
    y = dt.year
    m = dt.month + delta_months
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    return dt.replace(year=y, month=m, day=1)


def pitchero_list_links_month_archives(base: str, limit: int = 20, months_back: int = 18) -> list[str]:
    """
    Pitchero /news is often JS-driven with no server-rendered items.
    The month archives (/news?month=YYYY-MM) typically render links server-side.

    We crawl from current month backward until we gather enough /news/*.html links.
    """
    base = base.rstrip("/")
    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    seen = set()
    out: list[str] = []

    for k in range(0, months_back + 1):
        dt = add_months(start, -k)
        mk = month_key(dt)
        url = f"{base}/news?month={mk}"

        try:
            r = safe_get(url)
            if r.status_code != 200:
                continue

            soup = BeautifulSoup(r.text, "html.parser")

            for a in soup.find_all("a", href=True):
                href = (a["href"] or "").strip()
                if not href:
                    continue

                # Standard Pitchero news article pattern on custom domains
                # e.g. /news/programme--woking-2967522.html
                if re.search(r"^/news/.+\.html$", href):
                    full = urljoin(url, href)
                elif href.startswith("http"):
                    try:
                        if urlparse(href).netloc == urlparse(base).netloc and "/news/" in href and href.endswith(".html"):
                            full = href
                        else:
                            continue
                    except Exception:
                        continue
                else:
                    continue

                if full in seen:
                    continue
                seen.add(full)
                out.append(full)
                if len(out) >= limit:
                    return out

        except Exception:
            continue

        time.sleep(0.15)

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


def pitchero_scrape(name: str, code: str, short: str, domain: str, base: str) -> tuple[SourceResult, list[dict]]:
    # Crawl month archives to get article URLs
    links = pitchero_list_links_month_archives(base, limit=MAX_ITEMS_PER_CLUB, months_back=18)

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
        return (SourceResult(name, domain, "pitchero:/news?month=YYYY-MM (scrape)", True, len(items), ""), items)

    return (
        SourceResult(name, domain, "pitchero:/news?month=YYYY-MM (scrape)", False, 0, "Pitchero month-archive scrape returned 0 usable items"),
        [],
    )


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
        # Try month archive first (more reliable server-side HTML)
        test_url = base.rstrip("/") + "/news?month=" + month_key(datetime.now(timezone.utc))
        r = safe_get(test_url)
        if r.status_code == 200 and looks_like_pitchero(r.text):
            return pitchero_scrape(name, code, short, domain, base)
    except Exception:
        pass

    return (SourceResult(name, domain, best_feed, False, 0, last_err), [])


def main():
    if not os.path.exists(CLUBS_META):
        print(f"Missing clubs-meta.json at {CLUBS_META}", file=sys.stderr, flush=True)
        sys.exit(1)

    with open(CLUBS_META, "r", encoding="utf-8") as f:
        meta = json.load(f)

    clubs = meta.get("clubs", [])
    if not isinstance(clubs, list) or not clubs:
        print("clubs-meta.json has no clubs[]", file=sys.stderr, flush=True)
        sys.exit(1)

    all_items = []
    sources = []
    failures = []

    total = len(clubs)
    ok_sources = 0

    for i, club in enumerate(clubs, start=1):
        name = club.get("name", "")
        domain = club.get("domain", "")
        print(f"[{i}/{total}] {name} ({domain})", flush=True)

        src, items = build_for_club(club)

        # Extra per-club outcome line (helps quickly spot failures in Actions logs)
        if src.ok:
            print(f"  -> OK ({src.count}) via {src.feed}", flush=True)
        else:
            print(f"  -> FAIL via {src.feed} :: {src.error}", flush=True)

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

    print(f"Done. Sources OK: {ok_sources}/{total}. Items written: {len(out['items'])}", flush=True)


if __name__ == "__main__":
    main()
