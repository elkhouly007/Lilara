#!/usr/bin/env node
/**
 * spend-tracker.js — Lilara  (PostToolUse hook, all tools)
 *
 * Fires after every tool use. Estimates token spend from input/output lengths,
 * accumulates per-session totals, and emits coaching warnings when cumulative
 * spend crosses configurable thresholds.
 *
 * Thresholds (tokens): 100 000, 500 000, 1 000 000.
 * Override with LILARA_SPEND_WARN_AT="100000,500000,1000000" (CSV).
 *
 * SAFETY CONTRACT:
 * - Reads JSON from stdin; echoes unchanged to stdout.
 * - Writes coaching to stderr only.
 * - No external packages, no network calls.
 * - Silent fail on errors.
 * - Honors LILARA_KILL_SWITCH=1.
 */

"use strict";

const { readStdin, hookLog } = require("./hook-utils");
const { estimateTokens, addSpend, shouldWarn } = require("../../runtime/spend-estimator");

function parseThresholds() {
  const raw = process.env.LILARA_SPEND_WARN_AT;
  if (!raw) return [100000, 500000, 1000000];
  return raw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}

readStdin()
  .then((raw) => {
    process.stdout.write(raw || "");
    if (process.env.LILARA_KILL_SWITCH === "1") return;

    try {
      const input = JSON.parse(raw || "{}");
      const tool  = input.tool_name || "unknown";

      const inputText  = JSON.stringify(input.tool_input  || "");
      const outputText = JSON.stringify(input.tool_response || "");
      const inputTokens  = estimateTokens(inputText);
      const outputTokens = estimateTokens(outputText);

      addSpend({ tool, inputTokens, outputTokens });

      const thresholds = parseThresholds();
      const { warn, threshold, total } = shouldWarn(thresholds);

      if (warn) {
        const totalK = Math.round(total / 1000);
        const msg = `[Lilara spend-tracker] Cumulative token estimate: ~${totalK}K tokens (crossed ${threshold.toLocaleString()} threshold). Consider /compact or starting a new session if context feels degraded.`;
        hookLog("spend-tracker", "INFO", `total=${total} threshold=${threshold}`);
        process.stderr.write(msg + "\n");
      }
    } catch { /* silent */ }
  })
  .catch(() => process.exit(0));
