#!/usr/bin/env node
"use strict";

// F17: cross-agent-lock floor helpers. Extracted from runtime/decision-engine.js
// (lines 786-855) by the monolith-decomposition sprint (2026-06).
//
// Pure decision read-side; the only I/O is the per-call lock-dir scan via
// readLockState() against the engine's stateDir (LILARA_STATE_DIR-aware).
// Owner identity for the current call falls back through
// input.owner → input.sessionId → discovered.sessionId so existing harness
// wiring needs no schema change.

const { readLockState: _readLockState, findConflict: _findLockConflict } = require("./cross-agent-lock");
const { stateDir: _statePathStateDir } = require("./state-paths");

function _isWriteLikeForLock(input) {
  if (!input) return false;
  const t = String(input.tool || "");
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return true;
  const irT = input.ir && input.ir.fileTargets;
  if (Array.isArray(irT)) {
    for (const ft of irT) {
      if (ft && (ft.intent === "write" || ft.intent === "delete")) return true;
    }
  }
  return false;
}
function _collectLockCandidatePaths(input) {
  const out = []; const seen = Object.create(null);
  const push = (p) => { if (typeof p === "string" && p.length > 0 && !seen[p]) { seen[p] = true; out.push(p); } };
  if (input && typeof input.targetPath === "string") push(input.targetPath);
  const irT = input && input.ir && input.ir.fileTargets;
  if (Array.isArray(irT)) for (const t of irT) if (t && (t.intent === "write" || t.intent === "delete")) push(t.path);
  const envT = input && input.envelope && input.envelope.targets;
  if (Array.isArray(envT)) for (const t of envT) if (t && typeof t.path === "string") push(t.path);
  return out;
}
function evalCrossAgentLockFloor(input, discovered, enriched) {
  if (!_isWriteLikeForLock(input)) return { fire: false };
  const owner = String(
    (input && input.owner) ||
    (input && input.sessionId) ||
    (enriched && enriched.sessionId) ||
    (discovered && discovered.sessionId) ||
    ""
  );
  const projectRoot = String((discovered && discovered.projectRoot) || (input && input.projectRoot) || "");
  const candidatePaths = _collectLockCandidatePaths(input);
  const state = _readLockState(_statePathStateDir());
  if (!state.ok && state.malformed && state.malformed.length > 0) {
    return {
      fire: true,
      reason: "lock-state-malformed",
      lockOwner: null,
      lockPath: null,
      lockProject: null,
      lockExpiresAt: null,
    };
  }
  if (!Array.isArray(state.locks) || state.locks.length === 0) return { fire: false };
  const conflict = _findLockConflict({
    owner,
    projectRoot,
    paths: candidatePaths,
    locks: state.locks,
    now: Date.now(),
  });
  if (!conflict) return { fire: false };
  const lockedPathPick = Array.isArray(conflict.paths) && conflict.paths.length > 0
    ? String(conflict.paths[0])
    : null;
  return {
    fire: true,
    reason: "conflicting-lock",
    lockOwner: conflict.owner,
    lockPath: lockedPathPick,
    lockProject: conflict.projectRoot || null,
    lockExpiresAt: conflict.expiresAt != null ? conflict.expiresAt : null,
  };
}

module.exports = { evalCrossAgentLockFloor };
