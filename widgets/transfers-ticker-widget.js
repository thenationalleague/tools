/* Transfers Ticker Widget (v1.0) — Shadow DOM isolated embed
   - Google Sheet columns: Player | From | To | Type
   - Accepts either pubhtml or CSV sheet URL; auto-normalises to CSV feed
   - Matches club names against assets/data/clubs-meta.json
   - Crest fallback = National League rose
   - One item visible at a time
   - Holds for 5s, then eased vertical slide to next
*/

(function(){
  "use strict";

  const VERSION = "v1.0";

  const DEFAULTS = {
    sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vScH-aEGMzzUMsxO4GkWK-mtoNGVUrQn_Lfz3LgnoH-1Uf3D7R-sxREmJsRy3DUfKOxqHxoahMihnuA/pubhtml",
    clubsMeta: "https://rckd-nl.github.io/nl-tools/assets/data/clubs-meta.json",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    roseImg: "National League rose.png",
    height: 92,
    holdMs: 5000,
    animMs: 950,
    refreshMs: 120000,
    bg: "#FFE100",
    fg: "#000000",
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

  function clampInt(v, min, max, fallback){
    const n = parseInt(v, 10);
    if(Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
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

  function isHeaderRow(row){
    const a = safeText(row && row[0]).toLowerCase();
    const b = safeText(row && row[1]).toLowerCase();
    const c = safeText(row && row[2]).toLowerCase();
    const d = safeText(row && row[3]).toLowerCase();

    return a === "player" && b === "from" && c === "to" && d === "type";
  }

  function normaliseItems(rows){
    const items = [];
    let startRow = 0;

    if(rows.length && isHeaderRow(rows[0])) startRow = 1;

    for(let i = startRow; i < rows.length; i++){
      const player = safeText(rows[i][0]);
      const from = safeText(rows[i][1]);
      const to = safeText(rows[i][2]);
      const type = safeText(rows[i][3]);

      if(!player || !from || !to || !type) continue;

      items.push({ player, from, to, type });
    }

    return items;
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

  function cssFor(opts){
    return `
:host{
  --bg:${opts.bg};
  --fg:${opts.fg};
  --border:${opts.border};
  --h:${opts.height}px;
}

*{ box-sizing:border-box; }

.wrap{
  position:relative;
  height:var(--h);
  overflow:hidden;
  background:var(--bg);
  border:3px solid var(--border);
  border-radius:12px;
  color:var(--fg);
  user-select:none;
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
  grid-template-columns:minmax(0, 1.2fr) auto minmax(0, 1.2fr);
  align-items:center;
  gap:18px;
  padding:12px 18px;
}

.side{
  display:flex;
  align-items:center;
  gap:12px;
  min-width:0;
}

.side.to{
  justify-content:flex-end;
}

.crest{
  width:42px;
  height:42px;
  object-fit:contain;
  flex:0 0 42px;
}

.copy{
  display:flex;
  flex-direction:column;
  min-width:0;
  gap:4px;
}

.side.to .copy{
  align-items:flex-end;
  text-align:right;
}

.label{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:11px;
  font-weight:700;
  line-height:1;
  letter-spacing:0.12em;
  text-transform:uppercase;
  opacity:0.85;
}

.club{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:18px;
  font-weight:800;
  line-height:1.05;
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
  text-align:center;
  min-width:0;
  gap:8px;
  padding:0 6px;
}

.player{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:24px;
  font-weight:800;
  line-height:1;
  text-transform:uppercase;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  max-width:100%;
}

.type{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:28px;
  padding:5px 12px 4px;
  border:2px solid var(--border);
  border-radius:999px;
  background:#000000;
  color:#FFE100;
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:14px;
  font-weight:800;
  line-height:1;
  letter-spacing:0.05em;
  text-transform:uppercase;
  white-space:nowrap;
}

.arrow{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:26px;
  font-weight:800;
  line-height:1;
}

@media (max-width: 820px){
  .card{
    grid-template-columns:1fr;
    gap:8px;
    padding:10px 14px;
  }

  .side,
  .side.to{
    justify-content:center;
  }

  .side .copy,
  .side.to .copy{
    align-items:center;
    text-align:center;
  }

  .middle{
    order:-1;
    gap:6px;
  }

  .player{ font-size:20px; }
  .club{ font-size:16px; }
  .crest{ width:34px; height:34px; flex-basis:34px; }
}

@media (prefers-reduced-motion: reduce){
  .track{
    transition:none !important;
  }
}
`;
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.sheet) opts.sheet = d.sheet;
    if(d.clubsMeta) opts.clubsMeta = d.clubsMeta;
    if(d.crestBase) opts.crestBase = d.crestBase;
    if(d.roseImg) opts.roseImg = d.roseImg;
    if(d.kitCss) opts.kitCss = d.kitCss;

    if(d.height) opts.height = clampInt(d.height, 60, 220, DEFAULTS.height);
    if(d.holdMs) opts.holdMs = clampInt(d.holdMs, 1000, 20000, DEFAULTS.holdMs);
    if(d.animMs) opts.animMs = clampInt(d.animMs, 200, 4000, DEFAULTS.animMs);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);

    if(d.bg) opts.bg = d.bg;
    if(d.fg) opts.fg = d.fg;
    if(d.border) opts.border = d.border;
    if(d.fallbackClubLabel) opts.fallbackClubLabel = safeText(d.fallbackClubLabel) || DEFAULTS.fallbackClubLabel;

    opts.sheet = normaliseSheetUrlToCsv(opts.sheet);
    opts.clubsMeta = resolveUrl(opts.clubsMeta);
    opts.crestBase = resolveUrl(opts.crestBase);

    return opts;
  }

  function makeClubSide(opts, sideLabel, clubName, sideClass){
    const side = document.createElement("div");
    side.className = "side " + sideClass;

    const crest = document.createElement("img");
    crest.className = "crest";
    crest.alt = safeText(clubName) ? (clubName + " crest") : "National League crest";
    crest.src = crestUrlForClub(opts, clubName) || "";
    crest.onerror = function(){
      const base = resolveUrl(opts.crestBase);
      this.onerror = null;
      this.src = encodeURI(base + safeText(opts.roseImg));
    };

    const copy = document.createElement("div");
    copy.className = "copy";

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = sideLabel;

    const club = document.createElement("div");
    club.className = "club";
    club.textContent = safeText(clubName) || opts.fallbackClubLabel;

    copy.appendChild(label);
    copy.appendChild(club);

    if(sideClass === "to"){
      side.appendChild(copy);
      side.appendChild(crest);
    }else{
      side.appendChild(crest);
      side.appendChild(copy);
    }

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

    const type = document.createElement("div");
    type.className = "type";
    type.textContent = toAllCaps(item.type);

    const arrow = document.createElement("div");
    arrow.className = "arrow";
    arrow.textContent = "→";

    middle.appendChild(player);
    middle.appendChild(type);
    middle.appendChild(arrow);

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

    const viewport = document.createElement("div");
    viewport.className = "viewport";

    const track = document.createElement("div");
    track.className = "track";

    viewport.appendChild(track);
    wrap.appendChild(viewport);
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

    function resetTrack(){
      track.style.transition = "none";
      track.style.transform = "translateY(0)";
      while(track.firstChild) track.removeChild(track.firstChild);
    }

    function renderSingle(item){
      resetTrack();
      track.appendChild(makeCard(opts, item));
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

        requestAnimationFrame(()=>{
          requestAnimationFrame(()=>{
            track.style.transition = "transform " + opts.animMs + "ms cubic-bezier(0.22, 1, 0.36, 1)";
            track.style.transform = "translateY(-" + opts.height + "px)";
          });
        });

        timer = window.setTimeout(()=>{
          index = nextIndex;
          renderSingle(items[index]);
          queueNext();
        }, opts.animMs + 40);

      }, opts.holdMs);
    }

    async function refresh(){
      try{
        await ensureClubsMeta(opts);

        const res = await fetch(opts.sheet, { cache: "no-store" });
        if(!res.ok) throw new Error("sheet fetch failed: " + res.status);

        const csvText = await res.text();
        const rows = parseCSV(csvText).filter(r => r.some(c => safeText(c)));
        const nextItems = normaliseItems(rows);

        if(!nextItems.length) return;

        const oldSig = JSON.stringify(items);
        const newSig = JSON.stringify(nextItems);

        items = nextItems;

        if(oldSig !== newSig || !track.firstChild){
          index = 0;
          clearCycle();
          renderSingle(items[index]);
          queueNext();
        }
      }catch(e){
        console.error("[Transfers Ticker " + VERSION + "]", e);
      }
    }

    refresh();
    refreshTimer = window.setInterval(refresh, opts.refreshMs);

    return {
      destroy(){
        destroyed = true;
        clearCycle();
        if(refreshTimer) window.clearInterval(refreshTimer);
      }
    };
  }

  function boot(){
    const nodes = document.querySelectorAll("[data-nl-transfers-ticker]");
    nodes.forEach(node => {
      if(node.__nlTransfersTicker) return;
      node.__nlTransfersTicker = makeWidget(node);
    });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
