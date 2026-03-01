/* Results Ticker Widget (v1.68) — Shadow DOM isolated embed
   Feed: Google Sheets published CSV
   Sheet columns:
   Date & Time | MD | Competition | Home team | Score | Away team

   v1.68:
   - Switcher ALWAYS uses brand red #9E0000
   - Stacked switcher on desktop (left column)
   - Mobile (≤768px): switcher moves to top as horizontal bar
   - Removes winner text animation entirely (performance)
   - Integrates clubs-meta.json with PRIMARY/SECONDARY/TERTIARY
     * pill BG = primary, text = secondary, border = tertiary
   - Score shows "v" when Score isn't a final n-n
   - Window filtering: daysBack/daysForward (default 3/3)
   - Drag scrub works; link click works; drag prevents click only when actual drag happened
   - All fixture elements link to Match Hub (new tab)
*/
(function(){
  "use strict";

  const VERSION = "v1.68";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTOvhhj8bPbZCsAEOurgzBzK_iZN6-qCux9ThncoO7_gZuPWmCHfrxf3vReW8m97hJ4guc954TzRrra/pub?output=csv",
    clubsMeta: "https://rckd-nl.github.io/nl-tools/assets/data/clubs-meta.json",

    maxItems: 60,
    height: 74,
    speed: 80,
    refreshMs: 120000,

    kitCss: "https://use.typekit.net/gff4ipy.css",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",

    bg: "#ffffff",
    text: "#111111",
    muted: "#6b7280",

    brand: "#9E0000",

    dividerColor: "#000000",
    dividerH: 30,
    dividerW: 2,
    dividerPad: 18,

    daysBack: 3,
    daysForward: 3,

    matchHubUrl: "https://www.thenationalleague.org.uk/match-hub/",

    // layout
    controlsWidth: 130
  };

  const COMP_DISPLAY = {
    "National": "Enterprise National League",
    "North": "Enterprise National League North",
    "South": "Enterprise National League South",
    "NL Cup": "National League Cup"
  };

  const STORAGE_PREFIX = "nlResultsTickerState:";

  function safeText(s){ return (s || "").toString().replace(/\s+/g," ").trim(); }

  function clampInt(v, min, max, fallback){
    const n = parseInt(v, 10);
    if(Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.csv) opts.csv = d.csv;
    if(d.clubsMeta) opts.clubsMeta = d.clubsMeta;

    if(d.maxItems) opts.maxItems = clampInt(d.maxItems, 1, 500, DEFAULTS.maxItems);
    if(d.height) opts.height = clampInt(d.height, 52, 140, DEFAULTS.height);
    if(d.speed) opts.speed = clampInt(d.speed, 10, 500, DEFAULTS.speed);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);

    if(d.bg) opts.bg = d.bg;
    if(d.text) opts.text = d.text;
    if(d.muted) opts.muted = d.muted;

    if(d.brand) opts.brand = d.brand;

    if(d.dividerColor) opts.dividerColor = d.dividerColor;
    if(d.dividerH) opts.dividerH = clampInt(d.dividerH, 10, 80, DEFAULTS.dividerH);
    if(d.dividerW) opts.dividerW = clampInt(d.dividerW, 1, 12, DEFAULTS.dividerW);
    if(d.dividerPad) opts.dividerPad = clampInt(d.dividerPad, 0, 60, DEFAULTS.dividerPad);

    if(d.daysBack) opts.daysBack = clampInt(d.daysBack, 0, 30, DEFAULTS.daysBack);
    if(d.daysForward) opts.daysForward = clampInt(d.daysForward, 0, 30, DEFAULTS.daysForward);

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;

    if(d.matchHubUrl) opts.matchHubUrl = d.matchHubUrl;

    if(d.controlsWidth) opts.controlsWidth = clampInt(d.controlsWidth, 100, 200, DEFAULTS.controlsWidth);

    return opts;
  }

  function cssFor(opts){
    return `
:host{
  display:block;
  width:100%;
  --bg:${opts.bg};
  --text:${opts.text};
  --muted:${opts.muted};
  --brand:${opts.brand};

  --h:${opts.height}px;
  --controls-w:${opts.controlsWidth}px;

  --crest:30px;

  --divider:${opts.dividerColor};
  --div-h:${opts.dividerH}px;
  --div-w:${opts.dividerW}px;
  --div-pad:${opts.dividerPad}px;
}

*{ box-sizing:border-box; }

.wrap{
  width:100%;
  display:flex;
  background:var(--bg);
  border-radius:12px;
  overflow:hidden;
  border:1px solid rgba(0,0,0,0.08);
  position:relative;
}

/* ===== Controls (desktop left) ===== */
.controlsCol{
  width:var(--controls-w);
  flex:0 0 var(--controls-w);
  display:flex;
  flex-direction:column;
  background:rgba(255,255,255,0.98);
  border-right:2px solid var(--brand);
}

.switcher{
  display:flex;
  flex-direction:column;
  height:100%;
}

.tbtn{
  appearance:none;
  border:0;
  background:transparent;
  padding:0 14px;
  height:calc(var(--h) / 2);
  display:flex;
  align-items:center;
  justify-content:flex-start;
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  font-size:13px;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--brand);
  cursor:pointer;
  user-select:none;
}

.tbtn + .tbtn{
  border-top:2px solid var(--brand);
}

.tbtn.active{
  background:var(--brand);
  color:#fff;
}

/* ===== Ticker area ===== */
.tickerCol{
  flex:1 1 auto;
  min-width:0;
  height:var(--h);
  overflow:hidden;
  position:relative;
}

.edgeMask:before,
.edgeMask:after{
  content:"";
  position:absolute;
  top:0; bottom:0;
  width:40px;
  pointer-events:none;
  z-index:6;
}
.edgeMask:before{
  left:0;
  background:linear-gradient(to right, var(--bg) 0%, rgba(255,255,255,0) 100%);
}
.edgeMask:after{
  right:0;
  background:linear-gradient(to left, var(--bg) 0%, rgba(255,255,255,0) 100%);
}

.belt{
  display:flex;
  align-items:center;
  height:100%;
  white-space:nowrap;
  will-change:transform;
  transform:translate3d(0,0,0);
}

.lane{
  display:flex;
  align-items:center;
}

.fixtureLink{
  display:inline-flex;
  align-items:center;
  text-decoration:none;
  color:inherit;
  padding:0 var(--div-pad);
  -webkit-tap-highlight-color: transparent;
}

.fixture{
  display:flex;
  flex-direction:column;
  justify-content:center;
  gap:6px;
  min-height:var(--h);
  padding:8px 0;
}

.meta{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:11px;
  color:var(--muted);
  white-space:nowrap;
  line-height:1.1;
}

.row{
  display:flex;
  align-items:center;
  gap:12px;
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

.teamPill{
  display:inline-flex;
  align-items:center;
  padding:6px 10px;
  border-radius:999px;
  border:2px solid rgba(0,0,0,0.18);
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  font-size:14px;
  letter-spacing:0.03em;
  text-transform:uppercase;
  line-height:1;
  white-space:nowrap;
}

.scorePill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:56px;
  height:30px;
  padding:0 12px;
  border:2px solid rgba(0,0,0,0.18);
  border-radius:999px;
  background:#fff;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  font-size:15px;
  color:var(--text);
  line-height:1;
  white-space:nowrap;
}

.divider{
  width:var(--div-w);
  height:var(--div-h);
  background:var(--divider);
  display:block;
  opacity:1;
}

/* Status/error */
.msg{
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  padding:0 14px;
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:14px;
  color:#111;
  background:var(--bg);
  z-index:8;
}
.msg strong{ font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }

/* ===== Mobile: switcher goes on top ===== */
@media (max-width: 768px){
  .wrap{
    flex-direction:column;
  }
  .controlsCol{
    width:100%;
    flex:0 0 auto;
    border-right:0;
    border-bottom:2px solid var(--brand);
  }
  .switcher{
    flex-direction:row;
    height:auto;
  }
  .tbtn{
    height:auto;
    padding:12px 0;
    justify-content:center;
    flex:1;
    font-size:12px;
  }
  .tbtn + .tbtn{
    border-top:0;
    border-left:2px solid var(--brand);
  }
  .tickerCol{
    height:var(--h);
  }
}
`;
  }

  // Robust CSV parser (handles quoted commas)
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

  function normalizeHeader(h){ return safeText(h).toLowerCase(); }

  function normalizeScoreCell(s){
    const t = safeText(s);
    if(!t) return "";
    return t.replace(/[–—]/g, "-").replace(/\s+/g,"");
  }

  function isScoreFinal(s){
    return /^\d+-\d+$/.test(normalizeScoreCell(s));
  }

  function parseUKDateTimeToLocal(dtStr){
    const s = safeText(dtStr);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(s);
    if(!m) return null;
    const dd = +m[1], mm = +m[2], yyyy = +m[3], hh = +m[4], mi = +m[5];
    const d = new Date(yyyy, mm-1, dd, hh, mi, 0, 0);
    if(!Number.isFinite(+d)) return null;
    return d;
  }

  function formatDddDMmmYYYYHHMM(d){
    const wd = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
    const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
    const day = d.getDate();
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,"0");
    const mi = String(d.getMinutes()).padStart(2,"0");
    return `${wd}, ${day} ${mon} ${yyyy} ${hh}:${mi}`;
  }

  function compDisplay(comp){
    const c = safeText(comp);
    return COMP_DISPLAY[c] || c || "—";
  }

  function storageKey(opts){
    return STORAGE_PREFIX + encodeURIComponent(opts.csv);
  }

  function loadState(opts){
    try{
      const raw = localStorage.getItem(storageKey(opts));
      if(!raw) return null;
      const s = JSON.parse(raw);
      if(!s || typeof s !== "object") return null;
      return s;
    }catch{
      return null;
    }
  }

  function saveState(opts, state){
    try{
      localStorage.setItem(storageKey(opts), JSON.stringify(state));
    }catch{}
  }

  function safeHexColor(x, fallback){
    const s = safeText(x);
    if(/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(s)) return s.toUpperCase();
    return fallback;
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache:"no-store" });
    if(!res.ok) throw new Error("JSON fetch failed: " + res.status);
    return await res.json();
  }

  function buildClubColorMap(meta){
    const map = new Map();
    if(!meta || !Array.isArray(meta.clubs)) return map;

    for(const c of meta.clubs){
      const name = safeText(c && c.name);
      if(!name) continue;

      const primary = safeHexColor(c?.colors?.primary, "#111111");
      const secondary = safeHexColor(c?.colors?.secondary, "#FFFFFF");

      // tertiary: use provided if present, else repeat secondary
      const tertiary = safeHexColor(c?.colors?.tertiary, secondary);

      map.set(name.toLowerCase(), { primary, secondary, tertiary });
    }
    return map;
  }

  function crestUrlForTeam(opts, club){
    const t = safeText(club);
    if(!t) return null;
    return encodeURI(opts.crestBase + t + ".png");
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
    wrap.setAttribute("aria-label","Fixtures and results ticker");
    root.appendChild(wrap);

    // Controls column
    const controlsCol = document.createElement("div");
    controlsCol.className = "controlsCol";
    wrap.appendChild(controlsCol);

    const switcher = document.createElement("div");
    switcher.className = "switcher";
    controlsCol.appendChild(switcher);

    const btnFixtures = document.createElement("button");
    btnFixtures.className = "tbtn";
    btnFixtures.type = "button";
    btnFixtures.textContent = "FIXTURES";

    const btnResults = document.createElement("button");
    btnResults.className = "tbtn";
    btnResults.type = "button";
    btnResults.textContent = "RESULTS";

    switcher.appendChild(btnFixtures);
    switcher.appendChild(btnResults);

    // Ticker column
    const tickerCol = document.createElement("div");
    tickerCol.className = "tickerCol edgeMask";
    wrap.appendChild(tickerCol);

    const belt = document.createElement("div");
    belt.className = "belt";
    tickerCol.appendChild(belt);

    const laneA = document.createElement("div");
    laneA.className = "lane";
    const laneB = document.createElement("div");
    laneB.className = "lane";
    belt.appendChild(laneA);
    belt.appendChild(laneB);

    const msg = document.createElement("div");
    msg.className = "msg";
    msg.innerHTML = `<strong>Loading…</strong>`;
    tickerCol.appendChild(msg);

    // State
    let clubColors = new Map();
    let allItems = [];
    let mode = "results";

    // Animation state
    let shiftPx = 0;
    let offsetPx = 0;
    let lastTs = 0;
    let rafId = 0;

    // Drag state
    const DRAG_THRESHOLD_PX = 6;
    let dragging = false;
    let dragStartX = 0;
    let dragStartOffset = 0;
    let didDrag = false;

    let refreshTimer = null;
    let ro = null;

    // Restore persisted state
    const persisted = loadState(opts);
    if(persisted && (persisted.mode === "fixtures" || persisted.mode === "results")){
      mode = persisted.mode;
    }
    if(persisted && typeof persisted.offsetPx === "number" && Number.isFinite(persisted.offsetPx)){
      offsetPx = persisted.offsetPx;
    }

    function setTransform(){
      belt.style.transform = "translate3d(" + offsetPx + "px,0,0)";
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

    function persist(){
      saveState(opts, { mode, offsetPx, savedAt: Date.now() });
    }

    function applyModeUI(){
      btnFixtures.classList.toggle("active", mode === "fixtures");
      btnResults.classList.toggle("active", mode === "results");
    }

    function setMode(newMode){
      mode = newMode;
      applyModeUI();
      persist();
      render();
    }

    btnFixtures.addEventListener("click", (e)=>{
      e.stopPropagation();
      setMode("fixtures");
    });
    btnResults.addEventListener("click", (e)=>{
      e.stopPropagation();
      setMode("results");
    });
    applyModeUI();

    // Drag scrub on ticker area only
    tickerCol.addEventListener("pointerdown", (e)=>{
      if(e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      didDrag = false;
      dragStartX = e.clientX;
      dragStartOffset = offsetPx;
      try{ tickerCol.setPointerCapture(e.pointerId); }catch{}
    });

    tickerCol.addEventListener("pointermove", (e)=>{
      if(!dragging || !shiftPx) return;
      const dx = e.clientX - dragStartX;
      if(Math.abs(dx) > DRAG_THRESHOLD_PX) didDrag = true;
      offsetPx = dragStartOffset + dx;
      normalizeOffset();
      setTransform();
    });

    tickerCol.addEventListener("pointerup", (e)=>{
      if(!dragging) return;
      dragging = false;
      try{ tickerCol.releasePointerCapture(e.pointerId); }catch{}
      lastTs = performance.now();
      persist();
    });

    tickerCol.addEventListener("pointercancel", ()=>{
      dragging = false;
      didDrag = false;
    });

    // Cancel navigation only if actual drag happened
    tickerCol.addEventListener("click", (e)=>{
      if(!didDrag) return;
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if(a){
        e.preventDefault();
        e.stopPropagation();
      }
      didDrag = false;
    }, false);

    function buildDividerEl(){
      const d = document.createElement("span");
      d.className = "divider";
      d.setAttribute("aria-hidden","true");
      return d;
    }

    function teamPillEl(teamName){
      const name = safeText(teamName);
      const pill = document.createElement("span");
      pill.className = "teamPill";

      const colors = clubColors.get(name.toLowerCase());
      if(colors){
        pill.style.background = colors.primary;
        pill.style.color = colors.secondary;
        pill.style.borderColor = colors.tertiary;
      }else{
        pill.style.background = "#111111";
        pill.style.color = "#FFFFFF";
        pill.style.borderColor = "rgba(0,0,0,0.18)";
      }

      pill.textContent = name.toUpperCase();
      return pill;
    }

    function buildFixtureEl(fx){
      const link = document.createElement("a");
      link.className = "fixtureLink";
      link.href = opts.matchHubUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      const box = document.createElement("span");
      box.className = "fixture";

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = fx.dt ? (formatDddDMmmYYYYHHMM(fx.dt) + " • " + compDisplay(fx.comp)) : compDisplay(fx.comp);

      const row = document.createElement("div");
      row.className = "row";

      const homeSide = document.createElement("span");
      homeSide.className = "side";

      const hCrest = document.createElement("img");
      hCrest.className = "crest";
      hCrest.alt = safeText(fx.home) ? (safeText(fx.home) + " crest") : "";
      const hUrl = crestUrlForTeam(opts, fx.home);
      if(hUrl){
        hCrest.src = hUrl;
        hCrest.loading = "lazy";
        hCrest.decoding = "async";
        hCrest.onerror = ()=> hCrest.classList.add("missing");
      }else{
        hCrest.classList.add("missing");
      }

      const hPill = teamPillEl(fx.home);

      const score = document.createElement("span");
      score.className = "scorePill";
      score.textContent = fx.isFinal ? normalizeScoreCell(fx.scoreRaw) : "v";

      const awaySide = document.createElement("span");
      awaySide.className = "side";

      const aPill = teamPillEl(fx.away);

      const aCrest = document.createElement("img");
      aCrest.className = "crest";
      aCrest.alt = safeText(fx.away) ? (safeText(fx.away) + " crest") : "";
      const aUrl = crestUrlForTeam(opts, fx.away);
      if(aUrl){
        aCrest.src = aUrl;
        aCrest.loading = "lazy";
        aCrest.decoding = "async";
        aCrest.onerror = ()=> aCrest.classList.add("missing");
      }else{
        aCrest.classList.add("missing");
      }

      homeSide.appendChild(hCrest);
      homeSide.appendChild(hPill);

      awaySide.appendChild(aPill);
      awaySide.appendChild(aCrest);

      row.appendChild(homeSide);
      row.appendChild(score);
      row.appendChild(awaySide);

      box.appendChild(meta);
      box.appendChild(row);
      link.appendChild(box);

      return link;
    }

    function recomputeShift(){
      shiftPx = laneA.scrollWidth || 0;
      normalizeOffset();
      setTransform();
    }

    function render(){
      const now = new Date();
      const start = new Date(now);
      start.setHours(0,0,0,0);

      const from = new Date(start);
      from.setDate(from.getDate() - opts.daysBack);

      const to = new Date(start);
      to.setDate(to.getDate() + opts.daysForward + 1);

      let items = allItems.filter(it => it.dt && it.dt >= from && it.dt < to);

      if(mode === "fixtures") items = items.filter(it => !it.isFinal);
      else items = items.filter(it => it.isFinal);

      items.sort((a,b)=> (+a.dt) - (+b.dt));

      if(items.length > opts.maxItems){
        items = items.slice(items.length - opts.maxItems);
      }

      laneA.innerHTML = "";
      laneB.innerHTML = "";

      if(!items.length){
        msg.style.display = "flex";
        msg.innerHTML = `<strong>${mode === "fixtures" ? "FIXTURES" : "RESULTS"}:</strong>&nbsp;none in ±${Math.max(opts.daysBack, opts.daysForward)} days.`;
        offsetPx = 0;
        setTransform();
        shiftPx = 0;
        return;
      }

      msg.style.display = "none";

      const fragA = document.createDocumentFragment();
      const fragB = document.createDocumentFragment();

      for(const fx of items){
        fragA.appendChild(buildFixtureEl(fx));
        fragA.appendChild(buildDividerEl());
      }
      for(const fx of items){
        fragB.appendChild(buildFixtureEl(fx));
        fragB.appendChild(buildDividerEl());
      }

      laneA.appendChild(fragA);
      laneB.appendChild(fragB);

      requestAnimationFrame(()=> requestAnimationFrame(recomputeShift));
    }

    async function refresh(){
      try{
        msg.style.display = "flex";
        msg.innerHTML = `<strong>Loading…</strong>`;

        const [csvText, clubsMeta] = await Promise.all([
          fetch(opts.csv, { cache:"no-store" }).then(r=>{
            if(!r.ok) throw new Error("Feed fetch failed: " + r.status);
            return r.text();
          }),
          fetchJson(opts.clubsMeta).catch(()=> null)
        ]);

        clubColors = buildClubColorMap(clubsMeta);

        const rows = parseCSV(csvText);
        if(!rows.length){
          msg.style.display = "flex";
          msg.innerHTML = `<strong>Error:</strong> CSV has no rows.`;
          return;
        }

        const header = rows[0].map(normalizeHeader);

        const idxDateTime = header.indexOf("date & time");
        const idxComp     = header.indexOf("competition");
        const idxHome     = header.indexOf("home team");
        const idxScore    = header.indexOf("score");
        const idxAway     = header.indexOf("away team");

        const missing = [];
        if(idxDateTime === -1) missing.push("Date & Time");
        if(idxComp === -1) missing.push("Competition");
        if(idxHome === -1) missing.push("Home team");
        if(idxScore === -1) missing.push("Score");
        if(idxAway === -1) missing.push("Away team");

        if(missing.length){
          msg.style.display = "flex";
          msg.innerHTML = `<strong>Error:</strong> Missing columns: ${missing.join(", ")}.`;
          return;
        }

        const parsed = [];
        for(let i=1; i<rows.length; i++){
          const r = rows[i];
          if(!r || !r.length) continue;

          const dtRaw = safeText(r[idxDateTime]);
          const dt = parseUKDateTimeToLocal(dtRaw);
          if(!dt) continue;

          const comp = safeText(r[idxComp]);
          const home = safeText(r[idxHome]);
          const scoreRaw = safeText(r[idxScore]);
          const away = safeText(r[idxAway]);

          if(!home || !away) continue;

          parsed.push({
            dt,
            comp,
            home,
            away,
            scoreRaw,
            isFinal: isScoreFinal(scoreRaw)
          });
        }

        allItems = parsed;
        render();
      }catch(e){
        console.error("[ResultsTicker " + VERSION + "] refresh error", e);
        msg.style.display = "flex";
        msg.innerHTML = `<strong>Error:</strong> Feed/parse failed.`;
      }
    }

    try{
      ro = new ResizeObserver(()=> recomputeShift());
      ro.observe(tickerCol);
    }catch{}

    refresh();
    refreshTimer = window.setInterval(refresh, opts.refreshMs);

    setTransform();
    normalizeOffset();
    setTransform();
    startAnim();

    return {
      destroy(){
        if(rafId) cancelAnimationFrame(rafId);
        if(refreshTimer) window.clearInterval(refreshTimer);
        if(ro) ro.disconnect();
      }
    };
  }

  function bootOnce(){
    const nodes = document.querySelectorAll("[data-nl-results-ticker]");
    nodes.forEach(node => {
      if(node.__nlResultsTicker) return;
      try{
        node.__nlResultsTicker = makeWidget(node);
      }catch(e){
        console.error("[ResultsTicker " + VERSION + "] boot error", e);
      }
    });
  }

  function boot(){
    bootOnce();
    const mo = new MutationObserver(()=>{ bootOnce(); });
    mo.observe(document.documentElement, { childList:true, subtree:true });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
