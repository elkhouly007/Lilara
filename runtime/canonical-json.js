#!/usr/bin/env node
"use strict";

// canonical-json.js — Deterministic JSON stringify for contract hashing.
//
// Recursively sorts object keys so the same logical document always produces
// the same byte string regardless of insertion order. Handles: null, boolean,
// number, string, array, plain object. Rejects: functions, undefined, symbols.
// Zero external dependencies.
//
// ADR-021 (canonical-json-depth-cap): bounded recursion.  Deep nesting would
// previously stack-overflow the Node process — killing it and leaving the gate
// unprotected.  The cap is set at 64, measured against the deepest legitimate
// use across 225 corpus entries:
//
//   max IR depth     = 4  (F3:rm-rf-tmp)
//   max receipt depth = 5  (f16 envelope-targets entry)   ← baseline
//
// Cap = 64 = 12.8 × baseline ≥ 10 × baseline (the required precondition).
// Re-measure before raising the cap: run the depth-measurement script in
// scripts/measure-canonical-json-depth.js against the current corpus.
//
// On cap-exceed: throws RangeError("canonicalJson: depth limit exceeded").
// Callers that construct the security receipt or IR hash already operate
// inside try/catch blocks that route to fail-safe outcomes; the cap converts
// a stack-overflow DoS into a controlled clean throw so the gate can still
// apply its severity-fallback logic (pattern, secret, path-sensitivity).

const _DEPTH_LIMIT = 64;

function _canonicalJsonInner(value, depth) {
  if (depth > _DEPTH_LIMIT) {
    throw new RangeError(
      `canonicalJson: depth limit exceeded (>${_DEPTH_LIMIT}); ` +
      "possible adversarial nesting or runaway data structure"
    );
  }
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean" || t === "number") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => _canonicalJsonInner(v, depth + 1)).join(",") + "]";
  }
  if (t === "object") {
    const keys = Object.keys(value).sort();
    const pairs = keys
      .filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + _canonicalJsonInner(value[k], depth + 1));
    return "{" + pairs.join(",") + "}";
  }
  throw new TypeError(`canonicalJson: unsupported type ${t}`);
}

function canonicalJson(value) {
  return _canonicalJsonInner(value, 1);
}

module.exports = { canonicalJson };
