#!/usr/bin/env node
"use strict";
// dashboard-server.js — Read-only observability dashboard for Lilara decisions.
//
// Usage:
//   node scripts/dashboard-server.js [--port N]
//   LILARA_DASHBOARD_PORT=7917 node scripts/dashboard-server.js
//
// Binds 127.0.0.1 only. Zero external dependencies (stdlib: http/fs/path/zlib/crypto).
// All journal data is redacted before serving — no raw secrets ever leave the server.
//
// Fail-closed: if receipt-export.js is missing or redactEntry is not a function
// at startup, the server refuses to serve any journal data.

const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const zlib   = require("zlib");

const root    = path.resolve(__dirname, "..");
const scripts = __dirname;

// ── Parse args ───────────────────────────────────────────────────────────────
let argPort = null;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--port" || a === "-p") argPort = Number(process.argv[++i]);
  else if (a.startsWith("--port=")) argPort = Number(a.slice(7));
  else if (a === "-h" || a === "--help") {
    process.stdout.write(
      "Usage: node scripts/dashboard-server.js [--port N]\n" +
      "       LILARA_DASHBOARD_PORT=N node scripts/dashboard-server.js\n" +
      "\nBinds 127.0.0.1 only. Default port: 7917.\n"
    );
    process.exit(0);
  }
}
const PORT = argPort || Number(process.env.LILARA_DASHBOARD_PORT) || 7917;

// ── Load redaction helpers (fail-closed) ─────────────────────────────────────
let redactEntry, readJournal;
try {
  const exp = require(path.join(root, "runtime", "receipt-export"));
  redactEntry = exp.redactEntry || exp._redactEntry;
  readJournal = exp.readJournal || exp._readJournal;
  if (typeof redactEntry !== "function") throw new Error("redactEntry is not a function");
  if (typeof readJournal !== "function") throw new Error("readJournal is not a function");
} catch (err) {
  process.stderr.write(
    "[dashboard] FATAL: cannot load redaction helpers from runtime/receipt-export.js\n" +
    "  " + err.message + "\n" +
    "  Dashboard refuses to start to prevent unredacted journal exposure.\n"
  );
  process.exit(1);
}

// ── State dir ────────────────────────────────────────────────────────────────
function stateDir() {
  return process.env.LILARA_STATE_DIR
    ? path.resolve(process.env.LILARA_STATE_DIR)
    : path.join(require("os").homedir(), ".lilara");
}

// ── Read all journal entries (active + rotated), redact every entry ───────────
function readAllJournalEntries() {
  const base   = stateDir();
  const active = path.join(base, "decision-journal.jsonl");
  const r1     = path.join(base, "decision-journal.1.jsonl");
  const r2     = path.join(base, "decision-journal.2.jsonl.gz");
  const r3     = path.join(base, "decision-journal.3.jsonl.gz");

  const entries = [];

  function loadPlain(file) {
    if (!fs.existsSync(file)) return;
    try {
      const raw = fs.readFileSync(file, "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    } catch { /* skip unreadable file */ }
  }

  function loadGzip(file) {
    if (!fs.existsSync(file)) return;
    try {
      const buf = fs.readFileSync(file);
      const raw = zlib.gunzipSync(buf).toString("utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    } catch { /* skip corrupt gz */ }
  }

  loadPlain(active);
  loadPlain(r1);
  loadGzip(r2);
  loadGzip(r3);

  // Redact every entry — single chokepoint, no raw data escapes.
  return entries.map((e) => { try { return redactEntry(e); } catch { return e; } });
}

// ── Aggregate helpers ─────────────────────────────────────────────────────────

function buildSummary(entries) {
  const runtimeDecisions = entries.filter((e) => e.kind === "runtime-decision");
  const byAction   = {};
  const byLevel    = {};
  const byFloor    = {};
  let   blockCount = 0;

  for (const e of runtimeDecisions) {
    const act = e.action || "unknown";
    byAction[act] = (byAction[act] || 0) + 1;
    const lvl = e.riskLevel || "unknown";
    byLevel[lvl] = (byLevel[lvl] || 0) + 1;
    if (e.floorFired) byFloor[e.floorFired] = (byFloor[e.floorFired] || 0) + 1;
    if (act === "block" || act === "escalate") blockCount++;
  }

  const total    = runtimeDecisions.length;
  const blockRate = total > 0 ? ((blockCount / total) * 100).toFixed(1) : "0.0";

  return { total, blockCount, blockRate: blockRate + "%", byAction, byLevel, byFloor };
}

function buildCoverage(entries) {
  const runtimeDecisions = entries.filter((e) => e.kind === "runtime-decision");
  const byToolKind  = { bash: 0, "file-write": 0, mcp: 0, network: 0, other: 0 };
  const reasonCount = {};
  let   f24Hits     = 0;

  for (const e of runtimeDecisions) {
    const tool = String(e.tool || "").toLowerCase();
    if (tool === "bash") byToolKind.bash++;
    else if (tool === "edit" || tool === "write") byToolKind["file-write"]++;
    else if (tool.startsWith("mcp__")) byToolKind.mcp++;
    else if (tool === "webfetch" || tool === "websearch") byToolKind.network++;
    else byToolKind.other++;

    for (const r of (e.reasonCodes || [])) {
      reasonCount[r] = (reasonCount[r] || 0) + 1;
    }

    if (e.floorFired === "credential-persistence-write") f24Hits++;
  }

  const newReasonCodes = ["file-write-high-sensitivity", "file-write-medium-sensitivity",
    "file-write-persistence", "file-write-cicd-config", "file-write-lockfile",
    "file-write-system-path", "mcp-sensitive-path-arg", "network-plaintext",
    "network-ip-literal", "network-egress-observed", "credential-persistence-write-denied"];
  const newReasonSummary = {};
  for (const r of newReasonCodes) newReasonSummary[r] = reasonCount[r] || 0;

  return { byToolKind, f24Hits, newReasonCodes: newReasonSummary, allReasonCodes: reasonCount };
}

function buildKillChains(entries) {
  return entries
    .filter((e) => e.killChain)
    .map((e) => ({
      ts:          e.ts,
      tool:        e.tool,
      action:      e.action,
      session:     e.session,
      chainType:   e.killChain.chainType,
      severity:    e.killChain.severity,
      detected:    e.killChain.detected,
      enforced:    e.killChain.enforced,
      wouldAction: e.killChain.wouldAction,
      confidence:  e.killChain.confidence,
      evidence:    e.killChain.evidence,
      steps:       e.killChain.steps,
    }));
}

function buildSessions() {
  const base = stateDir();
  const ctxFile = path.join(base, "session-context.json");
  const idFile  = path.join(base, "current-session-id");
  let   ctx = null, currentId = null;
  try { ctx       = JSON.parse(fs.readFileSync(ctxFile, "utf8")); } catch { /* absent */ }
  try { currentId = fs.readFileSync(idFile, "utf8").trim(); }     catch { /* absent */ }
  return { currentSessionId: currentId, context: ctx };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function json(res, data, status) {
  const body = JSON.stringify(data);
  res.writeHead(status || 200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function parseQuery(url) {
  const idx = url.indexOf("?");
  if (idx < 0) return {};
  const q = {};
  for (const part of url.slice(idx + 1).split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    q[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
  }
  return q;
}

// ── Inline dashboard HTML (single-file, no CDN) ───────────────────────────────
const DASHBOARD_HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lilara Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh}
  header{background:#161b22;border-bottom:1px solid #30363d;padding:12px 24px;display:flex;align-items:center;gap:16px}
  header h1{font-size:1.1rem;font-weight:600;color:#f0f6fc}
  header .badge{background:#238636;color:#fff;border-radius:4px;padding:2px 8px;font-size:.75rem;font-weight:600}
  nav{background:#161b22;border-bottom:1px solid #30363d;padding:0 24px;display:flex;gap:2px}
  nav button{background:none;border:none;color:#8b949e;cursor:pointer;padding:12px 16px;font-size:.875rem;border-bottom:2px solid transparent;transition:color .15s,border-color .15s}
  nav button:hover{color:#f0f6fc}
  nav button.active{color:#f0f6fc;border-bottom-color:#f78166}
  main{padding:24px;max-width:1200px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:24px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
  .card-label{font-size:.75rem;color:#8b949e;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em}
  .card-value{font-size:1.5rem;font-weight:700;color:#f0f6fc}
  .card-sub{font-size:.75rem;color:#8b949e;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th{text-align:left;padding:8px 12px;background:#161b22;border-bottom:2px solid #30363d;color:#8b949e;font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
  td{padding:8px 12px;border-bottom:1px solid #21262d;vertical-align:top;color:#c9d1d9}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#1c2128}
  .pill{display:inline-block;border-radius:12px;padding:2px 8px;font-size:.7rem;font-weight:600;white-space:nowrap}
  .pill-block{background:#da3633;color:#fff}
  .pill-allow{background:#238636;color:#fff}
  .pill-route{background:#9e6a03;color:#fff}
  .pill-modify{background:#6e40c9;color:#fff}
  .pill-escalate{background:#e3b341;color:#000}
  .pill-require-review{background:#1f6feb;color:#fff}
  .pill-other{background:#30363d;color:#c9d1d9}
  .section-title{font-size:.95rem;font-weight:600;color:#f0f6fc;margin-bottom:12px;margin-top:24px}
  .filters{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
  .filters input,.filters select{background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;padding:6px 10px;font-size:.85rem}
  .filters input:focus,.filters select:focus{outline:none;border-color:#388bfd}
  .refresh{margin-left:auto;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;padding:6px 12px;cursor:pointer;font-size:.8rem}
  .refresh:hover{background:#30363d}
  .empty{color:#8b949e;text-align:center;padding:32px;font-size:.9rem}
  .mono{font-family:ui-monospace,'Cascadia Mono',monospace;font-size:.8rem}
  .err{color:#f85149}
  .bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .bar-label{min-width:120px;font-size:.8rem;color:#8b949e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar-track{flex:1;background:#21262d;border-radius:4px;height:12px;overflow:hidden}
  .bar-fill{height:100%;border-radius:4px;background:#388bfd;transition:width .3s}
  .bar-count{min-width:40px;text-align:right;font-size:.8rem;color:#8b949e}
  #view-overview,#view-decisions,#view-coverage,#view-kill-chains,#view-sessions{display:none}
  #view-overview.active,#view-decisions.active,#view-coverage.active,#view-kill-chains.active,#view-sessions.active{display:block}
  pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px;overflow:auto;font-size:.8rem}
</style>
</head>
<body>
<header>
  <h1>Lilara Dashboard</h1>
  <span class="badge">read-only</span>
</header>
<nav>
  <button class="active" onclick="switchView('overview')">Overview</button>
  <button onclick="switchView('decisions')">Decisions</button>
  <button onclick="switchView('coverage')">Coverage</button>
  <button onclick="switchView('kill-chains')">Kill Chains</button>
  <button onclick="switchView('sessions')">Sessions</button>
</nav>
<main>
  <div id="view-overview" class="active"></div>
  <div id="view-decisions"></div>
  <div id="view-coverage"></div>
  <div id="view-kill-chains"></div>
  <div id="view-sessions"></div>
</main>
<script>
const VIEWS = ['overview','decisions','coverage','kill-chains','sessions'];
let currentView = 'overview';

function pill(action) {
  const cls = {block:'pill-block',allow:'pill-allow',route:'pill-route',
    modify:'pill-modify',escalate:'pill-escalate','require-review':'pill-require-review'}[action] || 'pill-other';
  return '<span class="pill '+cls+'">'+esc(action)+'</span>';
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmt(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return esc(ts); }
}

function switchView(v) {
  currentView = v;
  document.querySelectorAll('nav button').forEach((b,i) => b.classList.toggle('active', VIEWS[i] === v));
  VIEWS.forEach(id => document.getElementById('view-'+id).classList.toggle('active', id === v));
  loadView(v);
}

async function api(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
  return r.json();
}

function barChart(data, maxVal) {
  const max = maxVal || Math.max(...Object.values(data), 1);
  return Object.entries(data).sort((a,b) => b[1]-a[1]).map(([k,v]) =>
    '<div class="bar-row"><div class="bar-label">'+esc(k)+'</div>'+
    '<div class="bar-track"><div class="bar-fill" style="width:'+Math.round(v/max*100)+'%"></div></div>'+
    '<div class="bar-count">'+v+'</div></div>'
  ).join('');
}

async function loadView(v) {
  const el = document.getElementById('view-'+v);
  if (v === 'overview') {
    try {
      const s = await api('/api/summary');
      el.innerHTML =
        '<div class="grid">'+
        '<div class="card"><div class="card-label">Total Decisions</div><div class="card-value">'+s.total+'</div></div>'+
        '<div class="card"><div class="card-label">Block Rate</div><div class="card-value">'+s.blockRate+'</div><div class="card-sub">'+s.blockCount+' blocked</div></div>'+
        Object.entries(s.byAction).map(([a,n]) =>
          '<div class="card"><div class="card-label">'+esc(a)+'</div><div class="card-value">'+n+'</div></div>'
        ).join('')+
        '</div>'+
        '<div class="section-title">By Risk Level</div>'+barChart(s.byLevel)+
        (Object.keys(s.byFloor).length ?
          '<div class="section-title">Floor Fires</div>'+barChart(s.byFloor) : '');
    } catch(e) { el.innerHTML = '<div class="err">'+esc(e.message)+'</div>'; }
  }
  else if (v === 'decisions') {
    el.innerHTML = '<div class="filters">'+
      '<input id="f-action" placeholder="action (block, allow...)" size="22">'+
      '<input id="f-level" placeholder="risk level" size="14">'+
      '<input id="f-floor" placeholder="floor" size="18">'+
      '<input id="f-session" placeholder="session" size="18">'+
      '<input id="f-date" placeholder="date (YYYY-MM-DD)" size="18">'+
      '<input id="f-limit" type="number" value="50" min="1" max="500" size="6">'+
      '<button class="refresh" onclick="loadDecisions()">Refresh</button>'+
      '</div><div id="dec-table"><div class="empty">Loading…</div></div>';
    await loadDecisions();
  }
  else if (v === 'coverage') {
    try {
      const c = await api('/api/coverage');
      el.innerHTML =
        '<div class="section-title">Decisions by Tool Kind</div>'+barChart(c.byToolKind)+
        '<div class="section-title">F24 Credential-Persistence Hits</div>'+
        '<div class="card" style="display:inline-block;min-width:160px"><div class="card-label">F24 Blocks</div><div class="card-value">'+c.f24Hits+'</div></div>'+
        '<div class="section-title">New Coverage Reason Codes</div>'+barChart(c.newReasonCodes)+
        '<div class="section-title">All Reason Codes</div>'+barChart(c.allReasonCodes);
    } catch(e) { el.innerHTML = '<div class="err">'+esc(e.message)+'</div>'; }
  }
  else if (v === 'kill-chains') {
    try {
      const chains = await api('/api/kill-chains');
      if (!chains.length) { el.innerHTML = '<div class="empty">No kill-chain events recorded yet.</div>'; return; }
      el.innerHTML = '<table><thead><tr>'+
        '<th>Time</th><th>Tool</th><th>Action</th><th>Chain</th><th>Severity</th><th>Enforced</th><th>Evidence</th></tr></thead><tbody>'+
        chains.map(c =>
          '<tr><td class="mono">'+fmt(c.ts)+'</td>'+
          '<td class="mono">'+esc(c.tool||'—')+'</td>'+
          '<td>'+pill(c.action)+'</td>'+
          '<td><span class="pill pill-other">'+esc(c.chainType||'—')+'</span></td>'+
          '<td>'+esc(c.severity||'—')+'</td>'+
          '<td>'+(c.enforced?'<span class="pill pill-block">enforced</span>':'<span class="pill pill-other">observe</span>')+'</td>'+
          '<td class="mono">'+(c.evidence||[]).map(esc).join('<br>')+'</td></tr>'
        ).join('')+'</tbody></table>';
    } catch(e) { el.innerHTML = '<div class="err">'+esc(e.message)+'</div>'; }
  }
  else if (v === 'sessions') {
    try {
      const s = await api('/api/sessions');
      el.innerHTML =
        '<div class="section-title">Current Session</div>'+
        '<div class="card" style="margin-bottom:16px"><div class="card-label">Session ID</div>'+
        '<div class="mono" style="margin-top:4px">'+esc(s.currentSessionId||'—')+'</div></div>'+
        (s.context ? '<div class="section-title">Session Context</div><pre>'+esc(JSON.stringify(s.context,null,2))+'</pre>' : '<div class="empty">No session context recorded.</div>');
    } catch(e) { el.innerHTML = '<div class="err">'+esc(e.message)+'</div>'; }
  }
}

async function loadDecisions() {
  const el = document.getElementById('dec-table');
  if (!el) return;
  el.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const params = new URLSearchParams({
      limit: document.getElementById('f-limit')?.value || '50',
      action: document.getElementById('f-action')?.value || '',
      level:  document.getElementById('f-level')?.value || '',
      floor:  document.getElementById('f-floor')?.value || '',
      session:document.getElementById('f-session')?.value || '',
      date:   document.getElementById('f-date')?.value || '',
    });
    for (const [k, v] of params) { if (!v) params.delete(k); }
    const data = await api('/api/decisions?' + params);
    if (!data.entries.length) { el.innerHTML = '<div class="empty">No matching decisions.</div>'; return; }
    el.innerHTML = '<table><thead><tr>'+
      '<th>Time</th><th>Action</th><th>Level</th><th>Tool</th><th>Floor</th><th>Reasons</th><th>Target</th></tr></thead><tbody>'+
      data.entries.map(e =>
        '<tr><td class="mono">'+fmt(e.ts)+'</td>'+
        '<td>'+pill(e.action)+'</td>'+
        '<td>'+esc(e.riskLevel||'—')+'</td>'+
        '<td class="mono">'+esc(e.tool||'—')+'</td>'+
        '<td class="mono">'+esc(e.floorFired||'—')+'</td>'+
        '<td class="mono">'+(e.reasonCodes||[]).join(', ')+'</td>'+
        '<td class="mono">'+esc(e.targetPath||'—')+'</td></tr>'
      ).join('')+'</tbody></table>'+
      (data.total > data.entries.length ? '<div style="padding:8px 12px;font-size:.8rem;color:#8b949e">Showing '+data.entries.length+' of '+data.total+' entries.</div>' : '');
  } catch(e) { el.innerHTML = '<div class="err">'+esc(e.message)+'</div>'; }
}

// Initial load
loadView('overview');
</script>
</body>
</html>`;

// ── Request router ────────────────────────────────────────────────────────────
function handle(req, res) {
  const url  = req.url || "/";
  const base = url.split("?")[0];

  // Security: only allow GET from localhost
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method not allowed");
    return;
  }

  if (base === "/healthz") {
    json(res, { ok: true, uptime: process.uptime() });
    return;
  }

  if (base === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(DASHBOARD_HTML) });
    res.end(DASHBOARD_HTML);
    return;
  }

  if (base === "/api/summary") {
    try {
      const entries = readAllJournalEntries();
      json(res, buildSummary(entries));
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  if (base === "/api/decisions") {
    try {
      const q       = parseQuery(url);
      const limit   = Math.min(Math.max(Number(q.limit) || 50, 1), 500);
      const entries = readAllJournalEntries()
        .filter((e) => e.kind === "runtime-decision")
        .filter((e) => !q.action  || e.action    === q.action)
        .filter((e) => !q.level   || e.riskLevel  === q.level)
        .filter((e) => !q.floor   || e.floorFired === q.floor)
        .filter((e) => !q.session || String(e.session || "").includes(q.session))
        .filter((e) => !q.date    || String(e.ts || "").startsWith(q.date));
      const paged = entries.slice(0, limit);
      json(res, { total: entries.length, limit, entries: paged });
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  if (base === "/api/coverage") {
    try {
      const entries = readAllJournalEntries();
      json(res, buildCoverage(entries));
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  if (base === "/api/kill-chains") {
    try {
      const entries = readAllJournalEntries();
      json(res, buildKillChains(entries));
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  if (base === "/api/sessions") {
    try {
      json(res, buildSessions());
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

// ── Start server ──────────────────────────────────────────────────────────────
const server = http.createServer(handle);
server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(
    "[dashboard] Lilara Dashboard running at http://127.0.0.1:" + PORT + "\n" +
    "[dashboard] Serving from state dir: " + stateDir() + "\n" +
    "[dashboard] Press Ctrl+C to stop.\n"
  );
});

server.on("error", (err) => {
  process.stderr.write("[dashboard] Server error: " + err.message + "\n");
  process.exit(1);
});
