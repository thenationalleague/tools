/* Transfers Ticker Widget (v2.8) — Shadow DOM isolated embed
   Feed: Google Sheets published CSV
   Sheet columns:
   Player | Position | From | To | Type | Date

   v2.8:
   - FIX: auto-scroll restored on mobile + desktop
   - FIX: mobile finger drag / swipe works without killing auto-cycle
   - Freshness badge smaller, smoother pulse, sits beside transfer type
   - Position pill made much smaller
   - Rose underlay now black silhouette style, locked to viewport, wider on wide view, more transparent
   - Desktop = vertical swap
   - Mobile = horizontal drag + auto-advance
*/

(function(){
  "use strict";

  const VERSION = "v2.8";

  const DEFAULTS = {
    sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vScH-aEGMzzUMsxO4GkWK-mtoNGVUrQn_Lfz3LgnoH-1Uf3D7R-sxREmJsRy3DUfKOxqHxoahMihnuA/pubhtml",
    clubsMeta: "https://rckd-nl.github.io/nl-tools/assets/data/clubs-meta.json",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    roseImg: "National League rose.png",

    height: 108,
    panelWidth: 132,
    holdMs: 10000,
    animMs: 950,
    refreshMs: 120000,
    maxAgeDays: 31,

    bg: "#FFE100",
    fg: "#000000",
    panelBg: "#000000",
    panelFg: "#FFE100",
    border: "#000000",

    kitCss: "https://use.typekit.net/gff4ipy.css",
    fallbackClubLabel: "NL"
  };

  function safeText(s){
    return (s || "").toString().replace(/\s+/g, " ").trim();
  }

  function toAllCaps(s){
    return safeText(s).toUpperCase();
  }

  function resolveUrl(u){
    const raw = safeText(u);
    if(!raw) return "";
    try{
      return new URL(raw, document.baseURI).toString();
    }catch{
      return raw;
    }
  }

  function clampInt(v, min, max, fallback){
    const n = parseInt(v, 10);
    if(Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normKey(s){
    return safeText(s)
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/\./g, "")
      .replace(/'/g, "")
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normaliseSheetUrlToCsv(url){
    const raw = resolveUrl(url);
    if(!raw) return "";
    if(raw.includes("/pubhtml")) return raw.replace("/pubhtml", "/pub?output=csv");
    if(raw.includes("/pub?")){
      if(raw.includes("output=csv")) return raw;
      return raw + (raw.includes("?") ? "&" : "?") + "output=csv";
    }
    if(raw.includes("output=csv")) return raw;
    return raw;
  }

  function parseCSV(text){
    const out = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for(let i = 0; i < text.length; i++){
      const ch = text[i];
      const next = text[i + 1];

      if(ch === '"' && inQuotes && next === '"'){
        cur += '"';
        i++;
        continue;
      }
      if(ch === '"'){
        inQuotes = !inQuotes;
        continue;
      }
      if(!inQuotes && ch === ","){
        row.push(cur);
        cur = "";
        continue;
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

  function normalizeHeader(h){
    return safeText(h).toLowerCase();
  }

  function parseDateCell(value){
    const s = safeText(value);
    if(!s) return null;

    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
    if(m){
      const dd = +m[1];
      const mm = +m[2];
      const yy = +m[3];
      const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
      const d = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
      return Number.isFinite(+d) ? d : null;
    }

    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if(m){
      const dd = +m[1];
      const mm = +m[2];
      const yyyy = +m[3];
      const d = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
      return Number.isFinite(+d) ? d : null;
    }

    return null;
  }

  function formatDateDisplay(d){
    if(!d) return "";
    const wd = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
    const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
    return wd + " " + d.getDate() + " " + mon + " " + d.getFullYear();
  }

  function startOfLocalDay(d){
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }

  function dayDiffFromToday(d){
    const today = startOfLocalDay(new Date());
    const target = startOfLocalDay(d);
    return Math.round((today - target) / 86400000);
  }

  function freshnessLabel(d){
    const diff = dayDiffFromToday(d);
    if(diff === 0) return "Today";
    if(diff === 1) return "Yesterday";
    return "";
  }

  function normalizePosition(pos){
    const p = toAllCaps(pos).replace(/[^A-Z]/g, "");
    return p.slice(0, 2);
  }

  let CLUBS_BY_KEY = new Map();
  let CLUBS_LOADED = false;
  let CLUBS_LOADING = null;

  function addClubKey(map, key, clubObj){
    const k = normKey(key);
    if(!k) return;
    if(!map.has(k)) map.set(k, clubObj);
  }

  async function ensureClubsMeta(opts){
    if(CLUBS_LOADED) return;
    if(CLUBS_LOADING) return CLUBS_LOADING;

    CLUBS_LOADING = (async ()=>{
      try{
        const res = await fetch(resolveUrl(opts.clubsMeta), { cache: "no-store" });
        if(!res.ok) throw new Error("clubs-meta fetch failed: " + res.status);
        const json = await res.json();
        const clubs = Array.isArray(json && json.clubs) ? json.clubs : [];

        const map = new Map();
        for(const c of clubs){
          if(!c) continue;
          addClubKey(map, c.name, c);
          addClubKey(map, c.short, c);
          addClubKey(map, c.code, c);
        }

        CLUBS_BY_KEY = map;
        CLUBS_LOADED = true;
      }catch(e){
        console.error("[Transfers Ticker " + VERSION + "] clubs-meta load error:", e);
        CLUBS_BY_KEY = new Map();
        CLUBS_LOADED = false;
      }finally{
        CLUBS_LOADING = null;
      }
    })();

    return CLUBS_LOADING;
  }

  function clubMetaForName(name){
    const k = normKey(name);
    if(!k) return null;
    return CLUBS_BY_KEY.get(k) || null;
  }

  function crestUrlForClub(opts, clubName){
    const meta = clubMetaForName(clubName);
    const base = resolveUrl(opts.crestBase);

    if(meta && safeText(meta.name)){
      return encodeURI(base + safeText(meta.name) + ".png");
    }

    const rose = safeText(opts.roseImg);
    if(rose) return encodeURI(base + rose);

    return null;
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.sheet) opts.sheet = d.sheet;
    if(d.clubsMeta) opts.clubsMeta = d.clubsMeta;
    if(d.crestBase) opts.crestBase = d.crestBase;
    if(d.roseImg) opts.roseImg = d.roseImg;
    if(d.kitCss) opts.kitCss = d.kitCss;

    if(d.height) opts.height = clampInt(d.height, 72, 220, DEFAULTS.height);
    if(d.panelWidth) opts.panelWidth = clampInt(d.panelWidth, 90, 240, DEFAULTS.panelWidth);
    if(d.holdMs) opts.holdMs = clampInt(d.holdMs, 1000, 30000, DEFAULTS.holdMs);
    if(d.animMs) opts.animMs = clampInt(d.animMs, 200, 4000, DEFAULTS.animMs);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);
    if(d.maxAgeDays) opts.maxAgeDays = clampInt(d.maxAgeDays, 1, 365, DEFAULTS.maxAgeDays);

    if(d.bg) opts.bg = d.bg;
    if(d.fg) opts.fg = d.fg;
    if(d.panelBg) opts.panelBg = d.panelBg;
    if(d.panelFg) opts.panelFg = d.panelFg;
    if(d.border) opts.border = d.border;

    if(d.fallbackClubLabel) opts.fallbackClubLabel = safeText(d.fallbackClubLabel) || DEFAULTS.fallbackClubLabel;

    opts.sheet = normaliseSheetUrlToCsv(opts.sheet);
    opts.clubsMeta = resolveUrl(opts.clubsMeta);
    opts.crestBase = resolveUrl(opts.crestBase);

    return opts;
  }

  function cssFor(opts){
    return `
:host{
  display:block;
  width:100%;
  --bg:${opts.bg};
  --fg:${opts.fg};
  --panel-bg:${opts.panelBg};
  --panel-fg:${opts.panelFg};
  --border:${opts.border};
  --h:${opts.height}px;
  --panel-w:${opts.panelWidth}px;
}

*{ box-sizing:border-box; }

.wrap{
  width:100%;
  display:flex;
  background:var(--bg);
  border:3px solid var(--border);
  border-radius:12px;
  overflow:hidden;
  color:var(--fg);
}

.labelCol{
  width:var(--panel-w);
  flex:0 0 var(--panel-w);
  background:var(--panel-bg);
  color:var(--panel-fg);
  display:flex;
  align-items:center;
  justify-content:center;
  border-right:3px solid var(--border);
  padding:12px 10px;
}

.labelStack{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  justify-content:center;
  gap:3px;
  width:100%;
}

.labelTop,
.labelBottom{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  line-height:0.95;
  text-transform:uppercase;
  letter-spacing:0.04em;
  font-size:18px;
}

.contentCol{
  flex:1 1 auto;
  min-width:0;
  height:var(--h);
  overflow:hidden;
  position:relative;
  touch-action:pan-y;
}

.viewport{
  position:relative;
  width:100%;
  height:100%;
  overflow:hidden;
}

.viewport::before{
  content:"";
  position:absolute;
  inset:0;
  background-image:var(--rose-watermark, none);
  background-repeat:no-repeat;
  background-position:center;
  background-size:min(520px, 86%);
  opacity:0.075;
  pointer-events:none;
  z-index:0;
  filter:grayscale(1) brightness(0);
}

.track{
  position:absolute;
  inset:0;
  will-change:transform;
  transform:translateY(0);
  z-index:1;
}

.card{
  width:100%;
  height:var(--h);
  display:grid;
  grid-template-columns:minmax(0, 1fr) minmax(0, 1.25fr) minmax(0, 1fr);
  align-items:center;
  gap:18px;
  padding:14px 18px;
  background:transparent;
  position:relative;
  overflow:hidden;
}

.clubSide{
  display:flex;
  align-items:center;
  gap:12px;
  min-width:0;
}

.clubSide.to{
  justify-content:flex-end;
}

.clubSide.to .clubCopy{
  order:1;
  text-align:right;
  align-items:flex-end;
}

.clubSide.to .crest{
  order:2;
}

.crest{
  width:42px;
  height:42px;
  object-fit:contain;
  flex:0 0 42px;
  display:block;
}

.clubCopy{
  display:flex;
  flex-direction:column;
  gap:4px;
  min-width:0;
}

.sideLabel{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  font-size:11px;
  line-height:1;
  letter-spacing:0.12em;
  text-transform:uppercase;
  opacity:0.82;
}

.clubName{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  font-size:18px;
  line-height:1.02;
  text-transform:uppercase;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.middle{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:8px;
  min-width:0;
  text-align:center;
}

.playerRow{
  display:flex;
  align-items:flex-start;
  justify-content:center;
  gap:8px;
  min-width:0;
  max-width:100%;
}

.posPill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:24px;
  height:20px;
  padding:0 6px;
  border:1.5px solid var(--border);
  border-radius:999px;
  background:#ffffff;
  color:var(--fg);
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  font-size:10px;
  line-height:1;
  letter-spacing:0.03em;
  text-transform:uppercase;
  flex:0 0 auto;
  transform:translateY(3px);
}

.player{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  font-size:26px;
  line-height:0.98;
  text-transform:uppercase;
  white-space:normal;
  overflow:visible;
  text-overflow:clip;
  word-break:normal;
  overflow-wrap:anywhere;
  max-width:100%;
}

.metaRow{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:5px;
}

.metaTop{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  flex-wrap:wrap;
}

.typePill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:30px;
  padding:5px 13px 4px;
  border:2px solid var(--border);
  border-radius:999px;
  background:#000000;
  color:#FFE100;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  font-size:14px;
  line-height:1;
  letter-spacing:0.05em;
  text-transform:uppercase;
  white-space:nowrap;
}

.freshnessPill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:18px;
  padding:1px 6px 0;
  border:1px solid #8f0000;
  border-radius:999px;
  background:#c40000;
  color:#ffffff;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  font-size:8px;
  line-height:1;
  letter-spacing:0.04em;
  text-transform:uppercase;
  white-space:nowrap;
  animation:freshnessPulse 2.8s ease-in-out infinite;
}

@keyframes freshnessPulse{
  0%{ opacity:0.9; }
  50%{ opacity:0.4; }
  100%{ opacity:0.9; }
}

.dateText{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:700;
  font-size:12px;
  line-height:1.1;
  letter-spacing:0.03em;
  text-transform:uppercase;
}

.msg{
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  padding:0 16px;
  background:var(--bg);
  color:var(--fg);
  z-index:5;
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:14px;
}

.msg strong{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
}

@media (max-width: 980px){
  .card{
    grid-template-columns:minmax(0, 1fr) minmax(0, 1.45fr) minmax(0, 1fr);
  }

  .player{
    font-size:23px;
  }
}

@media (max-width: 768px){
  .wrap{
    flex-direction:column;
  }

  .labelCol{
    width:100%;
    flex:0 0 auto;
    border-right:0;
    border-bottom:3px solid var(--border);
    padding:12px 14px 10px;
  }

  .labelStack{
    flex-direction:row;
    align-items:center;
    justify-content:flex-start;
    gap:8px;
  }

  .labelTop,
  .labelBottom{
    font-size:16px;
  }

  .contentCol{
    height:auto;
    min-height:var(--h);
  }

  .viewport{
    height:auto;
    min-height:var(--h);
  }

  .track{
    position:relative;
  }

  .card{
    height:auto;
    min-height:var(--h);
    display:flex;
    flex-direction:column;
    align-items:stretch;
    gap:14px;
    padding:16px 14px 18px;
  }

  .middle{
    order:1;
    align-items:flex-start;
    text-align:left;
    gap:10px;
  }

  .playerRow{
    justify-content:flex-start;
    align-items:flex-start;
    gap:8px;
    width:100%;
  }

  .posPill{
    min-width:22px;
    height:18px;
    padding:0 5px;
    font-size:9px;
    transform:translateY(4px);
  }

  .player{
    font-size:28px;
    line-height:0.94;
  }

  .metaRow{
    align-items:flex-start;
    gap:6px;
  }

  .metaTop{
    justify-content:flex-start;
  }

  .freshnessPill{
    min-height:16px;
    padding:1px 5px 0;
    font-size:8px;
  }

  .dateText{
    font-size:13px;
  }

  .clubSide,
  .clubSide.to{
    justify-content:flex-start;
  }

  .clubSide.to .clubCopy,
  .clubSide.to .crest{
    order:initial;
  }

  .clubSide.to .clubCopy{
    text-align:left;
    align-items:flex-start;
  }

  .clubName{
    white-space:normal;
    overflow:visible;
    text-overflow:clip;
    font-size:17px;
  }

  .crest{
    width:36px;
    height:36px;
    flex-basis:36px;
  }
}

@media (max-width: 640px) and (orientation: landscape){
  .card{
    padding:12px 12px 14px;
    gap:10px;
  }

  .player{
    font-size:22px;
    line-height:0.96;
  }

  .clubName{
    font-size:15px;
  }

  .typePill{
    font-size:12px;
    min-height:26px;
    padding:4px 10px 3px;
  }

  .freshnessPill{
    font-size:7px;
    min-height:14px;
    padding:1px 4px 0;
  }

  .dateText{
    font-size:11px;
  }

  .sideLabel{
    font-size:10px;
  }
}

@media (prefers-reduced-motion: reduce){
  .track, .freshnessPill{
    transition:none !important;
    animation:none !important;
  }
}
`;
  }

  function makeClubSide(opts, labelText, clubName, className){
    const side = document.createElement("div");
    side.className = "clubSide " + className;

    const crest = document.createElement("img");
    crest.className = "crest";
    crest.alt = safeText(clubName) ? (clubName + " crest") : "National League crest";
    crest.src = crestUrlForClub(opts, clubName) || "";
    crest.loading = "lazy";
    crest.decoding = "async";
    crest.onerror = function(){
      const base = resolveUrl(opts.crestBase);
      this.onerror = null;
      this.src = encodeURI(base + safeText(opts.roseImg));
    };

    const copy = document.createElement("div");
    copy.className = "clubCopy";

    const label = document.createElement("div");
    label.className = "sideLabel";
    label.textContent = labelText;

    const club = document.createElement("div");
    club.className = "clubName";
    club.textContent = safeText(clubName) || opts.fallbackClubLabel;

    copy.appendChild(label);
    copy.appendChild(club);

    side.appendChild(crest);
    side.appendChild(copy);

    return side;
  }

  function makeCard(opts, item){
    const card = document.createElement("div");
    card.className = "card";

    const left = makeClubSide(opts, "From", item.from, "from");

    const middle = document.createElement("div");
    middle.className = "middle";

    const playerRow = document.createElement("div");
    playerRow.className = "playerRow";

    if(item.position){
      const posPill = document.createElement("div");
      posPill.className = "posPill";
      posPill.textContent = item.position;
      playerRow.appendChild(posPill);
    }

    const player = document.createElement("div");
    player.className = "player";
    player.textContent = safeText(item.player);
    playerRow.appendChild(player);

    const metaRow = document.createElement("div");
    metaRow.className = "metaRow";

    const metaTop = document.createElement("div");
    metaTop.className = "metaTop";

    const typePill = document.createElement("div");
    typePill.className = "typePill";
    typePill.textContent = toAllCaps(item.type);
    metaTop.appendChild(typePill);

    if(item.freshnessLabel){
      const freshnessPill = document.createElement("div");
      freshnessPill.className = "freshnessPill";
      freshnessPill.textContent = item.freshnessLabel;
      metaTop.appendChild(freshnessPill);
    }

    const dateText = document.createElement("div");
    dateText.className = "dateText";
    dateText.textContent = item.dateDisplay || "";

    metaRow.appendChild(metaTop);
    if(item.dateDisplay) metaRow.appendChild(dateText);

    middle.appendChild(playerRow);
    middle.appendChild(metaRow);

    const right = makeClubSide(opts, "To", item.to, "to");

    card.appendChild(left);
    card.appendChild(middle);
    card.appendChild(right);

    return card;
  }

  function makeWidget(hostEl){
    const opts = readOptions(hostEl);
    const root = hostEl.attachShadow({ mode: "open" });

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
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Latest transfers ticker");

    const labelCol = document.createElement("div");
    labelCol.className = "labelCol";

    const labelStack = document.createElement("div");
    labelStack.className = "labelStack";

    const labelTop = document.createElement("div");
    labelTop.className = "labelTop";
    labelTop.textContent = "Latest";

    const labelBottom = document.createElement("div");
    labelBottom.className = "labelBottom";
    labelBottom.textContent = "Transfers";

    labelStack.appendChild(labelTop);
    labelStack.appendChild(labelBottom);
    labelCol.appendChild(labelStack);

    const contentCol = document.createElement("div");
    contentCol.className = "contentCol";

    const viewport = document.createElement("div");
    viewport.className = "viewport";

    const track = document.createElement("div");
    track.className = "track";

    const msg = document.createElement("div");
    msg.className = "msg";
    msg.innerHTML = "<strong>Loading…</strong>";

    viewport.appendChild(track);
    contentCol.appendChild(viewport);
    contentCol.appendChild(msg);

    wrap.appendChild(labelCol);
    wrap.appendChild(contentCol);
    root.appendChild(wrap);

    const roseWatermarkUrl = resolveUrl(opts.crestBase) + safeText(opts.roseImg);
    wrap.style.setProperty("--rose-watermark", 'url("' + roseWatermarkUrl.replace(/"/g, '\\"') + '")');

    let items = [];
    let index = 0;
    let timer = null;
    let refreshTimer = null;
    let destroyed = false;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchDeltaX = 0;
    let touchDeltaY = 0;
    let touchActive = false;
    let touchDragging = false;
    let dragAxisLocked = false;
    let dragAxis = "";

    function clearCycle(){
      if(timer){
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function isMobileStack(){
      return window.matchMedia("(max-width: 768px)").matches;
    }

    function currentCardHeight(){
      const first = track.firstElementChild;
      if(first) return first.offsetHeight || opts.height;
      return opts.height;
    }

    function currentCardWidth(){
      return contentCol.clientWidth || opts.height;
    }

    function resetTrack(){
      track.style.transition = "none";
      track.style.transform = isMobileStack() ? "translateX(0)" : "translateY(0)";
      while(track.firstChild) track.removeChild(track.firstChild);
    }

    function renderSingle(item){
      resetTrack();
      track.style.display = "block";
      track.style.flexDirection = "";
      track.style.alignItems = "";
      track.style.width = "";
      track.appendChild(makeCard(opts, item));
    }

    function renderMobileDragSet(){
      if(!items.length) return;

      const prevIndex = ((index - 1) % items.length + items.length) % items.length;
      const nextIndex = (index + 1) % items.length;
      const cardW = currentCardWidth();

      resetTrack();
      track.style.display = "flex";
      track.style.flexDirection = "row";
      track.style.alignItems = "stretch";
      track.style.width = (cardW * 3) + "px";

      const prevCard = makeCard(opts, items[prevIndex]);
      const currentCard = makeCard(opts, items[index]);
      const nextCard = makeCard(opts, items[nextIndex]);

      [prevCard, currentCard, nextCard].forEach(card => {
        card.style.width = cardW + "px";
        card.style.minWidth = cardW + "px";
        card.style.maxWidth = cardW + "px";
        card.style.flex = "0 0 " + cardW + "px";
        track.appendChild(card);
      });

      track.style.transform = "translateX(" + (-cardW) + "px)";
    }

    function showMessage(html){
      msg.style.display = "flex";
      msg.innerHTML = html;
    }

    function hideMessage(){
      msg.style.display = "none";
    }

    function queueNext(){
      clearCycle();
      if(destroyed || items.length <= 1 || touchDragging) return;

      timer = window.setTimeout(()=>{
        const current = items[index];
        const nextIndex = (index + 1) % items.length;
        const next = items[nextIndex];
        const mobile = isMobileStack();

        resetTrack();
        track.appendChild(makeCard(opts, current));
        track.appendChild(makeCard(opts, next));

        if(mobile){
          const cardW = currentCardWidth();

          track.style.display = "flex";
          track.style.flexDirection = "row";
          track.style.alignItems = "stretch";
          track.style.width = (cardW * 2) + "px";

          const cards = track.children;
          for(let i = 0; i < cards.length; i++){
            cards[i].style.width = cardW + "px";
            cards[i].style.minWidth = cardW + "px";
            cards[i].style.maxWidth = cardW + "px";
            cards[i].style.flex = "0 0 " + cardW + "px";
          }

          track.style.transform = "translateX(0px)";

          requestAnimationFrame(()=>{
            requestAnimationFrame(()=>{
              track.style.transition = "transform " + opts.animMs + "ms cubic-bezier(0.22, 1, 0.36, 1)";
              track.style.transform = "translateX(" + (-cardW) + "px)";
            });
          });
        }else{
          track.style.display = "block";
          track.style.flexDirection = "";
          track.style.alignItems = "";
          track.style.width = "";

          const cards = track.children;
          for(let i = 0; i < cards.length; i++){
            cards[i].style.width = "";
            cards[i].style.minWidth = "";
            cards[i].style.maxWidth = "";
            cards[i].style.flex = "";
          }

          const cardH = currentCardHeight();

          requestAnimationFrame(()=>{
            requestAnimationFrame(()=>{
              track.style.transition = "transform " + opts.animMs + "ms cubic-bezier(0.22, 1, 0.36, 1)";
              track.style.transform = "translateY(-" + cardH + "px)";
            });
          });
        }

        timer = window.setTimeout(()=>{
          index = nextIndex;
          renderSingle(items[index]);
          queueNext();
        }, opts.animMs + 80);

      }, opts.holdMs);
    }

    async function refresh(){
      try{
        showMessage("<strong>Loading…</strong>");

        await ensureClubsMeta(opts);

        const res = await fetch(opts.sheet, { cache: "no-store" });
        if(!res.ok) throw new Error("sheet fetch failed: " + res.status);

        const csvText = await res.text();
        const rows = parseCSV(csvText).filter(r => r.some(c => safeText(c)));

        if(!rows.length){
          showMessage("<strong>Error:</strong>&nbsp;CSV has no rows.");
          return;
        }

        const header = rows[0].map(normalizeHeader);

        const idxPlayer = header.indexOf("player");
        const idxPosition = header.indexOf("position");
        const idxFrom = header.indexOf("from");
        const idxTo = header.indexOf("to");
        const idxType = header.indexOf("type");
        const idxDate = header.indexOf("date");

        const missing = [];
        if(idxPlayer === -1) missing.push("Player");
        if(idxPosition === -1) missing.push("Position");
        if(idxFrom === -1) missing.push("From");
        if(idxTo === -1) missing.push("To");
        if(idxType === -1) missing.push("Type");
        if(idxDate === -1) missing.push("Date");

        if(missing.length){
          showMessage("<strong>Error:</strong>&nbsp;Missing columns: " + missing.join(", ") + ".");
          return;
        }

        const nextItems = [];
        const todayStart = startOfLocalDay(new Date());

        for(let i = 1; i < rows.length; i++){
          const r = rows[i];
          if(!r || !r.length) continue;

          const player = safeText(r[idxPlayer]);
          const position = normalizePosition(r[idxPosition]);
          const from = safeText(r[idxFrom]);
          const to = safeText(r[idxTo]);
          const type = safeText(r[idxType]);
          const dateRaw = safeText(r[idxDate]);
          const dateObj = parseDateCell(dateRaw);

          if(!player || !from || !to || !type || !dateObj) continue;

          const itemDay = startOfLocalDay(dateObj);
          const ageDays = Math.floor((todayStart - itemDay) / 86400000);
          if(ageDays > opts.maxAgeDays) continue;

          nextItems.push({
            player,
            position,
            from,
            to,
            type,
            dateRaw,
            dateObj,
            dateDisplay: formatDateDisplay(dateObj),
            freshnessLabel: freshnessLabel(dateObj),
            rowOrder: i
          });
        }

        nextItems.sort((a, b)=>{
          const dateDiff = b.dateObj - a.dateObj;
          if(dateDiff !== 0) return dateDiff;
          return a.rowOrder - b.rowOrder;
        });

        if(!nextItems.length){
          showMessage("<strong>No recent transfers found.</strong>");
          return;
        }

        const oldSig = JSON.stringify(items);
        const newSig = JSON.stringify(nextItems);

        items = nextItems;
        hideMessage();

        if(oldSig !== newSig || !track.firstChild){
          index = 0;
          clearCycle();
          renderSingle(items[index]);
          queueNext();
        }
      }catch(e){
        console.error("[Transfers Ticker " + VERSION + "]", e);
        showMessage("<strong>Error:</strong>&nbsp;Feed/parse failed.");
      }
    }

    const onResize = ()=>{
      if(!items.length) return;
      clearCycle();
      touchActive = false;
      touchDragging = false;
      dragAxisLocked = false;
      dragAxis = "";
      renderSingle(items[index]);
      queueNext();
    };

    function onTouchStart(e){
      if(!isMobileStack()) return;
      if(!items.length || items.length <= 1) return;
      if(!e.touches || e.touches.length !== 1) return;

      const t = e.touches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      touchDeltaX = 0;
      touchDeltaY = 0;
      touchActive = true;
      touchDragging = false;
      dragAxisLocked = false;
      dragAxis = "";
    }

    function onTouchMove(e){
      if(!isMobileStack()) return;
      if(!touchActive) return;
      if(!e.touches || !e.touches.length) return;

      const t = e.touches[0];
      touchDeltaX = t.clientX - touchStartX;
      touchDeltaY = t.clientY - touchStartY;

      if(!dragAxisLocked){
        if(Math.abs(touchDeltaX) > 6 || Math.abs(touchDeltaY) > 6){
          dragAxisLocked = true;
          dragAxis = Math.abs(touchDeltaX) > Math.abs(touchDeltaY) ? "x" : "y";
          if(dragAxis === "x"){
            touchDragging = true;
            clearCycle();
            renderMobileDragSet();
          }
        }
      }

      if(dragAxis !== "x" || !touchDragging) return;

      const cardW = currentCardWidth();
      track.style.transition = "none";
      track.style.transform = "translateX(" + (-cardW + touchDeltaX) + "px)";
    }

    function onTouchEnd(){
      if(!isMobileStack()) return;
      if(!touchActive){
        touchDragging = false;
        dragAxisLocked = false;
        dragAxis = "";
        return;
      }

      const wasDragging = touchDragging;
      const dx = touchDeltaX;
      const cardW = currentCardWidth();
      const threshold = Math.max(50, cardW * 0.18);

      touchActive = false;
      touchDragging = false;
      dragAxisLocked = false;
      dragAxis = "";

      if(!wasDragging){
        queueNext();
        return;
      }

      if(dx <= -threshold){
        track.style.transition = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";
        track.style.transform = "translateX(" + (-2 * cardW) + "px)";
        window.setTimeout(()=>{
          index = (index + 1) % items.length;
          renderSingle(items[index]);
          queueNext();
        }, 260);
        return;
      }

      if(dx >= threshold){
        track.style.transition = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";
        track.style.transform = "translateX(0px)";
        window.setTimeout(()=>{
          index = ((index - 1) % items.length + items.length) % items.length;
          renderSingle(items[index]);
          queueNext();
        }, 260);
        return;
      }

      track.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
      track.style.transform = "translateX(" + (-cardW) + "px)";
      window.setTimeout(()=>{
        renderSingle(items[index]);
        queueNext();
      }, 220);
    }

    contentCol.addEventListener("touchstart", onTouchStart, { passive: true });
    contentCol.addEventListener("touchmove", onTouchMove, { passive: true });
    contentCol.addEventListener("touchend", onTouchEnd, { passive: true });
    contentCol.addEventListener("touchcancel", onTouchEnd, { passive: true });

    try{
      const ro = new ResizeObserver(onResize);
      ro.observe(contentCol);

      refresh();
      refreshTimer = window.setInterval(refresh, opts.refreshMs);

      return {
        destroy(){
          destroyed = true;
          clearCycle();
          if(refreshTimer) window.clearInterval(refreshTimer);
          contentCol.removeEventListener("touchstart", onTouchStart, { passive: true });
          contentCol.removeEventListener("touchmove", onTouchMove, { passive: true });
          contentCol.removeEventListener("touchend", onTouchEnd, { passive: true });
          contentCol.removeEventListener("touchcancel", onTouchEnd, { passive: true });
          ro.disconnect();
        }
      };
    }catch{
      window.addEventListener("resize", onResize);

      refresh();
      refreshTimer = window.setInterval(refresh, opts.refreshMs);

      return {
        destroy(){
          destroyed = true;
          clearCycle();
          if(refreshTimer) window.clearInterval(refreshTimer);
          contentCol.removeEventListener("touchstart", onTouchStart, { passive: true });
          contentCol.removeEventListener("touchmove", onTouchMove, { passive: true });
          contentCol.removeEventListener("touchend", onTouchEnd, { passive: true });
          contentCol.removeEventListener("touchcancel", onTouchEnd, { passive: true });
          window.removeEventListener("resize", onResize);
        }
      };
    }
  }

  function bootOnce(){
    const nodes = document.querySelectorAll("[data-nl-transfers-ticker]");
    nodes.forEach(node => {
      if(node.__nlTransfersTicker) return;
      try{
        node.__nlTransfersTicker = makeWidget(node);
      }catch(e){
        console.error("[Transfers Ticker " + VERSION + "] boot error", e);
      }
    });
  }

  function boot(){
    bootOnce();
    const mo = new MutationObserver(()=>{ bootOnce(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
