#!/usr/bin/env node
"use strict";

// input-materializer.js — ADR-031: trust-boundary materialization gate for decide().
//
// Produces a plain, null-safe copy of the `input` object at decide() entry so
// every engine-level UNGUARDED read sees a safe value, while preserving any
// throwing-getter semantics on floor-internal reads (so ADR-022's fail-closed
// catches in F25/F26/F18/etc. still route to require-review).
//
// Two design constraints simultaneously:
//
//   ADR-031 — engine-unguarded reads must not crash decide().  `input.command`
//   at :1072, `input.harness` at :1101, `input.payloadClass` at :1141, the F15
//   envelope gate at :1348, `input.tool` in F4 at :1896, the discover/
//   Object.entries calls at :989-991, and the enriched reads at :1004-1006 all
//   sit OUTSIDE any try/catch.  A throwing getter on any of these propagates
//   to pretool-gate.js:281-282 → exit 0 = allow (fail-OPEN bypass).
//   FIX: silently swallow throws on those keys; leave the property absent so
//   the engine's `||""` / `!= null` fallbacks apply.
//
//   ADR-022 — F25/F26 (and F16/F17/F18/F23/etc.) have their own outer
//   try/catch that routes to require-review on any internal-error.  The
//   adversarial tests T15/T16 in mcp-floor-adversarial.test.js construct a
//   non-enumerable throwing getter on `arguments`/`content` and assert that
//   F25/F26's catch fires.  If the materializer silently swallows those
//   throws and emits an `absent` key, the floor sees no danger and falls
//   through to allow — fail-CLOSED → fail-OPEN regression.
//   FIX: preserve the throwing getter as a forwarding getter on the safe copy.
//   The floor's own read still throws, its own catch still routes to review.
//
// Zero external dependencies.

// Engine-unguarded reads — the ADR-031 surface.  A throwing getter on any of
// these reaches code with no try/catch and would crash decide() pre-fix.
// On materialization, throws on these keys are SWALLOWED; key left absent.
const _ENGINE_UNGUARDED_KEYS = new Set([
  "command",            // _classifyCommandDual @ :1072 — load-bearing
  "harness",            // String(input.harness) F5 @ :1101
  "payloadClass",       // F11 @ :1141
  "envelope",           // F15 gate @ :1348, receipts @ :269/:359/:2277
  "tool",               // F4 MCP @ :1896
  "repeatedApprovals",  // enriched @ :1004
  "sessionRisk",        // enriched @ :1005 → F9
  "branch",             // enriched @ :1006
  "dryRun",             // @ :1055
]);

// Type-normalization targets.

// String fields — null/absent stays absent; wrong type → String() coerced.
const _STRING_FIELDS = [
  "command", "tool", "harness", "targetPath", "branch",
  "projectRoot", "configPath", "notes", "content", "new_string",
  "mcpServer", "skillName", "payloadClass", "pathSensitivity", "primaryStack",
];

// Numeric fields.
const _NUMERIC_FIELDS = ["sessionRisk", "repeatedApprovals"];

// Boolean fields.
const _BOOL_FIELDS = ["dryRun", "enforceEnvDiff"];

// Object-typed fields — type-guard to plain-object-or-null.
//
// dnsResolutions is a `{ hostname → { ok, ips, code } }` dict
// (network-egress.js:417); outputChannels is a frozen `{ toolOutput, ... }`
// record (action-ir.js:125). Both are objects, NOT arrays — an earlier
// mis-classification regressed F18 FC#4 (fc4-dns-failure-deny-default fixture).
//
// NOT in this list: tool_input, args, params, arguments, input, content,
// new_string, edits — F25/F26 handle arbitrary shapes safely and have their
// own fail-closed catches (ADR-022).  Leaving them untouched preserves
// throwing-getter semantics so F25/F26 can still route to require-review.
const _OBJECT_FIELDS = [
  "ir", "envelope", "observedEnvelope", "trustMeta",
  "dnsResolutions", "outputChannels",
];

// Array-typed fields.
// observedConnectedIps IS an array — engine :1360 guards with Array.isArray.
const _ARRAY_FIELDS = [
  "observedConnectedIps",
];

function materializeInput(rawInput) {
  const safe = {};

  // Null / undefined / primitive → return empty safe shell.
  if (rawInput == null || typeof rawInput !== "object") return safe;

  // Enumerate own property names — INCLUDING non-enumerable.  Non-enumerable
  // own props are how the ADR-022 adversarial tests inject throwing getters
  // (so Object.entries(input) at :990 doesn't iterate them, but direct
  // property access inside F25/F26 still fires the getter).  We must SEE
  // them here so we can forward throws via Object.defineProperty.
  let keys;
  try { keys = Object.getOwnPropertyNames(rawInput); } catch { return safe; }

  for (const k of keys) {
    let v;
    let getterErr = null;
    try { v = rawInput[k]; }
    catch (e) { getterErr = e == null ? new Error("input getter threw") : e; }

    if (getterErr !== null) {
      // Engine-unguarded read: swallow.  The engine's `||""` / `!= null`
      // fallbacks treat absent keys as default values — safe.
      if (_ENGINE_UNGUARDED_KEYS.has(k)) continue;

      // Floor-internal read: preserve the throw via a forwarding getter so
      // ADR-022's fail-closed catches in F25/F26/F18/etc. still fire.
      // enumerable:false mirrors the test setup (Object.entries skips it).
      try {
        Object.defineProperty(safe, k, {
          get() { throw getterErr; },
          enumerable: false,
          configurable: true,
        });
      } catch { /* defineProperty rejected — leave key absent (still safe) */ }
      continue;
    }

    safe[k] = v;
  }

  // ── Type-normalization passes ─────────────────────────────────────────────
  // Only operate on plain data properties.  Throwing-getter forwards installed
  // above are non-enumerable; `k in safe` is true (since defineProperty), but
  // accessing safe[k] would re-throw and break the floors' contract.
  // Filter out forwarded throwing getters by skipping non-enumerable own props
  // that resolve via getter (`getOwnPropertyDescriptor(safe, k).get`).
  function _isDataProp(k) {
    const d = Object.getOwnPropertyDescriptor(safe, k);
    return d && !d.get && !d.set;
  }

  // String fields
  for (const k of _STRING_FIELDS) {
    if (!(k in safe) || !_isDataProp(k) || safe[k] == null) continue;
    if (typeof safe[k] !== "string") {
      try { safe[k] = String(safe[k]); } catch { delete safe[k]; }
    }
  }

  // Numeric fields
  for (const k of _NUMERIC_FIELDS) {
    if (!(k in safe) || !_isDataProp(k) || safe[k] == null) continue;
    const n = Number(safe[k]);
    if (Number.isFinite(n)) safe[k] = n;
    else delete safe[k];
  }

  // Boolean fields
  for (const k of _BOOL_FIELDS) {
    if (!(k in safe) || !_isDataProp(k)) continue;
    if (safe[k] != null) safe[k] = Boolean(safe[k]);
  }

  // Object-typed fields — plain object or null; wrong type → null.
  for (const k of _OBJECT_FIELDS) {
    if (!(k in safe) || !_isDataProp(k)) continue;
    const v = safe[k];
    if (v === null) continue;
    if (typeof v === "object" && !Array.isArray(v)) continue;
    safe[k] = null;
  }

  // Array-typed fields — array or null.
  for (const k of _ARRAY_FIELDS) {
    if (!(k in safe) || !_isDataProp(k)) continue;
    if (!Array.isArray(safe[k])) safe[k] = null;
  }

  return safe;
}

module.exports = { materializeInput };
