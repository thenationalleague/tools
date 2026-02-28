/* results-ticker-widget.js (v1.45) — Shadow DOM isolated embed
   - Feed: Google Sheets published CSV (CORS-friendly)
   - NEW sheet headers: Date & Time | MD | Competition | Home team | Score | Away team
   - NEVER misses rows: scans the ENTIRE sheet (no early caps)
   - 3-day window:
       * Fixtures: now → now+3 days, include today if no valid score yet
       * Results: now-3 days → now, include today if valid score present
   - Date/time is per-game (superscript above fixture)
   - F/R switcher (works)
   - Every crest, team, score, divider area links to Match Hub (new window)
   - Club colours pulled from clubs-meta.json (primary bg, secondary text) for TEAM pills
   - Seamless loop + rAF scroll + pointer drag scrub
   - Resume from last position per mode (localStorage)
*/
(function(){
  "use strict";

  const VERSION = "v1.45";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTOvhhj8bPbZCsAEOurgzBzK_iZN6-qCux9ThncoO7_gZuPWmCHfrxf3vReW8m97hJ4guc954TzRrra/pub?output=csv",
    clubsMeta: "https://rckd-nl.github.io/nl-tools/assets/data/clubs-meta.json",

    maxItems: 120,            // final render cap AFTER filtering (safe)
    height: 74,               // px
    speed: 80,                // px/sec
    refreshMs: 120000,        // 2 min
    kitCss: "https://use.typekit.net/gff4ipy.css",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    bg: "#ffffff",
    text: "#111111",
    dividerColor: "#000000",
    dividerH: 34,             // px height of divider line
    dividerW: 2,              // px width of divider line
    dividerPad: 16,           // px padding either side
    windowDays: 3,            // +/- days window
    defaultMode: "results",   // "fixtures" | "results"
    matchHubUrl: "https://www.thenationalleague.org.uk/match-hub/",
    resumeKeyPrefix: "nlResultsTicker_v145_"
  };

  // Competition label mapping (as requested)
  const COMP_LABEL = {
    "National": "Enterprise National League",
    "North": "Enterprise National League North",
    "South": "Enterprise National League South",
    "NL Cup": "National League Cup"
  };

  function safeText(s){ return (s || "").toString().replace(/\s+/g," ").trim(); }
  function clampInt(v, min, max, fallback){
    const n = parseInt(v, 10);
    if(Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeScore(s){
    const t = safeText(s);
    if(!t) return "";
    return t.replace(/[–—]/g, "-").replace(/\s+/g,"");
  }

  function isValidScore(score){
    const s = normalizeScore(score);
    return /^(\d+)-(\d+)$/.test(s);
  }

  function parseScore(score){
    const s = normalizeScore(score);
    const m = /^(\d+)-(\d+)$/.exec(s);
    if(!m) return null;
    return { h: parseInt(m[1],10), a: parseInt(m[2],10) };
  }

  // Parse DD/MM/YYYY HH:MM as LOCAL time (UK-friendly)
  function parseUKDateTimeLocal(dtStr){
    const s = safeText(dtStr);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(s);
    if(!m) return null;
    const dd = +m[1], mm = +m[2], yyyy = +m[3], hh = +m[4], mi = +m[5];
    const d = new Date(yyyy, mm-1, dd, hh, mi, 0, 0);
    if(Number.isNaN(+d)) return null;
    return d;
  }

  function fmtDateSup(d){
    // ddd, d mmm yyyy (e.g. Sat, 9 Aug 2025)
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const mons = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${days[d.getDay()]}, ${d.getDate()} ${mons[d.getMonth()]} ${d.getFullYear()}`;
  }

  function pad2(n){ return String(n).padStart(2,"0"); }
  function fmtTime(d){
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function compLabel(raw){
    const t = safeText(raw);
    return COMP_LABEL[t] || t || "—";
  }

  // CSV parser (quoted)
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

  function cssFor(opts){
    return `
:host{
  --bg:${opts.bg};
  --text:${opts.text};
  --h:${opts.height}px;

  --crest:28px;
  --div-h:${opts.dividerH}px;
  --div-w:${opts.dividerW}px;
  --div-pad:${opts.dividerPad}px;
  --divider:${opts.dividerColor};

  --chip-bg:#111;
  --chip-fg:#fff;
  --chip-border:rgba(0,0,0,.12);

  --toggle-bg:#f2f3f5;
  --toggle-border:rgba(0,0,0,.12);
  --toggle-pill:#fff;
}

*{ box-sizing:border-box; }

.wrap{
  height:var(--h);
  background:var(--bg);
  overflow:hidden;
  position:relative;
  border-radius:12px;
  user-select:none;
  touch-action: pan-y;
  border:1px solid rgba(0,0,0,0.08);
}

/* top control bar */
.bar{
  position:absolute;
  left:10px;
  top:8px;
  display:flex;
  align-items:center;
  gap:10px;
  z-index:5;
}

.toggle{
  display:inline-flex;
  border:1px solid var(--toggle-border);
  background:var(--toggle-bg);
  border-radius:999px;
  padding:3px;
  gap:3px;
  box-shadow:0 1px 0 rgba(0,0,0,.04);
}

.tbtn{
  border:0;
  background:transparent;
  color:#111;
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  font-size:12px;
  padding:6px 10px;
  border-radius:999px;
  cursor:pointer;
}
.tbtn[aria-pressed="true"]{
  background:var(--toggle-pill);
  box-shadow:0 1px 0 rgba(0,0,0,.08);
}

.msg{
  position:absolute;
  left:12px;
  top:calc(50% - 10px);
  transform:translateY(-50%);
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:14px;
  color:#111;
  padding:0 14px;
  white-space:nowrap;
  z-index:4;
}
.msg strong{ font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }

/* subtle mask edges */
.wrap:before,
.wrap:after{
  content:"";
  position:absolute;
  top:0; bottom:0;
  width:52px;
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

.track{
  position:absolute;
  left:0; right:0;
  top:0; bottom:0;
  display:flex;
  align-items:center;
  padding-top:30px; /* room for bar */
}

.belt{
  display:flex;
  align-items:flex-start;
  white-space:nowrap;
  will-change:transform;
  transform:translate3d(0,0,0);
}

.lane{
  display:flex;
  align-items:flex-start;
}

/* Each game is one anchor so “everything is clickable” */
.game{
  display:inline-flex;
  flex-direction:column;
  gap:6px;
  padding:0 var(--div-pad);
  text-decoration:none;
  color:inherit;
}

.sup{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:11px;
  font-weight:800;
  letter-spacing:.02em;
  color:rgba(0,0,0,.75);
  white-space:nowrap;
}

.row{
  display:inline-flex;
  align-items:center;
  gap:10px;
  white-space:nowrap;
}

.side{
  display:inline-flex;
  align-items:center;
  gap:8px;
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
  border:1px solid var(--chip-border);
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:900;
  font-size:13px;
  letter-spacing:.02em;
  line-height:1;
  text-transform:uppercase;
  background:var(--chip-bg);
  color:var(--chip-fg);
}

.scorePill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:56px;
  height:28px;
  padding:0 10px;
  border:2px solid rgba(0,0,0,.86);
  border-radius:999px;
  background:#fff;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:900;
  font-size:14px;
  color:#111;
  line-height:1;
}

.vText{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:900;
  font-size:13px;
  letter-spacing:.02em;
  color:#111;
  padding:0 4px;
  text-transform:lowercase;
}

/* Divider BETWEEN games (clickable via .game anchor padding, divider itself is inside anchor) */
.divider{
  width:var(--div-w);
  height:var(--div-h);
  background:var(--divider);
  display:inline-block;
  opacity:1;
  align-self:center;
  margin-left:var(--div-pad);
  margin-right:var(--div-pad);
}
`;
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.csv) opts.csv = d.csv;
    if(d.clubsMeta) opts.clubsMeta = d.clubsMeta;

    if(d.maxItems) opts.maxItems = clampInt(d.maxItems, 10, 600, DEFAULTS.maxItems);
    if(d.height) opts.height = clampInt(d.height, 52, 140, DEFAULTS.height);
    if(d.speed) opts.speed = clampInt(d.speed, 10, 500, DEFAULTS.speed);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);
    if(d.windowDays) opts.windowDays = clampInt(d.windowDays, 1, 14, DEFAULTS.windowDays);

    if(d.dividerColor) opts.dividerColor = d.dividerColor;
    if(d.dividerH) opts.dividerH = clampInt(d.dividerH, 10, 80, DEFAULTS.dividerH);
    if(d.dividerW) opts.dividerW = clampInt(d.dividerW, 1, 12, DEFAULTS.dividerW);
    if(d.dividerPad) opts.dividerPad = clampInt(d.dividerPad, 0, 60, DEFAULTS.dividerPad);

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;
    if(d.matchHubUrl) opts.matchHubUrl = d.matchHubUrl;

    if(d.bg) opts.bg = d.bg;
    if(d.text) opts.text = d.text;

    if(d.defaultMode && (d.defaultMode === "fixtures" || d.defaultMode === "results")){
      opts.defaultMode = d.defaultMode;
    }

    return opts;
  }

  // Clubs meta -> { nameLower: {bg, fg} }
  async function loadClubColours(opts){
    try{
      const res = await fetch(opts.clubsMeta, { cache:"force-cache" });
      if(!res.ok) throw new Error("clubs-meta fetch failed: " + res.status);
      const json = await res.json();
      const map = new Map();

      const clubs = Array.isArray(json?.clubs) ? json.clubs : [];
      clubs.forEach(c=>{
        const name = safeText(c?.name).toLowerCase();
        const bg = safeText(c?.colors?.primary) || "";
        const fg = safeText(c?.colors?.secondary) || "";
        if(name && bg && fg){
          map.set(name, { bg, fg });
        }
      });

      return map;
    }catch(e){
      console.warn("[ResultsTicker " + VERSION + "] clubs-meta unavailable; falling back to defaults.", e);
      return new Map();
    }
  }

  function crestUrlForTeam(opts, club){
    const t = safeText(club);
    if(!t) return null;
    return encodeURI(opts.crestBase + t + ".png");
  }

  function makeWidget(hostEl){
    const opts = readOptions(hostEl);
    const root = hostEl.attachShadow