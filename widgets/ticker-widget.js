/* News Ticker Widget (v1.2) — Shadow DOM isolated embed */
(function(){
  "use strict";

  const VERSION = "v1.2";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSuNN7o0PQ-YzDS7-oZe_D91PMpJmF9d6CYshqXcMOpJVq-WHceJN_qanp79QuwrqBMUX7KoGCMWXZm/pub?output=csv",
    maxItems: 10,
    height: 64,             // px
    speed: 110,             // px/sec
    refreshMs: 120000,      // 2 min
    start: "red",           // "red" or "blue" (team name colour for first item)
    kitCss: "https://use.typekit.net/gff4ipy.css", // Adobe CSS (NOT the JS loader)
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    bg: "#ffffff",
    rule: "#000000",
    red: "#9e0000",
    blue: "#223b7c",
    text: "#111111"
  };

  const TEAMS = [
    "Aldershot Town","Altrincham","Boreham Wood","Boston United","Brackley Town","Braintree Town","Carlisle United","Eastleigh",
    "FC Halifax Town","Forest Green Rovers","Gateshead","Hartlepool United","Morecambe","Rochdale","Scunthorpe United","Solihull Moors",
    "Southend United","Sutton United","Tamworth","Truro City","Wealdstone","Woking","Yeovil Town","York City",
    "AFC Fylde","AFC Telford United","Alfreton Town","Bedford Town","Buxton","Chester","Chorley","Curzon Ashton","Darlington","Hereford",
    "Kidderminster Harriers","King's Lynn Town","Leamington","Macclesfield","Marine","Merthyr Town","Oxford City","Peterborough Sports",
    "Radcliffe","Scarborough Athletic","South Shields","Southport","Spennymoor Town","Worksop Town",
    "AFC Totton","Bath City","Chelmsford City","Chesham United","Chippenham Town","Dagenham & Redbridge","Dorking Wanderers","Dover Athletic",
    "Eastbourne Borough","Ebbsfleet United","Enfield Town","Farnborough","Hampton & Richmond Borough","Hemel Hempstead Town","Hornchurch","Horsham",
    "Maidenhead United","Maidstone United","Salisbury","Slough Town","Tonbridge Angels","Torquay United","Weston-super-Mare","Worthing"
  ];
  const TEAM_SET = new Set(TEAMS.map(t => t.toLowerCase()));

  function safeText(s){ return (s || "").toString().replace(/\s+/g," ").trim(); }
  function toAllCaps(s){ return safeText(s).toUpperCase(); }

  function teamTextForGraphic(teamName){
    const t = safeText(teamName);
    if(!t) return "";
    if(t.toLowerCase() === "hampton & richmond borough") return "HAMPTON & RICHMOND";
    return toAllCaps(t);
  }

  function crestUrlForTeam(opts, club){
    const t = safeText(club);
    if(!t) return null;
    if(!TEAM_SET.has(t.toLowerCase())) return null;
    return encodeURI(opts.crestBase + t + ".png");
  }

  // Robust CSV parser (handles quotes/commas reasonably)
  function parseCSV(text){
    const out = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for(let i=0;i<text.length;i++){
      const ch = text[i];
      const next = text[i+1];

      if(ch === '"' && inQuotes && next === '"'){
        cur += '"'; i++; continue;
      }
      if(ch === '"'){
        inQuotes = !inQuotes; continue;
      }
      if(!inQuotes && ch === ","){
        row.push(cur); cur = ""; continue;
      }
      if(!inQuotes && ch === "\n"){
        row.push(cur);
        out.push(row);
        row = [];
        cur = "";
        continue;
      }
      if(ch !== "\r") cur += ch;
    }
    if(cur.length || row.length){
      row.push(cur);
      out.push(row);
    }

    return out.map(r => r.map(c => safeText(c)));
  }

  function isHeaderRow(r){
    const joined = (r || []).join(" ").toLowerCase();
    return joined.includes("club") && joined.includes("headline");
  }

  function normaliseItems(items, maxItems){
    const out = [];
    for(const it of items){
      const club = safeText(it.club);
      const headline = safeText(it.headline);
      const hyperlink = safeText(it.hyperlink);
      if(!club || !headline || !hyperlink) continue;
      out.push({ club, headline, hyperlink });
      if(out.length >= maxItems) break;
    }
    return out;
  }

  function cssFor(opts){
    return `
:host{
  --brand-red:${opts.red};
  --brand-blue:${opts.blue};
  --bg:${opts.bg};
  --rule:${opts.rule};
  --text:${opts.text};
  --h:${opts.height}px;
  --crest:34px;
  --gap:16px;
  --rule-w:2px;
  --rule-h:26px;
  --pad:14px;
  --dur:30s;
}

*{ box-sizing:border-box; }

.wrap{
  height:var(--h);
  background:var(--bg);
  overflow:hidden;
  display:flex;
  align-items:center;
  position:relative;
  border-radius:10px;
}

/* subtle mask edges (keeps it “newsy” and tidy) */
.wrap:before,
.wrap:after{
  content:"";
  position:absolute;
  top:0; bottom:0;
  width:48px;
  pointer-events:none;
  z-index:3;
}
.wrap:before{
  left:0;
  background:linear-gradient(to right, var(--bg) 0%, rgba(255,255,255,0) 100%);
}
.wrap:after{
  right:0;
  background:linear-gradient(to left, var(--bg) 0%, rgba(255,255,255,0) 100%);
}

.track{
  display:flex;
  align-items:center;
  gap:var(--gap);
  white-space:nowrap;
  will-change:transform;
  animation: scroll var(--dur) linear infinite;
  padding-left:100%;
}

.track.dupe{ padding-left:0; }

@keyframes scroll{
  from{ transform:translateX(0); }
  to{ transform:translateX(-100%); }
}

.wrap:hover .track{ animation-play-state:paused; }

.item{
  display:inline-flex;
  align-items:center;
  gap:12px;
  padding-right:24px;
}

.crest{
  width:var(--crest);
  height:var(--crest);
  object-fit:contain;
  display:block;
}

.crest.missing{ width:0; height:0; }

.club{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  letter-spacing:0.04em;
  font-size:16px;
  text-transform:uppercase;
  line-height:1;
}

.rule{
  width:var(--rule-w);
  height:var(--rule-h);
  background:var(--rule);
}

.headline{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:450;
  font-size:16px;
  color:var(--text);
  text-decoration:none;
  line-height:1.1;
}

.headline:hover{ text-decoration:underline; }

/* alternating colour scheme */
.base .club{ color:var(--brand-red); }
.base .headline{ color:var(--brand-blue); }

.alt .club{ color:var(--brand-blue); }
.alt .headline{ color:var(--brand-red); }

@media (prefers-reduced-motion: reduce){
  .track{ animation:none; padding-left:0; }
  .wrap{ overflow:auto; }
}
`;
  }

  function makeWidget(hostEl){
    const opts = readOptions(hostEl);

    const root = hostEl.attachShadow({ mode:"open" });

    // Load Adobe kit CSS inside the shadow root (isolated)
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
    wrap.setAttribute("role","region");
    wrap.setAttribute("aria-label","Club news ticker");

    const trackA = document.createElement("div");
    trackA.className = "track";
    const trackB = document.createElement("div");
    trackB.className = "track dupe";

    wrap.appendChild(trackA);
    wrap.appendChild(trackB);
    root.appendChild(wrap);

    let refreshTimer = null;

    async function refresh(){
      try{
        const res = await fetch(opts.csv, { cache:"no-store" });
        if(!res.ok) throw new Error("Feed fetch failed: " + res.status);
        const csvText = await res.text();

        const rows = parseCSV(csvText).filter(r => r.some(c => safeText(c)));
        let start = 0;
        if(rows.length && isHeaderRow(rows[0])) start = 1;

        const items = [];
        for(let i=start;i<rows.length;i++){
          items.push({ club: rows[i][0], headline: rows[i][1], hyperlink: rows[i][2] });
        }

        const data = normaliseItems(items, opts.maxItems);
        render(data);
      }catch(e){
        // keep silent on page, but log for debug
        console.error("[Ticker " + VERSION + "]", e);
      }
    }

    function render(items){
      trackA.innerHTML = "";
      trackB.innerHTML = "";

      const startRed = (opts.start || "red").toLowerCase() === "red";

      items.forEach((it, idx)=>{
        const isBase = startRed ? (idx % 2 === 0) : (idx % 2 === 1);
        const itemEl = buildItemEl(it, isBase ? "base" : "alt");
        trackA.appendChild(itemEl);
      });

      items.forEach((it, idx)=>{
        const isBase = startRed ? (idx % 2 === 0) : (idx % 2 === 1);
        const itemEl = buildItemEl(it, isBase ? "base" : "alt");
        trackB.appendChild(itemEl);
      });

      // compute duration from content width
      requestAnimationFrame(()=>{
        const w = trackA.scrollWidth || 1;
        const dur = Math.max(12, Math.round(w / opts.speed));
        trackA.style.setProperty("--dur", dur + "s");
        trackB.style.setProperty("--dur", dur + "s");
      });
    }

    function buildItemEl(it, variantClass){
      const wrap = document.createElement("span");
      wrap.className = "item " + variantClass;

      const crest = document.createElement("img");
      crest.className = "crest";
      crest.alt = safeText(it.club) ? (safeText(it.club) + " crest") : "";

      const crestUrl = crestUrlForTeam(opts, it.club);
      if(crestUrl){
        crest.src = crestUrl;
        crest.onerror = ()=> crest.classList.add("missing");
      }else{
        crest.classList.add("missing");
      }

      const club = document.createElement("span");
      club.className = "club";
      club.textContent = teamTextForGraphic(it.club) || toAllCaps(it.club);

      const rule = document.createElement("span");
      rule.className = "rule";
      rule.setAttribute("aria-hidden","true");

      const a = document.createElement("a");
      a.className = "headline";
      a.href = it.hyperlink;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = it.headline;

      wrap.appendChild(crest);
      wrap.appendChild(club);
      wrap.appendChild(rule);
      wrap.appendChild(a);

      return wrap;
    }

    refresh();
    refreshTimer = window.setInterval(refresh, opts.refreshMs);

    return {
      destroy(){
        if(refreshTimer) window.clearInterval(refreshTimer);
      }
    };
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.csv) opts.csv = d.csv;
    if(d.maxItems) opts.maxItems = clampInt(d.maxItems, 1, 50, DEFAULTS.maxItems);
    if(d.height) opts.height = clampInt(d.height, 30, 160, DEFAULTS.height);
    if(d.speed) opts.speed = clampInt(d.speed, 40, 500, DEFAULTS.speed);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);
    if(d.start) opts.start = (d.start === "blue" ? "blue" : "red");

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;

    if(d.bg) opts.bg = d.bg;
    if(d.rule) opts.rule = d.rule;
    if(d.red) opts.red = d.red;
    if(d.blue) opts.blue = d.blue;
    if(d.text) opts.text = d.text;

    return opts;
  }

  function clampInt(v, min, max, fallback){
    const n = parseInt(v, 10);
    if(Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function boot(){
    const nodes = document.querySelectorAll("[data-nl-news-ticker]");
    nodes.forEach(node => {
      // prevent double-init
      if(node.__nlTicker) return;
      node.__nlTicker = makeWidget(node);
    });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
