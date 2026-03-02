/* Club News Widget (v1.20) — ultra stripped-back list
   - Reads generated JSON (assets/data/club-news.json)
   - Renders N most recent items with club + title + time
*/
(function(){
  "use strict";

  const VERSION = "v1.20";

  function el(tag, attrs, ...kids){
    const n = document.createElement(tag);
    if (attrs){
      for (const [k,v] of Object.entries(attrs)){
        if (k === "class") n.className = v;
        else if (k === "style") n.setAttribute("style", v);
        else n.setAttribute(k, v);
      }
    }
    for (const kid of kids){
      if (kid == null) continue;
      n.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
    }
    return n;
  }

  function fmtLocal(iso){
    try{
      const d = new Date(iso);
      if (isNaN(d)) return "";
      return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
    }catch(_){
      return "";
    }
  }

  async function fetchJSON(url){
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Fetch failed: " + res.status);
    return await res.json();
  }

  function mountOne(host){
    const jsonURL = (host.getAttribute("data-json") || "/assets/data/club-news.json").trim();
    const max = Math.max(1, Math.min(200, parseInt(host.getAttribute("data-max") || "30", 10) || 30));

    const shadow = host.attachShadow({ mode: "open" });

    const style = el("style", null, `
:host{ all:initial; }
.wrap{
  font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size: 14px;
  color: #111;
}
.hdr{
  display:flex;
  justify-content:space-between;
  align-items:baseline;
  gap:12px;
  padding:10px 0 8px 0;
  border-bottom:1px solid #ddd;
}
.hdr .title{ font-weight:700; }
.hdr .meta{ font-size:12px; color:#555; }
.list{ margin:0; padding:0; list-style:none; }
.item{
  padding:10px 0;
  border-bottom:1px solid #eee;
}
.item:last-child{ border-bottom:0; }
.club{ font-weight:700; display:inline-block; margin-right:8px; }
.time{ font-size:12px; color:#666; margin-top:4px; }
a{ color:inherit; text-decoration:none; }
a:hover{ text-decoration:underline; }
.err{ padding:10px 0; color:#900; }
    `);

    const wrap = el("div", { class: "wrap" });
    const hdr = el("div", { class: "hdr" },
      el("div", { class: "title" }, "Club News"),
      el("div", { class: "meta" }, `Widget ${VERSION}`)
    );

    const list = el("ul", { class: "list" });
    wrap.appendChild(hdr);
    wrap.appendChild(list);

    shadow.appendChild(style);
    shadow.appendChild(wrap);

    (async () => {
      try{
        const data = await fetchJSON(jsonURL);
        const items = Array.isArray(data.items) ? data.items.slice(0, max) : [];
        hdr.querySelector(".meta").textContent = `Updated ${fmtLocal(data.generatedAt || "")}`;

        if (!items.length){
          list.appendChild(el("li", { class: "item" }, "No items found."));
          return;
        }

        for (const it of items){
          const club = it.club || "";
          const title = it.title || "";
          const url = it.url || "";
          const published = it.published || "";

          const a = el("a", { href: url, target: "_blank", rel: "noopener noreferrer" },
            el("span", { class: "club" }, club + ":"),
            el("span", { class: "ttl" }, title)
          );

          const li = el("li", { class: "item" },
            a,
            el("div", { class: "time" }, fmtLocal(published))
          );

          list.appendChild(li);
        }
      }catch(err){
        list.innerHTML = "";
        list.appendChild(el("div", { class: "err" }, "Could not load club news."));
      }
    })();
  }

  function init(){
    const nodes = document.querySelectorAll("[data-nl-club-news]");
    nodes.forEach(mountOne);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
