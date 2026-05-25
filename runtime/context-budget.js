#!/usr/bin/env node
"use strict";

// context-budget.js — Estimates remaining context window based on session
// tool-call count and annotated byte volume.
//
// Heuristic: a session with a 200K-token context window and ~2000 tokens per
// tool exchange yields a budget of ~100 effective exchanges. Thresholds below
// are tunable via LILARA_CONTEXT_BUDGET env var (default 100).
//
// Pure computation — zero I/O in this module; callers supply the counter.

const DEFAULT_BUDGET = 100; // effective tool exchanges per session

/**
 * Classify how much of the context budget has been consumed.
 *
 * @param {number} callCount  Current session tool-call count.
 * @param {number} [budget]   Override for LILARA_CONTEXT_BUDGET.
 * @returns {{ usedPct: number, remainingPct: number, severity: string }}
 *   severity: "ok" | "yellow" | "orange" | "red"
 */
function estimate(callCount, budget) {
  const cap = (budget != null && Number.isFinite(budget) && budget > 0)
    ? budget
    : (Number(process.env.LILARA_CONTEXT_BUDGET) || DEFAULT_BUDGET);

  const used = Math.min(callCount, cap);
  const usedPct = Math.round((used / cap) * 100);
  const remainingPct = 100 - usedPct;

  let severity;
  if (remainingPct <= 15) {
    severity = "red";
  } else if (remainingPct <= 25) {
    severity = "orange";
  } else if (remainingPct <= 35) {
    severity = "yellow";
  } else {
    severity = "ok";
  }

  return { usedPct, remainingPct, severity };
}

/**
 * Build a coaching message for the given severity level.
 *
 * @param {object} params
 * @param {string} params.severity  "yellow" | "orange" | "red"
 * @param {number} params.remainingPct
 * @param {number} params.callCount
 * @returns {string}
 */
function buildMessage({ severity, remainingPct, callCount }) {
  const base = `Context budget: ~${remainingPct}% remaining (${callCount} tool calls this session).`;
  if (severity === "red") {
    return `[CRITICAL] ${base} Context is nearly full. Use /compact now to compress history or /clear to start fresh. Continuing without compaction risks losing context mid-task.`;
  }
  if (severity === "orange") {
    return `[WARNING] ${base} Context is running low. Consider /compact to preserve working memory for the rest of this task.`;
  }
  // yellow
  return `[INFO] ${base} Context is filling up. Plan to /compact before the next major task boundary.`;
}

module.exports = { estimate, buildMessage };
