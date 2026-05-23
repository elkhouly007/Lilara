#!/usr/bin/env node
/**
 * strategic-compact.js — Lilara  (PostToolUse hook)
 *
 * Fires after every tool use. Tracks a lightweight call counter and suggests
 * /compact when the context window may be filling up.
 *
 * SAFETY CONTRACT:
 * - Reads JSON from stdin.
 * - Echoes original input to stdout UNCHANGED.
 * - Writes hints to stderr only.
 * - No external packages, no network calls, no file content access.
 * - Silent fail on errors.
 *
 * Counter file is stored under ~/.lilara/ (not /tmp/) to avoid the Linux
 * /tmp symlink attack: any local user can pre-create a symlink at a known
 * /tmp path and redirect writes to an arbitrary file.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { readStdin, hookLog } = require("./hook-utils");
const { hookStateDir }       = require("../../runtime/state-paths");

// User-private directory — not world-writable like /tmp.
const LILARA_DIR      = hookStateDir();
const COUNTER_FILE = path.join(LILARA_DIR, "session-counter.json");

const EXPENSIVE_TOOLS = new Set(["Agent", "WebFetch", "WebSearch"]);

function ensureDir() {
  try {
    fs.mkdirSync(LILARA_DIR, { recursive: true, mode: 0o700 });
  } catch {
    // Already exists or permission denied — handled silently below.
  }
}

function readCounter() {
  try {
    const raw = fs.readFileSync(COUNTER_FILE, "utf8");
    const obj = JSON.parse(raw);
    return typeof obj.count === "number" ? obj.count : 0;
  } catch {
    return 0;
  }
}

function writeCounter(count) {
  try {
    ensureDir();
    fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count }), { encoding: "utf8", mode: 0o600 });
  } catch {
    // Silent — counter write failure must not block.
  }
}

function shouldSuggest(count, toolName) {
  if (EXPENSIVE_TOOLS.has(toolName)) {
    return { suggest: true, reason: `${toolName} is a high-context operation` };
  }
  if (count === 50)  return { suggest: true, reason: "50 tool calls in this session" };
  if (count === 100) return { suggest: true, reason: "100 tool calls — context may be large" };
  if (count > 100 && count % 25 === 0) {
    return { suggest: true, reason: `${count} tool calls — context is growing` };
  }
  return { suggest: false };
}

readStdin()
  .then((raw) => {
    // Always echo input unchanged first.
    process.stdout.write(raw || "");
    if (process.env.LILARA_KILL_SWITCH === "1") return;

    try {
      const input    = JSON.parse(raw || "{}");
      const toolName = typeof input.tool_name === "string" ? input.tool_name.slice(0, 64) : "";

      const count = readCounter() + 1;
      writeCounter(count);

      const { suggest, reason } = shouldSuggest(count, toolName);
      if (suggest) {
        hookLog("strategic-compact", "INFO", `suggestion-fired count=${count}`);
        process.stderr.write(
          `[Lilara] Context hint: consider /compact — ${reason}. Call count: ${count}.\n`
        );
      }
    } catch {
      // Malformed input or counter error — do not block.
    }
  })
  .catch(() => process.exit(0));
