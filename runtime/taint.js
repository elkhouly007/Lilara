#!/usr/bin/env node
"use strict";

/**
 * taint.js — Provenance/taint tracker for indirect prompt-injection defense.
 *
 * PostToolUse hooks call recordExternalRead() to annotate tool results that
 * came from external sources (browser, MCP, web-fetch, curl/wget output).
 * PreToolUse hooks (via decision-engine.js) call correlateCommandPure() to check
 * whether the pending tool call overlaps with recent external reads.
 *
 * When a match is found, the decision engine raises the action to require-review
 * via the taint floor (F10) regardless of the baseline risk score.
 *
 * Provenance entries are stored in ~/.lilara/provenance-window.json with a 5-minute
 * hard TTL. ADR-046: the 60-second correlation window is loaded at the impure
 * boundary (pretool-gate.js via session-context.getProvenanceWindow) and injected
 * into decide() as input.provenanceWindow — correlateCommandPure() is disk-free so
 * decide() stays cross-call-pure and byte-identical-replayable.
 *
 * Zero external dependencies.
 */

const { recordExternalRead: _record } = require("./session-context");
const { correlate } = require("./provenance-correlator");
const { redact } = require("./secret-scan"); // ADR-045 symmetric redaction (used by correlateCommandPure)

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
 * Correlate a pending command against recently-read external content (ADR-046).
 *
 * Pure: the caller — the impure boundary (pretool-gate.js / operator tools), or
 * decide() via the injected `input.provenanceWindow` — supplies BOTH the
 * already-loaded window AND the taint policy. NO disk read, NO loadProjectPolicy,
 * so decide() can run F10 without touching disk (cross-call purity).
 *
 * Read-only tools (Read, Grep, Glob, LS, NotebookRead and any added to
 * taint.safeToolClasses in lilara.config.json) bypass correlation — they cannot
 * execute injected payloads, so firing F10 on them produces only noise (D37).
 *
 * Returns { tainted: true, reason, source, matchedToken? } when overlap found,
 * or { tainted: false } when the command appears unrelated to external reads.
 *
 * ADR-045 symmetric redaction is preserved through the ADR-046 injection refactor:
 * the injected window was already redact()-ed at rest on the write side
 * (session-context.recordExternalRead). Redacting the command here with the same
 * function under the same env gate keeps the comparison placeholder-vs-placeholder,
 * so a genuine secret shared between an external read and a command still fires F10
 * (fail-safe). Non-secret tokens are unchanged by redact() and still match. redact()
 * is a pure regex scrubber (no disk, no clock) → decide() cross-call purity intact.
 *
 * @param {string} command       — shell command to check
 * @param {Array}  recentReads   — provenance window: [{ content, source, ts }]
 * @param {string} [toolName]    — tool being invoked (safe-class filter)
 * @param {object} [taintPolicy] — { taintSafeToolClasses, taintMinTokenLength }
 */
function correlateCommandPure(command, recentReads, toolName, taintPolicy) {
  const safeClasses = (taintPolicy && taintPolicy.taintSafeToolClasses) || [];
  if (toolName && safeClasses.includes(toolName)) {
    return { tainted: false };
  }
  const effectiveCommand = process.env.LILARA_TAINT_WINDOW_REDACT !== "0"
    ? redact(String(command || ""))
    : String(command || "");
  return correlate(
    effectiveCommand,
    Array.isArray(recentReads) ? recentReads : [],
    taintPolicy && taintPolicy.taintMinTokenLength,
  );
}

module.exports = { recordExternalRead, correlateCommandPure };
