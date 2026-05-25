#!/usr/bin/env node
/**
 * error-recovery.js — Lilara  (PostToolUse hook, all tools)
 *
 * Fires after every tool use. Inspects tool output for failure signals and
 * emits categorized recovery coaching on stderr.
 *
 * Failure categories:
 *   permission-denied  — "Permission denied", "EACCES", "EPERM"
 *   not-found          — "No such file or directory", "ENOENT", "command not found", "not found"
 *   syntax-error       — "SyntaxError", "ParseError", "unexpected token"
 *   network-timeout    — "ECONNREFUSED", "ETIMEDOUT", "network timeout", "ERR_NETWORK"
 *   oom                — "Cannot allocate memory", "ENOMEM", "OOM", "out of memory"
 *
 * Observation-only: never blocks, never modifies output.
 *
 * SAFETY CONTRACT:
 * - Reads JSON from stdin.
 * - Echoes original input to stdout UNCHANGED.
 * - Writes recovery coaching to stderr only.
 * - Inspects only output text (capped at 1000 chars) — not prompts.
 * - No external packages, no network calls.
 * - Silent fail on errors.
 */

"use strict";

const { readStdin, hookLog } = require("./hook-utils");

const CATEGORIES = [
  {
    name: "permission-denied",
    patterns: [/permission denied/i, /EACCES/i, /EPERM/i, /\bOperation not permitted\b/i],
    coaching:
      "Permission denied. Try: (1) check file ownership with `ls -la`; " +
      "(2) use `sudo` if appropriate; (3) verify your user has write access to the target directory.",
  },
  {
    name: "not-found",
    patterns: [/no such file or directory/i, /ENOENT/i, /command not found/i, /\bnot found\b/],
    coaching:
      "File or command not found. Try: (1) check the path with `ls` or `which`; " +
      "(2) verify the file was created or the dependency installed; " +
      "(3) check for typos in the path or command name.",
  },
  {
    name: "syntax-error",
    patterns: [/SyntaxError/i, /ParseError/i, /unexpected token/i, /parse error/i, /\bsyntax error\b/i],
    coaching:
      "Syntax error. Try: (1) read the error line number and column; " +
      "(2) check for missing brackets, quotes, or semicolons near that line; " +
      "(3) run the file through a linter (`eslint`, `python -m py_compile`, `rustc --edition 2021`).",
  },
  {
    name: "network-timeout",
    patterns: [/ECONNREFUSED/i, /ETIMEDOUT/i, /network timeout/i, /ERR_NETWORK/i, /\bconnection refused\b/i],
    coaching:
      "Network connection failed. Try: (1) verify the service is running (`ps aux | grep <name>`); " +
      "(2) check the host and port are correct; " +
      "(3) confirm no firewall or proxy is blocking the connection.",
  },
  {
    name: "oom",
    patterns: [/Cannot allocate memory/i, /ENOMEM/i, /\bOOM\b/, /out of memory/i, /kill.*process/i],
    coaching:
      "Out of memory. Try: (1) reduce batch size or chunk the operation; " +
      "(2) free memory with `free -h` and close unused processes; " +
      "(3) consider streaming instead of loading the entire dataset.",
  },
];

/** Extract text from PostToolUse output fields (capped). */
function outputText(input) {
  const raw =
    input.tool_response?.output ??
    input.tool_response?.stderr ??
    input.tool_response ??
    input.output ??
    input.result ??
    null;
  if (typeof raw === "string") return raw.slice(0, 1000);
  if (raw != null && typeof raw === "object") {
    try { return JSON.stringify(raw).slice(0, 1000); } catch {}
  }
  return "";
}

/** Detect non-zero exit code. */
function hasFailed(input) {
  const exitCode =
    input.tool_response?.exit_code ??
    input.tool_response?.returncode ??
    input.exit_code ??
    null;
  return exitCode != null && exitCode !== 0 && exitCode !== "0";
}

readStdin()
  .then((raw) => {
    process.stdout.write(raw || "");
    if (process.env.LILARA_KILL_SWITCH === "1") return;

    try {
      const input = JSON.parse(raw || "{}");
      const text  = outputText(input);
      const failed = hasFailed(input);

      if (!text && !failed) return;

      for (const cat of CATEGORIES) {
        if (cat.patterns.some((re) => re.test(text))) {
          hookLog("error-recovery", "INFO", `category=${cat.name}`);
          process.stderr.write(
            `[Lilara] Recovery hint (${cat.name}): ${cat.coaching}\n`
          );
          return; // emit first matching category only
        }
      }

      // Generic failure: non-zero exit but no recognizable pattern
      if (failed) {
        hookLog("error-recovery", "INFO", "category=generic-failure");
        process.stderr.write(
          `[Lilara] The previous command failed. Read the full error output above, identify the root cause, and fix it directly rather than retrying the same command unchanged.\n`
        );
      }
    } catch {}
  })
  .catch(() => process.exit(0));
