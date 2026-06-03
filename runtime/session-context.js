#!/usr/bin/env node
"use strict";

const fs     = require("fs");
const os     = require("os");
const path   = require("path");
const crypto = require("crypto");
const { emitEvent } = require("./telemetry");
const { stateDir } = require("./state-paths");
const { ensureStateDirSafe, ensureBaseDirSafe } = require("./state-dir"); // ADR-028

function paths() {
  const baseDir = stateDir();
  return {
    baseDir,
    sessionFile: path.join(baseDir, "session-context.json"),
  };
}

function ensureBaseDir() {
  const { baseDir } = paths();
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  }
}

// ---------------------------------------------------------------------------
// Session ID — written once per SessionStart hook, read on every decide().
// Provides a real session boundary so getSessionRisk() partitions correctly.
// ---------------------------------------------------------------------------

function sessionIdPath() {
  return path.join(paths().baseDir, "current-session-id");
}

function currentSessionId() {
  try {
    const p = sessionIdPath();
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  } catch { /* best-effort */ }
  return null;
}

function startSession() {
  const id = crypto.randomBytes(8).toString("hex");
  try {
    // ADR-028: validate state dir before writing session-id. On unsafe dir →
    // skip the write (session-id is best-effort; the in-memory id is returned
    // so within-process partitioning still works).
    const dir = paths().baseDir;
    if (!ensureBaseDirSafe(dir)) return id;
    fs.writeFileSync(sessionIdPath(), id + "\n", { mode: 0o600 });
  } catch { /* best-effort */ }
  return id;
}

function emptyState() {
  return {
    sessions: {},
    recent: [],              // legacy field — kept for backward-compat
    mcpInjectionSignals: 0, // ADR-034 Option 2: per-session MCP injection count
    updatedAt: null,
  };
}

// Module-level cache — valid for the lifetime of one Node.js process.
// Invalidated on saveState so trajectory + risk reads after a recordDecision
// within the same process observe the updated value.
let _stateCache = null;

function loadState() {
  if (_stateCache !== null) return _stateCache;
  const { baseDir, sessionFile } = paths();
  // ADR-028: validate state dir on read. On unsafe dir → degrade to in-memory
  // empty state. Trajectory is best-effort; within-process risk escalation still
  // works. Only validate when the dir already exists (not yet created = first use,
  // not a threat).
  if (fs.existsSync(baseDir) && !ensureStateDirSafe(baseDir)) {
    _stateCache = emptyState();
    return _stateCache;
  }
  try {
    _stateCache = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      try {
        const bak = `${sessionFile}.corrupt-${Date.now()}.bak`;
        fs.copyFileSync(sessionFile, bak);
        process.stderr.write(`[ARG] WARNING: session-context.json corrupt — backed up to ${path.basename(bak)}, resetting to defaults.\n`);
        emitEvent("session-context-corrupt", { file: "session-context.json", errCode: String(err.code || "parse-error") });
      } catch { /* backup is best-effort */ }
    }
    _stateCache = emptyState();
  }
  return _stateCache;
}

function saveState(state) {
  if (process.env.LILARA_READONLY_CONTRACT === "1") { _stateCache = state; return; }
  _stateCache = null;
  try {
    // ADR-028: validate state dir before writing. On unsafe dir → cache-only
    // (mirrors readonly path). Within-process trajectory still updates via cache.
    const { baseDir, sessionFile } = paths();
    if (!ensureBaseDirSafe(baseDir)) { _stateCache = state; return; }
    const data = JSON.stringify(state, null, 2) + "\n";
    const tmp = sessionFile + ".tmp";
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    try {
      fs.renameSync(tmp, sessionFile);
    } catch {
      // Atomic rename failed (e.g. EPERM on Windows when file is locked by AV).
      try {
        fs.writeFileSync(sessionFile, data, { mode: 0o600 });
      } catch { /* best-effort fallback */ }
      try { fs.unlinkSync(tmp); } catch { /* tmp cleanup is best-effort */ }
    }
  } finally {
    // Always repopulate cache so callers in the same process see the new state,
    // even if the disk write failed.
    _stateCache = state;
  }
}

function sessionRecent(state) {
  const sid = currentSessionId();
  if (sid && state.sessions) {
    // In the partitioned format, a session with no prior decisions is a clean slate.
    // Do NOT fall back to the legacy `recent` field — that would bleed cross-session
    // trajectory into a new session. Fall back to `recent` only for old state files
    // that predate session partitioning (i.e., no `sessions` map at all).
    return Array.isArray(state.sessions[sid]) ? state.sessions[sid] : [];
  }
  return Array.isArray(state.recent) ? state.recent : [];
}

function getMcpInjectionSignals() {
  // ADR-034 Option 2: returns the MCP injection signal count for the current
  // session. Stored separately from the trajectory so a single injection event
  // can immediately contribute to session risk without needing two entries.
  const state = loadState();
  return typeof state.mcpInjectionSignals === "number" ? state.mcpInjectionSignals : 0;
}

function recordMcpInjectionSignal() {
  // ADR-034 Option 2: called by post-adapter-factory when block 2d detects a
  // confirmed MCP result-injection signal. Increments the per-session counter
  // and persists to session-context.json so the next decide() call sees the
  // updated risk via getSessionRisk() → F9 escalation path.
  //
  // Fail-safe: errors are swallowed so a broken state-dir never blocks the
  // PostToolUse path (detection itself has already been journalled by the
  // caller; this counter is best-effort enrichment).
  try {
    const state = loadState();
    const prev  = typeof state.mcpInjectionSignals === "number" ? state.mcpInjectionSignals : 0;
    saveState({ ...state, mcpInjectionSignals: prev + 1, updatedAt: new Date().toISOString() });
  } catch { /* best-effort — PostToolUse must never throw */ }
}

function getSessionRisk() {
  const state  = loadState();
  const recent = sessionRecent(state).slice(-8);
  let risk = 0;
  const highish     = recent.filter((item) => ["escalate", "block"].includes(item.action)).length;
  const destructive = recent.filter((item) => Array.isArray(item.reasonCodes) && item.reasonCodes.includes("destructive-delete-pattern")).length;
  if (highish >= 2)     risk += 2;
  if (destructive >= 2) risk += 1;
  // ADR-034 Option 2: MCP injection signals contribute tiered risk so that:
  //   1 injection alone  → risk +2 (does not trip F9 threshold of 3 alone)
  //   2+ injections alone → risk +3 (immediately trips F9 on next PreToolUse)
  //   1 injection + 2+ escalations → 2+2 = 4 → cap 3 → F9 fires
  // Buildup is intentional: a single advisory signal is informative but not
  // conclusive; two confirmed injections in one session warrant hard escalation.
  const mcpInj = getMcpInjectionSignals();
  if (mcpInj >= 2)      risk += 3;
  else if (mcpInj >= 1) risk += 2;
  return Math.min(3, risk);
}

function recordDecision(entry = {}) {
  const state = loadState();
  const next = {
    ts:          new Date().toISOString(),
    action:      String(entry.action    || "unknown"),
    riskLevel:   String(entry.riskLevel || "unknown"),
    reasonCodes: Array.isArray(entry.reasonCodes) ? entry.reasonCodes.slice(0, 8) : [],
  };

  const sid  = currentSessionId();
  const sessions = state.sessions || {};

  if (sid) {
    // Session-partitioned storage
    const sessionData = Array.isArray(sessions[sid]) ? sessions[sid].slice(-23) : [];
    sessionData.push(next);
    sessions[sid] = sessionData;
    // Also maintain legacy field for tools that read the old format
    const recent = Array.isArray(state.recent) ? state.recent.slice(-11) : [];
    recent.push(next);
    saveState({ sessions, recent, updatedAt: next.ts });
  } else {
    // No active session — legacy path
    const recent = Array.isArray(state.recent) ? state.recent.slice(-11) : [];
    recent.push(next);
    saveState({ sessions, recent, updatedAt: next.ts });
  }
  return next;
}

function getSessionTrajectory() {
  const windowMin   = Number(process.env.LILARA_TRAJECTORY_WINDOW_MIN || "30");
  const state       = loadState();
  const recent      = sessionRecent(state);
  const windowStart = new Date(Date.now() - windowMin * 60 * 1000);
  const windowed    = recent.filter((item) => !item.ts || new Date(item.ts) >= windowStart);
  return {
    recentEscalations: windowed.filter((item) => ["escalate", "block"].includes(item.action)).length,
    recentReviews:     windowed.filter((item) => ["require-review", "review", "modify"].includes(item.action)).length,
    lastDecisionAt:    recent.length ? (recent[recent.length - 1]?.ts || null) : null,
  };
}

// Reset the in-process cache. Used by test scripts only to prevent cross-call
// state contamination when multiple runPreToolGate calls share one Node process.
// IMPORTANT: also clears the provenance-graph cache — this is load-bearing for
// replay isolation (scripts/replay-decisions.js calls resetCache() + fresh
// LILARA_STATE_DIR per entry; the graph cache must be cleared too or entry N
// could bleed into entry N+1 via the in-memory cache).
function resetCache() {
  _stateCache  = null;
  _graphCache  = null;
}

// ---------------------------------------------------------------------------
// Provenance window — stores recent external-read annotations for taint.js
// ---------------------------------------------------------------------------

const PROVENANCE_MAX_AGE_MS  = 300_000; // 5 minutes hard TTL
const PROVENANCE_MAX_ENTRIES = 20;

// ---------------------------------------------------------------------------
// Provenance graph — session-scoped data-flow graph for F23 kill-chain floor.
//
// Nodes represent sources (file reads / web-fetch / mcp outputs) and
// derivatives (writes whose content overlaps a source). The graph is stored
// in provenance-graph.json under the stateDir, mirroring the provenance-
// window.json pattern: same atomic-write, same readonly guard, same TTL prune.
//
// NOTE: _graphCache is a separate module-level variable from _stateCache so
// that resetCache() clears BOTH (load-bearing for replay isolation — see the
// resetCache comment above). Never fold this into _stateCache.
// ---------------------------------------------------------------------------

const PROVENANCE_GRAPH_MAX_AGE_MS  = 300_000; // 5-minute TTL (one session's tail)
const PROVENANCE_GRAPH_MAX_NODES   = 40;      // Cap so the file stays small

let _graphCache = null;

function provenanceGraphPath() {
  return path.join(paths().baseDir, "provenance-graph.json");
}

function loadProvenanceGraph() {
  if (_graphCache !== null) return _graphCache;
  try {
    const p = provenanceGraphPath();
    if (!fs.existsSync(p)) { _graphCache = []; return _graphCache; }
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    _graphCache = Array.isArray(parsed) ? parsed : [];
  } catch { _graphCache = []; }
  return _graphCache;
}

function saveProvenanceGraph(nodes) {
  _graphCache = Array.isArray(nodes) ? nodes : [];
  if (process.env.LILARA_READONLY_CONTRACT === "1") return;
  try {
    // ADR-028: validate state dir before writing. On unsafe dir → cache-only
    // (provenance graph is advisory taint data; in-memory cache still works).
    const dir = paths().baseDir;
    if (!ensureBaseDirSafe(dir)) return;
    const p = provenanceGraphPath();
    const data = JSON.stringify(_graphCache);
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    try {
      fs.renameSync(tmp, p);
    } catch {
      try { fs.writeFileSync(p, data, { mode: 0o600 }); } catch { /* best-effort */ }
      try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
    }
  } catch { /* provenance-graph I/O is best-effort */ }
}

/**
 * Append a node to the provenance graph.
 * Prunes nodes older than PROVENANCE_GRAPH_MAX_AGE_MS and caps at
 * PROVENANCE_GRAPH_MAX_NODES. Content is NEVER stored — only token hashes.
 *
 * Node shape (caller is responsible for building):
 *   { role, sourceClass, pathHash?, urlHash?, targetPathHash?, host?,
 *     tokenHashes: string[], ts: number }
 */
function recordProvenanceStep(node) {
  try {
    const now = Date.now();
    let graph = loadProvenanceGraph();
    // Prune stale nodes
    graph = graph.filter((n) => (now - (n.ts || 0)) < PROVENANCE_GRAPH_MAX_AGE_MS);
    graph.push(node);
    if (graph.length > PROVENANCE_GRAPH_MAX_NODES) {
      graph = graph.slice(-PROVENANCE_GRAPH_MAX_NODES);
    }
    saveProvenanceGraph(graph);
  } catch { /* best-effort */ }
}

function provenanceWindowPath() {
  return path.join(paths().baseDir, "provenance-window.json");
}

function recordExternalRead(content, source) {
  try {
    // ADR-028: validate state dir before writing. On unsafe dir → skip (provenance
    // window is best-effort TTL taint data; not an enforcement gate).
    const dir = paths().baseDir;
    if (!ensureBaseDirSafe(dir)) return;
    const p = provenanceWindowPath();
    let window = [];
    try { window = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* first call */ }
    const now = Date.now();
    // Prune stale entries
    window = window.filter((e) => (now - (e.ts || 0)) < PROVENANCE_MAX_AGE_MS);
    window.push({ content: String(content || "").slice(0, 4096), source: String(source || "external"), ts: now });
    if (window.length > PROVENANCE_MAX_ENTRIES) window = window.slice(-PROVENANCE_MAX_ENTRIES);
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(window), { mode: 0o600 });
    fs.renameSync(tmp, p);
  } catch { /* provenance tracking is best-effort */ }
}

function getProvenanceWindow(windowSeconds) {
  try {
    const p = provenanceWindowPath();
    if (!fs.existsSync(p)) return [];
    const window = JSON.parse(fs.readFileSync(p, "utf8"));
    const cutoff = Date.now() - ((windowSeconds || 60) * 1000);
    return window.filter((e) => (e.ts || 0) >= cutoff);
  } catch { return []; }
}

module.exports = { paths, loadState, saveState, getSessionRisk, getMcpInjectionSignals, recordMcpInjectionSignal, recordDecision, getSessionTrajectory, startSession, currentSessionId, resetCache, recordExternalRead, getProvenanceWindow, loadProvenanceGraph, saveProvenanceGraph, recordProvenanceStep };
