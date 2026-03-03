#!/usr/bin/env python3
# build-club-news.py (v1.34)
#
# v1.34:
# - Adds Braintree table-based /news.html scraper (headline-boundary split)
# - Keeps existing feed overrides + WP REST + Pitchero scrape fallback
# - Writes club-news.json + club-news-failures.json

import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from html import unescape
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

VERSION = "v1.34"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36 "
    f"(nl-tools club-news builder/{VERSION})"
)

DEFAULT_TIMEOUT = 25
MAX_ITEMS_GLOBAL = 100
MAX_ITEMS_PER_CLUB = 25  # hard cap; global list still trimmed to MAX_ITEMS_GLOBAL

# ---- Feed overrides (domain -> feed URL) ----
FEED_OVERRIDES = {
    # Solved (WP / feeds etc.)
    "theshots.co.uk": "https://www.theshots.co.uk/feed/",
    "www.theshots.co.uk": "https://www.theshots.co.uk/feed/",
    "altrinchamfc.com": "https://altrinchamfc.com/blogs/news.atom",

    # Pitchero custom-domain sites (scrape-only)
    "bostonunited.co.uk": "PITCHERO_SCRAPE",
    "www.bostonunited.co.uk": "PITCHERO_SCRAPE",

    # Table-based legacy HTML (scrape-only)
    "braintreetownfc.org.uk": "BRAINTREE_SCRAPE",
    "www.braintreetownfc.org.uk": "BRAINTREE_SCRAPE",
}

# ---- Paths (repo-root aware) ----
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


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": UA,
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }
    )
    return s


SESS = _session()


def safe_get(url: str, timeout=DEFAULT_TIMEOUT) -> requests.Response:
    """
    GET with a retry once (helps when a site intermittently blocks "botty" requests).
    """
    last_exc = None
    for attempt in range(2):
        try:
            r = SESS.get(url, timeout=timeout, allow_redirects=True)
            return r
        except Exception as e:
            last_exc = e
            # tiny delay then retry
            time.sleep(0.4)
    raise last_exc


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
            # prefer rel="alternate" if present
            links = ent.find_all("link") if ent else []
            chosen = None
            for l in links:
                if l.get("rel") == "alternate" and l.get("href"):
                    chosen = l
                    break
            if not chosen:
                chosen = ent.find("link")
            if chosen and chosen.get("href"):
                link = norm_space(chosen.get("href"))

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


def _dedupe_preserve(seq: list[str]) -> list[str]:
    seen = set()
    out = []
    for x in seq:
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def _slugify(s: str, max_len: int = 60) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"&amp;", "and", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    if not s:
        s = "item"
    return s[:max_len]


def braintree_scrape(name: str, code: str, short: str, domain: str, base: str) -> tuple[SourceResult, list[dict]]:
    """
    Braintree Town:
    - Single legacy HTML page: /news.html
    - News entries are not individually linked and are not reliably dated.
    - We split items on headline blocks that appear as:
      <font color="#0000FF"><b>ALL CAPS HEADLINE</b>...
    Strategy:
    - Extract the left news <td width="700">...</td>
    - Split into items using a regex boundary on that blue headline pattern
    - Create stable per-item fragment URLs (#bt-<slug>-<n>)
    - Provide an estimated published timestamp (now - n minutes) to preserve ordering
    """
    news_url = base.rstrip("/") + "/news.html"
    r = safe_get(news_url)
    if r.status_code != 200:
        return (SourceResult(name, domain, "braintree:/news.html (table scrape)", False, 0, f"HTTP {r.status_code}"), [])

    soup = BeautifulSoup(r.text or "", "html.parser")

    # The page stores all news in the left TD, typically width="700"
    left_td = soup.find("td", attrs={"width": "700"})
    if left_td is None:
        # fallback: first TD that looks like the long text column
        tds = soup.find_all("td")
        left_td = tds[0] if tds else None

    if left_td is None:
        return (SourceResult(name, domain, "braintree:/news.html (table scrape)", False, 0, "Could not locate news <td>"), [])

    html = left_td.decode_contents() or ""

    # Split on headline markers: <font ... color="#0000FF" ...><b>HEADLINE</b>
    # Capture the headline text so split yields [preamble, H1, body1, H2, body2, ...]
    pat = re.compile(
        r'<font[^>]*color\s*=\s*["\']?#0000FF["\']?[^>]*>\s*<b>(.*?)</b>',
        re.IGNORECASE | re.DOTALL,
    )

    parts = pat.split(html)
    if len(parts) < 3:
        return (SourceResult(name, domain, "braintree:/news.html (table scrape)", False, 0, "No headline boundaries found"), [])

    now_utc = datetime.now(timezone.utc).replace(microsecond=0)

    items: list[dict] = []
    # parts layout: [preamble, H1, body1, H2, body2, ...]
    headlines = parts[1::2]
    bodies = parts[2::2]

    for idx, raw_head in enumerate(headlines[:MAX_ITEMS_PER_CLUB]):
        head_txt = norm_space(unescape(BeautifulSoup(raw_head, "html.parser").get_text(" ", strip=True)))
        if not head_txt:
            continue

        frag = f"bt-{_slugify(head_txt)}-{idx+1}"
        u = news_url + "#" + frag

        # Estimated published time to maintain order (page is newest-first).
        published_est = (now_utc - timedelta(minutes=idx)).isoformat().replace("+00:00", "Z")

        items.append(
            {
                "club": name,
                "code": code,
                "short": short,
                "domain": domain,
                "title": head_txt,
                "url": u,
                "published": published_est,
                "publishedEstimated": True,
            }
        )

    if items:
        return (SourceResult(name, domain, "braintree:/news.html (table scrape)", True, len(items), ""), items)

    return (SourceResult(name, domain, "braintree:/news.html (table scrape)", False, 0, "Braintree scrape returned 0 usable items"), [])


def pitchero_list_links(news_url: str, limit: int = 15) -> list[str]:
    """
    Scrape /news listing for article links.
    Pitchero custom domains commonly use: /news/some-slug-1234567.html

    IMPORTANT: Many Pitchero pages are client-rendered, so <a> tags may be absent
    in the initial HTML. We therefore also scan embedded JSON/scripts for /news/*.html.
    """
    r = safe_get(news_url)
    if r.status_code != 200:
        return []

    html = r.text or ""
    soup = BeautifulSoup(html, "html.parser")

    links: list[str] = []

    # 1) Normal anchors (works when server includes the links in HTML)
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

    # 2) Embedded JSON / script scan (works when client-rendered)
    # Look for /news/xxxxx.html inside the HTML (including __NEXT_DATA__)
    if len(links) < 3:
        found = re.findall(r'(/news/[^"\']+?\.html)', html)
        for rel in found:
            links.append(urljoin(news_url, rel))

    links = _dedupe_preserve(links)
    return links[:limit]


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

    # Extra fallback: scan scripts for ISO timestamps if meta tags missing
    if not published:
        m = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)', r.text or "")
        if m:
            published = parse_date_any(m.group(1))

    return (title, published)


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

        if ov == "BRAINTREE_SCRAPE":
            return braintree_scrape(name, code, short, domain, base)

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
            last_err = err or "Feed request failed"

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
    try:
        news_url = base.rstrip("/") + "/news"
        r = safe_get(news_url)
        if r.status_code == 200 and looks_like_pitchero(r.text):
            return pitchero_scrape(name, code, short, domain, base)
    except Exception:
        pass

    return (SourceResult(name, domain, best_feed, False, 0, last_err), [])


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
        print(f"[{i}/{total}] {name} ({domain})", flush=True)

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

        time.sleep(0.30)

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
