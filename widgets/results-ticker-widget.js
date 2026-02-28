/* Results Ticker Widget (v1.34) — Shadow DOM isolated embed
   - Feed: Google Sheets published CSV (CORS-friendly)
   - NEW SHEET COLS: Date & Time | MD | Competition | Home team | Score | Away team
   - ONLY MOST RECENT SET: filters to latest Date & Time in feed
   - Sticky label (top-left): Competition + date, updates as belt scrolls
   - Crests Home & Away
   - Divider BETWEEN fixtures (vertical line)
   - Winner wave/jump effect (letters) every N ms
   - Seamless loop + JS scroll + pointer drag scrub
*/
(function(){
  "use strict";

  const VERSION = "v1.34";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTOvhhj8bPbZCsAEOurgzBzK_iZN6-qCux9ThncoO7_gZuPWmCHfrxf3vReW8m97hJ4guc954TzRrra/pub?output=csv",
    maxItems: 60,
    height: 64,              // px
    speed: 80,               // px/sec
    refreshMs: 120000,       // 2 min
    kitCss: "https://use.typekit.net/gff4ipy.css",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    bg: "#ffffff",
    red: "#9e0000",
    blue: "#223b7c",
    text: "#111111",
    pillBg: "#ffffff",
    pillBorder: "#000000",
    dividerColor: "#000000",
    dividerH: 28,            // px height of divider line
    dividerW: 2,             // px width of divider line
    dividerPad: 18,          // px padding either side
    waveEveryMs: 10000,      // trigger interval
    waveStaggerMs: 35,       // per-letter delay
    waveDurMs: 520,          // per-letter animation duration
    stickyLabel: true        // show top-left label
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
  --gap:0px; /* we control spacing via divider pads now */
  --div-h:${opts.dividerH}px;
  --div-w:${opts.dividerW}px;
  --div-pad:${opts.dividerPad}px;
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

/* Sticky label (top-left) */
.sticky{
  position:absolute;
  top:8px;
  left:10px;
  z-index:4;
  display:flex;
  gap:8px;
  align-items:center;
  pointer-events:none;
}
.badge{
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:6px 10px;
  border-radius:999px;
  border:1px solid rgba(0,0,0,0.12);
  background:rgba(255,255,255,0.92);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow:0 1px 0 rgba(0,0,0,0.03);
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  font-size:12px;
  letter-spacing:.02em;
  text-transform:uppercase;
  color:#111;
  white-space:nowrap;
}
.badge .dot{
  width:6px; height:6px;
  border-radius:999px;
  background:var(--brand-red);
  display:inline-block;
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
  gap:14px;
  padding:0 var(--div-pad);
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

/* Divider BETWEEN fixtures */
.divider{
  width:var(--div-w);
  height:var(--div-h);
  background:var(--divider);
  display:block;
  opacity:1;
}

/* ===== Winner wave letters ===== */
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

/* When .wave is on the wrap, animate only winning letters */
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
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:14px;
  color:#111;
  padding:0 14px;
  white-space:nowrap;
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

  function normalizeScore(s){
    const t = safeText(s);
    if(!t) return "";
    return t.replace(/[–—]/g, "-").replace(/\s+/g,"").replace(/^(\d+)-(\d+)$/, "$1-$2");
  }

  function parseScore(score){
    const m = /^(\d+)-(\d+)$/.exec(score);
    if(!m) return null;
    return { h: parseInt(m[1],10), a: parseInt(m[2],10) };
  }

  function makeLetters(text){
    const frag = document.createDocumentFragment();
    const str = String(text || "");

    for(let i=0;i<str.length;i++){
      const ch = str[i];
      const span = document.createElement("span");
      span.className = "letter";

      if(ch === " "){
        span.innerHTML = "&nbsp;";
      }else{
        span.textContent = ch;
      }
      frag.appendChild(span);
    }
    return frag;
  }

  function parseUKDateTimeToMs(dtStr){
    // Expected: DD/MM/YYYY HH:MM (as in your sheet sample)
    const s = safeText(dtStr);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(s);
    if(!m) return NaN;
    const dd = parseInt(m[1],10);
    const mm = parseInt(m[2],10);
    const yyyy = parseInt(m[3],10);
    const hh = parseInt(m[4],10);
    const mi = parseInt(m[5],10);
    // Use UTC to avoid client TZ shifting
    return Date.UTC(yyyy, mm-1, dd, hh, mi, 0, 0);
  }

  function formatUKDateOnlyFromMs(ms){
    if(!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    const pad2 = (n)=>String(n).padStart(2,"0");
    return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`;
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

    // Sticky label
    const sticky = document.createElement("div");
    sticky.className = "sticky";
    sticky.style.display = opts.stickyLabel ? "flex" : "none";

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="txt">—</span>`;
    sticky.appendChild(badge);
    wrap.appendChild(sticky);

    root.appendChild(wrap);

    const msg = document.createElement("div");
    msg.className = "msg";
    msg.innerHTML = `<strong>Results:</strong> loading…`;
    wrap.appendChild(msg);

    // Animation state
    let shiftPx = 0;
    let offsetPx = 0;
    let lastTs = 0;
    let rafId = 0;

    // Scrub state
    let dragging = false;
    let dragStartX = 0;
    let dragStartOffset = 0;

    let refreshTimer = null;
    let ro = null;
    let waveTimer = null;

    // Sticky label update throttle
    let lastStickyKey = "";
    let lastStickyCheck = 0;

    // expose CSS var for wave duration
    wrap.style.setProperty("--wave-dur", opts.waveDurMs + "ms");

    function setTransform(){
      belt.style.transform = "translateX(" + offsetPx + "px)";
    }
    function normalizeOffset(){
      if(!shiftPx) return;
      while(offsetPx <= -shiftPx) offsetPx += shiftPx;
      while(offsetPx > 0) offsetPx -= shiftPx;
    }

    function setStickyLabel(comp, ms){
      const dateOnly = formatUKDateOnlyFromMs(ms);
      const txt = safeText(comp) ? `${safeText(comp)} • ${dateOnly}` : (dateOnly || "—");
      const el = badge.querySelector(".txt");
      if(el) el.textContent = txt;
    }

    function updateStickyLabel(){
      if(!opts.stickyLabel) return;
      const now = performance.now();
      if(now - lastStickyCheck < 120) return; // throttle
      lastStickyCheck = now;

      const fixtures = root.querySelectorAll(".fixture");
      if(!fixtures.length) return;

      const wrapRect = wrap.getBoundingClientRect();
      let best = null;
      let bestLeft = Infinity;

      for(const fx of fixtures){
        const r = fx.getBoundingClientRect();
        // we want the fixture whose left edge is closest to the wrap's left, but still visible
        if(r.right <= wrapRect.left + 2) continue;  // fully left/out
        if(r.left >= wrapRect.right) continue;      // fully right/out
        const dist = Math.abs(r.left - wrapRect.left);
        if(dist < bestLeft){
          bestLeft = dist;
          best = fx;
        }
      }

      if(!best) return;
      const key = best.getAttribute("data-groupkey") || "";
      if(!key || key === lastStickyKey) return;

      lastStickyKey = key;

      const comp = best.getAttribute("data-comp") || "";
      const msStr = best.getAttribute("data-ms") || "";
      const ms = Number(msStr);
      setStickyLabel(comp, ms);
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

      updateStickyLabel();
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
      updateStickyLabel();
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

    function buildDividerEl(){
      const d = document.createElement("span");
      d.className = "divider";
      d.setAttribute("aria-hidden","true");
      return d;
    }

    function buildFixtureEl(fx, idx){
      const alt = (idx % 2 === 1);
      const parsed = parseScore(fx.score);

      let homeRes = "draw";
      let awayRes = "draw";
      if(parsed){
        if(parsed.h > parsed.a){ homeRes = "win"; awayRes = "lose"; }
        else if(parsed.h < parsed.a){ homeRes = "lose"; awayRes = "win"; }
      }

      const wrapFx = document.createElement("span");
      wrapFx.className = "fixture";

      // data for sticky label
      wrapFx.setAttribute("data-comp", safeText(fx.comp));
      wrapFx.setAttribute("data-ms", String(fx.ms));
      wrapFx.setAttribute("data-groupkey", fx.groupKey);

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
      hTeam.className = "team" + (alt ? " alt" : "") + " " + homeRes;
      hTeam.appendChild(makeLetters(teamTextForGraphic(fx.home) || toAllCaps(fx.home)));

      homeSide.appendChild(hCrest);
      homeSide.appendChild(hTeam);

      const score = document.createElement("span");
      score.className = "scorePill";
      score.textContent = fx.score;

      // Away side (name then crest)
      const awaySide = document.createElement("span");
      awaySide.className = "side";

      const aTeam = document.createElement("span");
      aTeam.className = "team" + (alt ? "" : " alt") + " " + awayRes;
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

      wrapFx.appendChild(homeSide);
      wrapFx.appendChild(score);
      wrapFx.appendChild(awaySide);

      return wrapFx;
    }

    function recomputeShift(){
      shiftPx = laneA.scrollWidth || 0;
      normalizeOffset();
      setTransform();
      updateStickyLabel();
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

      // set initial sticky label from first fixture
      lastStickyKey = "";
      if(fixtures.length && opts.stickyLabel){
        setStickyLabel(fixtures[0].comp, fixtures[0].ms);
        lastStickyKey = fixtures[0].groupKey;
      }

      offsetPx = 0;
      setTransform();
      requestAnimationFrame(()=> requestAnimationFrame(recomputeShift));
    }

    function triggerWave(){
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

    async function refresh(){
      try{
        msg.style.display = "block";
        msg.innerHTML = `<strong>Results:</strong> loading…`;

        const res = await fetch(opts.csv, { cache:"no-store" });
        if(!res.ok) throw new Error("Feed fetch failed: " + res.status);
        const csvText = await res.text();

        const rows = parseCSV(csvText);
        if(!rows.length){
          msg.style.display = "block";
          msg.innerHTML = `<strong>Results:</strong> no rows found.`;
          render([]);
          return;
        }

        const header = rows[0].map(h => safeText(h).toLowerCase());

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
          msg.innerHTML = `<strong>Results:</strong> missing columns: ${missing.join(", ")}.`;
          render([]);
          return;
        }

        // First pass: find latest ms among valid rows
        let latestMs = NaN;
        for(let i=1; i<rows.length; i++){
          const r = rows[i];
          if(!r || !r.length) continue;

          const dtRaw = safeText(r[idxDateTime]);
          const home = safeText(r[idxHome]);
          const away = safeText(r[idxAway]);
          const scoreRaw = safeText(r[idxScore]);
          const score = normalizeScore(scoreRaw);

          if(!dtRaw || !home || !away || !score) continue;
          const ms = parseUKDateTimeToMs(dtRaw);
          if(!Number.isFinite(ms)) continue;

          if(!Number.isFinite(latestMs) || ms > latestMs) latestMs = ms;
        }

        if(!Number.isFinite(latestMs)){
          msg.style.display = "block";
          msg.innerHTML = `<strong>Results:</strong> no valid rows found.`;
          render([]);
          return;
        }

        // Second pass: collect only rows with latestMs
        const out = [];
        for(let i=1; i<rows.length; i++){
          const r = rows[i];
          if(!r || !r.length) continue;

          const dtRaw = safeText(r[idxDateTime]);
          const ms = parseUKDateTimeToMs(dtRaw);
          if(ms !== latestMs) continue;

          const comp = safeText(r[idxComp]);
          const home = safeText(r[idxHome]);
          const away = safeText(r[idxAway]);

          const scoreRaw = safeText(r[idxScore]);
          const score = normalizeScore(scoreRaw);

          if(!home || !away || !score) continue;

          const groupKey = `${safeText(comp).toLowerCase()}|${String(latestMs)}`;
          out.push({ home, away, score, comp, ms: latestMs, groupKey });
          if(out.length >= opts.maxItems) break;
        }

        if(out.length === 0){
          msg.style.display = "block";
          msg.innerHTML = `<strong>Results:</strong> no rows matched the latest set.`;
          render([]);
          return;
        }

        // Sort within the latest set: comp then home
        out.sort((a,b)=>{
          const ca = safeText(a.comp).toLowerCase();
          const cb = safeText(b.comp).toLowerCase();
          if(ca !== cb) return ca.localeCompare(cb);
          return safeText(a.home).toLowerCase().localeCompare(safeText(b.home).toLowerCase());
        });

        // Prime sticky label to that latest set (competition may vary within set)
        if(opts.stickyLabel){
          setStickyLabel(out[0].comp, out[0].ms);
          lastStickyKey = out[0].groupKey;
        }

        render(out);
      }catch(e){
        console.error("[ResultsTicker " + VERSION + "]", e);
        msg.style.display = "block";
        msg.innerHTML = `<strong>Results:</strong> feed error (open console).`;
      }
    }

    try{
      ro = new ResizeObserver(()=> recomputeShift());
      ro.observe(wrap);
    }catch{}

    refresh();
    refreshTimer = window.setInterval(refresh, opts.refreshMs);

    waveTimer = window.setInterval(triggerWave, opts.waveEveryMs);
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

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.csv) opts.csv = d.csv;

    if(d.maxItems) opts.maxItems = clampInt(d.maxItems, 1, 500, DEFAULTS.maxItems);
    if(d.height) opts.height = clampInt(d.height, 30, 160, DEFAULTS.height);
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
    if(d.red) opts.red = d.red;
    if(d.blue) opts.blue = d.blue;
    if(d.text) opts.text = d.text;
    if(d.pillBg) opts.pillBg = d.pillBg;
    if(d.pillBorder) opts.pillBorder = d.pillBorder;

    if(typeof d.stickyLabel !== "undefined"){
      const v = String(d.stickyLabel).toLowerCase();
      opts.stickyLabel = !(v === "0" || v === "false" || v === "no");
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