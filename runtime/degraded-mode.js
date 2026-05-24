#!/usr/bin/env node
"use strict";

// degraded-mode.js — ADR-004 PR 37B (PR-B) degraded-mode enforcement.
//
// ADR-004 says: when the tamper-evident hash chain fails verify, Lilara enters
// degraded mode. In degraded mode:
//   - no baseline-block demotion is allowed for F4, F6, F7, F15-F18.
//   - learned/auto allow routes to require-review (not allow) for write-like
//     actions; F4 operator-token demotion is suppressed entirely.
//   - write-like actions get require-review by default.
//   - every receipt + journal entry carries a degradedMode marker so audit
//     can distinguish degraded receipts from normal ones.
//
// This module is intentionally pure: `evaluate({ file })` reads the chain via
// runtime/journal-chain.verify() and returns a small descriptor. `getCached()`
// memoises one evaluation per process for the decide() hot path; tests call
// `_clearCache()` between cases. Zero new I/O paths; no enforcement happens
// here — the caller (decision-engine.js) reads the descriptor and routes.
//
// LILARA_DEGRADED_MODE env var is a forcing knob: "1" pins degraded on (used
// by tests and by an operator who wants the safer posture without a tamper
// signal); "0" pins it off (CI/test hermeticity when a chain happens to be
// present). Either explicit value short-circuits the verify() call.

const { classifyCommand } = require("./decision-key");

let _verify = null;
function _getVerify() {
  if (_verify) return _verify;
  // Lazy require to keep this module safe to import in contexts where the
  // journal-chain file system path is unavailable (unit tests of isWriteLike).
  _verify = require("./journal-chain").verify;
  return _verify;
}

// Pure evaluator. Returns:
//   { degraded: boolean, reason: string|null, source: "env"|"verify"|"verify-error" }
function evaluate(opts) {
  const o = opts || {};
  const envVal = process.env.LILARA_DEGRADED_MODE;
  if (envVal === "1") return { degraded: true,  reason: "env-override", source: "env" };
  if (envVal === "0") return { degraded: false, reason: null,           source: "env" };
  let result;
  try {
    result = _getVerify()({ file: o.file });
  } catch (err) {
    // verify() itself threw — treat as degraded (fail-closed); the operator
    // can clear via LILARA_DEGRADED_MODE=0 once they have inspected the chain.
    return {
      degraded: true,
      reason: "verify-threw:" + (err && err.message ? String(err.message) : "unknown"),
      source: "verify-error",
    };
  }
  if (!result || !result.ok) {
    const errs = result && Array.isArray(result.errors) ? result.errors : [];
    const reason = errs.length > 0 && errs[0] && errs[0].reason
      ? String(errs[0].reason)
      : "verify-failed";
    return { degraded: true, reason, source: "verify" };
  }
  return { degraded: false, reason: null, source: "verify" };
}

let _cached = null;
function getCached(opts) {
  if (_cached !== null) return _cached;
  _cached = evaluate(opts);
  return _cached;
}
function _clearCache() { _cached = null; }

// Write-like classification. Conservative enough to cover the ADR-004
// "writes route to require-review" rule without over-catching read-only
// inspection commands.
//
// Captures:
//   - file-mutating tools (Edit/Write/MultiEdit/NotebookEdit)
//   - IR fileTargets with write/delete intent
//   - non-empty envelope targets (envelope wraps a write-like exec)
//   - Bash command classes that mutate persistent state
const _WRITE_TOOL_RE = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const _WRITE_LIKE_CMD_CLASSES = new Set([
  "destructive-delete",
  "force-push",
  "remote-exec",
  "auto-download",
  "hard-reset",
  "destructive-db",
  "disk-write",
  "global-pkg-install",
]);

function isWriteLike(input) {
  if (!input) return false;
  if (_WRITE_TOOL_RE.test(String(input.tool || ""))) return true;
  const irT = input.ir && input.ir.fileTargets;
  if (Array.isArray(irT)) {
    for (let i = 0; i < irT.length; i++) {
      const ft = irT[i];
      if (ft && (ft.intent === "write" || ft.intent === "delete")) return true;
    }
  }
  const envT = input.envelope && input.envelope.targets;
  if (Array.isArray(envT) && envT.length > 0) return true;
  if (typeof input.command === "string" && input.command.length > 0) {
    const cls = classifyCommand(input.command);
    if (_WRITE_LIKE_CMD_CLASSES.has(cls)) return true;
  }
  return false;
}

// Build the additive marker that decision-engine stamps on receipts and
// journal entries when degraded mode is active. Always include `active:true`
// + `reason`; `writeRouting` is set when the engine actually flipped a
// write-like allow to require-review.
function buildMarker(state, opts) {
  if (!state || !state.degraded) return null;
  const o = opts || {};
  const marker = {
    active: true,
    reason: state.reason || "verify-failed",
  };
  if (o.writeRouting) marker.writeRouting = String(o.writeRouting);
  if (o.suppressed) marker.suppressed = String(o.suppressed);
  return marker;
}

module.exports = {
  evaluate,
  getCached,
  isWriteLike,
  buildMarker,
  _clearCache,
};
