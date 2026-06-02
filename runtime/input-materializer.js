#!/usr/bin/env node
"use strict";

// input-materializer.js — ADR-031: trust-boundary materialization gate for decide().
//
// Produces a plain, getter-free, null-safe copy of the `input` object at
// decide() entry so every downstream read in the engine and receipt builders
// sees a safe value.  Called once per decide() call, immediately after the
// kill-switch early-return.
//
// Materialization contract:
//
//   VALUE-FAITHFUL — for a well-formed plain-object input (no getters, no Proxy,
//   no exotic prototype — the shape every real call site and every corpus entry
//   uses) materialization is value-identical.  irHash and every engine decision
//   are byte-for-byte unchanged.  The check-replay-corpus.sh gate is the arbiter.
//
//   GETTER-SAFE — each own property is read inside an individual try/catch.  A
//   throwing getter is treated as absent (key skipped), not as a crash.
//
//   TYPE-NORMALIZED — known security-critical fields are coerced to their expected
//   type.  Wrong-typed values are coerced or removed; they never reach a load-bearing
//   read site unguarded.
//
//   UNKNOWN FIELDS PRESERVED — unknown caller fields are included in the copy so
//   Object.entries(input) at engine :990 includes them in `explicit` → `enriched`
//   (policy / contract flow).
//
//   NESTED OBJECTS BY REFERENCE — known object-typed fields (ir, envelope, …) are
//   type-guarded to object-or-null but NOT deep-cloned.  Floors access values by
//   property, not identity; sharing the reference is value-identical.  If a nested
//   property has a throwing getter the floor's own outer try/catch (ADR-025) routes
//   the throw to require-review — fail-safe even without deep materialization.
//
//   NEVER THROWS — every dangerous access is guarded.  If the function itself
//   somehow throws, decide()'s caller-level guard routes to require-review.
//
// Zero external dependencies.

// Known object-typed fields (type-guard to plain-object-or-null, no deep clone).
const _OBJECT_FIELDS = [
  "ir", "envelope", "observedEnvelope", "tool_input",
  "args", "params", "arguments", "input", "trustMeta",
];

// Known array-typed fields (type-guard to array-or-null).
const _ARRAY_FIELDS = [
  "dnsResolutions", "observedConnectedIps", "outputChannels",
];

// Known numeric fields.
const _NUMERIC_FIELDS = ["sessionRisk", "repeatedApprovals"];

// Known boolean fields.
const _BOOL_FIELDS = ["dryRun", "enforceEnvDiff"];

// Known string fields (null/absent stays absent; wrong type → String() coerced).
const _STRING_FIELDS = [
  "command", "tool", "harness", "targetPath", "branch",
  "projectRoot", "configPath", "notes", "content", "new_string",
  "mcpServer", "skillName", "payloadClass", "pathSensitivity", "primaryStack",
];

function materializeInput(rawInput) {
  const safe = {};

  // Null, undefined, or primitive — return empty safe shell.
  // The engine treats absent fields as absent; command="" → low-risk outcome.
  if (rawInput == null || typeof rawInput !== "object") {
    return safe;
  }

  // Enumerate own enumerable keys.  If the key-enumeration trap throws (Proxy),
  // fall through with an empty safe object.
  let keys;
  try { keys = Object.keys(rawInput); } catch { return safe; }

  // Copy each property in its own try/catch so a throwing getter skips only
  // that key instead of aborting the whole materialization pass.
  for (const k of keys) {
    let v;
    try { v = rawInput[k]; } catch { continue; }
    safe[k] = v;
  }

  // ── String fields ─────────────────────────────────────────────────────────
  // Absent / null → leave absent (engine uses || "" fallbacks internally).
  // Non-string non-null → coerce; if coercion throws → delete.
  for (const k of _STRING_FIELDS) {
    if (!(k in safe) || safe[k] == null) continue;
    if (typeof safe[k] !== "string") {
      try { safe[k] = String(safe[k]); } catch { delete safe[k]; }
    }
  }

  // ── Numeric fields ────────────────────────────────────────────────────────
  for (const k of _NUMERIC_FIELDS) {
    if (!(k in safe) || safe[k] == null) continue;
    const n = Number(safe[k]);
    if (Number.isFinite(n)) { safe[k] = n; }
    else { delete safe[k]; }
  }

  // ── Boolean fields ────────────────────────────────────────────────────────
  for (const k of _BOOL_FIELDS) {
    if (k in safe && safe[k] != null) safe[k] = Boolean(safe[k]);
  }

  // ── Object-typed fields ───────────────────────────────────────────────────
  // A plain object (including null) is kept as-is.  Any other type → null so
  // the engine's `input.x || null` patterns degrade safely.
  for (const k of _OBJECT_FIELDS) {
    if (!(k in safe)) continue;
    const v = safe[k];
    if (v === null) continue;                         // explicit null — keep
    if (typeof v === "object" && !Array.isArray(v)) continue; // plain object — keep
    safe[k] = null;                                   // wrong type → null
  }

  // ── Array-typed fields ────────────────────────────────────────────────────
  for (const k of _ARRAY_FIELDS) {
    if (!(k in safe)) continue;
    if (!Array.isArray(safe[k])) safe[k] = null;
  }

  return safe;
}

module.exports = { materializeInput };
