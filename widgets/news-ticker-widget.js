/* News Ticker Widget (v1.7) — Shadow DOM isolated embed
   Changes from v1.6:
   - Loads assets/data/clubs-meta.json to resolve club IDs + colours
   - Team name becomes a colour pill:
       background = colors.primary
       text = colors.secondary (assumed #FFFFFF or #000000)
       border = colors.tertiary (fallback to primary)
   - Headline colour is black (configurable via data-headline, default #000000)
   - Removes red/blue alternation logic and hardcoded team list
   - Keeps TRUE seamless loop: separator after last item too
   - Keeps vertical divider between team and headline
   - JS-driven scroll + drag scrub
*/
(function(){
  "use strict";

  const VERSION = "v1.7";

  const DEFAULTS = {
    csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSuNN7o0PQ-YzDS7-oZe_D91PMpJmF9d6CYshqXcMOpJVq-WHceJN_qanp79QuwrqBMUX7KoGCMWXZm/pub?output=csv",
    clubsMeta: "assets/data/clubs-meta.json",
    maxItems: 10,
    height: 64,              // px
    speed: 48,               // px/sec (slow)
    refreshMs: 120000,       // 2 min
    kitCss: "https://use.typekit.net/gff4ipy.css",
    crestBase: "https://rckd-nl.github.io/nl-tools/assets/crests/",
    roseImg: "National League rose.png",
    bg: "#ffffff",
    headline: "#000000",
    rule: "#000000"
  };

  function safeText(s){ return (s || "").toString().replace(/\s+/g," ").trim(); }
  function toAllCaps(s){ return safeText(s).toUpperCase(); }

  function teamTextForGraphic(teamName){
    const t = safeText(teamName);
    if(!t) return "";
    if(t.toLowerCase() === "hampton & richmond borough") return "HAMPTON & RICHMOND";
    return toAllCaps(t);
  }

  // ===== Clubs meta cache (loaded from DEFAULTS.clubsMeta) =====
  let CLUBS_BY_KEY = new Map();     // key -> club object
  let CLUBS_LOADED = false;
  let CLUBS_LOADING = null;

  function normKey(s){
    return safeText(s).toLowerCase();
  }

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
        const res = await fetch(opts.clubsMeta, { cache:"no-store" });
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

        if(map.size){
          CLUBS_BY_KEY = map;
          CLUBS_LOADED = true;
        }else{
          throw new Error("clubs-meta contained no clubs");
        }
      }catch(e){
        console.error("[Ticker " + VERSION + "] clubs-meta load error:", e);
        CLUBS_LOADED = false;
      }finally{
        CLUBS_LOADING = null;
      }
    })();

    return CLUBS_LOADING;
  }

  function clubMetaForName(clubName){
    const k = normKey(clubName);
    if(!k) return null;
    return CLUBS_BY_KEY.get(k) || null;
  }

  function normalizeHexColor(s){
    const v = safeText(s);
    if(!v) return "";
    const x = v.startsWith("#") ? v : ("#" + v);
    return x.toUpperCase();
  }

  function normalizeBW(s, fallback){
    const v = normalizeHexColor(s);
    if(v === "#FFFFFF" || v === "#000000") return v;
    return fallback;
  }

  function clubPillColors(clubName){
    const meta = clubMetaForName(clubName);
    const colors = meta && meta.colors ? meta.colors : null;

    const primary = normalizeHexColor(colors && colors.primary) || "#E6E6E6";
    const secondary = normalizeBW(colors && colors.secondary, "#000000");
    const tertiary = normalizeHexColor(colors && colors.tertiary) || primary;

    return { primary, secondary, tertiary };
  }

  function crestUrlForTeam(opts, club){
    const t = safeText(club);
    if(!t) return null;

    const meta = clubMetaForName(t);
    if(!meta) return null;

    const crestName = safeText(meta.name) || t;
    return encodeURI(opts.crestBase + crestName + ".png");
  }

  function roseUrl(opts){
    const fn = safeText(opts.roseImg || "");
    if(!fn) return null;
    return encodeURI(opts.crestBase + fn);
  }

  // Robust-ish CSV parser (handles quotes/commas reasonably)
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

  function isHeaderRow(r){
    const joined = (r || []).join(" ").toLowerCase();
    return joined.includes("club") && joined.includes("headline");
  }

  function normaliseItems(items, maxItems){
    const out = [];
    for(const it of items){
      const club = safeText(it.club);
      const headline = safeText(it.headline);
      const hyperlink = safeText(it.hyperlink);
      if(!club || !headline || !hyperlink) continue;
      out.push({ club, headline, hyperlink });
      if(out.length >= maxItems) break;
    }
    return out;
  }

  function cssFor(opts){
    return `
:host{
  --bg:${opts.bg};
  --headline:${opts.headline};
  --rule:${opts.rule};
  --h:${opts.height}px;
  --crest:34px;
  --gap:16px;
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

.item{
  display:inline-flex;
  align-items:center;
  gap:12px;
}

.crest{
  width:var(--crest);
  height:var(--crest);
  object-fit:contain;
  display:block;
}

.crest.missing{ width:0; height:0; }

.clubpill{
  display:inline-flex;
  align-items:center;
  padding:7px 12px;
  border-radius:999px;
  border:2px solid var(--pill-border, #000000);
  background:var(--pill-bg, #E6E6E6);
  line-height:1;
}

.club{
  font-family:"carbona-extrabold","carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:800;
  letter-spacing:0.04em;
  font-size:15px;
  text-transform:uppercase;
  color:var(--pill-fg, #000000);
  line-height:1;
}

.vrule{
  width:2px;
  height:26px;
  background:var(--rule);
  display:block;
}

.headline{
  font-family:"carbona-variable",system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-weight:450;
  font-size:16px;
  color:var(--headline);
  text-decoration:none;
  line-height:1.1;
}

.headline:hover{ text-decoration:underline; }

/* Rose separator BETWEEN items: just clear space + rose */
.sep{
  display:inline-flex;
  align-items:center;
  padding:0 18px;
}

.rose{
  width:22px;
  height:22px;
  object-fit:contain;
  display:block;
}

@media (prefers-reduced-motion: reduce){
  .wrap{ overflow:auto; }
}
`;
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
    wrap.setAttribute("aria-label","Club news ticker");

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

    // Animation state
    let shiftPx = 0;           // width of one lane
    let offsetPx = 0;          // current translateX
    let lastTs = 0;
    let rafId = 0;

    // Scrub state
    let dragging = false;
    let dragStartX = 0;
    let dragStartOffset = 0;

    let refreshTimer = null;
    let ro = null;

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

      try{ wrap.setPointerCapture(e.pointerId); }catch(_e){}
    }

    function onPointerMove(e){
      if(!dragging) return;
      if(!shiftPx) return;

      const dx = e.clientX - dragStartX;
      offsetPx = dragStartOffset + dx;

      normalizeOffset();
      setTransform();
    }

    function onPointerUp(e){
      if(!dragging) return;
      dragging = false;

      try{ wrap.releasePointerCapture(e.pointerId); }catch(_e){}
      lastTs = performance.now();
    }

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", onPointerUp);
    wrap.addEventListener("pointercancel", onPointerUp);

    function buildItemEl(it){
      const el = document.createElement("span");
      el.className = "item";

      const crest = document.createElement("img");
      crest.className = "crest";
      crest.alt = safeText(it.club) ? (safeText(it.club) + " crest") : "";

      const cUrl = crestUrlForTeam(opts, it.club);
      if(cUrl){
        crest.src = cUrl;
        crest.onerror = ()=> crest.classList.add("missing");
      }else{
        crest.classList.add("missing");
      }

      const pill = document.createElement("span");
      pill.className = "clubpill";

      const pillColors = clubPillColors(it.club);
      pill.style.setProperty("--pill-bg", pillColors.primary);
      pill.style.setProperty("--pill-fg", pillColors.secondary);
      pill.style.setProperty("--pill-border", pillColors.tertiary);

      const club = document.createElement("span");
      club.className = "club";
      club.textContent = teamTextForGraphic(it.club) || toAllCaps(it.club);

      pill.appendChild(club);

      const vrule = document.createElement("span");
      vrule.className = "vrule";
      vrule.setAttribute("aria-hidden","true");

      const a = document.createElement("a");
      a.className = "headline";
      a.href = it.hyperlink;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = it.headline;

      el.appendChild(crest);
      el.appendChild(pill);
      el.appendChild(vrule);
      el.appendChild(a);

      return el;
    }

    function buildSepEl(rUrl){
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.setAttribute("aria-hidden","true");

      const img = document.createElement("img");
      img.className = "rose";
      img.alt = "";
      if(rUrl){
        img.src = rUrl;
      }else{
        img.style.display = "none";
      }

      sep.appendChild(img);
      return sep;
    }

    function recomputeShift(){
      // shift equals laneA width exactly; MUST be stable for seamless wrap
      shiftPx = laneA.scrollWidth || 0;
      normalizeOffset();
      setTransform();
    }

    function render(items){
      laneA.innerHTML = "";
      laneB.innerHTML = "";

      const rUrl = roseUrl(opts);

      // IMPORTANT: include a separator AFTER the last item too
      // so the boundary to the next lane begins with identical spacing/rose.
      function fillLane(lane){
        if(items.length === 0) return;

        items.forEach((it)=>{
          lane.appendChild(buildItemEl(it));
          lane.appendChild(buildSepEl(rUrl));
        });
      }

      fillLane(laneA);
      fillLane(laneB);

      // reset position on refresh
      offsetPx = 0;
      setTransform();

      // let layout settle (fonts/images), then measure precisely
      requestAnimationFrame(()=> requestAnimationFrame(recomputeShift));
    }

    async function refresh(){
      try{
        await ensureClubsMeta(opts);

        const res = await fetch(opts.csv, { cache:"no-store" });
        if(!res.ok) throw new Error("Feed fetch failed: " + res.status);
        const csvText = await res.text();

        const rows = parseCSV(csvText).filter(r => r.some(c => safeText(c)));
        let startRow = 0;
        if(rows.length && isHeaderRow(rows[0])) startRow = 1;

        const items = [];
        for(let i=startRow;i<rows.length;i++){
          items.push({ club: rows[i][0], headline: rows[i][1], hyperlink: rows[i][2] });
        }

        const data = normaliseItems(items, opts.maxItems);
        render(data);
      }catch(e){
        console.error("[Ticker " + VERSION + "]", e);
      }
    }

    // Resize observer keeps loop accurate if fonts load late or container resizes
    try{
      ro = new ResizeObserver(()=> recomputeShift());
      ro.observe(wrap);
    }catch(_e){}

    refresh();
    refreshTimer = window.setInterval(refresh, opts.refreshMs);
    startAnim();

    return {
      destroy(){
        if(rafId) cancelAnimationFrame(rafId);
        if(refreshTimer) window.clearInterval(refreshTimer);
        if(ro) ro.disconnect();
      }
    };
  }

  function readOptions(el){
    const d = el.dataset || {};
    const opts = Object.assign({}, DEFAULTS);

    if(d.csv) opts.csv = d.csv;
    if(d.clubsMeta) opts.clubsMeta = d.clubsMeta;

    if(d.maxItems) opts.maxItems = clampInt(d.maxItems, 1, 50, DEFAULTS.maxItems);
    if(d.height) opts.height = clampInt(d.height, 30, 160, DEFAULTS.height);
    if(d.speed) opts.speed = clampInt(d.speed, 10, 500, DEFAULTS.speed);
    if(d.refreshMs) opts.refreshMs = clampInt(d.refreshMs, 10000, 3600000, DEFAULTS.refreshMs);

    if(d.kitCss) opts.kitCss = d.kitCss;
    if(d.crestBase) opts.crestBase = d.crestBase;
    if(d.roseImg) opts.roseImg = d.roseImg;

    if(d.bg) opts.bg = d.bg;
    if(d.headline) opts.headline = d.headline;
    if(d.rule) opts.rule = d.rule;

    return opts;
  }

  function clampInt(v, min, max, fallback){
    const n = parseInt(v, 10);
    if(Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function boot(){
    const nodes = document.querySelectorAll("[data-nl-news-ticker]");
    nodes.forEach(node => {
      if(node.__nlTicker) return;
      node.__nlTicker = makeWidget(node);
    });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
