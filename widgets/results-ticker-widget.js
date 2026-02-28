/* results-ticker-widget.js (v1.41)
   Fixes in v1.41:
   - Club colour pills are now applied to TEAM NAME pills (home + away), NOT the score.
   - Score pill stays neutral (white/black).
   - Smoother scrolling: reduce layout shifts + fewer expensive recalcs
     • crests always reserve space (no width=0 “missing”)
     • debounce recomputeShift and re-run after images load
     • contain/translate3d optimisations
   - Clicks still work; drag scrub still works; remembers mode + position.
*/
(function(){
  "use strict";

  const VERSION = "v1.41";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTOvhhj8bPbZCsAEOurgzBzK_iZN6-qCux9ThncoO7_gZuPWmCHfrxf3vReW8m97hJ4guc954TzRrra/pub?output=csv",
    clubsMeta: "https://rckd-nl.github.io/nl-tools/assets/data/clubs-meta.json",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    matchHubUrl: "https://www.thenationalleague.org.uk/match-hub/",
    kitCss: "https://use.typekit.net/gff4ipy.css",

    maxItems: 80,
    height: 74,
    speed: 80,
    refreshMs: 120000,

    dividerColor: "#000000",
    dividerH: 34,
    dividerW: 2,
    dividerPad: 18,

    bg: "#ffffff",
    text: "#111111",
    border: "rgba(0,0,0,0.06)",

    waveEveryMs: 10000,
    waveStaggerMs: 35,
    waveDurMs: 520,

    windowDays: 7,
    persistKey: "nl_results_ticker_state_v141"
  };

  const COMP_MAP = {
    "National": "Enterprise National League",
    "North": "Enterprise National League North",
    "South": "Enterprise National League South",
    "NL Cup": "National League Cup"
  };

  function safeText(s){ return (s || "").toString().replace(/\s+/g," ").trim(); }
  function toAllCaps(s){ return safeText(s).toUpperCase(); }

  function normalizeScore(s){
    const t = safeText(s);
    if(!t) return "";
    return t.replace(/[–—]/g, "-").replace(/\s+/g,"");
  }
  function isNumericScore(score){
    const t = normalizeScore(score);
    return /^\d+\-\d+$/.test(t);
  }
  function parseScore(score){
    const t = normalizeScore(score);
    const m = /^(\d+)-(\d+)$/.exec(t);
    if(!m) return null;
    return { h: parseInt(m[1],10), a: parseInt(m[2],10) };
  }

  function parseCSV(text){
    const out = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for(let i=0;i<text.length;i++){
      const ch = text[i];
      const next = text[i+1];

      if(ch === '"' && inQuotes && next === '"'){ cur += '"'; i++; continue; }
      if(ch === '"'){ inQuotes = !inQuotes; continue; }

      if(!inQuotes && ch === ","){ row.push(cur); cur=""; continue; }
      if(!inQuotes && ch === "\n"){
        row.push(cur);
        out.push(row);
        row=[]; cur="";
        continue;
      }
      if(ch !== "\r") cur += ch;
    }
    if(cur.length || row.length){ row.push(cur); out.push(row); }

    return out.map(r => r.map(c => safeText(c)));
  }

  function parseUKDateTime(s){
    const t = safeText(s);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(t);
    if(!m) return null;
    const dd = +m[1], mm = +m[2], yyyy = +m[3], hh = +m[4], mi = +m[5];
    const d = new Date(yyyy, mm-1, dd, hh, mi, 0, 0);
    return Number.isFinite(+d) ? d : null;
  }

  function fmtDateLong(d){
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const mons = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${days[d.getDay()]}, ${d.getDate()} ${mons[d.getMonth()]} ${d.getFullYear()}`;
  }
  function pad2(n){ return String(n).padStart(2,"0"); }
  function fmtTime(d){ return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

  function clampInt(v, min, max, fallback){
    const n = parseInt(v,10);
    if(Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.csv) opts.csv = d.csv;
    if(d.clubsMeta) opts.clubsMeta = d.clubsMeta;
    if(d.crestBase) opts.crestBase = d.crestBase;
    if(d.matchHubUrl) opts.matchHubUrl = d.matchHubUrl;
    if(d.kitCss) opts.kitCss = d.kitCss;

    if(d.maxItems) opts.maxItems = clampInt(d.maxItems, 1, 500, DEFAULTS.maxItems);
    if(d.height) opts.height = clampInt(d.height, 48, 140, DEFAULTS.height);
    if(d.speed) opts.speed = clampInt(d.speed, 10, 500, DEFAULTS.speed);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);

    if(d.dividerColor) opts.dividerColor = d.dividerColor;
    if(d.dividerH) opts.dividerH = clampInt(d.dividerH, 12, 90, DEFAULTS.dividerH);
    if(d.dividerW) opts.dividerW = clampInt(d.dividerW, 1, 12, DEFAULTS.dividerW);
    if(d.dividerPad) opts.dividerPad = clampInt(d.dividerPad, 0, 60, DEFAULTS.dividerPad);

    if(d.bg) opts.bg = d.bg;
    if(d.text) opts.text = d.text;

    if(d.waveEveryMs) opts.waveEveryMs = clampInt(d.waveEveryMs, 2000, 600000, DEFAULTS.waveEveryMs);
    if(d.waveStaggerMs) opts.waveStaggerMs = clampInt(d.waveStaggerMs, 10, 200, DEFAULTS.waveStaggerMs);
    if(d.waveDurMs) opts.waveDurMs = clampInt(d.waveDurMs, 200, 2000, DEFAULTS.waveDurMs);

    if(d.windowDays) opts.windowDays = clampInt(d.windowDays, 1, 30, DEFAULTS.windowDays);

    if(d.persistKey) opts.persistKey = safeText(d.persistKey) || DEFAULTS.persistKey;

    return opts;
  }

  function cssFor(opts){
    return `
:host{
  --bg:${opts.bg};
  --text:${opts.text};
  --border:${opts.border};
  --h:${opts.height}px;

  --crest:30px;
  --div-h:${opts.dividerH}px;
  --div-w:${opts.dividerW}px;
  --div-pad:${opts.dividerPad}px;
  --divider:${opts.dividerColor};

  --muted:rgba(17,17,17,.72);
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
  border:1px solid var(--border);

  /* help smoothness */
  contain: layout paint;
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
.wrap:before{ left:0; background:linear-gradient(to right, var(--bg) 0%, rgba(255,255,255,0) 100%); }
.wrap:after{ right:0; background:linear-gradient(to left, var(--bg) 0%, rgba(255,255,255,0) 100%); }

/* top-right switcher */
.switcher{
  position:absolute;
  top:8px;
  right:10px;
  z-index:4;
  display:flex;
  gap:6px;
  background:rgba(255,255,255,.92);
  border:1px solid rgba(0,0,0,.10);
  border-radius:999px;
  padding:4px;
  backdrop-filter:saturate(1.2) blur(6px);
}
.swBtn{
  appearance:none;
  border:1px solid transparent;
  background:transparent;
  color:#111;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  font-size:12px;
  padding:6px 10px;
  border-radius:999px;
  cursor:pointer;
  line-height:1;
}
.swBtn[aria-pressed="true"]{
  background:#111;
  color:#fff;
}

.belt{
  display:flex;
  align-items:center;
  white-space:nowrap;
  will-change:transform;
  transform:translate3d(0,0,0);
  backface-visibility:hidden;
}

.lane{
  display:flex;
  align-items:center;
  gap:0px;
}

.fxLink{
  display:inline-flex;
  flex-direction:column;
  align-items:flex-start;
  gap:6px;
  padding:0 var(--div-pad);
  text-decoration:none;
  color:inherit;
  -webkit-tap-highlight-color: transparent;
}

.fxMeta{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  font-size:11px;
  letter-spacing:.02em;
  color:var(--muted);
  line-height:1;
  white-space:nowrap;
  text-align:left;
}

.fxRow{
  display:inline-flex;
  align-items:center;
  justify-content:flex-start;
  gap:14px;
  width:100%;
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
  flex:0 0 var(--crest);
}
.crest.missing{
  opacity:0;               /* reserve space but hide */
}

/* TEAM NAME PILL (club colours) */
.teamPill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  height:30px;
  padding:0 10px;
  border-radius:999px;
  border:1px solid rgba(0,0,0,.12);
  background:#111;
  color:#fff;

  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:900;
  letter-spacing:0.04em;
  font-size:15px;
  text-transform:uppercase;
  line-height:1;

  white-space:nowrap;
}

/* Neutral score pill */
.scorePill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:62px;
  height:30px;
  padding:0 12px;
  border-radius:999px;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:900;
  font-size:16px;
  line-height:1;
  border:2px solid rgba(0,0,0,.45);
  background:#fff;
  color:#111;
  white-space:nowrap;
}

.vSep{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:24px;
  height:30px;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:900;
  font-size:14px;
  letter-spacing:.08em;
  color:#111;
}

/* Divider between fixtures */
.divider{
  width:var(--div-w);
  height:var(--div-h);
  background:var(--divider);
  display:block;
  opacity:1;
}

/* winner wave letters */
.letter{ display:inline-block; transform:translateY(0); will-change:transform, filter; }
@keyframes waveJump{
  0%   { transform:translateY(0); filter:brightness(1); }
  18%  { transform:translateY(-7px); filter:brightness(1.35); }
  38%  { transform:translateY(2px); filter:brightness(1.15); }
  60%  { transform:translateY(-3px); filter:brightness(1.22); }
  100% { transform:translateY(0); filter:brightness(1); }
}
.wrap.wave .teamPill.win .letter{
  animation-name: waveJump;
  animation-duration: var(--wave-dur, 520ms);
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

@media (max-width: 520px){
  :host{ --crest:26px; }
  .teamPill{ height:28px; font-size:14px; padding:0 9px; }
  .scorePill{ height:28px; font-size:15px; min-width:58px; }
  .fxMeta{ font-size:10.5px; }
}
`;
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

  function crestUrlForTeam(opts, club){
    const t = safeText(club);
    if(!t) return null;
    return encodeURI(opts.crestBase + t + ".png");
  }

  function compLabel(raw){
    const t = safeText(raw);
    return COMP_MAP[t] || t || "—";
  }

  function stateLoad(key){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    }catch{ return null; }
  }
  function stateSave(key, obj){
    try{ localStorage.setItem(key, JSON.stringify(obj)); }catch{}
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache:"no-store" });
    if(!res.ok) throw new Error("Meta fetch failed: " + res.status);
    return await res.json();
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
    wrap.style.setProperty("--wave-dur", opts.waveDurMs + "ms");

    const switcher = document.createElement("div");
    switcher.className = "switcher";

    const btnFixtures = document.createElement("button");
    btnFixtures.className = "swBtn";
    btnFixtures.type = "button";
    btnFixtures.textContent = "Fixtures";
    btnFixtures.setAttribute("aria-pressed","false");

    const btnResults = document.createElement("button");
    btnResults.className = "swBtn";
    btnResults.type = "button";
    btnResults.textContent = "Results";
    btnResults.setAttribute("aria-pressed","true");

    switcher.appendChild(btnFixtures);
    switcher.appendChild(btnResults);
    wrap.appendChild(switcher);

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

    root.appendChild(wrap);

    // Meta map: lower(name) -> {primary, secondary}
    let clubsMetaMap = new Map();

    // State
    let mode = "results";
    let items = [];

    let shiftPx = 0;
    let offsetPx = 0;
    let lastTs = 0;
    let rafId = 0;

    // Drag/click handling
    let pointerDown = false;
    let dragging = false;
    let dragStartX = 0;
    let dragStartOffset = 0;
    let dragMoved = 0;
    let suppressClickUntil = 0;
    const DRAG_THRESHOLD_PX = 6;

    // timers
    let refreshTimer = null;
    let waveTimer = null;
    let saveTimer = null;
    let ro = null;

    // recompute debounce
    let recomputeT = 0;
    function scheduleRecompute(){
      window.clearTimeout(recomputeT);
      recomputeT = window.setTimeout(()=> recomputeShift(), 80);
    }

    // restore persisted state
    const saved = stateLoad(opts.persistKey);
    if(saved){
      if(saved.mode === "fixtures" || saved.mode === "results") mode = saved.mode;
      if(typeof saved.offsetPx === "number" && Number.isFinite(saved.offsetPx)) offsetPx = saved.offsetPx;
    }

    function setMode(next){
      mode = next;
      btnFixtures.setAttribute("aria-pressed", mode==="fixtures" ? "true" : "false");
      btnResults.setAttribute("aria-pressed", mode==="results" ? "true" : "false");
      stateSave(opts.persistKey, { mode, offsetPx });
      refresh();
    }

    btnFixtures.addEventListener("click", ()=> setMode("fixtures"));
    btnResults.addEventListener("click", ()=> setMode("results"));

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
      let dt = (ts - lastTs) / 1000;
      lastTs = ts;

      // prevent “jump” after tab is inactive
      if(dt > 0.06) dt = 0.06;

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
      if(e.target && e.target.closest && e.target.closest(".switcher")) return;

      pointerDown = true;
      dragging = false;
      dragMoved = 0;

      dragStartX = e.clientX;
      dragStartOffset = offsetPx;

      try{ wrap.setPointerCapture(e.pointerId); }catch{}
    }
    function onPointerMove(e){
      if(!pointerDown || !shiftPx) return;

      const dx = e.clientX - dragStartX;
      dragMoved = Math.max(dragMoved, Math.abs(dx));

      if(!dragging && dragMoved >= DRAG_THRESHOLD_PX){
        dragging = true;
      }
      if(!dragging) return;

      offsetPx = dragStartOffset + dx;
      normalizeOffset();
      setTransform();
    }
    function onPointerUp(e){
      if(!pointerDown) return;
      pointerDown = false;

      if(dragging){
        suppressClickUntil = Date.now() + 350;
      }
      dragging = false;

      try{ wrap.releasePointerCapture(e.pointerId); }catch{}
      lastTs = performance.now();
      stateSave(opts.persistKey, { mode, offsetPx });
    }

    wrap.addEventListener("pointerdown", onPointerDown, { passive:true });
    wrap.addEventListener("pointermove", onPointerMove, { passive:true });
    wrap.addEventListener("pointerup", onPointerUp, { passive:true });
    wrap.addEventListener("pointercancel", onPointerUp, { passive:true });

    wrap.addEventListener("click", (e)=>{
      if(Date.now() < suppressClickUntil){
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

    function clubColors(name){
      const key = safeText(name).toLowerCase();
      const rec = clubsMetaMap.get(key);
      if(!rec) return null;
      const bg = rec.primary || null;
      const fg = rec.secondary || null;
      if(!bg || !fg) return null;
      return { bg, fg };
    }

    function buildTeamPill(teamName, resClass){
      const pill = document.createElement("span");
      pill.className = "teamPill " + (resClass || "");
      pill.appendChild(makeLetters(toAllCaps(teamName)));

      const col = clubColors(teamName);
      if(col){
        pill.style.background = col.bg;
        pill.style.color = col.fg;
      }
      return pill;
    }

    function buildFixtureEl(fx){
      const parsed = parseScore(fx.score || "");
      let homeRes = "draw";
      let awayRes = "draw";
      if(parsed){
        if(parsed.h > parsed.a){ homeRes = "win"; awayRes = "lose"; }
        else if(parsed.h < parsed.a){ homeRes = "lose"; awayRes = "win"; }
      }

      const a = document.createElement("a");
      a.className = "fxLink";
      a.href = opts.matchHubUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", "Open Match Hub");

      const meta = document.createElement("div");
      meta.className = "fxMeta";
      meta.textContent = fx.metaText;

      const row = document.createElement("div");
      row.className = "fxRow";

      // Home side
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
        hCrest.onload = scheduleRecompute;
      }else{
        hCrest.classList.add("missing");
      }

      const hTeamPill = buildTeamPill(fx.home, homeRes);

      homeSide.appendChild(hCrest);
      homeSide.appendChild(hTeamPill);

      // Middle: score OR "V"
      let mid;
      if(isNumericScore(fx.score)){
        mid = document.createElement("span");
        mid.className = "scorePill";
        mid.textContent = normalizeScore(fx.score);
      }else{
        mid = document.createElement("span");
        mid.className = "vSep";
        mid.textContent = "V";
      }

      // Away side
      const awaySide = document.createElement("span");
      awaySide.className = "side";

      const aTeamPill = buildTeamPill(fx.away, awayRes);

      const aCrest = document.createElement("img");
      aCrest.className = "crest";
      aCrest.alt = safeText(fx.away) ? (safeText(fx.away) + " crest") : "";
      const aUrl = crestUrlForTeam(opts, fx.away);
      if(aUrl){
        aCrest.src = aUrl;
        aCrest.loading = "lazy";
        aCrest.decoding = "async";
        aCrest.onerror = ()=> aCrest.classList.add("missing");
        aCrest.onload = scheduleRecompute;
      }else{
        aCrest.classList.add("missing");
      }

      awaySide.appendChild(aTeamPill);
      awaySide.appendChild(aCrest);

      row.appendChild(homeSide);
      row.appendChild(mid);
      row.appendChild(awaySide);

      a.appendChild(meta);
      a.appendChild(row);

      return a;
    }

    function recomputeShift(){
      shiftPx = laneA.scrollWidth || 0;
      normalizeOffset();
      setTransform();
    }

    function render(list){
      items = list.slice();

      laneA.innerHTML = "";
      laneB.innerHTML = "";

      for(let i=0;i<items.length;i++){
        laneA.appendChild(buildFixtureEl(items[i]));
        laneA.appendChild(buildDividerEl());
      }
      for(let i=0;i<items.length;i++){
        laneB.appendChild(buildFixtureEl(items[i]));
        laneB.appendChild(buildDividerEl());
      }

      msg.style.display = items.length ? "none" : "block";

      // recompute after paint + (likely) image decode/lazy loads
      requestAnimationFrame(()=> requestAnimationFrame(()=> {
        recomputeShift();
        // one more delayed recompute to catch late image decode without thrash
        scheduleRecompute();
      }));
    }

    function triggerWave(){
      const winners = root.querySelectorAll(".teamPill.win");
      if(!winners.length) return;

      winners.forEach(teamEl => {
        const letters = teamEl.querySelectorAll(".letter");
        letters.forEach((l, i) => l.style.setProperty("--d", (i * opts.waveStaggerMs) + "ms"));
      });

      wrap.classList.remove("wave");
      void wrap.offsetWidth;
      wrap.classList.add("wave");

      const maxLetters = Math.max(8, ...Array.from(winners).map(w => (w.querySelectorAll(".letter").length || 0)));
      const totalMs = (maxLetters * opts.waveStaggerMs) + opts.waveDurMs + 120;
      window.setTimeout(()=> wrap.classList.remove("wave"), totalMs);
    }

    function withinDays(date, start, end){
      const t = +date;
      return t >= +start && t <= +end;
    }

    function buildWindow(){
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0,0);
      const end = new Date(start);
      end.setDate(end.getDate() + opts.windowDays);
      const pastStart = new Date(start);
      pastStart.setDate(pastStart.getDate() - opts.windowDays);
      return { start, end, pastStart };
    }

    function rowsFromCsv(csvText){
      const rows = parseCSV(csvText);
      if(!rows.length) return { error:"no rows" };

      const header = rows[0].map(h => safeText(h).toLowerCase());
      const idxDT = header.indexOf("date & time");
      const idxComp = header.indexOf("competition");
      const idxHome = header.indexOf("home team");
      const idxScore = header.indexOf("score");
      const idxAway = header.indexOf("away team");

      const missing = [];
      if(idxDT === -1) missing.push("Date & Time");
      if(idxComp === -1) missing.push("Competition");
      if(idxHome === -1) missing.push("Home team");
      if(idxScore === -1) missing.push("Score");
      if(idxAway === -1) missing.push("Away team");
      if(missing.length) return { error:"missing columns: " + missing.join(", ") };

      const out = [];
      for(let i=1;i<rows.length;i++){
        const r = rows[i];
        if(!r || !r.length) continue;

        const dtRaw = safeText(r[idxDT]);
        const dt = parseUKDateTime(dtRaw);
        const compRaw = safeText(r[idxComp]);
        const home = safeText(r[idxHome]);
        const scoreRaw = safeText(r[idxScore]);
        const away = safeText(r[idxAway]);

        if(!home && !away && !scoreRaw && !dtRaw) continue;
        if(!dt || !home || !away) continue;

        out.push({
          dt,
          compRaw,
          home,
          away,
          score: normalizeScore(scoreRaw)
        });
      }

      out.sort((a,b)=>{
        const ta = +a.dt, tb = +b.dt;
        if(ta !== tb) return ta - tb;
        const ca = compLabel(a.compRaw), cb = compLabel(b.compRaw);
        if(ca !== cb) return ca.localeCompare(cb);
        return a.home.localeCompare(b.home);
      });

      return { rows: out };
    }

    function selectItems(all){
      const { start, end, pastStart } = buildWindow();
      const isRes = (r)=> isNumericScore(r.score);
      const isFix = (r)=> !isNumericScore(r.score);

      let picked;
      if(mode === "fixtures"){
        picked = all.filter(r => withinDays(r.dt, start, end) && isFix(r));
      }else{
        picked = all.filter(r => withinDays(r.dt, pastStart, end) && isRes(r));
      }

      if(picked.length > opts.maxItems) picked = picked.slice(0, opts.maxItems);

      return picked.map(r=>{
        const label = compLabel(r.compRaw);
        const metaText = `${fmtDateLong(r.dt)} • ${label} • ${fmtTime(r.dt)}`;
        return { metaText, home:r.home, away:r.away, score:r.score };
      });
    }

    async function loadClubsMeta(){
      try{
        const json = await fetchJson(opts.clubsMeta);
        const clubs = (json && json.clubs) ? json.clubs : [];
        const map = new Map();
        for(const c of clubs){
          const name = safeText(c && c.name);
          if(!name) continue;
          const primary = c && c.colors && c.colors.primary ? String(c.colors.primary) : null;
          const secondary = c && c.colors && c.colors.secondary ? String(c.colors.secondary) : null;
          map.set(name.toLowerCase(), { primary, secondary });
        }
        clubsMetaMap = map;
      }catch(e){
        console.warn("[ResultsTicker " + VERSION + "] clubs-meta load failed", e);
        clubsMetaMap = new Map();
      }
    }

    async function refresh(){
      try{
        msg.style.display = "block";
        msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> loading…`;

        if(!clubsMetaMap || clubsMetaMap.size === 0){
          await loadClubsMeta();
        }

        const res = await fetch(opts.csv, { cache:"no-store" });
        if(!res.ok) throw new Error("Feed fetch failed: " + res.status);
        const csvText = await res.text();

        const parsed = rowsFromCsv(csvText);
        if(parsed.error){
          msg.style.display = "block";
          msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> ${safeText(parsed.error)}.`;
          render([]);
          return;
        }

        const list = selectItems(parsed.rows);
        if(!list.length){
          msg.style.display = "block";
          msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> no matches in the last/next ${opts.windowDays} days.`;
        }

        render(list);
      }catch(e){
        console.error("[ResultsTicker " + VERSION + "]", e);
        msg.style.display = "block";
        msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> feed error (open console).`;
        render([]);
      }
    }

    // Resize observer
    try{
      ro = new ResizeObserver(()=> scheduleRecompute());
      ro.observe(wrap);
    }catch{}

    // Persist offset periodically
    saveTimer = window.setInterval(()=>{
      stateSave(opts.persistKey, { mode, offsetPx });
    }, 1200);

    // Wave loop
    waveTimer = window.setInterval(triggerWave, opts.waveEveryMs);

    // Refresh loop
    refresh();
    refreshTimer = window.setInterval(refresh, opts.refreshMs);

    // initial UI
    btnFixtures.setAttribute("aria-pressed", mode==="fixtures" ? "true" : "false");
    btnResults.setAttribute("aria-pressed", mode==="results" ? "true" : "false");

    // initial transform + go
    setTransform();
    startAnim();

    return {
      destroy(){
        if(rafId) cancelAnimationFrame(rafId);
        if(refreshTimer) window.clearInterval(refreshTimer);
        if(waveTimer) window.clearInterval(waveTimer);
        if(saveTimer) window.clearInterval(saveTimer);
        if(ro) ro.disconnect();
      }
    };
  }

  function compLabel(raw){
    const t = safeText(raw);
    return COMP_MAP[t] || t || "—";
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
