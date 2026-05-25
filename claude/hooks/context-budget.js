#!/usr/bin/env node
/**
 * context-budget.js — Lilara  (PostToolUse hook, all tools)
 *
 * Fires after every tool use. Estimates remaining context window from the
 * session tool-call counter maintained by strategic-compact.js. Emits
 * coaching warnings at 35%, 25%, and 15% remaining budget.
 *
 * Debounced: emits at most one warning per 5 tool calls (tracked in a
 * separate file under ~/.lilara/ so as not to interfere with the counter).
 *
 * SAFETY CONTRACT:
 * - Reads JSON from stdin.
 * - Echoes original input to stdout UNCHANGED.
 * - Writes coaching hints to stderr (or additionalContext if supported).
 * - Reads only the session counter file — never file or prompt content.
 * - No external packages, no network calls.
 * - Silent fail on errors.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { readStdin, hookLog }     = require("./hook-utils");
const { hookStateDir }           = require("../../runtime/state-paths");
const { estimate, buildMessage } = require("../../runtime/context-budget");

const LILARA_DIR     = hookStateDir();
const COUNTER_FILE   = path.join(LILARA_DIR, "session-counter.json");
const DEBOUNCE_FILE  = path.join(LILARA_DIR, "context-budget-debounce.json");
const DEBOUNCE_CALLS = 5; // minimum tool calls between warnings

function ensureDir() {
  try { fs.mkdirSync(LILARA_DIR, { recursive: true, mode: 0o700 }); } catch {}
}

function readCallCount() {
  try {
    const obj = JSON.parse(fs.readFileSync(COUNTER_FILE, "utf8") || "{}");
    return typeof obj.count === "number" ? obj.count : 0;
  } catch { return 0; }
}

function readLastWarnedAt() {
  try {
    const obj = JSON.parse(fs.readFileSync(DEBOUNCE_FILE, "utf8") || "{}");
    return typeof obj.lastWarnedAt === "number" ? obj.lastWarnedAt : 0;
  } catch { return 0; }
}

function writeLastWarnedAt(count) {
  try {
    ensureDir();
    fs.writeFileSync(DEBOUNCE_FILE, JSON.stringify({ lastWarnedAt: count }), { encoding: "utf8", mode: 0o600 });
  } catch {}
}

readStdin()
  .then((raw) => {
    process.stdout.write(raw || "");
    if (process.env.LILARA_KILL_SWITCH === "1") return;

    try {
      const callCount = readCallCount();
      const { severity, remainingPct } = estimate(callCount);

      if (severity === "ok") return;

      // Debounce: only warn if >= DEBOUNCE_CALLS have passed since last warning.
      const lastWarnedAt = readLastWarnedAt();
      if (callCount - lastWarnedAt < DEBOUNCE_CALLS) return;

      writeLastWarnedAt(callCount);

      const message = buildMessage({ severity, remainingPct, callCount });
      hookLog("context-budget", "INFO", `severity=${severity} remaining=${remainingPct}%`);
      process.stderr.write(`[Lilara] ${message}\n`);
    } catch {}
  })
  .catch(() => process.exit(0));
