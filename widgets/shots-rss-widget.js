/* Shots Feed Widget (v1.5) — JSON-only
   v1.5:
   - Reads a JSON cache (assets/data/shots-feed.json)
   - No RSS, no AllOrigins, no cross-origin scraping
*/
(function(){
  const VERSION = "v1.5";

  function el(tag, attrs, ...kids){
    const n = document.createElement(tag);
    if(attrs){
      Object.entries(attrs).forEach(([k,v])=>{
        if(k === "class") n.className = v;
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

  function fmtDateDDMMYYYY(s){
    // Input from scraper is typically DD/MM/YYYY. Display it as-is.
    return (s || "").trim();
  }

  async function fetchJson(url){
    const r = await fetch(url, { cache:"no-store" });
    if(!r.ok) throw new Error("JSON fetch failed (" + r.status + ")");
    return await r.json();
  }

  async function mount(host){
    const jsonURL = host.getAttribute("data-json") || "https://rckd-nl.github.io/nl-tools/assets/data/shots-feed.json";
    const max = Math.max(1, Math.min(50, parseInt(host.getAttribute("data-max") || "10", 10) || 10));
    const heading = host.getAttribute("data-title") || "Aldershot Town — Latest News";

    const shadow = host.attachShadow({ mode:"open" });

    shadow.appendChild(el("style", null, `
      .wrap{ font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#111; border:1px solid #d0d7de; border-radius:14px; overflow:hidden; background:#fff; }
      .top{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; background:#9e0000; color:#fff; }
      .top h3{ margin:0; font-size:14px; font-weight:800; letter-spacing:.2px; }
      .meta{ display:flex; align-items:center; gap:10px; font-size:12px; opacity:.95; white-space:nowrap; }
      .btn{ appearance:none; border:1px solid rgba(255,255,255,.35); background:rgba(255,255,255,.12); color:#fff; font-weight:700; font-size:12px; padding:6px 9px; border-radius:10px; cursor:pointer; }
      .btn:active{ transform:translateY(1px); }
      .body{ padding:10px 14px 14px; }
      .status{ font-size:12px; color:#57606a; margin:6px 0 10px; }
      .list{ display:flex; flex-direction:column; gap:10px; }
      .item{ border:1px solid #e5e7eb; border-radius:12px; padding:10px; background:#fff; }
      .item a{ color:#111; text-decoration:none; font-weight:800; font-size:13px; line-height:1.2; }
      .item a:hover{ text-decoration:underline; }
      .sub{ display:flex; gap:8px; align-items:center; margin-top:6px; font-size:12px; color:#57606a; }
      .dot{ width:4px; height:4px; border-radius:99px; background:#9e0000; display:inline-block; }
      .excerpt{ margin-top:8px; font-size:12px; line-height:1.35; color:#24292f; }
      .foot{ border-top:1px solid #eef1f4; padding:10px 14px; font-size:11px; color:#6b7280; display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .foot a{ color:#6b7280; text-decoration:none; }
      .foot a:hover{ text-decoration:underline; }
      @media (max-width:520px){ .top{ padding:11px 12px; } .body{ padding:10px 12px 12px; } }
    `));

    const last = el("span", null, "—");
    const btn = el("button", { class:"btn", type:"button" }, "Refresh");

    const top = el("div", { class:"top" },
      el("h3", null, heading),
      el("div", { class:"meta" }, el("span", null, "v" + VERSION.replace(/^v/i,"")), last, btn)
    );

    const status = el("div", { class:"status" }, "Loading…");
    const list = el("div", { class:"list" });
    const body = el("div", { class:"body" }, status, list);

    const foot = el("div", { class:"foot" },
      el("span", null, "Source: cached JSON"),
      el("a", { href: jsonURL, target:"_blank", rel:"noopener noreferrer" }, "Open JSON")
    );

    shadow.appendChild(el("div", { class:"wrap" }, top, body, foot));

    async function load(){
      status.textContent = "Loading…";
      list.textContent = "";

      try{
        const data = await fetchJson(jsonURL);
        const items = (data.items || []).slice(0, max);

        if(!items.length){
          status.textContent = "No items found.";
          last.textContent = "—";
          return;
        }

        const now = new Date();
        last.textContent = "Updated " + now.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });
        status.textContent = "";

        items.forEach(it=>{
          const dateStr = fmtDateDDMMYYYY(it.date) || "Update";
          const a = el("a", { href: it.link, target:"_blank", rel:"noopener noreferrer" }, it.title);
          const sub = el("div", { class:"sub" }, el("span", { class:"dot", "aria-hidden":"true" }), el("span", null, dateStr));
          const excerpt = it.excerpt ? el("div", { class:"excerpt" }, it.excerpt) : null;
          list.appendChild(el("div", { class:"item" }, a, sub, excerpt));
        });
      }catch(e){
        status.textContent = "Couldn’t load cached JSON. Check that the GitHub Action has produced the file and Pages is serving it.";
        last.textContent = "—";
      }
    }

    btn.addEventListener("click", load);
    await load();
  }

  function boot(){
    document.querySelectorAll("[data-shots-rss]").forEach(host=>{
      if(host.__shotsRssMounted) return;
      host.__shotsRssMounted = true;
      mount(host);
    });
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
