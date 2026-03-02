/* Club News Widget (v1.21) */

(function(){
  const VERSION = "v1.21";

  function el(tag, attrs, ...kids){
    const n = document.createElement(tag);
    if(attrs){
      Object.entries(attrs).forEach(([k,v])=>{
        if(k==="class") n.className=v;
        else n.setAttribute(k,v);
      });
    }
    kids.forEach(k=>{
      if(typeof k==="string") n.appendChild(document.createTextNode(k));
      else if(k) n.appendChild(k);
    });
    return n;
  }

  function fmt(iso){
    const d = new Date(iso);
    if(isNaN(d)) return "";
    return d.toLocaleString();
  }

  async function mount(host){
    const jsonURL = host.getAttribute("data-json") ||
      "https://rckd-nl.github.io/nl-tools/assets/data/club-news.json";

    const max = parseInt(host.getAttribute("data-max")||"30",10);

    const shadow = host.attachShadow({mode:"open"});

    const style = el("style",null,`
      .wrap{font-family:system-ui,Segoe UI,Arial;font-size:14px}
      .item{padding:8px 0;border-bottom:1px solid #eee}
      .club{font-weight:700;margin-right:6px}
      .time{font-size:12px;color:#666}
      a{text-decoration:none;color:#000}
      a:hover{text-decoration:underline}
    `);

    const wrap = el("div",{class:"wrap"});
    shadow.appendChild(style);
    shadow.appendChild(wrap);

    try{
      const res = await fetch(jsonURL);
      const data = await res.json();
      const items = (data.items||[]).slice(0,max);

      items.forEach(it=>{
        wrap.appendChild(
          el("div",{class:"item"},
            el("a",{href:it.url,target:"_blank"},
              el("span",{class:"club"},it.club+":"),
              it.title
            ),
            el("div",{class:"time"},fmt(it.published))
          )
        );
      });

    }catch(e){
      wrap.textContent="Could not load club news.";
    }
  }

  document.querySelectorAll("[data-nl-club-news]")
    .forEach(mount);
})();
