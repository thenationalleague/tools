/* Results Ticker Widget (v1.34) — Shadow DOM isolated embed
   - Feed: Google Sheets published CSV (CORS-friendly)
   - Crests Home & Away
   - Divider BETWEEN fixtures (vertical line)
   - Winner wave/jump effect (letters) every N ms
   - Seamless loop + JS scroll + pointer drag scrub
   - v1.34: club colours from clubs-meta.json
     Team pills: BG=primary, TEXT=secondary, BORDER=tertiary
*/
(function(){
  "use strict";

  const VERSION = "v1.34";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTOvhhj8bPbZCsAEOurgzBzK_iZN6-qCux9ThncoO7_gZuPWmCHfrxf3vReW8m97hJ4guc954TzRrra/pub?output=csv",
    clubsMeta: "https://rckd-nl.github.io/nl-tools/assets/data/clubs-meta.json",

    maxItems: 60,
    height: 64,              // px
    speed: 80,               // px/sec
    refreshMs: 120000,       // 2 min
    kitCss: "https://use.typekit.net/gff4ipy.css",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    bg: "#FFFFFF",
    text: "#111111",

    // score pill (kept neutral)
    scorePillBg: "#FFFFFF",
    scorePillBorder: "#000000",

    dividerColor: "#000000",
    dividerH: 28,            // px height of divider line
    dividerW: 2,             // px width of divider line
    dividerPad: 18,          // px padding either side

    waveEveryMs: 10000,      // trigger interval
    waveStaggerMs: 35,       // per-letter delay
    waveDurMs: 520           // per-letter animation duration
  };

  // Cache meta across multiple widgets on same page
  let CLUB_META_PROMISE = null;
  let CLUB_META_MAP = null;

  function safeText(s){ return (s || "").toString().replace(/\s+/g," ").trim(); }
  function lowerKey(s){ return safeText(s).toLowerCase(); }

  function normalizeHex(hex, fallback){
    const t = safeText(hex);
    if(!t) return fallback;
    // allow #RGB/#RRGGBB
    const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(t);
    if(!m) return fallback;
    return ("#" + m[1].toUpperCase());
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

  function teamTextForGraphic(teamName){
    const t = safeText(teamName);
    if(!t) return "";
    if(t.toLowerCase() === "hampton & richmond borough") return "HAMPTON & RICHMOND";
    return t.toUpperCase();
  }

  function crestUrlForTeam(opts, club){
    const t = safeText(club);
    if(!t) return null;
    return encodeURI(opts.crestBase + t + ".png");
  }

  function cssFor(opts){
    return `
:host{
  --bg:${opts.bg};
  --text:${opts.text};
  --h:${opts.height}px;

  --crest:30px;

  --score-bg:${opts.scorePillBg};
  --score-border:${opts.scorePillBorder};

  --divider:${opts.dividerColor};
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

/* ===== TEAM PILL ===== */
.teamPill{
  display:inline-flex;
  align-items:center;
  padding:6px 10px;
  border-radius:999px;
  border:2px solid var(--pill-brd, #000);
  background:var(--pill-bg, #EEE);
  color:var(--pill-fg, #000);
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  letter-spacing:0.04em;
  font-size:14px;
  text-transform:uppercase;
  line-height:1;
  white-space:nowrap;
}

/* Score pill stays neutral */
.scorePill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:66px;
  height:30px;
  padding:0 12px;
  border:2px solid var(--score-border);
  border-radius:999px;
  background:var(--score-bg);
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
.wrap.wave .teamPill.win .letter{
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

  // CSV parser (handles quoted cells)
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

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.csv) opts.csv = d.csv;
    if(d.clubsMeta) opts.clubsMeta = d.clubsMeta;

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
    if(d.text) opts.text = d.text;

    if(d.scorePillBg) opts.scorePillBg = d.scorePillBg;
    if(d.scorePillBorder) opts.scorePillBorder = d.scorePillBorder;

    return opts;
  }

  function clampInt(v, min, max, fallback){
    const n = parseInt(v, 10);
    if(Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  async function loadClubMetaOnce(url){
    // If already loaded for this page, reuse (even if multiple widgets exist).
    if(CLUB_META_MAP) return CLUB_META_MAP;

    if(!CLUB_META_PROMISE){
      CLUB_META_PROMISE = (async ()=>{
        try{
          const res = await fetch(url, { cache:"no-store" });
          if(!res.ok) throw new Error("clubs-meta fetch failed: " + res.status);
          const json = await res.json();
          const map = new Map();

          const clubs = Array.isArray(json && json.clubs) ? json.clubs : [];
          for(const c of clubs){
            const name = safeText(c && c.name);
            if(!name) continue;

            const colors = (c && c.colors) || {};
            const primary = normalizeHex(colors.primary, null);
            const secondary = normalizeHex(colors.secondary, null);
            const tertiary = normalizeHex(colors.tertiary, null);

            map.set(lowerKey(name), {
              primary: primary || "#EEEEEE",
              secondary: secondary || "#000000",
              tertiary: tertiary || (secondary || "#000000")
            });
          }

          CLUB_META_MAP = map;
          return map;
        }catch(err){
          console.warn("[ResultsTicker " + VERSION + "] clubs-meta unavailable; using fallback colours.", err);
          CLUB_META_MAP = new Map();
          return CLUB_META_MAP;
        }
      })();
    }

    return CLUB_META_PROMISE;
  }

  function getClubColors(metaMap, teamName){
    const key = lowerKey(teamName);
    const c = metaMap && metaMap.get(key);
    if(c) return c;
    // fallback neutral pill
    return { primary:"#EEEEEE", secondary:"#000000", tertiary:"#000000" };
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

    // meta
    let metaMap = null;

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

    function buildDividerEl(){
      const d = document.createElement("span");
      d.className = "divider";
      d.setAttribute("aria-hidden","true");
      return d;
    }

    function buildTeamPill(teamName, resultClass){
      const colors = getClubColors(metaMap, teamName);

      const pill = document.createElement("span");
      pill.className = "teamPill " + (resultClass || "");
      pill.style.setProperty("--pill-bg", colors.primary);
      pill.style.setProperty("--pill-fg", colors.secondary);
      pill.style.setProperty("--pill-brd", colors.tertiary);

      pill.appendChild(makeLetters(teamTextForGraphic(teamName) || safeText(teamName).toUpperCase()));
      return pill;
    }

    function buildFixtureEl(fx){
      const parsed = parseScore(fx.score);

      let homeRes = "draw";
      let awayRes = "draw";
      if(parsed){
        if(parsed.h > parsed.a){ homeRes = "win"; awayRes = "lose"; }
        else if(parsed.h < parsed.a){ homeRes = "lose"; awayRes = "win"; }
      }

      const wrapFx = document.createElement("span");
      wrapFx.className = "fixture";

      // Home side (crest then pill)
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

      const hPill = buildTeamPill(fx.home, homeRes);

      homeSide.appendChild(hCrest);
      homeSide.appendChild(hPill);

      const score = document.createElement("span");
      score.className = "scorePill";
      score.textContent = fx.score;

      // Away side (pill then crest)
      const awaySide = document.createElement("span");
      awaySide.className = "side";

      const aPill = buildTeamPill(fx.away, awayRes);

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

      awaySide.appendChild(aPill);
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
    }

    function render(fixtures){
      laneA.innerHTML = "";
      laneB.innerHTML = "";

      fixtures.forEach((fx)=>{
        laneA.appendChild(buildFixtureEl(fx));
        laneA.appendChild(buildDividerEl());
      });
      fixtures.forEach((fx)=>{
        laneB.appendChild(buildFixtureEl(fx));
        laneB.appendChild(buildDividerEl());
      });

      msg.style.display = (fixtures.length ? "none" : "block");

      offsetPx = 0;
      setTransform();
      requestAnimationFrame(()=> requestAnimationFrame(recomputeShift));
    }

    function triggerWave(){
      const winners = root.querySelectorAll(".teamPill.win");
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

        // ensure meta loaded (but don't block forever)
        if(!metaMap){
          metaMap = await loadClubMetaOnce(opts.clubsMeta);
        }

        const res = await fetch(opts.csv, { cache:"no-store" });
        if(!res.ok) throw new Error("Feed fetch failed: " + res.status);
        const csvText = await res.text();

        const rows = parseCSV(csvText);
        const out = [];

        if(!rows.length){
          msg.style.display = "block";
          msg.innerHTML = `<strong>Results:</strong> no rows found.`;
          render([]);
          return;
        }

        // New sheet headers:
        // Date & Time | MD | Competition | Home team | Score | Away team
        const header = rows[0].map(h => safeText(h).toLowerCase());
        const idxHome  = header.indexOf("home team");
        const idxScore = header.indexOf("score");
        const idxAway  = header.indexOf("away team");

        const missing = [];
        if(idxHome === -1) missing.push("Home team");
        if(idxScore === -1) missing.push("Score");
        if(idxAway === -1) missing.push("Away team");

        if(missing.length){
          msg.style.display = "block";
          msg.innerHTML = `<strong>Results:</strong> missing columns: ${missing.join(", ")}.`;
          render([]);
          return;
        }

        for(let i=1; i<rows.length; i++){
          const r = rows[i];
          if(!r || !r.length) continue;

          const home = safeText(r[idxHome]);
          const scoreRaw = safeText(r[idxScore]);
          const away = safeText(r[idxAway]);

          if(!home && !scoreRaw && !away) continue;

          const score = normalizeScore(scoreRaw);
          if(!home || !away || !score) continue;

          out.push({ home, score, away });
          if(out.length >= opts.maxItems) break;
        }

        if(out.length === 0){
          msg.style.display = "block";
          msg.innerHTML = `<strong>Results:</strong> no valid rows found (needs Home team, Score, Away team).`;
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
