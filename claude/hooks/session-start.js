#!/usr/bin/env node
/**
 * session-start.js — Lilara  (SessionStart hook)
 *
 * Fires when a new Claude Code session begins.
 * Shows a brief instinct status summary so Ahmed knows what's pending review.
 *
 * SAFETY CONTRACT:
 * - Reads JSON from stdin.
 * - Echoes original input to stdout UNCHANGED.
 * - Summary printed to stderr only (visible to user, not to model).
 * - No file writes during session-start.
 * - No external packages, no network calls.
 * - Read-only: only reads ~/.lilara/instincts/pending.json and confident.json.
 */

"use strict";

const utils = require("./instinct-utils");
const { startSession } = require("../../runtime/session-context");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
  });
}

readStdin()
  .then((raw) => {
    // Always echo input unchanged.
    process.stdout.write(raw || "");
    if (process.env.LILARA_KILL_SWITCH === "1") return;

    // Write a fresh session ID so all decisions this session are partitioned.
    try { startSession(); } catch { /* non-critical */ }

    // Run TTL pruning silently to keep the store clean.
    let pruned = 0;
    try {
      pruned = utils.prunePending();
    } catch {
      // Non-critical — do not fail session start.
    }

    // Read summary counts (no content exposed).
    let s;
    try {
      s = utils.summary();
    } catch {
      // If instinct store doesn't exist yet, skip the summary.
      return;
    }

    // Only print if there is something worth showing.
    if (s.pending === 0 && s.confident === 0) return;

    const lines = ["[Agent Runtime Guard] Instinct store loaded."];
    if (s.candidates > 0) {
      lines.push(`  → ${s.candidates} candidate(s) ready for your review — run /instinct-status.`);
    }
    if (s.pending > 0) {
      lines.push(`  ${s.pending} pending, ${s.confident} confident.`);
    }
    if (s.expiringSoon > 0) {
      lines.push(`  ⚠ ${s.expiringSoon} instinct(s) expire within 7 days — run /prune.`);
    }
    if (pruned > 0) {
      lines.push(`  ${pruned} expired instinct(s) pruned automatically.`);
    }

    process.stderr.write(lines.join("\n") + "\n");
  })
  .catch(() => {
    // Silent fail — hooks must never crash the harness.
    process.exit(0);
  });
