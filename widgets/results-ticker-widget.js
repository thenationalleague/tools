/* Results Ticker Widget (v1.65) — Shadow DOM isolated embed
   Feed: Google Sheets published CSV
   Sheet columns:
   Date & Time | MD | Competition | Home team | Score | Away team

   v1.65:
   - Switcher back to STACKED (FIXTURES / RESULTS)
   - Cleaner, more defined controls: single unified panel (no nested rounded boxes)
   - Controls panel runs full ticker height + has hard right-edge divider so ticker feels "separated"
   - Winner text animation remains REMOVED (smoothness)
   - Keeps: club primary/secondary/tertiary pills (tertiary = pill border), drag scrub, link click, 3-day window, persistence
*/
(function(){
  "use strict";

  const VERSION = "v1.65";

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

    // fallback border if club has no meta
    pillBorder: "#000000",

    dividerColor: "#000000",
    dividerH: 30,
    dividerW: 2,
    dividerPad: 18,

    daysBack: 3,
    daysForward: 3,

    matchHubUrl: "https://www.thenationalleague.org.uk/match-hub/",

    // Switcher
    switcher: "stacked",      // "stacked" | "segmented" (segmented kept for compatibility)

    // Controls panel sizing
    controlsPad: 8,           // px padding inside wrap at top/left/bottom
    controlsWidth: 116,       // px (min width of controls panel)

    // Network hardening
    fetchTimeoutMs: 12000
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
    if(d.height) opts.height = clampInt(d.height, 46, 140, DEFAULTS.height);
    if(d.speed) opts.speed = clampInt(d.speed, 10, 500, DEFAULTS.speed);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);

    if(d.dividerColor) opts.dividerColor = d.dividerColor;
    if(d.dividerH) opts.dividerH = clampInt(d.dividerH, 10, 80, DEFAULTS.dividerH);
    if(d.dividerW) opts.dividerW = clampInt(d.dividerW, 1, 12, DEFAULTS.dividerW);
    if(d.dividerPad) opts.dividerPad = clampInt(d.dividerPad, 0, 60, DEFAULTS.dividerPad);

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;

    if(d.bg) opts.bg = d.bg;
    if(d.text) opts.text = d.text;
    if(d.muted) opts.muted = d.muted;
    if(d.pillBorder) opts.pillBorder = d.pillBorder;

    if(d.daysBack) opts.daysBack = clampInt(d.daysBack, 0, 30, DEFAULTS.daysBack);
    if(d.daysForward) opts.daysForward = clampInt(d.daysForward, 0, 30, DEFAULTS.daysForward);

    if(d.matchHubUrl) opts.matchHubUrl = d.matchHubUrl;

    if(d.switcher){
      const s = safeText(d.switcher).toLowerCase();
      if(s === "segmented" || s === "stacked") opts.switcher = s;
    }

    if(d.controlsPad) opts.controlsPad = clampInt(d.controlsPad, 0, 18, DEFAULTS.controlsPad);
    if(d.controlsWidth) opts.controlsWidth = clampInt(d.controlsWidth, 84, 180, DEFAULTS.controlsWidth);

    if(d.fetchTimeoutMs) opts.fetchTimeoutMs = clampInt(d.fetchTimeoutMs, 2000, 60000, DEFAULTS.fetchTimeoutMs);

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
  --h:${opts.height}px;

  --crest:30px;

  --pill-border:${opts.pillBorder};
  --divider:${opts.dividerColor};
  --div-h:${opts.dividerH}px;
  --div-w:${opts.dividerW}px;
  --div-pad:${opts.dividerPad}px;

  --controls-pad:${opts.controlsPad}px;
  --controls-w:${opts.controlsWidth}px;
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
  border:1px solid rgba(0,0,0,0.08);
}

/* mask edges */
.wrap:before,
.wrap:after{
  content:"";
  position:absolute;
  top:0; bottom:0;
  width:46px;
  pointer-events:none;
  z-index:6;
}
.wrap:before{
  left:0;
  background:linear-gradient(to right, var(--bg) 0%, rgba(255,255,255,0) 100%);
}
.wrap:after{
  right:0;
  background:linear-gradient(to left, var(--bg) 0%, rgba(255,255,255,0) 100%);
}

/* ===== Controls: unified full-height panel ===== */
.controls{
  position:absolute;
  top:0;
  left:0;
  bottom:0;
  z-index:10;
  padding:var(--controls-pad);
  pointer-events:auto;
  display:flex;
  align-items:stretch;
}

/* This is the single panel (no nested rounded boxes) */
.controlsPanel{
  position:relative;
  width:var(--controls-w);
  height:100%;
  border-radius:10px;
  border:2px solid rgba(0,0,0,0.14);
  background:rgba(255,255,255,0.96);
  overflow:hidden;
  box-shadow:0 1px 0 rgba(0,0,0,.04);
  display:flex;
  flex-direction:column;
}

/* Hard divider at right edge to "separate" controls from ticker */
.controlsPanel:after{
  content:"";
  position:absolute;
  top:0;
  right:-2px;
  bottom:0;
  width:2px;
  background:rgba(0,0,0,0.20);
}

/* Switcher STACKED */
.switcher.stacked{
  display:flex;
  flex-direction:column;
  height:100%;
}

.tbtn{
  appearance:none;
  border:0;
  background:transparent;
  padding:10px 12px;
  font-family:"carbona-variable", system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  font-size:13px;
  letter-spacing:.10em;
  text-transform:uppercase;
  color:var(--text);
  cursor:pointer;
  line-height:1;
  text-align:left;
  flex:1 1 50%;
  display:flex;
  align-items:center;
}

.tbtn + .tbtn{
  border-top:2px solid rgba(0,0,0,0.14);
}

.tbtn.active{
  background:#0b0f19;
  color:#fff;
}

/* Accessibility focus */
.tbtn:focus{ outline:none; }
.tbtn:focus-visible{
  box-shadow:0 0 0 3px rgba(11,15,25,0.18) inset;
}

/* ===== Belt ===== */
.belt{
  display:flex;
  align-items:center;
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
  min-height: calc(var(--h) - 12px);
  padding:6px 0;
}

.meta{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:11px;
  color:var(--muted);
  letter-spacing:.2px;
  white-space:nowrap;
  line-height:1;
  text-align:left;
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
  border:2px solid var(--pill-border);
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:900;
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
  min-width:60px;
  height:30px;
  padding:0 12px;
  border:2px solid rgba(0,0,0,0.14);
  border-radius:999px;
  background:#fff;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:900;
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

/* Message */
.msg{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:14px;
  color:#111;
  padding:0 14px;
  white-space:nowrap;
}
.msg strong{ font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
`;
  }

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
    if(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s.toUpperCase();
    return fallback;
  }

  async function fetchWithTimeout(url, timeoutMs){
    const controller = new AbortController();
    const id = window.setTimeout(()=> controller.abort(), timeoutMs);
    try{
      const res = await fetch(url, { cache:"no-store", signal: controller.signal });
      return res;
    } finally {
      window.clearTimeout(id);
    }
  }

  async function fetchJson(url, timeoutMs){
    const res = await fetchWithTimeout(url, timeoutMs);
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

    if(!hostEl.style.display) hostEl.style.display = "block";
    if(!hostEl.style.width) hostEl.style.width = "100%";

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

    // Controls
    const controls = document.createElement("div");
    controls.className = "controls";

    const controlsPanel = document.createElement("div");
    controlsPanel.className = "controlsPanel";

    const switcher = document.createElement("div");
    switcher.className = "switcher stacked";

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
    controlsPanel.appendChild(switcher);
    controls.appendChild(controlsPanel);
    wrap.appendChild(controls);

    // Belt
    const belt = document.createElement("div");
    belt.className = "belt";

    const laneA = document.createElement("div");
    laneA.className = "lane";
    const laneB = document.createElement("div");
    laneB.className = "lane";

    belt.appendChild(laneA);
    belt.appendChild(laneB);
    wrap.appendChild(belt);

    const msg = document.createElement("div");
    msg.className = "msg";
    msg.innerHTML = `<strong>Loading…</strong>`;
    wrap.appendChild(msg);

    // Data / rendering state
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

    // Persisted state
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

    // Drag scrub on wrap, but don't start drag if user pressed controls
    wrap.addEventListener("pointerdown", (e)=>{
      const path = e.composedPath ? e.composedPath() : [];
      if(path.some(el => el && el.classList && el.classList.contains("controls"))) return;

      if(e.pointerType === "mouse" && e.button !== 0) return;

      dragging = true;
      didDrag = false;
      dragStartX = e.clientX;
      dragStartOffset = offsetPx;

      try{ wrap.setPointerCapture(e.pointerId); }catch{}
    });

    wrap.addEventListener("pointermove", (e)=>{
      if(!dragging || !shiftPx) return;
      const dx = e.clientX - dragStartX;
      if(Math.abs(dx) > DRAG_THRESHOLD_PX) didDrag = true;

      offsetPx = dragStartOffset + dx;
      normalizeOffset();
      setTransform();
    });

    wrap.addEventListener("pointerup", (e)=>{
      if(!dragging) return;
      dragging = false;
      try{ wrap.releasePointerCapture(e.pointerId); }catch{}
      lastTs = performance.now();
      persist();
    });

    wrap.addEventListener("pointercancel", ()=>{
      dragging = false;
      didDrag = false;
    });

    // Only cancel navigation if a drag truly happened
    wrap.addEventListener("click", (e)=>{
      if(!didDrag) return;
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if(a){
        e.preventDefault();
        e.stopPropagation();
      }
      didDrag = false;
    }, false);

    // Pause animation when tab hidden
    document.addEventListener("visibilitychange", ()=>{
      if(document.hidden){
        if(rafId) cancelAnimationFrame(rafId);
        rafId = 0;
      }else{
        lastTs = 0;
        startAnim();
      }
    });

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
        pill.style.background = "#111";
        pill.style.color = "#fff";
        pill.style.borderColor = opts.pillBorder;
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
      link.setAttribute("aria-label", "Open Match Hub");

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

      homeSide.appendChild(hCrest);
      homeSide.appendChild(teamPillEl(fx.home));

      const score = document.createElement("span");
      score.className = "scorePill";
      score.textContent = fx.isFinal ? normalizeScoreCell(fx.scoreRaw) : "v";

      const awaySide = document.createElement("span");
      awaySide.className = "side";

      awaySide.appendChild(teamPillEl(fx.away));

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
        msg.style.display = "block";
        msg.innerHTML = `<strong>${mode === "fixtures" ? "FIXTURES" : "RESULTS"}:</strong> none in ±${Math.max(opts.daysBack, opts.daysForward)} days.`;
        offsetPx = 0;
        setTransform();
        shiftPx = 0;
        return;
      }

      msg.style.display = "none";

      const fragA = document.createDocumentFragment();
      const fragB = document.createDocumentFragment();

      items.forEach((fx)=>{
        fragA.appendChild(buildFixtureEl(fx));
        fragA.appendChild(buildDividerEl());
      });
      items.forEach((fx)=>{
        fragB.appendChild(buildFixtureEl(fx));
        fragB.appendChild(buildDividerEl());
      });

      laneA.appendChild(fragA);
      laneB.appendChild(fragB);

      requestAnimationFrame(()=> requestAnimationFrame(recomputeShift));
    }

    async function refresh(){
      try{
        msg.style.display = "block";
        msg.innerHTML = `<strong>Loading…</strong>`;

        const timeoutMs = opts.fetchTimeoutMs;

        const csvPromise = (async ()=>{
          const r = await fetchWithTimeout(opts.csv, timeoutMs);
          if(!r.ok) throw new Error("CSV fetch failed: " + r.status);
          return await r.text();
        })();

        const metaPromise = (async ()=>{
          try{
            return await fetchJson(opts.clubsMeta, timeoutMs);
          }catch{
            return null;
          }
        })();

        const [csvText, clubsMeta] = await Promise.all([csvPromise, metaPromise]);

        clubColors = buildClubColorMap(clubsMeta);

        const rows = parseCSV(csvText);
        if(!rows.length){
          msg.style.display = "block";
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
          msg.style.display = "block";
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
        msg.style.display = "block";
        msg.innerHTML =
          `<strong>Error:</strong> Feed/parse failed. ` +
          `<span style="font-size:12px;color:#444">(${safeText(e && e.message) || "see console"})</span>`;
      }
    }

    try{
      ro = new ResizeObserver(()=> recomputeShift());
      ro.observe(wrap);
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

    const mo = new MutationObserver(()=>{
      bootOnce();
    });
    mo.observe(document.documentElement, { childList:true, subtree:true });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
