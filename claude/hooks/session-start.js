#!/usr/bin/env node
/**
 * session-start.js — Lilara  (SessionStart hook)
 *
 * Fires when a new Claude Code session begins.
 * Injects a compact prior-session summary into hookSpecificOutput.additionalContext
 * so the model has resume context. Shows instinct status on stderr.
 *
 * SAFETY CONTRACT:
 * - Reads JSON from stdin.
 * - Emits JSON to stdout: original fields preserved, hookSpecificOutput.additionalContext
 *   injected when a prior session summary is available. Falls back to raw echo on
 *   JSON parse failure or LILARA_KILL_SWITCH=1.
 * - Instinct summary printed to stderr only (visible to user, not to model).
 * - No external packages, no network calls.
 */

"use strict";

const utils = require("./instinct-utils");
const { startSession } = require("../../runtime/session-context");
const { buildSummary } = require("../../runtime/session-resume");
const { search: memSearch } = require("../../runtime/memory-search");

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
    // Kill-switch: echo stdin unchanged, skip all enrichment.
    if (process.env.LILARA_KILL_SWITCH === "1") {
      process.stdout.write(raw || "");
      return;
    }

    // Write a fresh session ID so all decisions this session are partitioned.
    try { startSession(); } catch { /* non-critical */ }

    // Build prior-session summary and inject into hookSpecificOutput.
    // Also inject top-3 memory facts (concatenated after resume summary).
    let out = raw || "";
    try {
      const resume = buildSummary();
      let facts = [];
      try { facts = memSearch("", { topK: 3 }); } catch { /* memory optional */ }

      let context = resume.sessionCount >= 1 ? resume.text : "";
      if (facts.length > 0) {
        const factLines = facts.map((f) => "- " + f.fact.slice(0, 120)).join("\n");
        context = (context ? context + "\n\n" : "") + "[Lilara memory] Relevant prior facts:\n" + factLines;
      }

      if (context) {
        context = context.slice(0, 500);
        const input = JSON.parse(raw);
        out = JSON.stringify({
          ...input,
          hookSpecificOutput: {
            ...(input.hookSpecificOutput || {}),
            hookEventName: "SessionStart",
            additionalContext: context,
          },
        });
      }
    } catch { /* non-critical — fall through to raw echo */ }
    process.stdout.write(out);

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

    const lines = ["[Lilara] Instinct store loaded."];
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
