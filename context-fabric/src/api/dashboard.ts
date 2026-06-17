/** Self-contained dashboard served at GET / by the API. Vanilla JS, no build. */
export const dashboardHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Context Fabric — Console</title>
<style>
  :root { --bg:#0d1117; --panel:#161b22; --border:#30363d; --fg:#e6edf3; --muted:#8b949e;
          --accent:#3b82f6; --green:#2ea043; --amber:#d29922; --red:#f85149; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:16px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; }
  header .tag { color:var(--muted); font-size:13px; }
  main { padding:24px; max-width:1100px; margin:0 auto; }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
  select, input, button { font:inherit; padding:8px 10px; border-radius:8px; border:1px solid var(--border);
          background:var(--panel); color:var(--fg); }
  input[type=text] { flex:1; min-width:280px; }
  button { background:var(--accent); border-color:var(--accent); color:#fff; cursor:pointer; }
  button.secondary { background:var(--panel); color:var(--fg); }
  button:hover { filter:brightness(1.1); }
  .meta { color:var(--muted); margin:14px 0; font-size:13px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px; margin:10px 0; }
  .card h3 { margin:0 0 6px; font-size:14px; }
  .card a { color:var(--accent); text-decoration:none; }
  .badges { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
  .badge { font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--border); color:var(--muted); }
  .badge.public { color:#8b949e; } .badge.internal { color:#58a6ff; border-color:#1f6feb; }
  .badge.confidential { color:var(--amber); border-color:var(--amber); }
  .badge.restricted { color:var(--red); border-color:var(--red); }
  .badge.redact { color:var(--red); border-color:var(--red); }
  .badge.app { color:#fff; background:#21262d; }
  .denied { color:var(--amber); }
  pre { white-space:pre-wrap; background:var(--panel); border:1px solid var(--border); padding:12px; border-radius:8px; }
  .tabs { display:flex; gap:8px; margin:18px 0 8px; }
  .tabs button { background:var(--panel); color:var(--fg); }
  .tabs button.active { background:var(--accent); border-color:var(--accent); color:#fff; }
  .hint { color:var(--muted); font-size:12px; margin-top:4px; }
</style>
</head>
<body>
<header>
  <h1>Context Fabric</h1>
  <span class="tag">the secure context layer for enterprise AI — console</span>
</header>
<main>
  <div class="row">
    <label>Acting as
      <select id="user">
        <option value="u_msmith">Morgan Smith — sales manager</option>
        <option value="u_jdoe">Jane Doe — account exec</option>
        <option value="u_dev1">Dev One — engineer</option>
        <option value="u_finance">Fin Ops — finance</option>
        <option value="u_exec">Exec Person — executive</option>
        <option value="u_support">Support Engineer — support</option>
      </select>
    </label>
  </div>
  <div class="row" style="margin-top:12px">
    <input type="text" id="q" placeholder="Ask about Acme, ACME-481, INC-7781, the opportunity…"
           value="What is the current state of the Acme opportunity and what changed recently?" />
    <button onclick="doSearch()">Search</button>
    <button class="secondary" onclick="doAnswer()">Grounded answer</button>
  </div>
  <div class="hint">Switch the acting user to watch permissions, redaction, and withheld counts change for the same query.</div>

  <div class="tabs">
    <button class="active" data-tab="results" onclick="tab('results')">Results</button>
    <button data-tab="summary" onclick="tab('summary')">Banded summary</button>
    <button data-tab="cost" onclick="tab('cost')">Cost</button>
    <button data-tab="audit" onclick="tab('audit')">Audit</button>
  </div>

  <div id="results"></div>
  <div id="summary" style="display:none"></div>
  <div id="cost" style="display:none"></div>
  <div id="audit" style="display:none"></div>
</main>

<script>
const user = () => document.getElementById('user').value;
const hdrs = () => ({ 'content-type':'application/json', 'x-cf-user': user() });
const el = (id) => document.getElementById(id);

function tab(name){
  for (const d of ['results','summary','cost','audit']) el(d).style.display = d===name?'block':'none';
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  if(name==='cost') loadCost();
  if(name==='audit') loadAudit();
  if(name==='summary') loadSummary();
}

function badge(cls, text){ return '<span class="badge '+cls+'">'+text+'</span>'; }

async function doSearch(){
  tab('results');
  el('results').innerHTML = '<div class="meta">Searching…</div>';
  const res = await fetch('/v1/context/search', { method:'POST', headers:hdrs(),
    body: JSON.stringify({ query: el('q').value, active_entity_hints: hints(el('q').value) }) });
  const data = await res.json();
  render(data);
}

async function doAnswer(){
  tab('results');
  el('results').innerHTML = '<div class="meta">Thinking…</div>';
  const res = await fetch('/v1/ai/contextual-response', { method:'POST', headers:hdrs(),
    body: JSON.stringify({ query: el('q').value, active_entity_hints: hints(el('q').value) }) });
  const data = await res.json();
  let html = '<div class="card"><h3>Grounded answer</h3><pre>'+escapeHtml(data.answer)+'</pre>'
    + '<div class="meta">model: '+data.cost.provider+'/'+data.cost.model+' · '
    + (data.cost.prompt_tokens+data.cost.completion_tokens)+' tokens · $'+data.cost.usd+'</div></div>';
  render(data.retrieval, html);
}

function hints(q){
  const out = [];
  for (const m of ['Acme','ACME-481','INC-7781','Platform Expansion']) if (q.includes(m)) out.push({name:m});
  return out.length?out:[{name:'Acme'}];
}

function render(data, prefix){
  let html = prefix || '';
  html += '<div class="meta">focus: '+(data.entity_focus||[]).map(e=>e.name+' ('+e.type+')').join(', ')
    + ' · returned '+data.context.length+' · <span class="denied">withheld '+data.denied_count+'</span>'
    + ' · confidence '+data.confidence+' · '+data.budget.used_tokens+'/'+data.budget.max_tokens+' tokens</div>';
  if (data.denied_count>0) html += '<div class="meta denied">'+escapeHtml(data.denied_summary)+'</div>';
  for (const c of data.context){
    html += '<div class="card"><h3>'+escapeHtml(c.summary||'')+'</h3>'
      + '<div class="meta">'+escapeHtml(c.content)+'</div>'
      + '<div class="badges">'+badge('app', c.citation.app)+badge(c.sensitivity, c.sensitivity)
      + (c.redacted_fields&&c.redacted_fields.length?badge('redact','redacted: '+c.redacted_fields.join(',')):'')
      + '<a href="'+c.citation.url+'" target="_blank">'+escapeHtml(c.citation.title)+' ↗</a></div></div>';
  }
  if (!data.context.length) html += '<div class="card">No context you are permitted to see answers this.</div>';
  el('results').innerHTML = html;
}

async function loadSummary(){
  el('summary').innerHTML = '<div class="meta">Loading banded summary for the Acme account…</div>';
  const res = await fetch('/v1/context/entity-summary', { method:'POST', headers:hdrs(),
    body: JSON.stringify({ entity_name:'Acme Corp', entity_type:'account' }) });
  if (res.status===404){ el('summary').innerHTML='<div class="card">No content you are permitted to see for this entity.</div>'; return; }
  const d = await res.json();
  el('summary').innerHTML = '<div class="card"><h3>Acme Corp — '+badge(d.band, d.band+' band')+'</h3>'
    + '<pre>'+escapeHtml(d.summary)+'</pre>'
    + '<div class="meta">'+d.source_chunk_count+' source chunks · '+(d.cache_hit?'served from cache ✔':'freshly generated')+'</div></div>'
    + '<div class="hint">Switch users and reload this tab: the band and content change with the reader\\'s clearance — never blending content above it.</div>';
}

async function loadCost(){
  const d = await (await fetch('/v1/cost')).json();
  el('cost').innerHTML = '<div class="card"><h3>AI cost telemetry (tenant)</h3>'
    + '<div class="meta">'+d.calls+' AI calls · '+d.tokens+' tokens · $'+Number(d.usd).toFixed(6)+' estimated</div></div>';
}

async function loadAudit(){
  const rows = await (await fetch('/v1/audit')).json();
  let html = '<div class="card"><h3>Audit trail (most recent)</h3><pre>';
  for (const r of rows.slice(-25)) html += r.created_at+'  '+r.action+'  '+(r.decision||'')+'  '+(r.reason||'')+'\\n';
  html += '</pre></div>';
  el('audit').innerHTML = html;
}

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

doSearch();
</script>
</body>
</html>`;
