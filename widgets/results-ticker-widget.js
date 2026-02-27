/* Results Ticker Widget (v1.0) — Shadow DOM isolated embed
   - Feed: Google Sheets published "pubhtml" (scrapes the table)
   - Crests Home & Away (uses your existing crest naming convention)
   - Seamless loop with rose separators (separator after every item incl. last)
   - JS-driven scroll + pointer drag scrub (mobile/desktop)
*/
(function(){
  "use strict";

  const VERSION = "v1.0";

  const DEFAULTS = {
    pubhtml: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTOvhhj8bPbZCsAEOurgzBzK_iZN6-qCux9ThncoO7_gZuPWmCHfrxf3vReW8m97hJ4guc954TzRrra/pubhtml",
    maxItems: 40,
    height: 64,              // px
    speed: 52,               // px/sec (tweak)
    refreshMs: 120000,       // 2 min
    kitCss: "https://use.typekit.net/gff4ipy.css",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    roseImg: "National League rose.png",
    bg: "#ffffff",
    red: "#9e0000",
    blue: "#223b7c",
    text: "#111111",
    rule: "#000000",
    pillBg: "#ffffff",
    pillBorder: "#000000"
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

  function cssFor(opts){
    return `
:host{
  --brand-red:${opts.red};
  --brand-blue:${opts.blue};
  --bg:${opts.bg};
  --text:${opts.text};
  --rule:${opts.rule};
  --pill-bg:${opts.pillBg};
  --pill-border:${opts.pillBorder};
  --h:${opts.height}px;
  --crest:30px;
  --gap:16px;
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
  touch-action: pan-y;
  user-select:none;
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
  white-space:nowrap;
  will-change:transform;
  transform:translateX(0);
}

.lane{
  display:flex;
  align-items:center;
  gap:var(--gap);
}

.fixture{
  display:inline-flex;
  align-items:center;
  gap:10px;
}

.side{
  display:inline-flex;
  align-items:center;
  gap:10px;
}

.crest{
  width:var(--crest);
  height:var(--crest);
  object-fit:contain;
  display:block;
}

.crest.missing{ width:0; height:0; }

.team{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  letter-spacing:0.04em;
  font-size:16px;
  text-transform:uppercase;
  line-height:1;
  color:var(--brand-red);
}

.team.alt{ color:var(--brand-blue); }

.vrule{
  width:2px;
  height:26px;
  background:var(--rule);
  display:block;
}

.scorePill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:62px;
  height:30px;
  padding:0 10px;
  border:2px solid var(--pill-border);
  border-radius:999px;
  background:var(--pill-bg);
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  font-size:16px;
  color:var(--text);
  line-height:1;
}

.sep{
  display:inline-flex;
  align-items:center;
  padding:0 18px;
}

.rose{
  width:22px;
  height:22px;
  object-fit:contain;
  display:block;
}
`;
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
    wrap.setAttribute("role","region");
    wrap.setAttribute("aria-label","Results ticker");

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

    // Animation
    let shiftPx = 0;
    let offsetPx = 0;
    let lastTs = 0;
    let rafId = 0;

    // Scrub
    let dragging = false;
    let dragStartX = 0;
    let dragStartOffset = 0;

    let refreshTimer = null;
    let ro = null;

    function setTransform(){
      belt.style.transform = "translateX(" + offsetPx + "px)";
    }

    function normalizeOffset(){
      if(!shiftPx) return;
      while(offsetPx <= -shiftPx) offsetPx += shiftPx;
      while(offsetPx > 0) offsetPx -= shiftPx;
    }

    function tick(ts){
      if(!lastTs) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      if(!dragging && shiftPx > 0){
        offsetPx -= (opts.speed * dt);
        normalizeOffset();
        setTransform();
      }

      rafId = requestAnimationFrame(tick);
    }

    function startAnim(){
      if(rafId) cancelAnimationFrame(rafId);
      lastTs = 0;
      rafId = requestAnimationFrame(tick);
    }

    function onPointerDown(e){
      if(e.pointerType === "mouse" && e.button !== 0) return;

      dragging = true;
      dragStartX = e.clientX;
      dragStartOffset = offsetPx;
      try{ wrap.setPointerCapture(e.pointerId); }catch{}
    }

    function onPointerMove(e){
      if(!dragging || !shiftPx) return;
      const dx = e.clientX - dragStartX;
      offsetPx = dragStartOffset + dx;
      normalizeOffset();
      setTransform();
    }

    function onPointerUp(e){
      if(!dragging) return;
      dragging = false;
      try{ wrap.releasePointerCapture(e.pointerId); }catch{}
      lastTs = performance.now();
    }

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", onPointerUp);
    wrap.addEventListener("pointercancel", onPointerUp);

    function buildSepEl(rUrl){
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.setAttribute("aria-hidden","true");

      const img = document.createElement("img");
      img.className = "rose";
      img.alt = "";
      if(rUrl){
        img.src = rUrl;
      }else{
        img.style.display = "none";
      }

      sep.appendChild(img);
      return sep;
    }

    function buildFixtureEl(fx, idx){
      // Alternate colours per fixture to add rhythm
      const alt = (idx % 2 === 1);

      const wrapFx = document.createElement("span");
      wrapFx.className = "fixture";

      // Home side (crest then name)
      const homeSide = document.createElement("span");
      homeSide.className = "side";

      const hCrest = document.createElement("img");
      hCrest.className = "crest";
      hCrest.alt = safeText(fx.home) ? (safeText(fx.home) + " crest") : "";
      const hUrl = crestUrlForTeam(opts, fx.home);
      if(hUrl){
        hCrest.src = hUrl;
        hCrest.onerror = ()=> hCrest.classList.add("missing");
      }else{
        hCrest.classList.add("missing");
      }

      const hTeam = document.createElement("span");
      hTeam.className = "team" + (alt ? " alt" : "");
      hTeam.textContent = teamTextForGraphic(fx.home) || toAllCaps(fx.home);

      homeSide.appendChild(hCrest);
      homeSide.appendChild(hTeam);

      const vr1 = document.createElement("span");
      vr1.className = "vrule";
      vr1.setAttribute("aria-hidden","true");

      const score = document.createElement("span");
      score.className = "scorePill";
      score.textContent = fx.score;

      const vr2 = document.createElement("span");
      vr2.className = "vrule";
      vr2.setAttribute("aria-hidden","true");

      // Away side (name then crest)
      const awaySide = document.createElement("span");
      awaySide.className = "side";

      const aTeam = document.createElement("span");
      aTeam.className = "team" + (alt ? "" : " alt"); // flip to keep contrast
      aTeam.textContent = teamTextForGraphic(fx.away) || toAllCaps(fx.away);

      const aCrest = document.createElement("img");
      aCrest.className = "crest";
      aCrest.alt = safeText(fx.away) ? (safeText(fx.away) + " crest") : "";
      const aUrl = crestUrlForTeam(opts, fx.away);
      if(aUrl){
        aCrest.src = aUrl;
        aCrest.onerror = ()=> aCrest.classList.add("missing");
      }else{
        aCrest.classList.add("missing");
      }

      awaySide.appendChild(aTeam);
      awaySide.appendChild(aCrest);

      wrapFx.appendChild(homeSide);
      wrapFx.appendChild(vr1);
      wrapFx.appendChild(score);
      wrapFx.appendChild(vr2);
      wrapFx.appendChild(awaySide);

      return wrapFx;
    }

    function recomputeShift(){
      shiftPx = laneA.scrollWidth || 0;
      normalizeOffset();
      setTransform();
    }

    function render(fixtures){
      laneA.innerHTML = "";
      laneB.innerHTML = "";

      const rUrl = roseUrl(opts);

      function fillLane(lane){
        if(fixtures.length === 0) return;
        // IMPORTANT: add separator AFTER every fixture including last
        // so lane boundary is identical => seamless.
        fixtures.forEach((fx, idx)=>{
          lane.appendChild(buildFixtureEl(fx, idx));
          lane.appendChild(buildSepEl(rUrl));
        });
      }

      fillLane(laneA);
      fillLane(laneB);

      offsetPx = 0;
      setTransform();

      requestAnimationFrame(()=> requestAnimationFrame(recomputeShift));
    }

    function normalizeScore(s){
      const t = safeText(s);
      if(!t) return "";
      // Normalise to "x-x" with optional spaces trimmed
      return t.replace(/[–—]/g, "-").replace(/\s+/g,"").replace(/^(\d+)-(\d+)$/, "$1-$2");
    }

    function looksLikeHeader(home, score, away){
      const joined = (home + " " + score + " " + away).toLowerCase();
      return joined.includes("home") && joined.includes("score") && joined.includes("away");
    }

    async function fetchFromPubhtml(){
      const res = await fetch(opts.pubhtml, { cache:"no-store" });
      if(!res.ok) throw new Error("Feed fetch failed: " + res.status);
      const html = await res.text();

      const doc = new DOMParser().parseFromString(html, "text/html");
      const table = doc.querySelector("table.waffle") || doc.querySelector("table");
      if(!table) return [];

      const rows = Array.from(table.querySelectorAll("tbody tr"));
      const out = [];

      for(const tr of rows){
        const tds = Array.from(tr.querySelectorAll("td")).map(td => safeText(td.textContent));
        if(tds.length < 3) continue;

        const home = tds[0] || "";
        const scoreRaw = tds[1] || "";
        const away = tds[2] || "";

        if(!home && !scoreRaw && !away) continue;
        if(looksLikeHeader(home, scoreRaw, away)) continue;

        const score = normalizeScore(scoreRaw);
        if(!home || !away || !score) continue;

        out.push({ home, score, away });
        if(out.length >= opts.maxItems) break;
      }

      return out;
    }

    async function refresh(){
      try{
        const fixtures = await fetchFromPubhtml();
        render(fixtures);
      }catch(e){
        console.error("[ResultsTicker " + VERSION + "]", e);
      }
    }

    try{
      ro = new ResizeObserver(()=> recomputeShift());
      ro.observe(wrap);
    }catch{}

    refresh();
    refreshTimer = window.setInterval(refresh, opts.refreshMs);
    startAnim();

    return {
      destroy(){
        if(rafId) cancelAnimationFrame(rafId);
        if(refreshTimer) window.clearInterval(refreshTimer);
        if(ro) ro.disconnect();
      }
    };
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.pubhtml) opts.pubhtml = d.pubhtml;

    if(d.maxItems) opts.maxItems = clampInt(d.maxItems, 1, 200, DEFAULTS.maxItems);
    if(d.height) opts.height = clampInt(d.height, 30, 160, DEFAULTS.height);
    if(d.speed) opts.speed = clampInt(d.speed, 10, 500, DEFAULTS.speed);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;
    if(d.roseImg) opts.roseImg = d.roseImg;

    if(d.bg) opts.bg = d.bg;
    if(d.red) opts.red = d.red;
    if(d.blue) opts.blue = d.blue;
    if(d.text) opts.text = d.text;
    if(d.rule) opts.rule = d.rule;
    if(d.pillBg) opts.pillBg = d.pillBg;
    if(d.pillBorder) opts.pillBorder = d.pillBorder;

    return opts;
  }

  function clampInt(v, min, max, fallback){
    const n = parseInt(v, 10);
    if(Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function boot(){
    const nodes = document.querySelectorAll("[data-nl-results-ticker]");
    nodes.forEach(node => {
      if(node.__nlResultsTicker) return;
      node.__nlResultsTicker = makeWidget(node);
    });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
