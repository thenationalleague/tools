/* Shots RSS Widget (v1.0) — Shadow DOM isolated embed
   - Pulls RSS from https://www.theshots.co.uk/feed/
   - Tries direct fetch first, then falls back to allorigins proxy (CORS helper)
   - Renders latest items with date + excerpt
*/
(function(){
  const VERSION = "v1.0";

  function el(tag, attrs, ...kids){
    const n = document.createElement(tag);
    if(attrs){
      Object.entries(attrs).forEach(([k,v])=>{
        if(k === "class") n.className = v;
        else if(k === "style") n.setAttribute("style", v);
        else n.setAttribute(k, v);
      });
    }
    kids.forEach(k=>{
      if(k == null) return;
      if(typeof k === "string") n.appendChild(document.createTextNode(k));
      else n.appendChild(k);
    });
    return n;
  }

  function stripHtml(html){
    const d = document.createElement("div");
    d.innerHTML = html || "";
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  }

  function clamp(s, n){
    s = (s || "").trim();
    if(!s) return "";
    if(s.length <= n) return s;
    return s.slice(0, n - 1).trimEnd() + "…";
  }

  function fmtDate(d){
    if(!(d instanceof Date) || isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
  }

  async function fetchTextWithFallback(url){
    // 1) direct (may fail due to CORS / WAF)
    try{
      const r1 = await fetch(url, { cache:"no-store" });
      if(r1.ok){
        return await r1.text();
      }
      // if server returns non-2xx, try fallback anyway
    }catch(_e){}

    // 2) fallback proxy
    const prox = "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
    const r2 = await fetch(prox, { cache:"no-store" });
    if(!r2.ok) throw new Error("RSS fetch failed (" + r2.status + ")");
    return await r2.text();
  }

  function parseRss(xmlText){
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");
    const parseError = xml.querySelector("parsererror");
    if(parseError) throw new Error("RSS parse error");

    const items = Array.from(xml.querySelectorAll("item")).map(item=>{
      const title = (item.querySelector("title")?.textContent || "").trim();
      const link  = (item.querySelector("link")?.textContent || "").trim();
      const pub   = (item.querySelector("pubDate")?.textContent || "").trim();

      // Prefer content:encoded, else description
      const contentNode =
        item.getElementsByTagName("content:encoded")[0] ||
        item.querySelector("encoded") ||
        item.querySelector("description");

      const raw = contentNode ? (contentNode.textContent || "") : "";
      const excerpt = clamp(stripHtml(raw), 180);

      let date = null;
      if(pub){
        const d = new Date(pub);
        if(!isNaN(d)) date = d;
      }

      return { title, link, date, excerpt };
    }).filter(x => x.title && x.link);

    return items;
  }

  async function mount(host){
    const feedURL = host.getAttribute("data-feed") || "https://www.theshots.co.uk/feed/";
    const max = Math.max(1, Math.min(50, parseInt(host.getAttribute("data-max") || "10", 10) || 10));
    const heading = host.getAttribute("data-title") || "Aldershot Town — Latest News";

    const shadow = host.attachShadow({ mode:"open" });

    const style = el("style", null, `
      :host{
        all: initial;
      }
      .wrap{
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        color:#111;
        border:1px solid #d0d7de;
        border-radius:14px;
        overflow:hidden;
        background:#fff;
      }
      .top{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding:12px 14px;
        background:#9e0000;
        color:#fff;
      }
      .top h3{
        margin:0;
        font-size:14px;
        font-weight:800;
        letter-spacing:.2px;
      }
      .top .meta{
        display:flex;
        align-items:center;
        gap:10px;
        font-size:12px;
        opacity:.95;
        white-space:nowrap;
      }
      .btn{
        appearance:none;
        border:1px solid rgba(255,255,255,.35);
        background:rgba(255,255,255,.12);
        color:#fff;
        font-weight:700;
        font-size:12px;
        padding:6px 9px;
        border-radius:10px;
        cursor:pointer;
      }
      .btn:active{ transform: translateY(1px); }

      .body{
        padding:10px 14px 14px;
      }
      .status{
        font-size:12px;
        color:#57606a;
        margin:6px 0 10px;
      }
      .list{
        display:flex;
        flex-direction:column;
        gap:10px;
      }
      .item{
        border:1px solid #e5e7eb;
        border-radius:12px;
        padding:10px 10px;
        background:#fff;
      }
      .item a{
        color:#111;
        text-decoration:none;
        font-weight:800;
        font-size:13px;
        line-height:1.2;
      }
      .item a:hover{ text-decoration:underline; }
      .sub{
        display:flex;
        gap:8px;
        align-items:center;
        margin-top:6px;
        font-size:12px;
        color:#57606a;
      }
      .dot{
        width:4px; height:4px; border-radius:99px; background:#9e0000; display:inline-block;
      }
      .excerpt{
        margin-top:8px;
        font-size:12px;
        line-height:1.35;
        color:#24292f;
      }
      .foot{
        border-top:1px solid #eef1f4;
        padding:10px 14px;
        font-size:11px;
        color:#6b7280;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
      }
      .foot a{
        color:#6b7280;
        text-decoration:none;
      }
      .foot a:hover{ text-decoration:underline; }

      @media (max-width:520px){
        .top{ padding:11px 12px; }
        .body{ padding:10px 12px 12px; }
        .item{ padding:10px; }
      }
    `);

    const h3 = el("h3", null, heading);
    const last = el("span", { class:"last" }, "—");
    const btn = el("button", { class:"btn", type:"button", title:"Refresh feed" }, "Refresh");
    const meta = el("div", { class:"meta" }, el("span", null, "v" + VERSION.replace(/^v/i,"")), last, btn);
    const top = el("div", { class:"top" }, h3, meta);

    const status = el("div", { class:"status" }, "Loading…");
    const list = el("div", { class:"list" });
    const body = el("div", { class:"body" }, status, list);

    const foot = el(
      "div",
      { class:"foot" },
      el("span", null, "Source: RSS feed"),
      el("a", { href: feedURL, target:"_blank", rel:"noopener noreferrer" }, "Open feed")
    );

    const wrap = el("div", { class:"wrap" }, style, top, body, foot);
    shadow.appendChild(wrap);

    async function load(){
      status.textContent = "Loading…";
      list.textContent = "";
      try{
        const xmlText = await fetchTextWithFallback(feedURL);
        const items = parseRss(xmlText).slice(0, max);

        if(!items.length){
          status.textContent = "No items found in feed.";
          last.textContent = "—";
          return;
        }

        const now = new Date();
        last.textContent = "Updated " + now.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });

        status.textContent = "";
        items.forEach(it=>{
          const dateStr = it.date ? fmtDate(it.date) : "";
          const sub = el("div", { class:"sub" },
            el("span", { class:"dot", "aria-hidden":"true" }),
            el("span", null, dateStr || "Update")
          );

          const a = el("a", { href: it.link, target:"_blank", rel:"noopener noreferrer" }, it.title);
          const excerpt = it.excerpt ? el("div", { class:"excerpt" }, it.excerpt) : null;

          list.appendChild(el("div", { class:"item" }, a, sub, excerpt));
        });
      }catch(e){
        status.textContent =
          "Couldn’t load this feed in-browser (often CORS / rate-limit). " +
          "If you want it 100% reliable, fetch the RSS server-side and point this widget at a JSON file.";
        last.textContent = "—";
      }
    }

    btn.addEventListener("click", load);
    await load();
  }

  function boot(){
    const nodes = document.querySelectorAll("[data-shots-rss]");
    nodes.forEach(n=>{
      if(n.__shotsRssMounted) return;
      n.__shotsRssMounted = true;
      mount(n);
    });
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
