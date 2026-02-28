<!doctype html>
<html lang="en" data-app-version="v1.0">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Matchday Results Viewer (TSV/CSV) (v1.0)</title>
  <meta name="color-scheme" content="light" />
  <style>
    :root{
      --border:#d0d7de;
      --bg:#ffffff;
      --panel:#f6f8fa;
      --fg:#24292f;
      --muted:#57606a;
      --brand:#9e0000;
      --head:#111827;
      --zebra:#fbfbfb;
    }
    *{box-sizing:border-box;}
    body{
      margin:0;
      font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      color:var(--fg);
      background:var(--bg);
    }
    header{
      padding:16px 18px;
      border-bottom:1px solid var(--border);
      background:linear-gradient(180deg,#fff, #fff);
      position:sticky; top:0; z-index:10;
    }
    .topbar{
      display:flex;
      gap:12px;
      align-items:flex-start;
      justify-content:space-between;
      flex-wrap:wrap;
    }
    h1{
      margin:0;
      font-size:16px;
      line-height:1.2;
      font-weight:800;
      color:var(--head);
      letter-spacing:.2px;
    }
    .sub{
      margin-top:4px;
      font-size:12px;
      color:var(--muted);
    }

    main{ padding:16px 18px 28px; }

    .grid{
      display:grid;
      grid-template-columns: 420px 1fr;
      gap:14px;
      align-items:start;
    }

    .card{
      border:1px solid var(--border);
      border-radius:12px;
      background:#fff;
      overflow:hidden;
      box-shadow:0 1px 0 rgba(0,0,0,.02);
    }
    .card h2{
      margin:0;
      padding:12px 12px;
      font-size:13px;
      font-weight:800;
      background:var(--panel);
      border-bottom:1px solid var(--border);
    }
    .card .body{ padding:12px; }

    textarea{
      width:100%;
      min-height:210px;
      resize:vertical;
      font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
      font-size:12px;
      line-height:1.35;
      padding:10px;
      border:1px solid var(--border);
      border-radius:10px;
      outline:none;
    }
    textarea:focus{ border-color:var(--brand); box-shadow:0 0 0 3px rgba(158,0,0,.12); }

    .row{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      align-items:center;
      margin-top:10px;
    }
    .row > *{ flex:0 0 auto; }

    label{
      font-size:12px;
      color:var(--muted);
      display:block;
      margin:0 0 6px;
    }
    select, input[type="text"]{
      padding:8px 10px;
      border:1px solid var(--border);
      border-radius:10px;
      background:#fff;
      color:var(--fg);
      font-size:13px;
      outline:none;
      min-width: 170px;
    }
    select:focus, input[type="text"]:focus{ border-color:var(--brand); box-shadow:0 0 0 3px rgba(158,0,0,.12); }

    button{
      border:1px solid var(--brand);
      background:var(--brand);
      color:#fff;
      font-weight:800;
      font-size:13px;
      padding:9px 12px;
      border-radius:10px;
      cursor:pointer;
    }
    button.secondary{
      border:1px solid var(--border);
      background:#fff;
      color:var(--fg);
      font-weight:700;
    }
    button:disabled{
      opacity:.55;
      cursor:not-allowed;
    }

    .hint{
      margin-top:10px;
      font-size:12px;
      color:var(--muted);
    }
    .hint code{
      font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
      font-size:12px;
      background:var(--panel);
      padding:2px 6px;
      border-radius:8px;
      border:1px solid var(--border);
      color:var(--fg);
    }

    .tablewrap{
      width:100%;
      overflow:auto;
      border-radius:12px;
      border:1px solid var(--border);
      background:#fff;
    }
    table{
      width:100%;
      border-collapse:collapse;
      font-size:13px;
      min-width: 780px;
    }
    thead th{
      position:sticky;
      top:0;
      z-index:2;
      background:#0b0f19;
      color:#fff;
      text-align:left;
      padding:10px 10px;
      font-size:12px;
      letter-spacing:.2px;
      white-space:nowrap;
    }
    tbody td{
      padding:10px 10px;
      border-top:1px solid var(--border);
      vertical-align:top;
    }
    tbody tr:nth-child(even){ background:var(--zebra); }

    .pill{
      display:inline-block;
      padding:2px 8px;
      border-radius:999px;
      border:1px solid var(--border);
      background:var(--panel);
      font-size:12px;
      font-weight:800;
      white-space:nowrap;
    }
    .pill.brand{
      border-color: rgba(158,0,0,.35);
      background: rgba(158,0,0,.06);
      color: var(--brand);
    }
    .score{
      font-weight:900;
      letter-spacing:.2px;
      white-space:nowrap;
    }

    .empty{
      padding:16px;
      color:var(--muted);
      font-size:13px;
    }

    @media (max-width: 980px){
      .grid{ grid-template-columns: 1fr; }
      select, input[type="text"]{ min-width: 160px; }
      table{ min-width: 720px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div>
        <h1>Matchday Results Viewer (TSV/CSV) <span class="pill brand">v1.0</span></h1>
        <div class="sub">Paste your new format (tab- or comma-separated) and filter by Competition / Matchday.</div>
      </div>
      <div class="sub" id="status">No data loaded.</div>
    </div>
  </header>

  <main>
    <div class="grid">
      <section class="card">
        <h2>Input</h2>
        <div class="body">
          <label for="inputData">Paste TSV/CSV with headers:</label>
          <textarea id="inputData" spellcheck="false"></textarea>

          <div class="row">
            <button id="btnLoad">Load</button>
            <button class="secondary" id="btnSample" type="button">Insert sample</button>
            <button class="secondary" id="btnClear" type="button">Clear</button>
          </div>

          <div class="hint">
            Expected columns (exact headers):<br/>
            <code>Date &amp; Time</code> <code>MD</code> <code>Competition</code> <code>Home team</code> <code>Score</code> <code>Away team</code><br/><br/>
            Dates assumed <code>DD/MM/YYYY HH:MM</code> (24h). Score like <code>3-2</code> (extra spaces ok).
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Filters</h2>
        <div class="body">
          <div class="row" style="margin-top:0">
            <div>
              <label for="competitionSel">Competition</label>
              <select id="competitionSel" disabled>
                <option value="">All</option>
              </select>
            </div>
            <div>
              <label for="mdSel">Matchday (MD)</label>
              <select id="mdSel" disabled>
                <option value="">All</option>
              </select>
            </div>
            <div>
              <label for="searchBox">Search (team)</label>
              <input id="searchBox" type="text" placeholder="e.g. Altrincham" disabled />
            </div>
            <div style="align-self:end">
              <button class="secondary" id="btnReset" type="button" disabled>Reset</button>
            </div>
          </div>

          <div style="margin-top:12px" class="tablewrap" id="tableWrap">
            <div class="empty" id="emptyState">Load data to see results.</div>
            <table id="resultsTable" hidden>
              <thead>
                <tr>
                  <th style="width:160px">Date &amp; Time</th>
                  <th style="width:70px">MD</th>
                  <th style="width:120px">Competition</th>
                  <th>Home</th>
                  <th style="width:90px">Score</th>
                  <th>Away</th>
                </tr>
              </thead>
              <tbody id="tbody"></tbody>
            </table>
          </div>

          <div class="hint" id="countHint" style="margin-top:10px"></div>
        </div>
      </section>
    </div>
  </main>

  <script>
    // v1.0 — parses TSV/CSV with headers:
    // Date & Time | MD | Competition | Home team | Score | Away team
    (function(){
      const $ = (id)=>document.getElementById(id);

      const inputData = $("inputData");
      const btnLoad = $("btnLoad");
      const btnSample = $("btnSample");
      const btnClear = $("btnClear");

      const competitionSel = $("competitionSel");
      const mdSel = $("mdSel");
      const searchBox = $("searchBox");
      const btnReset = $("btnReset");

      const resultsTable = $("resultsTable");
      const tbody = $("tbody");
      const emptyState = $("emptyState");
      const status = $("status");
      const countHint = $("countHint");

      /** @type {Array<{dt:Date, dtRaw:string, md:number|null, comp:string, home:string, away:string, scoreRaw:string, hg:number|null, ag:number|null}>} */
      let allRows = [];

      const REQUIRED_HEADERS = [
        "Date & Time",
        "MD",
        "Competition",
        "Home team",
        "Score",
        "Away team"
      ];

      function normalizeHeader(h){
        return String(h || "").trim();
      }

      function splitLines(text){
        return String(text || "")
          .replace(/\r\n/g,"\n")
          .replace(/\r/g,"\n")
          .split("\n")
          .filter(line => line.trim().length>0);
      }

      function detectDelimiter(headerLine){
        // Prefer tabs if present, else commas.
        if (headerLine.includes("\t")) return "\t";
        if (headerLine.includes(",")) return ",";
        // fallback: multiple spaces (rare)
        return "\t";
      }

      function safeTrim(s){ return String(s ?? "").trim(); }

      function parseUKDateTime(dtStr){
        // Expected DD/MM/YYYY HH:MM
        const s = safeTrim(dtStr);
        const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
        if(!m) return null;
        const dd = Number(m[1]);
        const mm = Number(m[2]);
        const yyyy = Number(m[3]);
        const hh = Number(m[4]);
        const min = Number(m[5]);
        const d = new Date(Date.UTC(yyyy, mm-1, dd, hh, min, 0, 0));
        // Display in local time, but keep stable parsing. (You can change this if you want local parsing.)
        return d;
      }

      function formatUKDateTime(d){
        // Render as DD/MM/YYYY HH:MM using local time
        const pad2 = (n)=>String(n).padStart(2,"0");
        const dd = pad2(d.getDate());
        const mm = pad2(d.getMonth()+1);
        const yyyy = d.getFullYear();
        const hh = pad2(d.getHours());
        const mi = pad2(d.getMinutes());
        return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
      }

      function parseScore(scoreStr){
        const s = safeTrim(scoreStr).replace(/\s+/g,"");
        const m = s.match(/^(\d+)-(\d+)$/);
        if(!m) return {hg:null, ag:null, scoreRaw: safeTrim(scoreStr)};
        return {hg:Number(m[1]), ag:Number(m[2]), scoreRaw: `${m[1]}-${m[2]}`};
      }

      function parseInput(text){
        const lines = splitLines(text);
        if(lines.length < 2){
          return { ok:false, error:"Need a header row plus at least one data row." };
        }

        const delim = detectDelimiter(lines[0]);
        const headers = lines[0].split(delim).map(normalizeHeader);

        // Map header -> index
        const idx = {};
        headers.forEach((h,i)=>{ idx[h]=i; });

        const missing = REQUIRED_HEADERS.filter(h => !(h in idx));
        if(missing.length){
          return { ok:false, error:`Missing required headers: ${missing.join(", ")}` };
        }

        const rows = [];
        for(let i=1;i<lines.length;i++){
          const parts = lines[i].split(delim);

          const dtRaw = safeTrim(parts[idx["Date & Time"]]);
          const mdRaw = safeTrim(parts[idx["MD"]]);
          const comp = safeTrim(parts[idx["Competition"]]);
          const home = safeTrim(parts[idx["Home team"]]);
          const scoreCell = safeTrim(parts[idx["Score"]]);
          const away = safeTrim(parts[idx["Away team"]]);

          if(!dtRaw && !home && !away) continue;

          const dt = parseUKDateTime(dtRaw);
          const md = mdRaw === "" ? null : Number(mdRaw);

          const sc = parseScore(scoreCell);

          rows.push({
            dt: dt || new Date(NaN),
            dtRaw,
            md: Number.isFinite(md) ? md : null,
            comp,
            home,
            away,
            scoreRaw: sc.scoreRaw,
            hg: sc.hg,
            ag: sc.ag
          });
        }

        // Sort by date/time, then competition, then home
        rows.sort((a,b)=>{
          const ta = +a.dt, tb = +b.dt;
          if(Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
          if(a.comp !== b.comp) return a.comp.localeCompare(b.comp);
          return a.home.localeCompare(b.home);
        });

        return { ok:true, rows };
      }

      function uniq(arr){
        return Array.from(new Set(arr));
      }

      function setEnabled(enabled){
        competitionSel.disabled = !enabled;
        mdSel.disabled = !enabled;
        searchBox.disabled = !enabled;
        btnReset.disabled = !enabled;
      }

      function populateFilters(rows){
        // Competition list
        const comps = uniq(rows.map(r=>r.comp).filter(Boolean)).sort((a,b)=>a.localeCompare(b));
        const currentComp = competitionSel.value;

        competitionSel.innerHTML = `<option value="">All</option>` + comps.map(c=>`<option value="${escapeHtmlAttr(c)}">${escapeHtml(c)}</option>`).join("");

        if (comps.includes(currentComp)) competitionSel.value = currentComp;

        // MD list (numbers)
        const mds = uniq(rows.map(r=>r.md).filter(v=>typeof v==="number"))
          .sort((a,b)=>a-b);
        const currentMd = mdSel.value;

        mdSel.innerHTML = `<option value="">All</option>` + mds.map(m=>`<option value="${m}">${m}</option>`).join("");
        if (mds.map(String).includes(currentMd)) mdSel.value = currentMd;
      }

      function escapeHtml(s){
        return String(s ?? "")
          .replace(/&/g,"&amp;")
          .replace(/</g,"&lt;")
          .replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;")
          .replace(/'/g,"&#39;");
      }
      function escapeHtmlAttr(s){
        return escapeHtml(s).replace(/`/g,"&#96;");
      }

      function applyFilters(){
        const comp = competitionSel.value;
        const md = mdSel.value === "" ? null : Number(mdSel.value);
        const q = safeTrim(searchBox.value).toLowerCase();

        let rows = allRows.slice();

        if(comp){
          rows = rows.filter(r => r.comp === comp);
        }
        if(md !== null && Number.isFinite(md)){
          rows = rows.filter(r => r.md === md);
        }
        if(q){
          rows = rows.filter(r => (r.home + " " + r.away).toLowerCase().includes(q));
        }

        renderTable(rows);
        populateFilters(allRows); // keep full filter lists stable
      }

      function renderTable(rows){
        tbody.innerHTML = "";

        if(!rows.length){
          resultsTable.hidden = true;
          emptyState.textContent = "No matches found for the current filters.";
          emptyState.hidden = false;
          countHint.textContent = "";
          status.textContent = allRows.length ? `Loaded ${allRows.length} rows.` : "No data loaded.";
          return;
        }

        const frag = document.createDocumentFragment();
        for(const r of rows){
          const tr = document.createElement("tr");

          const dtCell = document.createElement("td");
          if (Number.isFinite(+r.dt)) dtCell.textContent = formatUKDateTime(r.dt);
          else dtCell.textContent = r.dtRaw || "—";

          const mdCell = document.createElement("td");
          mdCell.innerHTML = r.md !== null ? `<span class="pill">${r.md}</span>` : "—";

          const compCell = document.createElement("td");
          compCell.innerHTML = r.comp ? `<span class="pill">${escapeHtml(r.comp)}</span>` : "—";

          const homeCell = document.createElement("td");
          homeCell.textContent = r.home || "—";

          const scoreCell = document.createElement("td");
          scoreCell.innerHTML = `<span class="score">${escapeHtml(r.scoreRaw || "—")}</span>`;

          const awayCell = document.createElement("td");
          awayCell.textContent = r.away || "—";

          tr.appendChild(dtCell);
          tr.appendChild(mdCell);
          tr.appendChild(compCell);
          tr.appendChild(homeCell);
          tr.appendChild(scoreCell);
          tr.appendChild(awayCell);

          frag.appendChild(tr);
        }
        tbody.appendChild(frag);

        emptyState.hidden = true;
        resultsTable.hidden = false;

        countHint.textContent = `Showing ${rows.length} of ${allRows.length} loaded rows.`;
        status.textContent = `Loaded ${allRows.length} rows.`;
      }

      function loadFromTextarea(){
        const raw = inputData.value;
        const parsed = parseInput(raw);
        if(!parsed.ok){
          allRows = [];
          setEnabled(false);
          renderTable([]);
          emptyState.textContent = parsed.error;
          emptyState.hidden = false;
          status.textContent = "No data loaded.";
          return;
        }

        allRows = parsed.rows;

        setEnabled(true);
        populateFilters(allRows);

        // Reset filters on load
        competitionSel.value = "";
        mdSel.value = "";
        searchBox.value = "";

        renderTable(allRows);
      }

      // Events
      btnLoad.addEventListener("click", loadFromTextarea);
      btnClear.addEventListener("click", ()=>{
        inputData.value = "";
        allRows = [];
        setEnabled(false);
        competitionSel.innerHTML = `<option value="">All</option>`;
        mdSel.innerHTML = `<option value="">All</option>`;
        searchBox.value = "";
        renderTable([]);
        emptyState.textContent = "Load data to see results.";
        emptyState.hidden = false;
        status.textContent = "No data loaded.";
      });

      btnSample.addEventListener("click", ()=>{
        inputData.value =
`Date & Time\tMD\tCompetition\tHome team\tScore\tAway team
09/08/2025 15:00\t1\tNational\tAltrincham\t3-2\tAldershot Town
09/08/2025 15:00\t1\tNational\tBoreham Wood\t0-2\tRochdale
09/08/2025 15:00\t1\tNational\tBrackley Town\t1-0\tEastleigh
09/08/2025 15:00\t1\tNational\tBraintree Town\t3-0\tFC Halifax Town
09/08/2025 15:00\t1\tNational\tGateshead\t0-3\tSouthend United
09/08/2025 15:00\t1\tNational\tSolihull Moors\t2-2\tForest Green Rovers
09/08/2025 15:00\t1\tNational\tTamworth\t1-2\tScunthorpe United
09/08/2025 15:00\t1\tNational\tWealdstone\t2-0\tTruro City
09/08/2025 15:00\t1\tNational\tWoking\t0-2\tCarlisle United
09/08/2025 15:00\t1\tNational\tYeovil Town\t0-0\tHartlepool United
09/08/2025 15:00\t1\tNational\tYork City\t2-2\tSutton United
09/08/2025 15:00\t1\tNorth\tAFC Fylde\t3-2\tOxford City
09/08/2025 15:00\t1\tNorth\tBedford Town\t2-2\tAlfreton Town
09/08/2025 15:00\t1\tNorth\tBuxton\t2-1\tRadcliffe`;
      });

      competitionSel.addEventListener("change", applyFilters);
      mdSel.addEventListener("change", applyFilters);
      searchBox.addEventListener("input", ()=>{
        // simple debounce
        window.clearTimeout(searchBox._t);
        searchBox._t = window.setTimeout(applyFilters, 120);
      });

      btnReset.addEventListener("click", ()=>{
        competitionSel.value = "";
        mdSel.value = "";
        searchBox.value = "";
        renderTable(allRows);
        countHint.textContent = allRows.length ? `Showing ${allRows.length} of ${allRows.length} loaded rows.` : "";
      });

      // Optional: load from ?src= (TSV/CSV url)
      // Example: viewer.html?src=results.tsv
      (async function tryLoadFromQuery(){
        const params = new URLSearchParams(location.search);
        const src = params.get("src");
        if(!src) return;

        status.textContent = "Loading src…";
        try{
          const res = await fetch(src, { cache: "no-store" });
          if(!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          inputData.value = text;
          loadFromTextarea();
        }catch(err){
          allRows = [];
          setEnabled(false);
          renderTable([]);
          emptyState.textContent = "Could not load src. Paste data manually instead.";
          emptyState.hidden = false;
          status.textContent = "No data loaded.";
        }
      })();
    })();
  </script>
</body>
</html>
