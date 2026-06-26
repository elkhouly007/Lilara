#!/usr/bin/env node
"use strict";

const path = require("path");
const { stateDir, hookStateDir, instinctDir } = require("./state-paths");

const name = "tamper-floor";
const source = "tamper-floor";

// ---------------------------------------------------------------------------
// evaluateFloor(input) — ADR-050 runtime tamper floor.
//
// Pure predicate: no I/O. ADR-050 §"Implementation constraints":
//   "the floor decides on the canonical Action-IR's file targets
//    (pure inputs), like every other floor"
// Therefore the floor inspects input.targetPath ONLY — the IR's resolved
// file target. It does NOT parse input.command for path tokens (that would
// bypass the IR contract, defeat the "pure input" guarantee, and produce
// false-positives on legitimate commands whose argv merely mentions a
// protected path).
//
// Returns:
//   { fired: false }
//   | { fired: true, action: "block", reason: string }
// ---------------------------------------------------------------------------
function evaluateFloor(input) {
  if (!input) return { fired: false };

  // ADR-050: decide on the IR's resolved target. No command-token parsing.
  if (typeof input.targetPath !== "string" || input.targetPath.length === 0) {
    return { fired: false };
  }
  const candidates = [input.targetPath];

  // Build the set of protected dir prefixes (resolved, with trailing sep).
  const protectedPrefixes = _protectedPrefixes();

  for (const candidate of candidates) {
    let resolved;
    try {
      resolved = path.resolve(candidate);
    } catch {
      continue;
    }
    for (const prefix of protectedPrefixes) {
      if (_isUnderDir(resolved, prefix)) {
        return {
          fired: true,
          action: "block",
          reason: `write target '${candidate}' resolves under installed guard footprint (${prefix})`,
        };
      }
    }
  }

  return { fired: false };
}

// ---------------------------------------------------------------------------
// _protectedPrefixes — resolved directory prefixes guarded by F30.
// ---------------------------------------------------------------------------
function _protectedPrefixes() {
  return [
    path.resolve(stateDir()) + path.sep,
    path.resolve(hookStateDir()) + path.sep,
    path.resolve(instinctDir()) + path.sep,
  ];
}

// ---------------------------------------------------------------------------
// _isUnderDir — strict prefix match with path.sep boundary.
// ---------------------------------------------------------------------------
function _isUnderDir(filePath, dirPrefix) {
  const normalizedFile = filePath.replace(/[\\/]+$/, "") + path.sep;
  return normalizedFile.startsWith(dirPrefix);
}

module.exports = { name, source, evaluateFloor };
