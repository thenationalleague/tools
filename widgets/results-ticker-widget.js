/* Results Ticker Widget (v1.60) — Shadow DOM isolated embed
   Feed: Google Sheets published CSV
   Sheet columns:
   Date & Time | MD | Competition | Home team | Score | Away team

   v1.60 changes:
   - Never misses fixtures/results in long sheets: parse ALL rows, then filter
   - Fixtures/Results switcher (persisted)
   - 3 days forwards/backwards window
   - Per-game date/time + division shown as a small superscript line above each fixture
   - If Score is not n-n => show "v"
   - Team name pills use clubs-meta.json (primary bg, secondary text)
   - Everything links to Match Hub (new window)
   - Smoother belt animation + reduced stutter (fewer DOM scans / layout reads)
*/
(function(){
  "use strict";

  const VERSION = "v1.60";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTOvhhj8bPbZCsAEOurgzBzK_iZN6-qCux9ThncoO7_gZuPWmCHfrxf3vReW8m97hJ4guc954TzRrra/pub?output=csv",
    clubsMeta: "https://rckd-nl.github.io/nl-tools/assets/data/clubs-meta.json",

    maxItems: 60,
    height: 74,              // px (slightly taller to accommodate superscript line)
    speed: 80,               // px/sec
    refreshMs: 120000,       // 2 min

    kitCss: "https://use.typekit.net/gff4ipy.css",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",

    bg: "#ffffff",
    text: "#111111",
    muted: "#6b7280",

    pillBorder: "#000000",
    dividerColor: "#000000",
    dividerH: 30,
    dividerW: 2,
    dividerPad: 18,

    waveEveryMs: 10000,
    waveStaggerMs: 35,
    waveDurMs: 520,

    daysBack: 3,
    daysForward: 3,

    matchHubUrl: "https://www.thenationalleague.org.uk/match-hub/"
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

    if(d.waveEveryMs) opts.waveEveryMs = clampInt(d.waveEveryMs, 2000, 600000, DEFAULTS.waveEveryMs);
    if(d.waveStaggerMs) opts.waveStaggerMs = clampInt(d.waveStaggerMs, 10, 200, DEFAULTS.waveStaggerMs);
    if(d.waveDurMs) opts.waveDurMs = clampInt(d.waveDurMs, 200, 2000, DEFAULTS.waveDurMs);

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;

    if(d.bg) opts.bg = d.bg;
    if(d.text) opts.text = d.text;
    if(d.muted) opts.muted = d.muted;
    if(d.pillBorder) opts.pillBorder = d.pillBorder;

    if(d.daysBack) opts.daysBack = clampInt(d.daysBack, 0, 30, DEFAULTS.daysBack);
    if(d.daysForward) opts.daysForward = clampInt(d.daysForward, 0, 30, DEFAULTS.daysForward);

    if(d.matchHubUrl) opts.matchHubUrl = d.matchHubUrl;

    return opts;
  }

  function cssFor(opts){
    return `
:host{
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

  --wave-dur:${opts.waveDurMs}ms;
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
  border:1px solid rgba(0,0,0,0.06);
}

.wrap:before,
.wrap:after{
  content:"";
  position:absolute;
  top:0; bottom:0;
  width:48px;
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

.controls{
  position:absolute;
  top:8px;
  left:10px;
  z-index:10;
  display:flex;
  gap:8px;
  align-items:center;
  pointer-events:auto;
}

.toggle{
  display:inline-flex;
  border:1px solid rgba(0,0,0,0.12);
  background:rgba(255,255,255,0.9);
  backdrop-filter:saturate(1.2) blur(6px);
  border-radius:999px;
  overflow:hidden;
  box-shadow:0 1px 0 rgba(0,0,0,.04);
}

.tbtn{
  appearance:none;
  border:0;
  background:transparent;
  padding:6px 10px;
  font-family:"carbona-variable", system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  font-size:12px;
  color:var(--text);
  cursor:pointer;
  line-height:1;
}
.tbtn.active{
  background:#0b0f19;
  color:#fff;
}

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
}

.fixture{
  display:flex;
  flex-direction:column;
  justify-content:center;
  gap:6px;
  min-height: calc(var(--h) - 14px);
  padding:7px 0;
}

.meta{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:11px;
  color:var(--muted);
  letter-spacing:.2px;
  white-space:nowrap;
  line-height:1;
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
  font-weight:800;
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
  border:2px solid var(--pill-border);
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

/* Winner wave letters */
.letter{
  display:inline-block;
  transform:translateY(0);
  will-change:transform, filter;
}

@keyframes waveJump{
  0%   { transform:translateY(0); filter:brightness(1); }
  18%  { transform:translateY(-7px); filter:brightness(1.35); }
  38%  { transform:translateY(2px); filter:brightness(1.15); }
  60%  { transform:translateY(-3px); filter:brightness(1.22); }
  100% { transform:translateY(0); filter:brightness(1); }
}

.wrap.wave .teamPill.win .letter{
  animation-name: waveJump;
  animation-duration: var(--wave-dur);
  animation-timing-function: cubic-bezier(.2,.9,.2,1);
  animation-iteration-count: 1;
  animation-fill-mode: both;
  animation-delay: var(--d, 0ms);
}

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

  // Robust CSV parser (handles quoted fields + commas)
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

    // trim cells
    return out.map(r => r.map(c => safeText(c)));
  }

  function normalizeHeader(h){
    return safeText(h).toLowerCase();
  }

  function normalizeScoreCell(s){
    const t = safeText(s);
    if(!t) return "";
    return t.replace(/[–—]/g, "-").replace(/\s+/g,"");
  }

  function isScoreFinal(s){
    return /^\d+-\d+$/.test(normalizeScoreCell(s));
  }

  function parseScore(s){
    const m = /^(\d+)-(\d+)$/.exec(normalizeScoreCell(s));
    if(!m) return null;
    return { h: parseInt(m[1],10), a: parseInt(m[2],10) };
  }

  function parseUKDateTimeToLocal(dtStr){
    // Expected: DD/MM/YYYY HH:MM
    const s = safeText(dtStr);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(s);
    if(!m) return null;
    const dd = +m[1], mm = +m[2], yyyy = +m[3], hh = +m[4], mi = +m[5];
    // local time
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

  function makeLetters(text){
    const frag = document.createDocumentFragment();
    const str = String(text || "");
    for(let i=0;i<str.length;i++){
      const ch = str[i];
      const span = document.createElement("span");
      span.className = "letter";
      if(ch === " ") span.innerHTML = "&nbsp;";
      else span.textContent = ch;
      frag.appendChild(span);
    }
    return frag;
  }

  function safeHexColor(x, fallback){
    const s = safeText(x);
    if(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
    return fallback;
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache:"no-store" });
    if(!res.ok) throw new Error("JSON fetch failed: " + res.status);
    return await res.json();
  }

  function buildClubColorMap(meta){
    // meta: { version, clubs:[{name, colors:{primary,secondary}}] }
    const map = new Map();
    if(!meta || !Array.isArray(meta.clubs)) return map;

    for(const c of meta.clubs){
      const name = safeText(c && c.name);
      if(!name) continue;
      const primary = safeHexColor(c?.colors?.primary, "#111111");
      const secondary = safeHexColor(c?.colors?.secondary, "#ffffff");
      map.set(name.toLowerCase(), { primary, secondary });
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

    // Controls (top-left)
    const controls = document.createElement("div");
    controls.className = "controls";

    const toggle = document.createElement("div");
    toggle.className = "toggle";

    const btnFixtures = document.createElement("button");
    btnFixtures.className = "tbtn";
    btnFixtures.type = "button";
    btnFixtures.textContent = "Fixtures";

    const btnResults = document.createElement("button");
    btnResults.className = "tbtn";
    btnResults.type = "button";
    btnResults.textContent = "Results";

    toggle.appendChild(btnFixtures);
    toggle.appendChild(btnResults);
    controls.appendChild(toggle);
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

    // State
    let clubColors = new Map();
    let lastFixtures = [];
    let lastMode = "results"; // default
    let shiftPx = 0;

    // Animation
    let offsetPx = 0;
    let lastTs = 0;
    let rafId = 0;

    // Drag scrub
    let dragging = false;
    let dragStartX = 0;
    let dragStartOffset = 0;
    let dragMoved = 0;

    let refreshTimer = null;
    let waveTimer = null;
    let ro = null;

    // Load persisted state
    const persisted = loadState(opts);
    if(persisted && (persisted.mode === "fixtures" || persisted.mode === "results")){
      lastMode = persisted.mode;
    }
    if(persisted && typeof persisted.offsetPx === "number" && Number.isFinite(persisted.offsetPx)){
      offsetPx = persisted.offsetPx;
    }

    function setMode(mode){
      lastMode = mode;
      btnFixtures.classList.toggle("active", mode === "fixtures");
      btnResults.classList.toggle("active", mode === "results");
      saveState(opts, { mode:lastMode, offsetPx, savedAt: Date.now() });
      // re-render from last loaded dataset if available
      if(lastFixtures && lastFixtures.length){
        render(lastFixtures);
      }
    }

    btnFixtures.addEventListener("click", ()=> setMode("fixtures"));
    btnResults.addEventListener("click", ()=> setMode("results"));

    // Init toggle UI
    setMode(lastMode);

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

    function onPointerDown(e){
      if(e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      dragMoved = 0;
      dragStartX = e.clientX;
      dragStartOffset = offsetPx;
      try{ wrap.setPointerCapture(e.pointerId); }catch{}
    }

    function onPointerMove(e){
      if(!dragging || !shiftPx) return;
      const dx = e.clientX - dragStartX;
      dragMoved = Math.max(dragMoved, Math.abs(dx));
      offsetPx = dragStartOffset + dx;
      normalizeOffset();
      setTransform();
    }

    function onPointerUp(e){
      if(!dragging) return;
      dragging = false;
      try{ wrap.releasePointerCapture(e.pointerId); }catch{}
      lastTs = performance.now();
      // persist offset (so it resumes near where left off)
      saveState(opts, { mode:lastMode, offsetPx, savedAt: Date.now() });
    }

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", onPointerUp);
    wrap.addEventListener("pointercancel", onPointerUp);

    // Prevent click-through when user dragged
    wrap.addEventListener("click", (e)=>{
      if(dragMoved > 6){
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    function buildDividerEl(){
      const d = document.createElement("span");
      d.className = "divider";
      d.setAttribute("aria-hidden","true");
      return d;
    }

    function teamPillEl(teamName, outcome){
      const name = safeText(teamName);
      const pill = document.createElement("span");
      pill.className = "teamPill" + (outcome ? (" " + outcome) : "");

      const colors = clubColors.get(name.toLowerCase());
      if(colors){
        pill.style.background = colors.primary;
        pill.style.color = colors.secondary;
      }else{
        // sensible fallback
        pill.style.background = "#111";
        pill.style.color = "#fff";
      }

      pill.appendChild(makeLetters(name.toUpperCase()));
      return pill;
    }

    function buildFixtureEl(fx, idx){
      const link = document.createElement("a");
      link.className = "fixtureLink";
      link.href = opts.matchHubUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", "Open Match Hub");

      const box = document.createElement("span");
      box.className = "fixture";

      // superscript/meta line
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = fx.dt ? (formatDddDMmmYYYYHHMM(fx.dt) + " • " + compDisplay(fx.comp)) : compDisplay(fx.comp);

      const row = document.createElement("div");
      row.className = "row";

      const homeSide = document.createElement("span");
      homeSide.className = "side";

      const hCrest = document.createElement("img");
      hCrest.className = "crest";
      hCrest.alt = nameOrBlank(fx.home) ? (nameOrBlank(fx.home) + " crest") : "";
      const hUrl = crestUrlForTeam(opts, fx.home);
      if(hUrl){
        hCrest.src = hUrl;
        hCrest.loading = "lazy";
        hCrest.decoding = "async";
        hCrest.onerror = ()=> hCrest.classList.add("missing");
      }else{
        hCrest.classList.add("missing");
      }

      const scoreIsFinal = fx.isFinal;
      const parsed = scoreIsFinal ? parseScore(fx.scoreRaw) : null;

      let homeRes = "";
      let awayRes = "";
      if(parsed){
        if(parsed.h > parsed.a){ homeRes = "win"; awayRes = "lose"; }
        else if(parsed.h < parsed.a){ homeRes = "lose"; awayRes = "win"; }
        else { homeRes = "draw"; awayRes = "draw"; }
      }

      homeSide.appendChild(hCrest);
      homeSide.appendChild(teamPillEl(fx.home, homeRes));

      const score = document.createElement("span");
      score.className = "scorePill";
      score.textContent = scoreIsFinal ? normalizeScoreCell(fx.scoreRaw) : "v";

      const awaySide = document.createElement("span");
      awaySide.className = "side";

      const aPill = teamPillEl(fx.away, awayRes);

      const aCrest = document.createElement("img");
      aCrest.className = "crest";
      aCrest.alt = nameOrBlank(fx.away) ? (nameOrBlank(fx.away) + " crest") : "";
      const aUrl = crestUrlForTeam(opts, fx.away);
      if(aUrl){
        aCrest.src = aUrl;
        aCrest.loading = "lazy";
        aCrest.decoding = "async";
        aCrest.onerror = ()=> aCrest.classList.add("missing");
      }else{
        aCrest.classList.add("missing");
      }

      awaySide.appendChild(aPill);
      awaySide.appendChild(aCrest);

      row.appendChild(homeSide);
      row.appendChild(score);
      row.appendChild(awaySide);

      box.appendChild(meta);
      box.appendChild(row);
      link.appendChild(box);

      // per-letter wave delays set once here (no repeated scans later)
      if(parsed){
        const homeLetters = link.querySelectorAll(".teamPill.win .letter");
        if(homeLetters && homeLetters.length){
          homeLetters.forEach((l, i)=> l.style.setProperty("--d", (i * opts.waveStaggerMs) + "ms"));
        }
        const awayLetters = link.querySelectorAll(".teamPill.win .letter");
        if(awayLetters && awayLetters.length){
          awayLetters.forEach((l, i)=> l.style.setProperty("--d", (i * opts.waveStaggerMs) + "ms"));
        }
      }

      return link;
    }

    function nameOrBlank(s){ return safeText(s) || ""; }

    function recomputeShift(){
      // One layout read
      shiftPx = laneA.scrollWidth || 0;
      normalizeOffset();
      setTransform();
    }

    function triggerWave(){
      wrap.classList.remove("wave");
      // force reflow once, cheap
      void wrap.offsetWidth;
      wrap.classList.add("wave");

      // remove class after animation window
      window.setTimeout(()=> wrap.classList.remove("wave"), (opts.waveDurMs + (24 * opts.waveStaggerMs) + 160));
    }

    function render(allItems){
      // filter based on mode
      const now = new Date();
      const start = new Date(now);
      start.setHours(0,0,0,0);
      const from = new Date(start);
      from.setDate(from.getDate() - opts.daysBack);
      const to = new Date(start);
      to.setDate(to.getDate() + opts.daysForward + 1); // inclusive window end (next midnight)

      let items = allItems.filter(it => it.dt && it.dt >= from && it.dt < to);

      if(lastMode === "fixtures"){
        // fixtures: include items that are NOT final OR are future
        items = items.filter(it => !it.isFinal);
      }else{
        // results: include items that ARE final
        items = items.filter(it => it.isFinal);
      }

      // sort chronological for ticker readability
      items.sort((a,b)=> (+a.dt) - (+b.dt));

      // hard cap AFTER filtering so we don't miss end-of-sheet items
      if(items.length > opts.maxItems){
        items = items.slice(items.length - opts.maxItems); // keep newest chunk
      }

      laneA.innerHTML = "";
      laneB.innerHTML = "";

      if(!items.length){
        msg.style.display = "block";
        msg.innerHTML = `<strong>${lastMode === "fixtures" ? "Fixtures" : "Results"}:</strong> none in the last/next ${Math.max(opts.daysBack, opts.daysForward)} days.`;
        offsetPx = 0;
        setTransform();
        shiftPx = 0;
        return;
      }

      msg.style.display = "none";

      const fragA = document.createDocumentFragment();
      const fragB = document.createDocumentFragment();

      items.forEach((fx, idx)=>{
        fragA.appendChild(buildFixtureEl(fx, idx));
        fragA.appendChild(buildDividerEl());
      });

      items.forEach((fx, idx)=>{
        fragB.appendChild(buildFixtureEl(fx, idx));
        fragB.appendChild(buildDividerEl());
      });

      laneA.appendChild(fragA);
      laneB.appendChild(fragB);

      // Keep current offset if possible; just normalize after measuring
      requestAnimationFrame(()=> requestAnimationFrame(recomputeShift));
    }

    async function refresh(){
      try{
        msg.style.display = "block";
        msg.innerHTML = `<strong>Loading…</strong>`;

        // load clubs-meta in parallel with CSV
        const [csvRes, clubsMeta] = await Promise.all([
          fetch(opts.csv, { cache:"no-store" }).then(r=>{
            if(!r.ok) throw new Error("Feed fetch failed: " + r.status);
            return r.text();
          }),
          fetchJson(opts.clubsMeta).catch(()=> null)
        ]);

        clubColors = buildClubColorMap(clubsMeta);

        const rows = parseCSV(csvRes);
        if(!rows.length){
          msg.style.display = "block";
          msg.innerHTML = `<strong>Error:</strong> CSV has no rows.`;
          return;
        }

        const header = rows[0].map(normalizeHeader);

        const idxDateTime = header.indexOf("date & time");
        const idxMD       = header.indexOf("md");
        const idxComp     = header.indexOf("competition");
        const idxHome     = header.indexOf("home team");
        const idxScore    = header.indexOf("score");
        const idxAway     = header.indexOf("away team");

        const needed = [
          ["Date & Time", idxDateTime],
          ["MD", idxMD],
          ["Competition", idxComp],
          ["Home team", idxHome],
          ["Score", idxScore],
          ["Away team", idxAway]
        ];
        const missing = needed.filter(([,i]) => i === -1).map(([n]) => n);

        if(missing.length){
          msg.style.display = "block";
          msg.innerHTML = `<strong>Error:</strong> Missing columns: ${missing.join(", ")}.`;
          return;
        }

        // Parse ALL rows (no early cut-off)
        const parsed = [];
        for(let i=1; i<rows.length; i++){
          const r = rows[i];
          if(!r || !r.length) continue;

          const dtRaw = safeText(r[idxDateTime]);
          const comp = safeText(r[idxComp]);
          const home = safeText(r[idxHome]);
          const scoreRaw = safeText(r[idxScore]);
          const away = safeText(r[idxAway]);

          if(!dtRaw && !home && !away && !scoreRaw) continue;

          const dt = parseUKDateTimeToLocal(dtRaw);
          if(!dt) continue;

          if(!home || !away) continue;

          const final = isScoreFinal(scoreRaw);

          parsed.push({
            dt,
            md: safeText(r[idxMD]),
            comp,
            home,
            away,
            scoreRaw: scoreRaw,
            isFinal: final
          });
        }

        // keep parsed set
        lastFixtures = parsed;

        render(lastFixtures);
      }catch(e){
        console.error("[ResultsTicker " + VERSION + "]", e);
        msg.style.display = "block";
        msg.innerHTML = `<strong>Error:</strong> Feed/parse failed.`;
      }
    }

    // ResizeObserver (cheap) to keep loop seamless
    try{
      ro = new ResizeObserver(()=> recomputeShift());
      ro.observe(wrap);
    }catch{}

    // Initial render
    refresh();
    refreshTimer = window.setInterval(refresh, opts.refreshMs);

    // Winner wave loop
    waveTimer = window.setInterval(triggerWave, opts.waveEveryMs);

    // Start animation
    setTransform();
    startAnim();

    return {
      destroy(){
        if(rafId) cancelAnimationFrame(rafId);
        if(refreshTimer) window.clearInterval(refreshTimer);
        if(waveTimer) window.clearInterval(waveTimer);
        if(ro) ro.disconnect();
      }
    };
  }

  // Boot robustly (handles scripts loaded before container exists)
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

    // If CMS injects widget after load, observe and boot again
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
