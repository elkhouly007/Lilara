#!/usr/bin/env node
/**
 * pr-notifier.js — Lilara  (PostToolUse hook, Bash only)
 *
 * Fires after Bash tool use. Detects when `gh pr create` was run and a PR URL
 * appeared in the output, then prints a useful summary to stderr.
 *
 * SAFETY CONTRACT:
 * - Reads JSON from stdin.
 * - Echoes original input to stdout UNCHANGED.
 * - Writes notifications to stderr only.
 * - Inspects only output metadata (capped at 2000 chars) — not prompts or file content.
 * - No external packages, no network calls.
 * - Silent fail on errors.
 */

"use strict";

const PR_URL_PATTERN = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/(\d+)/;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
  });
}

function extractOutput(input) {
  // Try known output field names — limit to 2000 chars for safety.
  const raw =
    input.output ??
    input.tool_result ??
    input.result ??
    null;

  if (typeof raw === "string") return raw.slice(0, 2000);
  if (raw != null && typeof raw === "object") {
    // Shallow stringify — avoid deep traversal of large payloads.
    try {
      return JSON.stringify(raw).slice(0, 2000);
    } catch {
      return "";
    }
  }
  return "";
}

readStdin()
  .then((raw) => {
    // Always echo input unchanged first.
    process.stdout.write(raw || "");
    if (process.env.LILARA_KILL_SWITCH === "1") return;

    try {
      const input = JSON.parse(raw || "{}");
      const toolName = typeof input.tool_name === "string" ? input.tool_name : "";

      // Only act on Bash tool events.
      if (toolName !== "Bash") return;

      const output = extractOutput(input);
      if (!output) return;

      const match = PR_URL_PATTERN.exec(output);
      if (!match) return;

      const url = match[0];
      const number = match[1];

      process.stderr.write(
        `[Lilara] PR created: ${url}\n` +
        `  Review:  gh pr view ${number} --web\n` +
        `  Checks:  gh pr checks ${number}\n`
      );
    } catch {
      // Malformed input — do not block.
    }
  })
  .catch(() => process.exit(0));
