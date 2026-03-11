/* Transfers Ticker Widget (v2.0) — Shadow DOM isolated embed
   Feed: Google Sheets published CSV
   Sheet columns:
   Player | From | To | Type | Date

   v2.0:
   - NEW: fixed left panel "LATEST TRANSFERS"
   - NEW: right content cell with improved broadcast-style layout
   - NEW: date line shown under type pill, formatted "Tue 10 Mar 2026"
   - NEW: mobile stacked layout (player > meta > from > to)
   - FIX: removed disappearing arrow entirely
   - FIX: cleaner end-loop back to first item
   - Hold 10s by default, then eased vertical slide to next
   - Crest lookup by club name via clubs-meta.json
   - Fallback crest = National League rose
*/

(function(){
  "use strict";

  const VERSION = "v2.0";

  const DEFAULTS = {
    sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vScH-aEGMzzUMsxO4GkWK-mtoNGVUrQn_Lfz3LgnoH-1Uf3D7R-sxREmJsRy3DUfKOxHxoahMihnuA/pubhtml",
    clubsMeta: "https://rckd-nl.github.io/nl-tools/assets/data/clubs-meta.json",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    roseImg: "National League rose.png",

    height: 108,
    panelWidth: 154,
    holdMs: 10000,
    animMs: 950,
    refreshMs: 120000,

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

    if(raw.includes("/pubhtml")){
      return raw.replace("/pubhtml", "/pub?output=csv");
    }

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
  gap:4px;
  width:100%;
}

.labelTop,
.labelBottom{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  line-height:0.95;
  text-transform:uppercase;
  letter-spacing:0.04em;
}

.labelTop{
  font-size:16px;
}

.labelBottom{
  font-size:24px;
}

.contentCol{
  flex:1 1 auto;
  min-width:0;
  height:var(--h);
  overflow:hidden;
  position:relative;
}

.viewport{
  position:relative;
  width:100%;
  height:100%;
  overflow:hidden;
}

.track{
  position:absolute;
  inset:0;
  will-change:transform;
  transform:translateY(0);
}

.card{
  width:100%;
  height:var(--h);
  display:grid;
  grid-template-columns:minmax(0, 1fr) minmax(0, 1.15fr) minmax(0, 1fr);
  align-items:center;
  gap:18px;
  padding:14px 18px;
  background:var(--bg);
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

.player{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:950;
  font-size:26px;
  line-height:0.98;
  text-transform:uppercase;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  max-width:100%;
}

.metaRow{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:5px;
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

  .labelTop{
    font-size:14px;
  }

  .labelBottom{
    font-size:20px;
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
    gap:12px;
    padding:14px 14px 16px;
  }

  .middle{
    order:1;
    align-items:flex-start;
    text-align:left;
  }

  .player{
    white-space:normal;
    overflow:visible;
    text-overflow:clip;
    font-size:22px;
  }

  .metaRow{
    align-items:flex-start;
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

@media (prefers-reduced-motion: reduce){
  .track{
    transition:none !important;
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

    const player = document.createElement("div");
    player.className = "player";
    player.textContent = safeText(item.player);

    const metaRow = document.createElement("div");
    metaRow.className = "metaRow";

    const typePill = document.createElement("div");
    typePill.className = "typePill";
    typePill.textContent = toAllCaps(item.type);

    const dateText = document.createElement("div");
    dateText.className = "dateText";
    dateText.textContent = item.dateDisplay || "";

    metaRow.appendChild(typePill);
    if(item.dateDisplay) metaRow.appendChild(dateText);

    middle.appendChild(player);
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

    let items = [];
    let index = 0;
    let timer = null;
    let refreshTimer = null;
    let destroyed = false;

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
      if(isMobileStack()){
        const first = track.firstElementChild;
        if(first) return first.offsetHeight || opts.height;
      }
      return opts.height;
    }

    function resetTrack(){
      track.style.transition = "none";
      track.style.transform = "translateY(0)";
      while(track.firstChild) track.removeChild(track.firstChild);
    }

    function renderSingle(item){
      resetTrack();
      track.appendChild(makeCard(opts, item));
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

      if(destroyed || items.length <= 1) return;

      timer = window.setTimeout(()=>{
        const current = items[index];
        const nextIndex = (index + 1) % items.length;
        const next = items[nextIndex];

        resetTrack();
        track.appendChild(makeCard(opts, current));
        track.appendChild(makeCard(opts, next));

        const cardH = currentCardHeight();

        requestAnimationFrame(()=>{
          requestAnimationFrame(()=>{
            track.style.transition = "transform " + opts.animMs + "ms cubic-bezier(0.22, 1, 0.36, 1)";
            track.style.transform = "translateY(-" + cardH + "px)";
          });
        });

        timer = window.setTimeout(()=>{
          index = nextIndex;
          renderSingle(items[index]);
          queueNext();
        }, opts.animMs + 60);

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
        const idxFrom = header.indexOf("from");
        const idxTo = header.indexOf("to");
        const idxType = header.indexOf("type");
        const idxDate = header.indexOf("date");

        const missing = [];
        if(idxPlayer === -1) missing.push("Player");
        if(idxFrom === -1) missing.push("From");
        if(idxTo === -1) missing.push("To");
        if(idxType === -1) missing.push("Type");
        if(idxDate === -1) missing.push("Date");

        if(missing.length){
          showMessage("<strong>Error:</strong>&nbsp;Missing columns: " + missing.join(", ") + ".");
          return;
        }

        const nextItems = [];

        for(let i = 1; i < rows.length; i++){
          const r = rows[i];
          if(!r || !r.length) continue;

          const player = safeText(r[idxPlayer]);
          const from = safeText(r[idxFrom]);
          const to = safeText(r[idxTo]);
          const type = safeText(r[idxType]);
          const dateRaw = safeText(r[idxDate]);
          const dateObj = parseDateCell(dateRaw);
          const dateDisplay = formatDateDisplay(dateObj);

          if(!player || !from || !to || !type) continue;

          nextItems.push({
            player,
            from,
            to,
            type,
            dateRaw,
            dateObj,
            dateDisplay
          });
        }

        if(!nextItems.length){
          showMessage("<strong>No transfers found.</strong>");
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
      renderSingle(items[index]);
      queueNext();
    };

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