"use strict";

const fs   = require("fs");
const path = require("path");
const { stateDir, ensureDir } = require("./state-paths");

// ---------------------------------------------------------------------------
// spend-estimator.js
// Pure-compute helper for token-spend estimation and per-session tracking.
// Writes session-spend.json under <stateDir>/. Zero external dependencies.
// ---------------------------------------------------------------------------

const SPEND_FILE = "session-spend.json";

// Rough estimate: ~4 characters per token (English prose, code).
function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

function spendFilePath(stateDirOverride) {
  const base = stateDirOverride || stateDir();
  return path.join(base, SPEND_FILE);
}

function loadSpend(stateDirOverride) {
  try {
    const raw = fs.readFileSync(spendFilePath(stateDirOverride), "utf8");
    return JSON.parse(raw);
  } catch {
    return { total: { input: 0, output: 0 }, byTool: {}, updatedAt: null };
  }
}

function saveSpend(data, stateDirOverride) {
  const base = stateDirOverride || stateDir();
  ensureDir(base);
  const p   = spendFilePath(stateDirOverride);
  const tmp = p + ".tmp-" + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    try { fs.renameSync(tmp, p); } catch {
      fs.copyFileSync(tmp, p);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  } catch { /* optional */ }
}

// Add token spend for a tool call. Returns updated spend record.
function addSpend({ tool, inputTokens, outputTokens }, opts) {
  const stateDirOverride = (opts && opts.stateDirOverride) || null;
  const data = loadSpend(stateDirOverride);
  data.total.input  = (data.total.input  || 0) + (inputTokens  || 0);
  data.total.output = (data.total.output || 0) + (outputTokens || 0);
  if (tool) {
    if (!data.byTool[tool]) data.byTool[tool] = { input: 0, output: 0, calls: 0 };
    data.byTool[tool].input  += (inputTokens  || 0);
    data.byTool[tool].output += (outputTokens || 0);
    data.byTool[tool].calls  += 1;
  }
  data.updatedAt = new Date().toISOString();
  saveSpend(data, stateDirOverride);
  return data;
}

function getSpend(stateDirOverride) {
  return loadSpend(stateDirOverride);
}

// Returns true if cumulative (input + output) tokens have crossed threshold.
// Default thresholds: 100_000, 500_000, 1_000_000.
function shouldWarn(thresholds, stateDirOverride) {
  const data = loadSpend(stateDirOverride);
  const total = (data.total.input || 0) + (data.total.output || 0);
  const list = Array.isArray(thresholds) ? thresholds : [100000, 500000, 1000000];
  for (const t of list) {
    if (total >= t) return { warn: true, threshold: t, total };
  }
  return { warn: false, threshold: null, total };
}

module.exports = { estimateTokens, addSpend, getSpend, shouldWarn, spendFilePath };
