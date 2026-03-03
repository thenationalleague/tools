/* Club News Feed Widget (v1.0.0) — Shadow DOM isolated embed
   - Renders assets/data/club-news.json as a vertical, stylised feed list
   - Styling matches News Ticker: Carbona, club pill colours from clubs-meta.json,
     crests from assets/crests/(TEAMNAME).png, and optional NL rose icon
   - Auto refresh + optional scroll container

   Host attributes (all optional):
   - data-json="https://.../assets/data/club-news.json"
   - data-clubs-meta="https://.../assets/data/clubs-meta.json"
   - data-max="25"
   - data-refresh-ms="120000"
   - data-height="520"              (px; list scrolls if set)
   - data-show-date="1"             (default 1)
   - data-show-source="0"           (default 0; shows item.club domain)
   - data-kit-css="https://use.typekit.net/gff4ipy.css"
   - data-crest-base="https://.../assets/crests/"
   - data-rose-img="National League rose.png"
   - data-bg="#ffffff"
   - data-headline="#000000"
   - data-muted="#57606a"
   - data-rule="#000000"
*/

(function(){
  "use strict";

  const VERSION = "v1.0.0";

  const DEFAULTS = {
    json: "https://rckd-nl.github.io/nl-tools/assets/data/club-news.json",
    clubsMeta: "https://rckd-nl.github.io/nl-tools/assets/data/clubs-meta.json",
    max: 25,
    refreshMs: 120000,
    height: 520,

    showDate: true,
    showSource: false,

    kitCss: "https://use.typekit.net/gff4ipy.css",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    roseImg: "National League rose.png",

    bg: "#ffffff",
    headline: "#000000",
    muted: "#57606a",
    rule: "#000000"
  };

  function safeText(s){ return (s || "").toString().replace(/\s+/g," ").trim(); }
  function resolveUrl(u){
    const raw = safeText(u);
    if(!raw) return "";
    try{ return new URL(raw, document.baseURI).toString(); }
    catch{ return raw; }
  }
  function clampInt(v, min, max, fallback){
    const n = parseInt(v, 10);
    if(Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normKey(s){
    return safeText(s).toLowerCase().replace(/&/g, "and");
  }
  function stripWww(host){
    const h = safeText(host).toLowerCase();
    if(!h) return "";
    return h.startsWith("www.") ? h.slice(4) : h;
  }

  function normalizeHexColor(s){
    const v = safeText(s);
    if(!v) return "";
    const x = v.startsWith("#") ? v : ("#" + v);
    return x.toUpperCase();
  }
  function normalizeBW(s, fallback){
    const v = normalizeHexColor(s);
    if(v === "#FFFFFF" || v === "#000000") return v;
    return fallback;
  }

  function clubPillColorsByMeta(meta){
    const colors = meta && meta.colors ? meta.colors : null;

    const primary = normalizeHexColor(colors && colors.primary) || "#E6E6E6";
    const secondary = normalizeBW(colors && colors.secondary, "#000000");
    const tertiary = normalizeHexColor(colors && colors.tertiary) || primary;

    return { primary, secondary, tertiary };
  }

  function crestUrlForTeam(opts, teamNameFromMeta){
    const t = safeText(teamNameFromMeta);
    if(!t) return null;
    const base = resolveUrl(opts.crestBase);
    return encodeURI(base + t + ".png");
  }

  function roseUrl(opts){
    const fn = safeText(opts.roseImg || "");
    if(!fn) return null;
    const base = resolveUrl(opts.crestBase);
    return encodeURI(base + fn);
  }

  function fmtDate(iso){
    const s = safeText(iso);
    if(!s) return "";
    const d = new Date(s);
    if(isNaN(d)) return "";
    // “3 Mar 2026, 14:05” style, local browser time
    try{
      return d.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }catch{
      return d.toISOString();
    }
  }

  // ===== Clubs meta cache =====
  let CLUBS_BY_DOMAIN = new Map();
  let CLUBS_LOADED = false;
  let CLUBS_LOADING = null;

  function addClubDomain(map, domain, clubObj){
    const d = stripWww(domain);
    if(!d) return;
    if(!map.has(d)) map.set(d, clubObj);
  }

  async function ensureClubsMeta(opts){
    if(CLUBS_LOADED) return;
    if(CLUBS_LOADING) return CLUBS_LOADING;

    CLUBS_LOADING = (async ()=>{
      try{
        const metaUrl = resolveUrl(opts.clubsMeta);
        const res = await fetch(metaUrl, { cache:"no-store" });
        if(!res.ok) throw new Error("clubs-meta fetch failed: " + res.status);
        const json = await res.json();
        const clubs = Array.isArray(json && json.clubs) ? json.clubs : [];

        const mapDomains = new Map();
        for(const c of clubs){
          if(!c) continue;
          if(c.domain) addClubDomain(mapDomains, c.domain, c);
        }

        CLUBS_BY_DOMAIN = mapDomains;
        CLUBS_LOADED = true;
      }catch(e){
        console.error("[Feed " + VERSION + "] clubs-meta load error:", e);
        CLUBS_BY_DOMAIN = new Map();
        CLUBS_LOADED = false;
      }finally{
        CLUBS_LOADING = null;
      }
    })();

    return CLUBS_LOADING;
  }

  function clubMetaForDomain(domainOrUrl){
    const u = safeText(domainOrUrl);
    if(!u) return null;

    // If it’s a URL, pull host; if it’s already a domain, use as-is
    try{
      const host = stripWww(new URL(u).hostname);
      return CLUBS_BY_DOMAIN.get(host) || null;
    }catch{
      const d = stripWww(u);
      return CLUBS_BY_DOMAIN.get(d) || null;
    }
  }

  function cssFor(opts){
    return `
:host{
  --bg:${opts.bg};
  --headline:${opts.headline};
  --muted:${opts.muted};
  --rule:${opts.rule};

  --radius:14px;
  --pad:14px;

  --crest:34px;
  --gap:12px;

  --rowPadY:12px;
  --rowPadX:12px;
  --rowHover: rgba(0,0,0,0.04);
}

*{ box-sizing:border-box; }

.wrap{
  background:var(--bg);
  border-radius:var(--radius);
  overflow:hidden;
  border:1px solid rgba(0,0,0,0.10);
}

.head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:var(--pad);
  border-bottom:1px solid rgba(0,0,0,0.10);
}

.title{
  display:flex;
  align-items:center;
  gap:10px;
  min-width:0;
}

.titleText{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  letter-spacing:0.02em;
  font-size:16px;
  color:var(--headline);
  text-transform:uppercase;
  white-space:nowrap;
}

.sub{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:450;
  color:var(--muted);
  font-size:12.5px;
  white-space:nowrap;
}

.rose{
  width:22px;
  height:22px;
  object-fit:contain;
  display:block;
}

.list{
  max-height:${opts.height}px;
  overflow:auto;
}

.row{
  display:flex;
  gap:var(--gap);
  padding:var(--rowPadY) var(--rowPadX);
  border-bottom:1px solid rgba(0,0,0,0.08);
  align-items:flex-start;
}

.row:last-child{ border-bottom:none; }

.row:hover{ background:var(--rowHover); }

.crest{
  width:var(--crest);
  height:var(--crest);
  object-fit:contain;
  display:block;
  margin-top:2px;
  flex:0 0 auto;
}

.crest.missing{ width:0; height:0; }

.body{
  min-width:0;
  flex:1 1 auto;
}

.topline{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
  margin-bottom:6px;
}

.clubpill{
  display:inline-flex;
  align-items:center;
  padding:7px 12px;
  border-radius:999px;
  border:2px solid var(--pill-border, #000000);
  background:var(--pill-bg, #E6E6E6);
  line-height:1;
}

.club{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  letter-spacing:0.04em;
  font-size:13px;
  text-transform:uppercase;
  color:var(--pill-fg, #000000);
  line-height:1;
}

.meta{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
}

.date{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:450;
  color:var(--muted);
  font-size:12.5px;
}

.source{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:450;
  color:var(--muted);
  font-size:12.5px;
}

.rule{
  width:2px;
  height:18px;
  background:var(--rule);
  display:inline-block;
  opacity:0.85;
}

.link{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:450;
  font-size:16px;
  color:var(--headline);
  text-decoration:none;
  line-height:1.18;
  display:inline;
  word-break:break-word;
}

.link:hover{ text-decoration:underline; }

.empty{
  padding:18px var(--pad);
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:450;
  color:var(--muted);
  font-size:14px;
}
`;
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.json) opts.json = d.json;
    if(d.clubsMeta) opts.clubsMeta = d.clubsMeta;
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);
    if(d.max) opts.max = clampInt(d.max, 1, 200, DEFAULTS.max);
    if(d.height) opts.height = clampInt(d.height, 160, 5000, DEFAULTS.height);

    if(d.showDate !== undefined) opts.showDate = safeText(d.showDate) !== "0";
    if(d.showSource !== undefined) opts.showSource = safeText(d.showSource) === "1";

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;
    if(d.roseImg) opts.roseImg = d.roseImg;

    if(d.bg) opts.bg = d.bg;
    if(d.headline) opts.headline = d.headline;
    if(d.muted) opts.muted = d.muted;
    if(d.rule) opts.rule = d.rule;

    opts.json = resolveUrl(opts.json);
    opts.clubsMeta = resolveUrl(opts.clubsMeta);
    opts.crestBase = resolveUrl(opts.crestBase);

    return opts;
  }

  function makeWidget(hostEl){
    const opts = readOptions(hostEl);
    const root = hostEl.attachShadow({ mode:"open" });

    if(opts.kitCss){
      const kit = document.createElement("link");
      kit.rel = "stylesheet";
      kit.href = opts.kitCss;
      root.appendChild(kit);
    }

    const style = document.createElement("style");
    style.textContent = cssFor(opts);
    root.appendChild(style);

    const wrap = document.createElement("div");
    wrap.className = "wrap";

    const head = document.createElement("div");
    head.className = "head";

    const title = document.createElement("div");
    title.className = "title";

    const rose = document.createElement("img");
    rose.className = "rose";
    rose.alt = "";
    const rUrl = roseUrl(opts);
    if(rUrl) rose.src = rUrl;
    else rose.style.display = "none";

    const titleText = document.createElement("div");
    titleText.className = "titleText";
    titleText.textContent = "Club News";

    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = "";

    title.appendChild(rose);
    title.appendChild(titleText);

    head.appendChild(title);
    head.appendChild(sub);

    const list = document.createElement("div");
    list.className = "list";

    wrap.appendChild(head);
    wrap.appendChild(list);
    root.appendChild(wrap);

    let refreshTimer = null;

    function renderEmpty(msg){
      list.innerHTML = "";
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = msg;
      list.appendChild(e);
    }

    function buildRow(item){
      // item shape from your builder:
      // {club, short, code, domain, title, url, published}
      const clubName = safeText(item && item.club);
      const domain = safeText(item && item.domain);
      const titleText = safeText(item && item.title);
      const href = safeText(item && item.url);
      const publishedIso = safeText(item && item.published);

      const meta = clubMetaForDomain(domain) || null;

      const row = document.createElement("div");
      row.className = "row";

      const crest = document.createElement("img");
      crest.className = "crest";
      crest.alt = clubName ? (clubName + " crest") : "";
      const cUrl = crestUrlForTeam(opts, meta && meta.name ? meta.name : clubName);
      if(cUrl){
        crest.src = cUrl;
        crest.onerror = ()=> crest.classList.add("missing");
      }else{
        crest.classList.add("missing");
      }

      const body = document.createElement("div");
      body.className = "body";

      const topline = document.createElement("div");
      topline.className = "topline";

      const pill = document.createElement("span");
      pill.className = "clubpill";

      const pillColors = clubPillColorsByMeta(meta);
      pill.style.setProperty("--pill-bg", pillColors.primary);
      pill.style.setProperty("--pill-fg", pillColors.secondary);
      pill.style.setProperty("--pill-border", pillColors.tertiary);

      const club = document.createElement("span");
      club.className = "club";
      club.textContent = (meta && meta.name) ? safeText(meta.name).toUpperCase() : (clubName ? clubName.toUpperCase() : "NEWS");
      pill.appendChild(club);

      topline.appendChild(pill);

      const metaLine = document.createElement("div");
      metaLine.className = "meta";

      let anyMeta = false;

      if(opts.showDate){
        const d = fmtDate(publishedIso);
        if(d){
          const dt = document.createElement("span");
          dt.className = "date";
          dt.textContent = d;
          metaLine.appendChild(dt);
          anyMeta = true;
        }
      }

      if(opts.showSource){
        if(anyMeta){
          const rule = document.createElement("span");
          rule.className = "rule";
          metaLine.appendChild(rule);
        }
        const s = document.createElement("span");
        s.className = "source";
        s.textContent = domain || "";
        metaLine.appendChild(s);
        anyMeta = true;
      }

      if(anyMeta){
        topline.appendChild(metaLine);
      }

      const link = document.createElement("a");
      link.className = "link";
      link.href = href || "#";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = titleText || "(Untitled)";

      body.appendChild(topline);
      body.appendChild(link);

      row.appendChild(crest);
      row.appendChild(body);

      return row;
    }

    async function refresh(){
      try{
        await ensureClubsMeta(opts);

        const res = await fetch(resolveUrl(opts.json), { cache:"no-store" });
        if(!res.ok) throw new Error("club-news.json fetch failed: " + res.status);
        const json = await res.json();

        const items = Array.isArray(json && json.items) ? json.items : [];
        const max = clampInt(opts.max, 1, 200, DEFAULTS.max);
        const sliced = items.slice(0, max);

        // header subtitle
        const genAt = safeText(json && json.generatedAt);
        sub.textContent = genAt ? ("Updated " + fmtDate(genAt)) : "";

        list.innerHTML = "";

        if(!sliced.length){
          renderEmpty("No items available.");
          return;
        }

        for(const it of sliced){
          list.appendChild(buildRow(it));
        }
      }catch(e){
        console.error("[Feed " + VERSION + "]", e);
        renderEmpty("Could not load feed.");
      }
    }

    refresh();
    refreshTimer = window.setInterval(refresh, opts.refreshMs);

    return {
      destroy(){
        if(refreshTimer) window.clearInterval(refreshTimer);
      }
    };
  }

  function boot(){
    const nodes = document.querySelectorAll("[data-nl-club-news-feed]");
    nodes.forEach(node => {
      if(node.__nlClubNewsFeed) return;
      node.__nlClubNewsFeed = makeWidget(node);
    });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
