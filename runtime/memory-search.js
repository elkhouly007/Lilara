#!/usr/bin/env node
"use strict";

const { loadFacts, addFact, pruneExpired, rebuildIndex, tokenise } = require("./session-memory");
const { stateDir } = require("./state-paths");
const { ensureBaseDirSafe } = require("./state-dir");

// ---------------------------------------------------------------------------
// Keyword search with recency boost
// ---------------------------------------------------------------------------

/**
 * Search for facts matching a query.
 *
 * Scoring: each shared token between query and fact scores 1 point, then
 * a recency multiplier is applied (facts from the last 7 days get a 1.5×
 * boost; last 24h get 2×). Results sorted by score descending.
 *
 * @param {string} query
 * @param {{topK?: number, stateDirOverride?: string}} [opts]
 * @returns {Array<{id, fact, source, timestamp, decayScore, score}>}
 */
function search(query, { topK = 3, stateDirOverride } = {}) {
  const facts = loadFacts({ stateDirOverride });
  if (facts.length === 0) return [];

  const queryTokens = new Set(tokenise(query));
  const now = Date.now();
  const DAY_MS  = 86400000;
  const WEEK_MS = 7 * DAY_MS;

  const scored = facts
    .filter((f) => typeof f.decayScore !== "number" || f.decayScore > 0)
    .map((f) => {
      const factTokens = tokenise(f.fact);
      const overlap = factTokens.filter((t) => queryTokens.size === 0 || queryTokens.has(t)).length;

      const age = now - new Date(f.timestamp || 0).getTime();
      const recency = age <= DAY_MS  ? 2.0
                    : age <= WEEK_MS ? 1.5
                    : 1.0;

      const score = (overlap + 0.01) * recency * (typeof f.decayScore === "number" ? f.decayScore : 1.0);
      return { ...f, score };
    })
    .sort((a, b) => {
      const diff = b.score - a.score;
      if (Math.abs(diff) > 1e-9) return diff;
      // Tiebreak by timestamp descending (most recent wins)
      return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
    })
    .slice(0, topK);

  return scored;
}

// ---------------------------------------------------------------------------
// Consolidation — merge near-duplicate facts
// ---------------------------------------------------------------------------

/**
 * Merge facts with identical normalised text (case-fold + whitespace collapse).
 * For merged groups, the surviving fact gets the max decayScore.
 *
 * @param {{dryRun?: boolean, stateDirOverride?: string}} [opts]
 * @returns {{merged: number, survivors: number}}
 */
function consolidate({ dryRun = false, stateDirOverride } = {}) {
  // ADR-032: state-dir guard
  if (!ensureBaseDirSafe(stateDirOverride || stateDir())) return { merged: 0, survivors: 0 };
  const base  = stateDirOverride || stateDir();
  const facts = loadFacts({ stateDirOverride });

  function normalise(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  const groups = new Map();
  for (const f of facts) {
    const key = normalise(f.fact);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  let merged = 0;
  const survivors = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      survivors.push(group[0]);
      continue;
    }
    merged += group.length - 1;
    // Pick the most recent as survivor; aggregate decay scores (capped at 1.0)
    const sorted = group.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const totalDecay = Math.min(1.0, group.reduce((s, f) => s + (f.decayScore || 1.0), 0));
    survivors.push({ ...sorted[0], decayScore: totalDecay });
  }

  if (!dryRun && merged > 0) {
    // Rewrite the facts file using addFact pattern: clear + re-add
    const { factsFile, indexFile, memoryDir } = require("./session-memory");
    const fs = require("fs");
    const { ensureDir } = require("./state-paths");

    ensureDir(memoryDir(base));
    const tmpFacts = factsFile(base) + ".tmp-" + process.pid;
    try {
      fs.writeFileSync(tmpFacts, survivors.map((f) => JSON.stringify(f)).join("\n") + (survivors.length ? "\n" : ""), { mode: 0o600 });
      fs.renameSync(tmpFacts, factsFile(base));
    } catch {
      try { fs.copyFileSync(tmpFacts, factsFile(base)); fs.unlinkSync(tmpFacts); } catch { /* best-effort */ }
    }
    rebuildIndex({ stateDirOverride });
  }

  return { merged, survivors: survivors.length };
}

module.exports = { search, consolidate };
