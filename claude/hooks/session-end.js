#!/usr/bin/env node
/**
 * session-end.js — Lilara  (Stop hook)
 *
 * Fires when Claude Code signals the session is stopping.
 * Captures METADATA ONLY — never session content, prompts, or payloads.
 *
 * SAFETY CONTRACT (must match claude/SECURITY_MODEL.md):
 * - Reads JSON from stdin.
 * - Echoes original input to stdout UNCHANGED.
 * - Writes observations to stderr only (visible to user, not to model).
 * - Writes one candidate instinct to ~/.lilara/instincts/pending.json.
 * - No external packages, no network calls, no access to file content.
 * - Does NOT auto-promote. Ahmed must manually promote via /instinct-status.
 *
 * What IS captured (safe metadata):
 *   - tool names that appeared in the event (e.g. "Bash", "Edit", "Write")
 *   - top-level event_type field
 *   - session timestamp
 *
 * What is NEVER captured:
 *   - prompt text or assistant responses
 *   - file contents read or written
 *   - command arguments or outputs
 *   - API keys, tokens, secrets
 *   - personal or confidential data
 */

"use strict";

const utils = require("./instinct-utils");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
  });
}

/**
 * Extract safe metadata from the hook payload.
 * Strictly limits depth and only reads known top-level keys.
 */
function extractSafeMetadata(input) {
  // Only read known safe, non-content fields.
  const tool_name  = typeof input.tool_name  === "string" ? input.tool_name.slice(0, 64)  : "unknown";
  const event_type = typeof input.event_type === "string" ? input.event_type.slice(0, 64) : "Stop";
  // Intentionally do NOT read: input, output, content, prompt, result, args, command, file_path
  return { tool_name, event_type };
}

readStdin()
  .then((raw) => {
    // Always echo input unchanged — harness requires this.
    process.stdout.write(raw || "");
    if (process.env.LILARA_KILL_SWITCH === "1") return;

    let input = {};
    try {
      input = JSON.parse(raw || "{}");
    } catch {
      // Malformed input — skip instinct capture but do not block.
      return;
    }

    const meta = extractSafeMetadata(input);

    // Build a candidate instinct with placeholder trigger/behavior.
    // Ahmed fills in the human-readable description when reviewing pending instincts.
    const instinct = utils.createInstinct({
      tool_name:  meta.tool_name,
      event_type: meta.event_type,
      trigger:    "(review pending — fill in trigger before promoting)",
      behavior:   "(review pending — fill in behavior before promoting)",
      outcome:    "neutral",
    });

    utils.appendPending(instinct);

    // Inform user via stderr — not visible to model, not blocking.
    const s = utils.summary();
    process.stderr.write(
      `[Lilara] Session end recorded.\n` +
      `  Instincts: ${s.pending} pending (${s.candidates} ready to review), ${s.confident} confident.\n` +
      `  Run /instinct-status to review and promote candidates.\n` +
      (s.expiringSoon > 0
        ? `  ⚠ ${s.expiringSoon} instinct(s) expire within 7 days — run /prune to clean up.\n`
        : "")
    );
  })
  .catch(() => {
    // Silent fail — hooks must never crash the harness.
    process.exit(0);
  });
