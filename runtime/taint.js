#!/usr/bin/env node
"use strict";

/**
 * taint.js — Provenance/taint tracker for indirect prompt-injection defense.
 *
 * PostToolUse hooks call recordExternalRead() to annotate tool results that
 * came from external sources (browser, MCP, web-fetch, curl/wget output).
 * PreToolUse hooks (via decision-engine.js) call correlateCommand() to check
 * whether the next N tool calls overlap with recent external reads.
 *
 * When a match is found, the decision engine raises the action to require-review
 * via the taint floor (F10) regardless of the baseline risk score.
 *
 * Provenance entries are stored in ~/.lilara/provenance-window.json with a 5-minute
 * hard TTL and a 60-second correlation window used by correlateCommand().
 *
 * Zero external dependencies.
 */

const { recordExternalRead: _record, getProvenanceWindow } = require("./session-context");
const { correlate } = require("./provenance-correlator");
const { loadProjectPolicy } = require("./project-policy");
const { redact } = require("./secret-scan"); // ADR-045: symmetric correlate-side redaction

const DEFAULT_WINDOW_SECONDS = 60;

/**
 * Record that a tool result came from an external source.
 * Called by PostToolUse hooks when browser, MCP, web-fetch, or network
 * curl/wget output is received.
 *
 * @param {string} content — the external content (truncated to 4096 chars by session-context)
 * @param {string} source  — label: "browser" | "mcp" | "web-fetch" | "curl" | "external"
 */
function recordExternalRead(content, source) {
  _record(content, source);
}

/**
 * Correlate a shell command against recently-read external content.
 * Returns { tainted: true, reason, source, matchedToken? } when overlap found,
 * or { tainted: false } when the command appears unrelated to external reads.
 *
 * Read-only tools (Read, Grep, Glob, LS, NotebookRead and any added to
 * taint.safeToolClasses in lilara.config.json) bypass correlation — they cannot
 * execute injected payloads, so firing F10 on them produces only noise (D37).
 *
 * @param {string} command         — shell command to check
 * @param {number} [windowSeconds] — correlation window in seconds (default: 60)
 * @param {string} [toolName]      — tool being invoked (used for safe-class filter)
 */
function correlateCommand(command, windowSeconds, toolName) {
  const recentReads = getProvenanceWindow(windowSeconds || DEFAULT_WINDOW_SECONDS);
  const policy = loadProjectPolicy({});
  if (toolName && (policy.taintSafeToolClasses || []).includes(toolName)) {
    return { tainted: false };
  }
  // ADR-045: symmetric command-side redaction. When taint-window redaction is
  // enabled (default ON), the stored window content was already run through
  // redact() at write time. Redacting the command here with the same function
  // preserves injection-token matching (non-secret tokens like curl/evil.com
  // are unchanged by redact()) while ensuring that a genuine secret value shared
  // between an external read and a command still produces a placeholder-vs-
  // placeholder match — F10 stays tainted:true (fail-safe, never fails open).
  const effectiveCommand = process.env.LILARA_TAINT_WINDOW_REDACT !== "0"
    ? redact(String(command || ""))
    : String(command || "");
  return correlate(effectiveCommand, recentReads, policy.taintMinTokenLength);
}

module.exports = { recordExternalRead, correlateCommand };
