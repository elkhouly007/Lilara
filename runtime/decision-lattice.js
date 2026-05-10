#!/usr/bin/env node
"use strict";

// decision-lattice.js — Declarative precedence lattice for decision-engine.
//
// HAP ADR-007 / scope §4.1 invariant 10: every floor declares its rung,
// action, demotability, and source tag in one place. This file is the
// source of truth for ORDERING + DEMOTABILITY + FIXTURE IDENTITY of the
// floors that decision-engine.js implements imperatively. PR-A introduces
// the table only — decision-engine.js is unchanged in this PR; PR-C will
// switch its string literals to read from LATTICE.
//
// Pure data + tiny helpers. Zero I/O. Zero external dependencies.
//
// Rung 0 is reserved for the Hard Ethical Core (Layer 1) which lands in
// HAP v1.0; the entry exists here so the table position is stable, but
// `predicateRef: "reserved"` documents that no engine code consumes it yet.
//
// The rung numbers reflect CODE REALITY in decision-engine.js as of
// master @ feat(f18) — they are the documented precedence as it actually
// fires today. If the documented order ever diverges from code, the fix
// is to update this table (and ARCHITECTURE.md from it), never to silently
// reorder code (scope §4.1 invariant 10).

const LATTICE_VERSION = "1";

// Each entry shape:
//   {
//     id              : string       // floor id (F1..F18, or stable name)
//     rung            : number       // strictly increasing across the table
//     name            : string       // human-readable
//     action          : string       // canonical decision verb when this fires
//     source          : string|string[] // decisionSource tag(s) used in engine
//     demotableBy     : string[]     // empty = non-demotable; entries are
//                                    // explicit demotion paths (operator-token,
//                                    // contract-allow, learned-allow, ...)
//     predicateRef    : string       // file:symbol reference (informational)
//     notes           : string|null  // edge-case prose
//   }

const LATTICE = Object.freeze([
  Object.freeze({
    id: "L1",
    rung: 0,
    name: "hard-ethical-core",
    action: "block",
    source: "hard-ethical-core",
    demotableBy: [],
    predicateRef: "reserved",
    notes: "Reserved for HAP v1.0 ethical core; not yet engine-baked.",
  }),
  Object.freeze({
    id: "F1",
    rung: 1,
    name: "kill-switch",
    action: "block",
    source: "kill-switch",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(HORUS_KILL_SWITCH)",
    notes: "Fires unconditionally when HORUS_KILL_SWITCH=1.",
  }),
  Object.freeze({
    id: "F2",
    rung: 2,
    name: "contract-hash-mismatch",
    action: "block",
    source: "contract-floor",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(contract.verify)",
    notes: "Strict mode only (HORUS_CONTRACT_REQUIRED=1).",
  }),
  Object.freeze({
    id: "F5",
    rung: 3,
    name: "strict-gated-no-cover",
    action: "block",
    source: "harness-out-of-scope",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(harnessInScope)",
    notes: "Strict mode + gated class + harness not in contract.harnessScope.",
  }),
  Object.freeze({
    id: "F11",
    rung: 4,
    name: "validity-window",
    action: "block",
    source: "contract-floor",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(isInActiveWindow)",
    notes: "Outside activeHoursUtc/activeDays AND payloadClass action != allow.",
  }),
  Object.freeze({
    id: "F12",
    rung: 5,
    name: "mcp-deny",
    action: "block",
    source: "contract-floor",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(getMcpPolicy)",
    notes: "scopes.mcp[<server>] = 'block'.",
  }),
  Object.freeze({
    id: "F13",
    rung: 6,
    name: "skill-deny",
    action: "block",
    source: "contract-floor",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(getSkillPolicy)",
    notes: "scopes.skills[<name>] = 'block'.",
  }),
  Object.freeze({
    id: "F14",
    rung: 7,
    name: "budget-exceeded",
    action: "block",
    source: "contract-floor",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(getBudgetLimits)",
    notes: "scopes.budget.maxDestructiveOps or maxExternalBytes hit.",
  }),
  Object.freeze({
    id: "F3",
    rung: 8,
    name: "critical-risk",
    action: "block",
    source: "risk-engine",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(risk.level=='critical')",
    notes: null,
  }),
  Object.freeze({
    id: "F8",
    rung: 9,
    name: "protected-branch",
    action: "require-review",
    source: "risk-engine",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(risk.reasons:protected-branch)",
    notes: "B4: protected-branch require-review is not demotable by contract-allow.",
  }),
  Object.freeze({
    id: "F4",
    rung: 10,
    name: "secret-class-C",
    action: "block",
    source: ["secret-class-C", "f4-class-c-demoted"],
    demotableBy: ["operator-token:class-c-review-demote"],
    predicateRef: "runtime/decision-engine.js:decide(payloadClass=='C'||scanSecrets)",
    notes: "ADR-002 Option B: demotable to require-review by one-shot scoped operator token.",
  }),
  Object.freeze({
    id: "F10",
    rung: 11,
    name: "taint-floor",
    action: "require-review",
    source: "taint-floor",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(correlateCommand)",
    notes: "A2: command overlaps recently-read external content (tainted).",
  }),
  Object.freeze({
    id: "F9",
    rung: 12,
    name: "session-risk-floor",
    action: "escalate",
    source: "session-risk-floor",
    demotableBy: ["contract-allow:tool-allow-matched", "contract-allow:tool-allow-tool-scope"],
    predicateRef: "runtime/decision-engine.js:decide(sessionRisk>=3)",
    notes: "W11 carve-out permits escalate→allow demotion via per-tool contract scope.",
  }),
  Object.freeze({
    id: "F6",
    rung: 13,
    name: "posture-strict-no-cover",
    action: "block",
    source: "posture-strict-no-cover",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(trustPosture=='strict'&&isGated)",
    notes: "D26: strict posture only; balanced/relaxed do not fire.",
  }),
  Object.freeze({
    id: "F7",
    rung: 14,
    name: "intent-unknown-strict",
    action: "require-review",
    source: "intent-unknown-strict",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(intent=='unknown'&&trustPosture=='strict')",
    notes: "ADR-001 D: require-review (was block); D26: strict posture only.",
  }),
  Object.freeze({
    id: "F14b",
    rung: 15,
    name: "session-over-duration",
    action: "require-review",
    source: "session-over-duration",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(sessionOverDuration)",
    notes: "D47: asserted AFTER demotion blocks so contract-allow cannot undo it.",
  }),
  Object.freeze({
    id: "F18",
    rung: 16,
    name: "network-egress-denied",
    action: "block",
    source: "network-egress-denied",
    demotableBy: [],
    predicateRef: "runtime/network-egress.js + decision-engine wiring",
    notes: "ADR-005: default-deny network egress when contract.network.egress unmatched.",
  }),
  Object.freeze({
    id: "F15",
    rung: 17,
    name: "execution-envelope-diverged",
    action: "block",
    source: "execution-envelope-diverged",
    demotableBy: [],
    predicateRef: "runtime/envelope.js + decision-engine wiring",
    notes: "ADR-003 B: pre-exec re-check on critical writes; envelope hash divergence = block.",
  }),
  // --- demotion / promotion rungs (not floors; recorded for completeness) ---
  Object.freeze({
    id: "D-CONTRACT-ALLOW",
    rung: 18,
    name: "contract-allow",
    action: "demote-baseline",
    source: ["contract-allow", "contract-allow-tool-scope"],
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(scopeMatch)",
    notes: "Demotes baseline only; never demotes a floor.",
  }),
  Object.freeze({
    id: "D-LEARNED-ALLOW",
    rung: 19,
    name: "learned-allow",
    action: "demote-narrow",
    source: "learned-allow",
    demotableBy: [],
    predicateRef: "runtime/policy-store.js:isLearnedAllowed",
    notes: "destructive-delete-pattern only; cannot demote any floor.",
  }),
  Object.freeze({
    id: "D-AUTO-ALLOW-ONCE",
    rung: 20,
    name: "auto-allow-once",
    action: "demote-narrow",
    source: "auto-allow-once",
    demotableBy: [],
    predicateRef: "runtime/policy-store.js:hasAutoAllowOnce",
    notes: "Consumed only when actually needed; cannot demote floors.",
  }),
  Object.freeze({
    id: "P-TRAJECTORY-NUDGE",
    rung: 21,
    name: "trajectory-nudge",
    action: "promote",
    source: "trajectory-nudge",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(trajectory)",
    notes: "Promote-only; exempts contract-allow + learned-allow + floor-derived sources.",
  }),
]);

// ---------------------------------------------------------------------------
// Build a quick id → entry index for O(1) lookup. Frozen.
// ---------------------------------------------------------------------------
const _BY_ID = Object.freeze(
  LATTICE.reduce((acc, entry) => {
    acc[entry.id] = entry;
    return acc;
  }, Object.create(null))
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEntry(id) {
  if (typeof id !== "string") return null;
  return _BY_ID[id] || null;
}

function getRung(id) {
  const entry = getEntry(id);
  return entry ? entry.rung : null;
}

function getFloor(id) {
  // Convenience: only "floor" rungs (engine-baked, not demotion/promotion).
  // Floors are ids starting with "L" or "F".
  const entry = getEntry(id);
  if (!entry) return null;
  if (entry.id[0] !== "F" && entry.id[0] !== "L") return null;
  return entry;
}

function listFloors() {
  return LATTICE.filter((e) => e.id[0] === "F" || e.id[0] === "L");
}

// assertOrdered() — enforces the table invariants. Throws Error on first
// violation. Used by tests + by the lattice-ordering CI script. Cheap to
// call; safe to invoke at module load when HORUS_LATTICE_SELFTEST=1.
function assertOrdered(table) {
  const t = table || LATTICE;
  if (!Array.isArray(t)) {
    throw new Error("decision-lattice: table is not an array");
  }
  const seenIds = Object.create(null);
  let prevRung = -Infinity;
  for (let i = 0; i < t.length; i++) {
    const e = t[i];
    if (!e || typeof e !== "object") {
      throw new Error(`decision-lattice: entry ${i} is not an object`);
    }
    if (typeof e.id !== "string" || e.id.length === 0) {
      throw new Error(`decision-lattice: entry ${i} has no id`);
    }
    if (typeof e.rung !== "number" || !Number.isFinite(e.rung)) {
      throw new Error(`decision-lattice: entry ${e.id} has non-finite rung`);
    }
    if (typeof e.name !== "string" || e.name.length === 0) {
      throw new Error(`decision-lattice: entry ${e.id} has no name`);
    }
    if (typeof e.action !== "string" || e.action.length === 0) {
      throw new Error(`decision-lattice: entry ${e.id} has no action`);
    }
    if (e.source == null) {
      throw new Error(`decision-lattice: entry ${e.id} has no source`);
    }
    if (!Array.isArray(e.demotableBy)) {
      throw new Error(`decision-lattice: entry ${e.id} has non-array demotableBy`);
    }
    if (typeof e.predicateRef !== "string") {
      throw new Error(`decision-lattice: entry ${e.id} has non-string predicateRef`);
    }
    if (seenIds[e.id]) {
      throw new Error(`decision-lattice: duplicate id '${e.id}'`);
    }
    seenIds[e.id] = true;
    if (!(e.rung > prevRung)) {
      throw new Error(
        `decision-lattice: rung not strictly increasing at entry '${e.id}' ` +
          `(rung=${e.rung}, previous=${prevRung})`
      );
    }
    prevRung = e.rung;
  }
  return true;
}

// Optional self-test on module load. Off by default to keep the cold-load
// path a pure data import; opt in via env for tests/CI.
if (process.env.HORUS_LATTICE_SELFTEST === "1") {
  assertOrdered(LATTICE);
}

module.exports = {
  LATTICE,
  LATTICE_VERSION,
  getEntry,
  getRung,
  getFloor,
  listFloors,
  assertOrdered,
};
