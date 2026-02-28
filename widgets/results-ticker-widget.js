/* results-ticker-widget.js (v1.43)
   - Now uses clubs-meta.json for:
     - team display label (short, fallback name)
     - crest filename (code.png fallback to full-name.png)
     - colours (primary/secondary)
*/
(function(){
  "use strict";

  const VERSION = "v1.43";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTOvhhj8bPbZCsAEOurgzBzK_iZN6-qCux9ThncoO7_gZuPWmCHfrxf3vReW8m97hJ4guc954TzRrra/pub?output=csv",
    clubsMeta: "https://rckd-nl.github.io/nl-tools/assets/data/clubs-meta.json",
    hubUrl: "https://www.thenationalleague.org.uk/match-hub/",
    maxItems: 80,
    height: 76,
    speed: 80,
    refreshMs: 120000,
    kitCss: "https://use.typekit.net/gff4ipy.css",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    bg: "#ffffff",
    text: "#111111",
    pillBg: "#ffffff",
    pillBorder: "#000000",
    dividerColor: "#000000",
    dividerH: 34,
    dividerW: 2,
    dividerPad: 18,
    waveEveryMs: 12000,
    waveStaggerMs: 28,
    waveDurMs: 520,
    dayWindow: 7
  };

  function safeText(s){ return (s || "").toString().replace(/\s+/g," ").trim(); }
  function normalizeScore(s){
    const t = safeText(s);
    if(!t) return "";
    return t.replace(/[–—]/g, "-").replace(/\s+/g,"");
  }
  function isRealScore(score){
    const s = normalizeScore(score);
    return /^\d+\-\d+$/.test(s);
  }
  function parseScore(score){
    const s = normalizeScore(score);
    const m = /^(\d+)-(\d+)$/.exec(s);
    if(!m) return null;
    return { h: parseInt(m[1],10), a: parseInt(m[2],10) };
  }

  function parseUKDateTimeLocal(dtStr){
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
  function addDays(d, n){ const x = new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }

  function formatDateLabel(d){
    const w = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${w[d.getDay()]}, ${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
  }

  function compLabel(code){
    const c = safeText(code);
    const map = {
      "National": "Enterprise National League",
      "North": "Enterprise National League North",
      "South": "Enterprise National League South",
      "NL Cup": "National League Cup"
    };
    return map[c] || c || "—";
  }

  function cssFor(opts){
    return `
:host{
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
  --label-fg: rgba(0,0,0,0.72);
  --label-bg: rgba(255,255,255,0.92);
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
.wrap:before,.wrap:after{
  content:"";
  position:absolute; top:0; bottom:0;
  width:48px;
  pointer-events:none; z-index:3;
}
.wrap:before{ left:0; background:linear-gradient(to right, var(--bg) 0%, rgba(255,255,255,0) 100%); }
.wrap:after{ right:0; background:linear-gradient(to left, var(--bg) 0%, rgba(255,255,255,0) 100%); }

.topbar{
  position:absolute; left:10px; top:8px; z-index:4;
  display:flex; align-items:center; gap:10px;
  pointer-events:auto;
}
.toggle{
  display:inline-flex;
  border:1px solid rgba(0,0,0,0.16);
  border-radius:999px;
  overflow:hidden;
  background:rgba(255,255,255,0.86);
  backdrop-filter:saturate(1.2) blur(6px);
}
.tbtn{
  appearance:none; border:0; background:transparent;
  padding:6px 10px;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800; font-size:12px;
  letter-spacing:.02em;
  color:rgba(0,0,0,0.78);
  cursor:pointer;
}
.tbtn.active{ background:rgba(0,0,0,0.9); color:#fff; }

.belt{
  display:flex; align-items:center; white-space:nowrap;
  will-change:transform;
  transform:translate3d(0,0,0);
}
.lane{ display:flex; align-items:center; gap:var(--gap); }

.fixtureLink{
  color:inherit; text-decoration:none;
  display:inline-flex; align-items:center;
}
.fixture{
  display:inline-flex;
  align-items:center;
  gap:14px;
  padding:0 var(--div-pad);
  position:relative;
}
.meta{
  position:absolute; left:0; top:-18px;
  display:inline-flex; align-items:center; gap:8px;
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:11px; line-height:1;
  color:var(--label-fg);
  background:var(--label-bg);
  border:1px solid rgba(0,0,0,0.10);
  border-radius:999px;
  padding:3px 8px;
  white-space:nowrap;
}
.meta .dot{ width:4px; height:4px; border-radius:999px; background:rgba(0,0,0,0.35); display:inline-block; }

.side{ display:inline-flex; align-items:center; gap:10px; }

.crest{ width:var(--crest); height:var(--crest); object-fit:contain; display:block; }
.crest.missing{ width:0; height:0; }

.teamPill{
  display:inline-flex; align-items:center;
  height:30px; padding:0 12px;
  border-radius:999px;
  border:1px solid rgba(0,0,0,0.18);
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:900;
  letter-spacing:0.02em;
  font-size:14px;
  text-transform:uppercase;
  line-height:1;
  background: var(--tp-bg, #fff);
  color: var(--tp-fg, #111);
}

.scorePill{
  display:inline-flex; align-items:center; justify-content:center;
  min-width:66px; height:30px; padding:0 12px;
  border:2px solid var(--pill-border);
  border-radius:999px;
  background:var(--pill-bg);
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:900; font-size:16px;
  color:var(--text);
  line-height:1;
}

.divider{ width:var(--div-w); height:var(--div-h); background:var(--divider); display:block; opacity:1; }

.letter{ display:inline-block; transform:translateY(0); will-change:transform, filter; }
@keyframes waveJump{
  0%{transform:translateY(0);filter:brightness(1);}
  18%{transform:translateY(-7px);filter:brightness(1.25);}
  38%{transform:translateY(2px);filter:brightness(1.10);}
  60%{transform:translateY(-3px);filter:brightness(1.18);}
  100%{transform:translateY(0);filter:brightness(1);}
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
  font-size:14px; color:#111;
  padding:0 14px; white-space:nowrap;
}
@media (prefers-reduced-motion: reduce){
  .wrap.wave .teamPill.win .letter{ animation:none !important; }
}
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
      if(ch === '"'){ inQuotes = !inQuotes; continue; }
      if(!inQuotes && ch === ","){ row.push(cur); cur=""; continue; }
      if(!inQuotes && ch === "\n"){
        row.push(cur); out.push(row);
        row=[]; cur=""; continue;
      }
      if(ch !== "\r") cur += ch;
    }
    if(cur.length || row.length){ row.push(cur); out.push(row); }
    return out.map(r => r.map(c => safeText(c)));
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
  function splitToLettersIfNeeded(el){
    if(!el) return;
    if(el.querySelector(".letter")) return;
    const text = el.textContent || "";
    el.textContent = "";
    el.appendChild(makeLetters(text));
  }
  function restoreTextFromLetters(el){
    if(!el) return;
    const letters = el.querySelectorAll(".letter");
    if(!letters.length) return;
    let s = "";
    letters.forEach(l => { s += l.textContent || ""; });
    el.textContent = s;
  }

  function storageKey(opts){
    return "nl_results_ticker_state::" + btoa(unescape(encodeURIComponent(opts.csv))).slice(0,80);
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache: "force-cache" });
    if(!res.ok) throw new Error("clubs-meta fetch failed: " + res.status);
    return await res.json();
  }

  function escapeHtml(s){
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  function withinWindow(d, start, end){
    const t = +d;
    return Number.isFinite(t) && t >= +start && t <= +end;
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
    wrap.setAttribute("aria-label","Fixtures & results ticker");
    wrap.style.setProperty("--wave-dur", opts.waveDurMs + "ms");

    const topbar = document.createElement("div");
    topbar.className = "topbar";

    const toggle = document.createElement("div");
    toggle.className = "toggle";

    const btnFix = document.createElement("button");
    btnFix.type = "button";
    btnFix.className = "tbtn";
    btnFix.textContent = "Fixtures";

    const btnRes = document.createElement("button");
    btnRes.type = "button";
    btnRes.className = "tbtn";
    btnRes.textContent = "Results";

    toggle.appendChild(btnFix);
    toggle.appendChild(btnRes);
    topbar.appendChild(toggle);
    wrap.appendChild(topbar);

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
    msg.innerHTML = `<strong>Loading…</strong>`;
    wrap.appendChild(msg);

    const stateKey = storageKey(opts);

    // Clubs meta maps:
    // - by name (lower) -> { name, short, code, colors{primary,secondary} }
    let clubByName = new Map();

    let mode = "results";
    let lastDatasetSig = "";
    let items = [];

    let shiftPx = 0;
    let offsetPx = 0;
    let lastTs = 0;
    let rafId = 0;

    let dragging = false;
    let dragMoved = false;
    let dragStartX = 0;
    let dragStartOffset = 0;

    let refreshTimer = null;
    let ro = null;
    let waveTimer = null;
    let settleTimer = null;

    function saveState(){
      try{
        localStorage.setItem(stateKey, JSON.stringify({ v: VERSION, mode, offsetPx }));
      }catch{}
    }
    function loadState(){
      try{
        const raw = localStorage.getItem(stateKey);
        if(!raw) return;
        const s = JSON.parse(raw);
        if(s && (s.mode === "fixtures" || s.mode === "results")) mode = s.mode;
        if(typeof s.offsetPx === "number" && Number.isFinite(s.offsetPx)) offsetPx = s.offsetPx;
      }catch{}
    }

    function setMode(nextMode){
      mode = nextMode;
      btnFix.classList.toggle("active", mode === "fixtures");
      btnRes.classList.toggle("active", mode === "results");
      offsetPx = 0;
      setTransform();
      saveState();
      refresh();
    }

    btnFix.addEventListener("click", ()=> setMode("fixtures"));
    btnRes.addEventListener("click", ()=> setMode("results"));

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
        if((ts|0) % 1200 < 16) saveState();
      }
      rafId = requestAnimationFrame(tick);
    }
    function startAnim(){
      if(rafId) cancelAnimationFrame(rafId);
      lastTs = 0;
      rafId = requestAnimationFrame(tick);
    }

    function onPointerDown(e){
      const path = e.composedPath ? e.composedPath() : [];
      if(path.some(n => n === topbar || n === toggle || n === btnFix || n === btnRes)) return;
      if(e.pointerType === "mouse" && e.button !== 0) return;

      dragging = true;
      dragMoved = false;
      dragStartX = e.clientX;
      dragStartOffset = offsetPx;
      try{ wrap.setPointerCapture(e.pointerId); }catch{}
    }
    function onPointerMove(e){
      if(!dragging || !shiftPx) return;
      const dx = e.clientX - dragStartX;
      if(Math.abs(dx) > 6) dragMoved = true;
      offsetPx = dragStartOffset + dx;
      normalizeOffset();
      setTransform();
    }
    function onPointerUp(e){
      if(!dragging) return;
      dragging = false;
      try{ wrap.releasePointerCapture(e.pointerId); }catch{}
      lastTs = performance.now();
      saveState();
      window.setTimeout(()=>{ dragMoved = false; }, 0);
    }

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", onPointerUp);
    wrap.addEventListener("pointercancel", onPointerUp);

    wrap.addEventListener("click", (e)=>{
      if(!dragMoved) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    function buildDividerEl(){
      const d = document.createElement("span");
      d.className = "divider";
      d.setAttribute("aria-hidden","true");
      return d;
    }

    function getClub(teamName){
      const key = safeText(teamName).toLowerCase();
      return clubByName.get(key) || null;
    }

    function crestUrlFor(teamName){
      // Prefer code-based filename if present: CODE.png
      // Fallback: full team name filename (existing behaviour)
      const club = getClub(teamName);
      if(club && club.code){
        return encodeURI(opts.crestBase + safeText(club.code) + ".png");
      }
      const nm = safeText(teamName);
      if(!nm) return null;
      return encodeURI(opts.crestBase + nm + ".png");
    }

    function applyTeamColours(pill, teamName){
      const club = getClub(teamName);
      const bg = club && club.colors && club.colors.primary ? safeText(club.colors.primary) : "#ffffff";
      const fg = club && club.colors && club.colors.secondary ? safeText(club.colors.secondary) : "#111111";
      pill.style.setProperty("--tp-bg", bg);
      pill.style.setProperty("--tp-fg", fg);
    }

    function displayName(teamName){
      const club = getClub(teamName);
      // Use short label if present, else fall back to full name
      const txt = club && club.short ? safeText(club.short) : safeText(teamName);
      return txt.toUpperCase();
    }

    function buildFixtureEl(fx){
      const a = document.createElement("a");
      a.className = "fixtureLink";
      a.href = opts.hubUrl;
      a.target = "_blank";
      a.rel = "noopener";

      const parsed = parseScore(fx.score);
      let homeRes = "draw";
      let awayRes = "draw";
      if(parsed){
        if(parsed.h > parsed.a){ homeRes="win"; awayRes="lose"; }
        else if(parsed.h < parsed.a){ homeRes="lose"; awayRes="win"; }
      }

      const wrapFx = document.createElement("span");
      wrapFx.className = "fixture";

      const meta = document.createElement("span");
      meta.className = "meta";
      meta.innerHTML = `${escapeHtml(fx.dateLabel)} <span class="dot"></span> ${escapeHtml(fx.compLabel)}`;
      wrapFx.appendChild(meta);

      const homeSide = document.createElement("span");
      homeSide.className = "side";

      const hCrest = document.createElement("img");
      hCrest.className = "crest";
      hCrest.alt = safeText(fx.home) ? (safeText(fx.home) + " crest") : "";
      hCrest.decoding = "async";
      const hUrl = crestUrlFor(fx.home);
      if(hUrl){
        hCrest.src = hUrl;
        hCrest.onerror = ()=>{
          // fallback to full-name crest if code.png missing
          const fallback = encodeURI(opts.crestBase + safeText(fx.home) + ".png");
          if(hCrest.src !== fallback) hCrest.src = fallback;
          else hCrest.classList.add("missing");
        };
      }else{
        hCrest.classList.add("missing");
      }

      const hTeam = document.createElement("span");
      hTeam.className = "teamPill " + homeRes;
      hTeam.textContent = displayName(fx.home);
      applyTeamColours(hTeam, fx.home);

      homeSide.appendChild(hCrest);
      homeSide.appendChild(hTeam);

      const score = document.createElement("span");
      score.className = "scorePill";
      score.textContent = fx.scoreDisplay;

      const awaySide = document.createElement("span");
      awaySide.className = "side";

      const aTeam = document.createElement("span");
      aTeam.className = "teamPill " + awayRes;
      aTeam.textContent = displayName(fx.away);
      applyTeamColours(aTeam, fx.away);

      const aCrest = document.createElement("img");
      aCrest.className = "crest";
      aCrest.alt = safeText(fx.away) ? (safeText(fx.away) + " crest") : "";
      aCrest.decoding = "async";
      const aUrl = crestUrlFor(fx.away);
      if(aUrl){
        aCrest.src = aUrl;
        aCrest.onerror = ()=>{
          const fallback = encodeURI(opts.crestBase + safeText(fx.away) + ".png");
          if(aCrest.src !== fallback) aCrest.src = fallback;
          else aCrest.classList.add("missing");
        };
      }else{
        aCrest.classList.add("missing");
      }

      awaySide.appendChild(aTeam);
      awaySide.appendChild(aCrest);

      wrapFx.appendChild(homeSide);
      wrapFx.appendChild(score);
      wrapFx.appendChild(awaySide);

      a.appendChild(wrapFx);
      return a;
    }

    function recomputeShift(){
      shiftPx = laneA.scrollWidth || 0;
      normalizeOffset();
      setTransform();
    }
    function scheduleRecomputeAfterAssets(){
      if(settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(()=>{ recomputeShift(); }, 80);
      window.setTimeout(()=>{ recomputeShift(); }, 420);
    }

    function render(list){
      laneA.innerHTML = "";
      laneB.innerHTML = "";

      list.forEach(fx => { laneA.appendChild(buildFixtureEl(fx)); laneA.appendChild(buildDividerEl()); });
      list.forEach(fx => { laneB.appendChild(buildFixtureEl(fx)); laneB.appendChild(buildDividerEl()); });

      msg.style.display = (list.length ? "none" : "block");

      normalizeOffset();
      setTransform();

      requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
          recomputeShift();
          scheduleRecomputeAfterAssets();
        });
      });
    }

    function triggerWave(){
      if(mode !== "results") return;
      const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if(prefersReduced) return;

      const winners = root.querySelectorAll(".teamPill.win");
      if(!winners.length) return;

      winners.forEach(teamEl => {
        splitToLettersIfNeeded(teamEl);
        const letters = teamEl.querySelectorAll(".letter");
        letters.forEach((l, i) => l.style.setProperty("--d", (i * opts.waveStaggerMs) + "ms"));
      });

      wrap.classList.remove("wave");
      void wrap.offsetWidth;
      wrap.classList.add("wave");

      const maxLetters = Math.max(8, ...Array.from(winners).map(w => (w.querySelectorAll(".letter").length || 0)));
      const totalMs = (maxLetters * opts.waveStaggerMs) + opts.waveDurMs + 140;

      window.setTimeout(()=>{
        wrap.classList.remove("wave");
        winners.forEach(teamEl => restoreTextFromLetters(teamEl));
      }, totalMs);
    }

    function buildWindowed(parsed){
      const now = new Date();
      const today0 = startOfDay(now);
      const pastStart = addDays(today0, -opts.dayWindow);
      const futureEnd = addDays(today0, opts.dayWindow);

      const list = [];
      for(const r of parsed){
        const dt = r.dt;
        if(!dt || !Number.isFinite(+dt)) continue;

        const scoreNorm = normalizeScore(r.scoreRaw);
        const hasScore = isRealScore(scoreNorm);

        if(mode === "fixtures"){
          if(!withinWindow(dt, today0, futureEnd)) continue;
          if(hasScore) continue;
        }else{
          if(!withinWindow(dt, pastStart, now)) continue;
          if(!hasScore) continue;
        }

        list.push({
          dt,
          dateLabel: formatDateLabel(dt),
          compLabel: compLabel(r.comp),
          home: r.home,
          away: r.away,
          score: hasScore ? scoreNorm : "",
          scoreDisplay: hasScore ? scoreNorm : "v"
        });

        if(list.length >= opts.maxItems) break;
      }

      list.sort((a,b)=> (mode==="fixtures") ? (+a.dt - +b.dt) : (+b.dt - +a.dt));
      return list;
    }

    async function loadClubsMeta(){
      try{
        if(!opts.clubsMeta) return;
        const data = await fetchJson(opts.clubsMeta);
        const arr = Array.isArray(data && data.clubs) ? data.clubs : [];
        const m = new Map();
        arr.forEach(c => {
          const name = safeText(c && c.name);
          if(!name) return;
          m.set(name.toLowerCase(), c);
        });
        clubByName = m;
      }catch(e){
        console.warn("[ResultsTicker " + VERSION + "] clubs-meta load failed", e);
      }
    }

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

        const missing = [];
        if(idxDateTime === -1) missing.push("Date & Time");
        if(idxComp     === -1) missing.push("Competition");
        if(idxHome     === -1) missing.push("Home team");
        if(idxScore    === -1) missing.push("Score");
        if(idxAway     === -1) missing.push("Away team");

        if(missing.length){
          msg.style.display = "block";
          msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> missing columns: ${missing.join(", ")}.`;
          render([]);
          return;
        }

        const parsed = [];
        for(let i=1;i<rows.length;i++){
          const r = rows[i];
          if(!r || !r.length) continue;

          const dtRaw = safeText(r[idxDateTime]);
          const comp = safeText(r[idxComp]);
          const home = safeText(r[idxHome]);
          const scoreRaw = safeText(r[idxScore]);
          const away = safeText(r[idxAway]);

          if(!dtRaw && !home && !away && !scoreRaw) continue;

          const dt = parseUKDateTimeLocal(dtRaw);
          if(!dt) continue;

          parsed.push({ dt, comp, home, away, scoreRaw });
          if(parsed.length >= (opts.maxItems * 6)) break;
        }

        const sig = mode + "::" + parsed.slice(0,120).map(x => `${+x.dt}|${x.comp}|${x.home}|${x.scoreRaw}|${x.away}`).join("~");
        if(sig === lastDatasetSig && items.length){
          msg.style.display = "none";
          return;
        }
        lastDatasetSig = sig;

        items = buildWindowed(parsed);

        if(!items.length){
          msg.style.display = "block";
          msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> nothing in the last/next ${opts.dayWindow} days.`;
          render([]);
          return;
        }

        msg.style.display = "none";
        render(items);

      }catch(e){
        console.error("[ResultsTicker " + VERSION + "]", e);
        msg.style.display = "block";
        msg.innerHTML = `<strong>${mode === "fixtures" ? "Fixtures" : "Results"}:</strong> feed error (open console).`;
      }
    }

    let roT = 0;
    try{
      ro = new ResizeObserver(()=>{
        window.clearTimeout(roT);
        roT = window.setTimeout(()=>{ recomputeShift(); }, 90);
      });
      ro.observe(wrap);
    }catch{}

    // INIT
    loadState();
    btnFix.classList.toggle("active", mode === "fixtures");
    btnRes.classList.toggle("active", mode === "results");

    loadClubsMeta().finally(()=>{
      refresh().finally(()=>{
        normalizeOffset();
        setTransform();
      });
    });

    refreshTimer = window.setInterval(refresh, opts.refreshMs);
    waveTimer = window.setInterval(triggerWave, opts.waveEveryMs);
    startAnim();

    return {
      destroy(){
        if(rafId) cancelAnimationFrame(rafId);
        if(refreshTimer) window.clearInterval(refreshTimer);
        if(waveTimer) window.clearInterval(waveTimer);
        if(ro) ro.disconnect();
        if(settleTimer) window.clearTimeout(settleTimer);
      }
    };
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.csv) opts.csv = d.csv;
    if(d.clubsMeta) opts.clubsMeta = d.clubsMeta;
    if(d.hubUrl) opts.hubUrl = d.hubUrl;

    if(d.maxItems) opts.maxItems = clampInt(d.maxItems, 1, 500, DEFAULTS.maxItems);
    if(d.height) opts.height = clampInt(d.height, 44, 140, DEFAULTS.height);
    if(d.speed) opts.speed = clampInt(d.speed, 10, 500, DEFAULTS.speed);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);

    if(d.dividerColor) opts.dividerColor = d.dividerColor;
    if(d.dividerH) opts.dividerH = clampInt(d.dividerH, 10, 90, DEFAULTS.dividerH);
    if(d.dividerW) opts.dividerW = clampInt(d.dividerW, 1, 12, DEFAULTS.dividerW);
    if(d.dividerPad) opts.dividerPad = clampInt(d.dividerPad, 0, 70, DEFAULTS.dividerPad);

    if(d.waveEveryMs) opts.waveEveryMs = clampInt(d.waveEveryMs, 2000, 600000, DEFAULTS.waveEveryMs);
    if(d.waveStaggerMs) opts.waveStaggerMs = clampInt(d.waveStaggerMs, 10, 200, DEFAULTS.waveStaggerMs);
    if(d.waveDurMs) opts.waveDurMs = clampInt(d.waveDurMs, 200, 2000, DEFAULTS.waveDurMs);

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;

    if(d.bg) opts.bg = d.bg;
    if(d.text) opts.text = d.text;
    if(d.pillBg) opts.pillBg = d.pillBg;
    if(d.pillBorder) opts.pillBorder = d.pillBorder;

    if(d.dayWindow) opts.dayWindow = clampInt(d.dayWindow, 1, 21, DEFAULTS.dayWindow);

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