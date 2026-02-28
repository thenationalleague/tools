/* Results/Fixtures Ticker Widget (v1.37) — Shadow DOM isolated embed
   v1.37 changes:
   - Date/time + competition now shown PER FIXTURE (small superscript line above each game)
   - No longer pinned/locked on the left
   - Fixtures/Results switcher fixed (buttons don’t get hijacked by drag/pointer scrub)
   - Links open in new window (entire fixture is a link)
*/
(function(){
  "use strict";

  const VERSION = "v1.37";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTOvhhj8bPbZCsAEOurgzBzK_iZN6-qCux9ThncoO7_gZuPWmCHfrxf3vReW8m97hJ4guc954TzRrra/pub?output=csv",
    maxItems: 140,
    height: 106,             // px (room for per-fixture meta + switcher)
    speed: 80,               // px/sec
    refreshMs: 120000,       // 2 min
    kitCss: "https://use.typekit.net/gff4ipy.css",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    hubUrl: "https://www.thenationalleague.org.uk/match-hub/",
    bg: "#ffffff",
    red: "#9e0000",
    blue: "#223b7c",
    text: "#111111",
    pillBg: "#ffffff",
    pillBorder: "#000000",
    dividerColor: "#000000",
    dividerH: 34,            // px height of divider line (taller for new layout)
    dividerW: 2,             // px width of divider line
    dividerPad: 18,          // px padding either side
    waveEveryMs: 10000,      // trigger interval
    waveStaggerMs: 35,       // per-letter delay
    waveDurMs: 520,          // per-letter animation duration
    defaultMode: "results"   // "results" | "fixtures"
  };

  const COMP_MAP = {
    "national": "Enterprise National League",
    "north": "Enterprise National League North",
    "south": "Enterprise National League South",
    "nl cup": "National League Cup"
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

  function displayCompetition(raw){
    const key = safeText(raw).toLowerCase();
    return COMP_MAP[key] || safeText(raw) || "—";
  }

  function normalizeScore(s){
    const t = safeText(s);
    if(!t) return "";
    return t.replace(/[–—]/g, "-").replace(/\s+/g,"").replace(/^(\d+)-(\d+)$/, "$1-$2");
  }
  function isRealScore(score){
    return /^(\d+)-(\d+)$/.test(score || "");
  }
  function parseScore(score){
    const m = /^(\d+)-(\d+)$/.exec(score);
    if(!m) return null;
    return { h: parseInt(m[1],10), a: parseInt(m[2],10) };
  }

  function parseUKDateTime(dtStr){
    // Expected: DD/MM/YYYY HH:MM (24h)
    const s = safeText(dtStr);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(s);
    if(!m) return null;
    const dd = parseInt(m[1],10);
    const mm = parseInt(m[2],10);
    const yyyy = parseInt(m[3],10);
    const hh = parseInt(m[4],10);
    const mi = parseInt(m[5],10);
    return new Date(yyyy, mm-1, dd, hh, mi, 0, 0);
  }

  function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0); }
  function endOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999); }
  function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }

  function formatMetaDateTime(d){
    // "Sat, 9 Aug 2025 15:00"
    try{
      const df = new Intl.DateTimeFormat("en-GB", {
        weekday:"short", day:"numeric", month:"short", year:"numeric"
      }).format(d);
      const tf = new Intl.DateTimeFormat("en-GB", {
        hour:"2-digit", minute:"2-digit", hourCycle:"h23"
      }).format(d);
      return `${df} ${tf}`;
    }catch{
      const wd = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
      const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
      const hh = String(d.getHours()).padStart(2,"0");
      const mm = String(d.getMinutes()).padStart(2,"0");
      return `${wd}, ${d.getDate()} ${mon} ${d.getFullYear()} ${hh}:${mm}`;
    }
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

  function cssFor(opts){
    return `
:host{
  --brand-red:${opts.red};
  --brand-blue:${opts.blue};
  --bg:${opts.bg};
  --text:${opts.text};
  --pill-bg:${opts.pillBg};
  --pill-border:${opts.pillBorder};
  --divider:${opts.dividerColor};
  --h:${opts.height}px;
  --crest:30px;
  --gap:0px;
  --div-h:${opts.dividerH}px;
  --div-w:${opts.dividerW}px;
  --div-pad:${opts.dividerPad}px;

  --bar-h:32px;
  --bar-pad-x:10px;
  --bar-bg:rgba(255,255,255,.94);
  --bar-border:rgba(0,0,0,.10);
  --bar-shadow:0 1px 0 rgba(0,0,0,.03);
}

*{ box-sizing:border-box; }

.wrap{
  height:var(--h);
  background:var(--bg);
  overflow:hidden;
  position:relative;
  border-radius:10px;
  touch-action: pan-y;
  user-select:none;
  border:1px solid rgba(0,0,0,0.06);
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

/* Switcher bar (top-right) */
.bar{
  position:absolute;
  left:0; right:0;
  top:0;
  height:var(--bar-h);
  display:flex;
  align-items:center;
  justify-content:flex-end;
  padding:0 var(--bar-pad-x);
  z-index:6;
  pointer-events:auto;
}

.switch{
  display:inline-flex;
  align-items:center;
  border:1px solid var(--bar-border);
  background:var(--bar-bg);
  border-radius:999px;
  overflow:hidden;
  box-shadow: var(--bar-shadow);
}
.switch button{
  appearance:none;
  border:0;
  background:transparent;
  padding:6px 10px;
  cursor:pointer;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  font-size:12px;
  color:#111;
  letter-spacing:.02em;
}
.switch button[aria-pressed="true"]{
  background:#111;
  color:#fff;
}
.switch button:focus{
  outline:none;
  box-shadow:0 0 0 3px rgba(158,0,0,.16);
}

/* belt area sits below bar */
.beltArea{
  position:absolute;
  left:0; right:0;
  top:var(--bar-h);
  bottom:0;
  display:flex;
  align-items:center;
  overflow:hidden;
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

/* Whole fixture is a link, but content is column:
   meta above + row below */
.fxLink{
  display:inline-flex;
  flex-direction:column;
  align-items:center;
  gap:8px;
  padding:0 var(--div-pad);
  text-decoration:none;
  color:inherit;
  -webkit-tap-highlight-color: transparent;
}
.fxLink:focus{
  outline:none;
  box-shadow:0 0 0 3px rgba(158,0,0,.16);
  border-radius:10px;
}

.fxMeta{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  font-size:11px;
  letter-spacing:.02em;
  color:#111;
  opacity:.88;
  line-height:1;
  white-space:nowrap;
}

.fxRow{
  display:inline-flex;
  align-items:center;
  gap:14px;
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
  display:inline-flex;
}
.team.alt{ color:var(--brand-blue); }

.scorePill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:66px;
  height:30px;
  padding:0 12px;
  border:2px solid var(--pill-border);
  border-radius:999px;
  background:var(--pill-bg);
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  font-size:16px;
  color:var(--text);
  line-height:1;
}
.scorePill.vs{ min-width:40px; }

/* Divider BETWEEN fixtures */
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
.wrap.wave .team.win .letter{
  animation-name: waveJump;
  animation-duration: var(--wave-dur, 520ms);
  animation-timing-function: cubic-bezier(.2,.9,.2,1);
  animation-iteration-count: 1;
  animation-fill-mode: both;
  animation-delay: var(--d, 0ms);
}

/* Status/error text */
.msg{
  position:absolute;
  left:0;
  top:50%;
  transform:translateY(-50%);
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:14px;
  color:#111;
  padding:0 14px;
  white-space:nowrap;
  z-index:7;
}
.msg strong{ font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
`;
  }

  // CSV parser
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

  function storageKey(opts, hostEl){
    const id = (hostEl && hostEl.id) ? hostEl.id : "";
    const base = safeText(opts.csv) || "csv";
    return "nl_results_ticker_state::" + base + "::" + id;
  }

  function readStoredState(key){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) return null;
      const obj = JSON.parse(raw);
      if(!obj || typeof obj !== "object") return null;
      return obj;
    }catch{
      return null;
    }
  }

  function writeStoredState(key, state){
    try{ localStorage.setItem(key, JSON.stringify(state)); }catch{}
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
    wrap.style.setProperty("--wave-dur", opts.waveDurMs + "ms");

    const bar = document.createElement("div");
    bar.className = "bar";

    const sw = document.createElement("div");
    sw.className = "switch";

    const btnFixtures = document.createElement("button");
    btnFixtures.type = "button";
    btnFixtures.textContent = "Fixtures";
    btnFixtures.setAttribute("aria-pressed", "false");

    const btnResults = document.createElement("button");
    btnResults.type = "button";
    btnResults.textContent = "Results";
    btnResults.setAttribute("aria-pressed", "true");

    sw.appendChild(btnFixtures);
    sw.appendChild(btnResults);
    bar.appendChild(sw);

    const beltArea = document.createElement("div");
    beltArea.className = "beltArea";

    const belt = document.createElement("div");
    belt.className = "belt";

    const laneA = document.createElement("div");
    laneA.className = "lane";

    const laneB = document.createElement("div");
    laneB.className = "lane";

    belt.appendChild(laneA);
    belt.appendChild(laneB);
    beltArea.appendChild(belt);

    const msg = document.createElement("div");
    msg.className = "msg";
    msg.innerHTML = `<strong>Loading…</strong>`;

    wrap.appendChild(bar);
    wrap.appendChild(beltArea);
    wrap.appendChild(msg);
    root.appendChild(wrap);

    // Mode + persistence
    let mode = (opts.defaultMode === "fixtures") ? "fixtures" : "results";

    // Animation state
    let shiftPx = 0;
    let offsetPx = 0;
    let lastTs = 0;
    let rafId = 0;

    // Drag vs click threshold
    let dragging = false;
    let dragStartX = 0;
    let dragStartOffset = 0;
    let movedPx = 0;
    const CLICK_CANCEL_PX = 8;

    let refreshTimer = null;
    let ro = null;
    let waveTimer = null;

    const stKey = storageKey(opts, hostEl);
    const stored = readStoredState(stKey);
    if(stored){
      if(stored.mode === "fixtures" || stored.mode === "results") mode = stored.mode;
      if(Number.isFinite(stored.offsetPx)) offsetPx = stored.offsetPx;
    }

    function setMode(next){
      mode = (next === "fixtures") ? "fixtures" : "results";
      btnFixtures.setAttribute("aria-pressed", mode === "fixtures" ? "true" : "false");
      btnResults.setAttribute("aria-pressed", mode === "results" ? "true" : "false");
      wrap.classList.remove("wave");
      writeStoredState(stKey, { mode, offsetPx });
      refresh();
    }

    // Switcher FIX: stop pointer/drag from hijacking button clicks
    function switchClickGuard(e){
      e.preventDefault();
      e.stopPropagation();
    }
    btnFixtures.addEventListener("pointerdown", switchClickGuard);
    btnResults.addEventListener("pointerdown", switchClickGuard);
    btnFixtures.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); setMode("fixtures"); });
    btnResults.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); setMode("results"); });

    // Init button state
    btnFixtures.setAttribute("aria-pressed", mode === "fixtures" ? "true" : "false");
    btnResults.setAttribute("aria-pressed", mode === "results" ? "true" : "false");

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

    function isInBar(target){
      return !!(target && bar.contains(target));
    }

    function onPointerDown(e){
      if(e.pointerType === "mouse" && e.button !== 0) return;
      if(isInBar(e.target)) return; // don't start dragging from the switcher bar

      dragging = true;
      movedPx = 0;
      dragStartX = e.clientX;
      dragStartOffset = offsetPx;
      try{ wrap.setPointerCapture(e.pointerId); }catch{}
    }
    function onPointerMove(e){
      if(!dragging || !shiftPx) return;
      const dx = e.clientX - dragStartX;
      movedPx = Math.max(movedPx, Math.abs(dx));
      offsetPx = dragStartOffset + dx;
      normalizeOffset();
      setTransform();
      writeStoredState(stKey, { mode, offsetPx });
    }
    function onPointerUp(e){
      if(!dragging) return;
      dragging = false;
      try{ wrap.releasePointerCapture(e.pointerId); }catch{}
      lastTs = performance.now();
      writeStoredState(stKey, { mode, offsetPx });
    }

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", onPointerUp);
    wrap.addEventListener("pointercancel", onPointerUp);

    // If user dragged, prevent accidental link activation
    root.addEventListener("click", (e)=>{
      const a = e.target && e.target.closest ? e.target.closest("a.fxLink") : null;
      if(!a) return;
      if(movedPx >= CLICK_CANCEL_PX){
        e.preventDefault();
        e.stopPropagation();
      }
    });

    function buildDividerEl(){
      const d = document.createElement("span");
      d.className = "divider";
      d.setAttribute("aria-hidden","true");
      return d;
    }

    function buildFixtureEl(fx, idx){
      const alt = (idx % 2 === 1);

      const scoreNorm = normalizeScore(fx.score || "");
      const hasScore = isRealScore(scoreNorm);
      const parsed = hasScore ? parseScore(scoreNorm) : null;

      let homeRes = "draw";
      let awayRes = "draw";
      if(parsed){
        if(parsed.h > parsed.a){ homeRes = "win"; awayRes = "lose"; }
        else if(parsed.h < parsed.a){ homeRes = "lose"; awayRes = "win"; }
      }

      const link = document.createElement("a");
      link.className = "fxLink";
      link.href = opts.hubUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.setAttribute("aria-label", "Open Match Hub");

      const meta = document.createElement("div");
      meta.className = "fxMeta";
      meta.textContent = fx.meta || "";
      link.appendChild(meta);

      const row = document.createElement("div");
      row.className = "fxRow";

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
      hTeam.className = "team" + (alt ? " alt" : "") + " " + (hasScore ? homeRes : "draw");
      hTeam.appendChild(makeLetters(teamTextForGraphic(fx.home) || toAllCaps(fx.home)));

      homeSide.appendChild(hCrest);
      homeSide.appendChild(hTeam);

      const score = document.createElement("span");
      score.className = "scorePill" + (hasScore ? "" : " vs");
      score.textContent = hasScore ? scoreNorm : "v";

      const awaySide = document.createElement("span");
      awaySide.className = "side";

      const aTeam = document.createElement("span");
      aTeam.className = "team" + (alt ? "" : " alt") + " " + (hasScore ? awayRes : "draw");
      aTeam.appendChild(makeLetters(teamTextForGraphic(fx.away) || toAllCaps(fx.away)));

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

      row.appendChild(homeSide);
      row.appendChild(score);
      row.appendChild(awaySide);

      link.appendChild(row);

      return link;
    }

    function recomputeShift(){
      shiftPx = laneA.scrollWidth || 0;
      normalizeOffset();
      setTransform();
      writeStoredState(stKey, { mode, offsetPx });
    }

    function render(fixtures){
      laneA.innerHTML = "";
      laneB.innerHTML = "";

      fixtures.forEach((fx, idx)=>{
        laneA.appendChild(buildFixtureEl(fx, idx));
        laneA.appendChild(buildDividerEl());
      });

      fixtures.forEach((fx, idx)=>{
        laneB.appendChild(buildFixtureEl(fx, idx));
        laneB.appendChild(buildDividerEl());
      });

      msg.style.display = (fixtures.length ? "none" : "block");

      normalizeOffset();
      setTransform();
      requestAnimationFrame(()=> requestAnimationFrame(recomputeShift));
    }

    function triggerWave(){
      if(mode !== "results") return;

      const winners = root.querySelectorAll(".team.win");
      winners.forEach(teamEl => {
        const letters = teamEl.querySelectorAll(".letter");
        letters.forEach((l, i) => {
          l.style.setProperty("--d", (i * opts.waveStaggerMs) + "ms");
        });
      });

      wrap.classList.remove("wave");
      void wrap.offsetWidth;
      wrap.classList.add("wave");

      const maxLetters = Math.max(8, ...Array.from(winners).map(w => (w.querySelectorAll(".letter").length || 0)));
      const totalMs = (maxLetters * opts.waveStaggerMs) + opts.waveDurMs + 120;
      window.setTimeout(()=> wrap.classList.remove("wave"), totalMs);
    }

    function windowNow(){ return new Date(); }

    async function refresh(){
      try{
        msg.style.display = "block";
        msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> loading…`;

        const res = await fetch(opts.csv, { cache:"no-store" });
        if(!res.ok) throw new Error("Feed fetch failed: " + res.status);
        const csvText = await res.text();

        const rows = parseCSV(csvText);
        if(!rows.length){
          msg.style.display = "block";
          msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> no rows found.`;
          render([]);
          return;
        }

        const header = rows[0].map(h => safeText(h).toLowerCase());

        const idxDateTime = header.indexOf("date & time");
        const idxComp     = header.indexOf("competition");
        const idxHome     = header.indexOf("home team");
        const idxScore    = header.indexOf("score");
        const idxAway     = header.indexOf("away team");

        const needed = [
          ["Date & Time", idxDateTime],
          ["Competition", idxComp],
          ["Home team", idxHome],
          ["Score", idxScore],
          ["Away team", idxAway]
        ];
        const missing = needed.filter(([,i]) => i === -1).map(([n]) => n);
        if(missing.length){
          msg.style.display = "block";
          msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> missing columns: ${missing.join(", ")}.`;
          render([]);
          return;
        }

        const now = windowNow();
        const todayStart = startOfDay(now);
        const todayEnd = endOfDay(now);

        const fixturesEnd = endOfDay(addDays(now, 7));
        const resultsStart = startOfDay(addDays(now, -7));

        const candidates = [];

        for(let i=1; i<rows.length; i++){
          const r = rows[i];
          if(!r || !r.length) continue;

          const dtRaw = safeText(r[idxDateTime]);
          const compRaw = safeText(r[idxComp]);
          const home = safeText(r[idxHome]);
          const scoreRaw = safeText(r[idxScore]);
          const away = safeText(r[idxAway]);

          if(!home || !away) continue;

          const dt = parseUKDateTime(dtRaw);
          if(!dt || !Number.isFinite(+dt)) continue;

          const scoreNorm = normalizeScore(scoreRaw);
          const hasScore = isRealScore(scoreNorm);

          candidates.push({
            dt,
            comp: displayCompetition(compRaw),
            home,
            away,
            score: scoreRaw,
            scoreNorm,
            hasScore
          });
        }

        let filtered = [];
        if(mode === "fixtures"){
          filtered = candidates.filter(x => {
            const t = +x.dt;
            const inNext7 = (t >= +todayStart && t <= +fixturesEnd);
            if(!inNext7) return false;

            const isToday = (t >= +todayStart && t <= +todayEnd);
            if(isToday){
              // today fixtures only if NOT yet a score
              return !x.hasScore;
            }
            // future fixtures only if NOT a score
            return !x.hasScore;
          });
        }else{
          filtered = candidates.filter(x => {
            const t = +x.dt;
            const inPast7 = (t >= +resultsStart && t <= +todayEnd);
            if(!inPast7) return false;
            return x.hasScore;
          });
        }

        filtered.sort((a,b)=>{
          const ta = +a.dt, tb = +b.dt;
          return (mode === "fixtures") ? (ta - tb) : (tb - ta);
        });

        const out = [];
        for(const x of filtered){
          const meta = `${x.comp} • ${formatMetaDateTime(x.dt)}`;
          out.push({
            home: x.home,
            score: x.score,
            away: x.away,
            meta
          });
          if(out.length >= opts.maxItems) break;
        }

        if(out.length === 0){
          msg.style.display = "block";
          msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> no matches in the last/next 7 days.`;
        }

        render(out);
      }catch(e){
        console.error("[ResultsTicker " + VERSION + "]", e);
        msg.style.display = "block";
        msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> feed error (open console).`;
      }
    }

    try{
      ro = new ResizeObserver(()=> recomputeShift());
      ro.observe(wrap);
    }catch{}

    refresh();
    refreshTimer = window.setInterval(refresh, opts.refreshMs);
    waveTimer = window.setInterval(triggerWave, opts.waveEveryMs);

    // Persist offset periodically
    const persistTimer = window.setInterval(()=> {
      writeStoredState(stKey, { mode, offsetPx });
    }, 2500);

    window.addEventListener("beforeunload", ()=> {
      writeStoredState(stKey, { mode, offsetPx });
    });

    startAnim();

    return {
      destroy(){
        if(rafId) cancelAnimationFrame(rafId);
        if(refreshTimer) window.clearInterval(refreshTimer);
        if(waveTimer) window.clearInterval(waveTimer);
        if(persistTimer) window.clearInterval(persistTimer);
        if(ro) ro.disconnect();
      }
    };
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.csv) opts.csv = d.csv;
    if(d.hubUrl) opts.hubUrl = d.hubUrl;

    if(d.maxItems) opts.maxItems = clampInt(d.maxItems, 1, 500, DEFAULTS.maxItems);
    if(d.height) opts.height = clampInt(d.height, 40, 240, DEFAULTS.height);
    if(d.speed) opts.speed = clampInt(d.speed, 10, 500, DEFAULTS.speed);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);

    if(d.dividerColor) opts.dividerColor = d.dividerColor;
    if(d.dividerH) opts.dividerH = clampInt(d.dividerH, 10, 90, DEFAULTS.dividerH);
    if(d.dividerW) opts.dividerW = clampInt(d.dividerW, 1, 12, DEFAULTS.dividerW);
    if(d.dividerPad) opts.dividerPad = clampInt(d.dividerPad, 0, 60, DEFAULTS.dividerPad);

    if(d.waveEveryMs) opts.waveEveryMs = clampInt(d.waveEveryMs, 2000, 600000, DEFAULTS.waveEveryMs);
    if(d.waveStaggerMs) opts.waveStaggerMs = clampInt(d.waveStaggerMs, 10, 200, DEFAULTS.waveStaggerMs);
    if(d.waveDurMs) opts.waveDurMs = clampInt(d.waveDurMs, 200, 2000, DEFAULTS.waveDurMs);

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;

    if(d.bg) opts.bg = d.bg;
    if(d.red) opts.red = d.red;
    if(d.blue) opts.blue = d.blue;
    if(d.text) opts.text = d.text;
    if(d.pillBg) opts.pillBg = d.pillBg;
    if(d.pillBorder) opts.pillBorder = d.pillBorder;

    if(d.defaultMode){
      const m = String(d.defaultMode).trim().toLowerCase();
      opts.defaultMode = (m === "fixtures") ? "fixtures" : "results";
    }

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
