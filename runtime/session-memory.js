#!/usr/bin/env node
"use strict";

const fs   = require("fs");
const path = require("path");
const { stateDir, ensureDir } = require("./state-paths");
const { ensureStateDirSafe, ensureBaseDirSafe } = require("./state-dir");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
function memoryDir(base) {
  return path.join(base || stateDir(), "memory");
}
function factsFile(base) {
  return path.join(memoryDir(base), "facts.jsonl");
}
function indexFile(base) {
  return path.join(memoryDir(base), "index.json");
}

// ---------------------------------------------------------------------------
// Atomic write helpers (mirrors decision-journal.js pattern)
// ---------------------------------------------------------------------------
function atomicWrite(filePath, data) {
  const tmp = filePath + ".tmp-" + process.pid;
  try {
    fs.writeFileSync(tmp, data, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } catch {
    try {
      fs.copyFileSync(tmp, filePath);
      fs.unlinkSync(tmp);
    } catch { /* best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// Keyword tokeniser — extract lowercased words ≥3 chars from text
// ---------------------------------------------------------------------------
function tokenise(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g) || [];
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------
function loadIndex(base) {
  try {
    return JSON.parse(fs.readFileSync(indexFile(base), "utf8") || "{}");
  } catch { return {}; }
}

function saveIndex(idx, base) {
  ensureDir(memoryDir(base));
  atomicWrite(indexFile(base), JSON.stringify(idx));
}

function indexFact(idx, id, fact) {
  const tokens = tokenise(fact);
  for (const tok of tokens) {
    if (!Array.isArray(idx[tok])) idx[tok] = [];
    if (!idx[tok].includes(id)) idx[tok].push(id);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a fact to the memory store.
 * @param {{fact: string, source?: string}} opts
 * @param {object} [_opts] internal — {stateDirOverride}
 * @returns {{id: string}}
 */
function addFact({ fact, source = "operator" } = {}, { stateDirOverride } = {}) {
  // ADR-032: state-dir guard
  if (!ensureBaseDirSafe(stateDir())) return { id: null };
  const base = stateDirOverride || stateDir();
  ensureDir(memoryDir(base));
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = {
    id,
    fact: String(fact || "").slice(0, 512),
    source: String(source || "operator").slice(0, 64),
    timestamp: new Date().toISOString(),
    decayScore: 1.0,
  };
  fs.appendFileSync(factsFile(base), JSON.stringify(entry) + "\n", { mode: 0o600 });

  // Update keyword index
  const idx = loadIndex(base);
  indexFact(idx, id, entry.fact);
  saveIndex(idx, base);

  return { id };
}

/**
 * Load all (non-expired) facts from the JSONL store.
 * @param {object} [opts] {stateDirOverride}
 * @returns {Array<object>}
 */
function loadFacts({ stateDirOverride } = {}) {
  // ADR-032: state-dir guard
  if (!ensureStateDirSafe(stateDir())) return [];
  const base = stateDirOverride || stateDir();
  const file = factsFile(base);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const facts = [];
  for (const line of lines) {
    try { facts.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return facts;
}

/**
 * List facts, most recent first.
 * @param {{limit?: number, stateDirOverride?: string}} [opts]
 * @returns {Array<object>}
 */
function listFacts({ limit = 20, stateDirOverride } = {}) {
  const facts = loadFacts({ stateDirOverride });
  return facts.slice().reverse().slice(0, limit);
}

/**
 * Prune expired facts (decayScore ≤ 0) and rewrite the JSONL + index.
 * @param {object} [opts] {stateDirOverride}
 * @returns {number} number of entries pruned
 */
function pruneExpired({ stateDirOverride } = {}) {
  const base = stateDirOverride || stateDir();
  const facts = loadFacts({ stateDirOverride });
  const live  = facts.filter((f) => (typeof f.decayScore !== "number" || f.decayScore > 0));
  const pruned = facts.length - live.length;
  if (pruned === 0) return 0;

  ensureDir(memoryDir(base));
  atomicWrite(factsFile(base), live.map((f) => JSON.stringify(f)).join("\n") + (live.length ? "\n" : ""));

  // Rebuild index from scratch
  const idx = {};
  for (const f of live) indexFact(idx, f.id, f.fact);
  saveIndex(idx, base);

  return pruned;
}

/**
 * Rebuild the keyword index from the current JSONL. Call after manual edits.
 * @param {object} [opts] {stateDirOverride}
 */
function rebuildIndex({ stateDirOverride } = {}) {
  const base = stateDirOverride || stateDir();
  const facts = loadFacts({ stateDirOverride });
  const idx = {};
  for (const f of facts) indexFact(idx, f.id, f.fact);
  saveIndex(idx, base);
}

module.exports = { addFact, loadFacts, listFacts, pruneExpired, rebuildIndex, memoryDir, factsFile, indexFile, tokenise };
