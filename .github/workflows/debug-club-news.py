#!/usr/bin/env python3
# debug-club-news.py (v0.3)
#
# v0.3:
# - Workflow_dispatch + DEBUG_DOMAIN support
# - Sweeps feed endpoints for BOTH domain + www.domain (https)
# - Prints headers likely relevant to Cloudflare
# - Detects Cloudflare challenge pages
# - Writes debug-out/debug-<domain>.txt + debug-<domain>.json
# - Attempts to parse RSS/Atom when XML received (counts items + sample titles)

import json
import os
import re
import sys
import textwrap
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

VERSION = "v0.3"

DEFAULT_TIMEOUT = 25

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
CLUBS_META = os.path.join(REPO_ROOT, "assets", "data", "clubs-meta.json")

OUT_DIR = os.path.join(REPO_ROOT, "debug-out")

UA = (
    "nl-tools club-news debug/"
    + VERSION
    + " (+https://rckd-nl.github.io/nl-tools/)"
)

FEED_CANDIDATES = [
    "/feed/",
    "/feed",
    "/?feed=rss2",
    "/?feed=rss",
    "/?feed=atom",
    "/index.php?feed=rss2",
    "/index.php?feed=rss",
    "/index.php?feed=atom",
    "/news/feed/",
    "/category/news/feed/",
    "/wp-json/wp/v2/posts?per_page=5",
    "/wp-json/",
    "/news",
]

def iso_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def safe_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())

def first_n(s: str, n: int = 600) -> str:
    s = s or ""
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    return s[:n]

def strip_www(host: str) -> str:
    host = safe_text(host).lower()
    return host[4:] if host.startswith("www.") else host

def looks_like_cloudflare_challenge(body: str) -> bool:
    t = (body or "").lower()
    # Common Cloudflare challenge signatures
    return (
        "just a moment" in t
        or "cf-chl" in t
        or "cloudflare" in t and "attention required" in t
        or "checking your browser" in t
    )

def parse_rss_atom(xml_text: str) -> dict:
    soup = BeautifulSoup(xml_text, "xml")
    rss_items = soup.find_all("item")
    atom_entries = soup.find_all("entry")

    titles = []
    if rss_items:
        for it in rss_items[:5]:
            if it.title and it.title.get_text():
                titles.append(safe_text(it.title.get_text()))
    elif atom_entries:
        for ent in atom_entries[:5]:
            if ent.title and ent.title.get_text():
                titles.append(safe_text(ent.title.get_text()))

    return {
        "rssItemCount": len(rss_items),
        "atomEntryCount": len(atom_entries),
        "sampleTitles": titles
    }

def req(session: requests.Session, url: str) -> dict:
    try:
        r = session.get(
            url,
            timeout=DEFAULT_TIMEOUT,
            allow_redirects=True,
        )
        body = r.text or ""
        headers = {k.lower(): v for k, v in (r.headers or {}).items()}

        info = {
            "urlRequested": url,
            "urlFinal": r.url,
            "status": r.status_code,
            "contentType": headers.get("content-type", ""),
            "server": headers.get("server", ""),
            "cfRay": headers.get("cf-ray", ""),
            "location": headers.get("location", ""),
            "bodyFirst600": first_n(body, 600),
            "cloudflareChallenge": looks_like_cloudflare_challenge(body),
            "parsed": None,
        }

        # If it looks like XML, attempt to parse
        ct = (info["contentType"] or "").lower()
        if "xml" in ct or body.lstrip().startswith("<?xml") or "<rss" in body[:500].lower() or "<feed" in body[:500].lower():
            try:
                info["parsed"] = parse_rss_atom(body)
            except Exception as e:
                info["parsed"] = {"error": f"{type(e).__name__}: {e}"}

        return info
    except Exception as e:
        return {
            "urlRequested": url,
            "urlFinal": "",
            "status": None,
            "contentType": "",
            "server": "",
            "cfRay": "",
            "location": "",
            "bodyFirst600": "",
            "cloudflareChallenge": False,
            "parsed": None,
            "error": f"{type(e).__name__}: {e}",
        }

def main():
    domain = safe_text(os.getenv("DEBUG_DOMAIN", ""))
    if not domain:
        print("ERROR: DEBUG_DOMAIN not set", file=sys.stderr)
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)

    out_txt = os.path.join(OUT_DIR, f"debug-{strip_www(domain)}.txt")
    out_json = os.path.join(OUT_DIR, f"debug-{strip_www(domain)}.json")

    # Load clubs-meta and match
    club_match = None
    if os.path.exists(CLUBS_META):
        with open(CLUBS_META, "r", encoding="utf-8") as f:
            meta = json.load(f)
        clubs = meta.get("clubs", []) if isinstance(meta, dict) else []
        dom_key = strip_www(domain)
        for c in clubs:
            d = strip_www(c.get("domain", "") or "")
            if d and d == dom_key:
                club_match = c
                break

    # Session with “browser-ish” headers (still won’t beat CF JS challenge, but worth seeing)
    session = requests.Session()
    session.headers.update({
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "keep-alive",
    })

    report = {
        "version": VERSION,
        "generatedAt": iso_now(),
        "debugDomain": domain,
        "clubMetaMatch": {
            "name": club_match.get("name") if club_match else "",
            "domain": club_match.get("domain") if club_match else "",
            "code": club_match.get("code") if club_match else "",
        } if club_match else None,
        "attempts": []
    }

    lines = []
    lines.append("="*90)
    lines.append(f"Club news debug {VERSION} — {domain}")
    lines.append("="*90)
    lines.append(f"generatedAt: {report['generatedAt']}")
    if club_match:
        lines.append(f"clubs-meta match: {club_match.get('name','')} (domain={club_match.get('domain','')})")
    else:
        lines.append("clubs-meta match: NONE (domain not found in assets/data/clubs-meta.json)")
    lines.append("="*90)

    # Sweep both host variants (https only)
    hosts = []
    d0 = strip_www(domain)
    hosts.append(f"https://{d0}")
    hosts.append(f"https://www.{d0}")

    for base in hosts:
        lines.append("")
        lines.append("="*90)
        lines.append(f"BASE: {base}")
        lines.append("="*90)

        for path in FEED_CANDIDATES:
            url = base.rstrip("/") + path
            info = req(session, url)
            report["attempts"].append(info)

            lines.append("")
            lines.append(f"--- TRY --- {url}")
            if info.get("error"):
                lines.append(f"ERROR: {info['error']}")
                continue

            lines.append(f"STATUS: {info['status']}")
            lines.append(f"FINAL:  {info['urlFinal']}")
            lines.append(f"CT:     {info['contentType']}")
            lines.append(f"SERVER: {info['server']}")
            lines.append(f"CF-RAY: {info['cfRay']}")
            lines.append(f"LOC:    {info['location']}")
            lines.append(f"CF-CHL: {info['cloudflareChallenge']}")
            if info["parsed"]:
                p = info["parsed"]
                lines.append(f"PARSE:  {json.dumps(p, ensure_ascii=False)}")
            lines.append("BODY (first 600 chars):")
            lines.append(info["bodyFirst600"])

    # Summary: show any XML successes
    xml_ok = []
    for a in report["attempts"]:
        if a.get("status") == 200 and a.get("parsed") and isinstance(a["parsed"], dict):
            # consider it "ok" if it found RSS items or Atom entries
            if (a["parsed"].get("rssItemCount", 0) or 0) > 0 or (a["parsed"].get("atomEntryCount", 0) or 0) > 0:
                xml_ok.append(a)

    lines.append("")
    lines.append("="*90)
    lines.append("SUMMARY")
    lines.append("="*90)
    lines.append(f"Total attempts: {len(report['attempts'])}")
    lines.append(f"XML successes (parsed items/entries): {len(xml_ok)}")
    if xml_ok:
        for a in xml_ok[:5]:
            lines.append(f"- {a['urlFinal']} :: {a['parsed']}")
    else:
        # detect if cloudflare was consistent
        cf_hits = sum(1 for a in report["attempts"] if a.get("cloudflareChallenge"))
        lines.append(f"Cloudflare challenge pages detected: {cf_hits}")
        if cf_hits:
            lines.append("")
            lines.append("Interpretation:")
            lines.append("You are being served Cloudflare challenge pages from the GitHub Actions runner,")
            lines.append("so the feed XML is not reachable from that environment (even though it works in your browser).")
            lines.append("")
            lines.append("Most reliable fixes:")
            lines.append("1) Cloudflare allow/bypass rule for /feed* and/or ?feed=* (best if the club can do it).")
            lines.append("2) Use a self-hosted runner (requests come from your IP instead of GitHub datacentres).")

    with open(out_txt, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # Also print the path so it’s visible in Actions logs
    print(f"Wrote: {out_txt}")
    print(f"Wrote: {out_json}")

if __name__ == "__main__":
    main()
