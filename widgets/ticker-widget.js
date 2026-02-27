/* News Ticker Widget (v1.4) — Shadow DOM isolated embed
   Changes from v1.3:
   - Slower default scroll (40% slower vs previous default)
   - Vertical divider kept between team and headline
   - National League rose separator moved BETWEEN items (headline -> next team)
     with short “border” lines either side + a ring around the rose
*/
(function(){
  "use strict";

  const VERSION = "v1.4";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSuNN7o0PQ-YzDS7-oZe_D91PMpJmF9d6CYshqXcMOpJVq-WHceJN_qanp79QuwrqBMUX7KoGCMWXZm/pub?output=csv",
    maxItems: 10,
    height: 64,              // px
    speed: 48,               // px/sec (40% slower vs v1.3 default of 80)
    refreshMs: 120000,       // 2 min
    start: "red",            // "red" or "blue" (team name colour for first item)
    kitCss: "https://use.typekit.net/gff4ipy.css", // Adobe CSS (NOT the JS loader)
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    roseImg: "National League rose.png",
    bg: "#ffffff",
    red: "#9e0000",
    blue: "#223b7c",
    text: "#111111",
    rule: "#000000",
    roseRule: "#000000",
    roseRing: "#000000"
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

  function roseUrl(opts){
    const fn = safeText(opts.roseImg || "");
    if(!fn) return null;
    return encodeURI(opts.crestBase + fn);
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
  --text:${opts.text};
  --rule:${opts.rule};
  --rose-rule:${opts.roseRule};
  --rose-ring:${opts.roseRing};
  --h:${opts.height}px;
  --shift: 0px;
  --crest:34px;
  --gap:16px;
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

/* subtle mask edges */
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

.belt{
  display:flex;
  align-items:center;
  gap:0;
  white-space:nowrap;
  will-change:transform;
  animation: scroll var(--dur) linear infinite;
  transform:translateX(0);
}

.lane{
  display:flex;
  align-items:center;
  gap:var(--gap);
}

/* animate exactly one lane-width left (seamless) */
@keyframes scroll{
  from{ transform:translateX(0); }
  to{ transform:translateX(calc(-1 * var(--shift))); }
}

.wrap:hover .belt{ animation-play-state:paused; }

.item{
  display:inline-flex;
  align-items:center;
  gap:12px;
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

/* KEEP the vertical divider between team and headline */
.vrule{
  width:2px;
  height:26px;
  background:var(--rule);
  display:block;
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

/* Rose separator BETWEEN items */
.sep{
  display:inline-flex;
  align-items:center;
  gap:10px;
  padding:0 14px;
}

.sepLine{
  width:24px;              /* “same width as the rose itself” vibe */
  height:2px;
  background:var(--rose-rule);
  display:block;
}

.roseRing{
  width:26px;
  height:26px;
  border:2px solid var(--rose-ring);
  border-radius:999px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:var(--bg);
}

.rose{
  width:18px;
  height:18px;
  object-fit:contain;
  display:block;
}

@media (prefers-reduced-motion: reduce){
  .belt{ animation:none; }
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

    const belt = document.createElement("div");
    belt.className = "belt";

    const laneA = document.createElement("div");
    laneA.className = "lane";

    const laneB = document.createElement("div");
    laneB.className = "lane";

    belt.appendChild(laneA);
    belt.appendChild(laneB);
    wrap.appendChild(belt);
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
        console.error("[Ticker " + VERSION + "]", e);
      }
    }

    function render(items){
      laneA.innerHTML = "";
      laneB.innerHTML = "";

      const startRed = (opts.start || "red").toLowerCase() === "red";
      const rUrl = roseUrl(opts);

      // Build lane sequence: ITEM, SEP, ITEM, SEP, ... (no sep after last)
      function fillLane(lane){
        items.forEach((it, idx)=>{
          const isBase = startRed ? (idx % 2 === 0) : (idx % 2 === 1);
          lane.appendChild(buildItemEl(it, isBase ? "base" : "alt"));
          if(idx !== items.length - 1){
            lane.appendChild(buildSepEl(rUrl));
          }
        });
      }

      fillLane(laneA);
      fillLane(laneB);

      requestAnimationFrame(()=>{
        const w = laneA.scrollWidth || 1;
        const dur = Math.max(12, Math.round(w / opts.speed));

        // shift exactly one lane width (seamless)
        hostEl.style.setProperty("--shift", w + "px");

        // duration applies to belt animation
        belt.style.setProperty("--dur", dur + "s");
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

      const vrule = document.createElement("span");
      vrule.className = "vrule";
      vrule.setAttribute("aria-hidden","true");

      const a = document.createElement("a");
      a.className = "headline";
      a.href = it.hyperlink;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = it.headline;

      wrap.appendChild(crest);
      wrap.appendChild(club);
      wrap.appendChild(vrule);
      wrap.appendChild(a);

      return wrap;
    }

    function buildSepEl(rUrl){
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.setAttribute("aria-hidden","true");

      const l1 = document.createElement("span");
      l1.className = "sepLine";

      const ring = document.createElement("span");
      ring.className = "roseRing";

      const img = document.createElement("img");
      img.className = "rose";
      img.alt = "";
      if(rUrl){
        img.src = rUrl;
      }else{
        img.style.display = "none";
      }

      const l2 = document.createElement("span");
      l2.className = "sepLine";

      ring.appendChild(img);

      sep.appendChild(l1);
      sep.appendChild(ring);
      sep.appendChild(l2);

      return sep;
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
    if(d.speed) opts.speed = clampInt(d.speed, 20, 500, DEFAULTS.speed);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);
    if(d.start) opts.start = (d.start === "blue" ? "blue" : "red");

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;

    if(d.roseImg) opts.roseImg = d.roseImg;

    if(d.bg) opts.bg = d.bg;
    if(d.red) opts.red = d.red;
    if(d.blue) opts.blue = d.blue;
    if(d.text) opts.text = d.text;
    if(d.rule) opts.rule = d.rule;
    if(d.roseRule) opts.roseRule = d.roseRule;
    if(d.roseRing) opts.roseRing = d.roseRing;

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
