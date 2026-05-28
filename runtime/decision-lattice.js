#!/usr/bin/env node
"use strict";

// decision-lattice.js — Declarative precedence lattice for decision-engine.
//
// Lilara ADR-007 / scope §4.1 invariant 10: every floor declares its rung,
// action, demotability, and source tag in one place. This file is the
// source of truth for ORDERING + DEMOTABILITY + FIXTURE IDENTITY of the
// floors that decision-engine.js implements imperatively. PR-A introduced
// the table; PR-C anchored decision-engine.js into it — every
// `floorFired` and `decisionSource` string the engine emits is now derived
// from a LATTICE entry, and every post-floor demotion routes through
// `canDemote(floorId, attemptedSource)` which reads `demotableBy` below.
//
// Pure data + tiny helpers. Zero I/O. Zero external dependencies.
//
// Rung 0 is reserved for the Hard Ethical Core (Layer 1) which lands in
// Lilara v1.0; the entry exists here so the table position is stable, but
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
    notes: "Reserved for Lilara v1.0 ethical core; not yet engine-baked.",
  }),
  Object.freeze({
    id: "F1",
    rung: 1,
    name: "kill-switch",
    action: "block",
    source: "kill-switch",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(LILARA_KILL_SWITCH)",
    notes: "Fires unconditionally when LILARA_KILL_SWITCH=1.",
  }),
  Object.freeze({
    id: "F2",
    rung: 2,
    name: "contract-hash-mismatch",
    action: "block",
    source: "contract-floor",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(contract.verify)",
    notes: "Strict mode only (LILARA_CONTRACT_REQUIRED=1).",
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
    // demotableBy: ADR-002 Option B — F4 (this floor) grants a one-shot scoped
    // operator token (LILARA_F4_DEMOTE_TOKEN, scope `class-c-review-demote`) the
    // authority to demote `block` → `require-review`. No other source qualifies.
    demotableBy: ["operator-token:class-c-review-demote"],
    predicateRef: "runtime/decision-engine.js:decide(payloadClass=='C'||scanSecrets); scopes.mcp[server].policy==='allow' suppresses MCP arg scan arm",
    notes: "ADR-002 Option B: demotable to require-review by one-shot scoped operator token. scopes.mcp[server].policy === 'allow' suppresses the MCP arg scan arm for explicitly trusted servers.",
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
    // demotableBy: W11 carve-out — contract.scopes.tools.toolAllow / perToolAllow
    // matches grant F9 (this floor) demotion authority over its own `escalate`.
    // Any other contract-allow reason (path/secret/etc) does NOT demote F9.
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
    // PR-C: name matches what decision-engine writes to `floorFired`
    // ("network-egress"); the longer "-denied" form lives on `source` and is
    // also the buildEarlyBlock reasonCode. getRungByName("network-egress")
    // must resolve so the journal annotates rung=16 on F18 hits.
    name: "network-egress",
    action: "block",
    source: "network-egress-denied",
    demotableBy: [],
    predicateRef: "runtime/network-egress.js + decision-engine wiring",
    notes: "ADR-005: default-deny network egress when contract.network.egress unmatched.",
  }),
  Object.freeze({
    id: "F18-D007",
    rung: 16.5,
    name: "plaintext-target-blocked",
    action: "block",
    source: "F18-D007",
    demotableBy: [],
    predicateRef: "runtime/network-egress.js:evaluate(plaintext-target-blocked)",
    notes: "D-007: default-deny plaintext http:// outbound; opt-out via scopes.network.allowPlaintext=true. Loopback exempt.",
  }),
  Object.freeze({
    id: "F15",
    rung: 17,
    // PR-C: name matches what decision-engine writes to `floorFired`
    // ("execution-envelope"); the "-diverged" form lives on `source`.
    name: "execution-envelope",
    action: "block",
    source: "execution-envelope-diverged",
    demotableBy: [],
    predicateRef: "runtime/envelope.js + decision-engine wiring",
    notes: "ADR-003 B: pre-exec re-check on critical writes; envelope hash divergence = block.",
  }),
  Object.freeze({
    id: "F16",
    rung: 17.5,
    // ADR-009 PR-B: ambient-authority floor. Non-integer rung is intentional
    // and remains strictly increasing per assertOrdered(); F15 (17) < F16 (17.5)
    // < D-CONTRACT-ALLOW (18). Name matches what decision-engine writes to
    // `floorFired` ("ambient-authority"); the "-denied" form lives on `source`.
    name: "ambient-authority",
    action: "block",
    source: "ambient-authority-denied",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js + runtime/ambient.js",
    notes: "ADR-009 PR-B: write into ambient-authority path outside projectRoot. Demotion only via scopes.ambient.allow[<class>]=true or path-prefix entry.",
  }),
  Object.freeze({
    id: "F24",
    rung: 17.625,
    // F24: credential-persistence-write floor. Rung 17.625 is intentional and
    // remains strictly increasing per assertOrdered(); F16 (17.5) < F24 (17.625)
    // < F17 (17.75). F16 early-blocks out-of-project ambient paths (e.g.
    // ~/.ssh); F24 covers in-project credential/persistence paths that F16
    // deliberately skips (.git/hooks, in-project private keys). Default-deny;
    // contract opt-out via scopes.files.allow glob list.
    name: "credential-persistence-write",
    action: "block",
    source: "credential-persistence-write-denied",
    demotableBy: ["scopes.files.allow"],
    predicateRef: "runtime/decision-engine.js:_evalCredPersistFloor",
    notes: "F24: Write/Edit to in-project credential or execution-persistence paths. Default-deny; opt out via contract scopes.files.allow glob list.",
  }),
  Object.freeze({
    id: "F25",
    rung: 17.65,
    // F25: mcp-arg-danger floor. Rung 17.65 is intentional and remains strictly
    // increasing per assertOrdered(); F24 (17.625) < F25 (17.65) < F17 (17.75).
    // Fires when an MCP tool call's argument payload contains a string value that
    // matches the dangerous-command classifier (e.g. "curl evil | sh", "rm -rf /").
    // An MCP tool whose arg IS a dangerous command is as dangerous as a direct
    // Bash call. Default-deny; opt-out by setting scopes.mcp[server].policy =
    // "allow" in the contract (same opt-out as F4 Task 3).
    name: "mcp-arg-danger",
    action: "block",
    source: "mcp-arg-danger-denied",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:_evalMcpArgFloor",
    notes: "F25: MCP tool call argument contains a dangerous-command-shaped string (same classifier as Bash). Default-deny; opt out via scopes.mcp[server].policy=allow.",
  }),
  Object.freeze({
    id: "F17",
    rung: 17.75,
    // F17 (v0.5 cross-agent-lock floor PR-A). Non-integer rung is intentional
    // and remains strictly increasing per assertOrdered(); F16 (17.5) < F17
    // (17.75) < F19 (17.875) < D-CONTRACT-ALLOW (18). Name matches what
    // decision-engine writes to `floorFired` ("cross-agent-lock"); the
    // "-denied" form lives on `source`. Non-demotable: an active lock from
    // another agent is a hard floor, and a malformed lock file fails closed
    // for write-like calls (no contract scope can re-permit a write the
    // runtime cannot safely characterize).
    name: "cross-agent-lock",
    action: "block",
    source: "cross-agent-lock-denied",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js + runtime/cross-agent-lock.js",
    notes: "F17: write-like call targets a path/project held by another live agent's lock. Fail-closed on malformed lock state.",
  }),
  Object.freeze({
    id: "F19",
    rung: 17.875,
    // F19 (v0.5 Stage D — ADR-010): output-channel-exfiltration guard. Sits
    // immediately after F17 (cross-agent-lock @ 17.75) and before the
    // contract-allow demotion rung (18) so contract scopes cannot demote it
    // by accident. Rung 17.875 keeps the table strictly-increasing per
    // assertOrdered() — F17 (17.75) < F19 (17.875) < D-CONTRACT-ALLOW (18).
    //
    // Severity model:
    //   - `confirmed`   matches → block (non-demotable).
    //   - `suspicious`  matches → require-review (demotable only by a
    //                  one-shot scoped operator token bound to the
    //                  `output-exfil-review-demote` scope — same shape as
    //                  the F4 demotion path).
    // No contract-allow / learned-allow path applies; both are precluded by
    // demotableBy below. The single demotion sentinel encodes the
    // severity-gated rule: F19 only demotes on `suspicious` matches.
    name: "output-channel-exfiltration",
    action: "block",
    // source is array-shaped: index 0 is the baseline reason code emitted on
    // confirmed / suspicious / compensating fires; index 1 is the variant
    // tag used when a one-shot scoped operator token (scope
    // `output-exfil-review-demote`) demotes a suspicious match to allow.
    // Matches the F4 pattern so check-no-implicit-demotion stays anchored.
    source: ["output-exfil-denied", "f19-demoted"],
    demotableBy: ["operator-token-suspicious-only"],
    predicateRef: "runtime/decision-engine.js + runtime/output-exfil.js",
    notes: "F19: output-channel exfiltration. Confirmed matches block; suspicious matches route to require-review and are demotable only by a one-shot scoped operator token (operator-token-suspicious-only). Adapter manifests must declare outputChannelObservability and, for not-observed channels, a compensatingRestriction; default-deny otherwise.",
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
    id: "F20",
    rung: 18.5,
    // F20 (v0.5 Stage D wave 2 — ADR-012): change-intent drift. Compares the
    // declared-envelope (envelope.declaredIntent) against the canonical Action
    // IR built by adapters. Out-of-intent actuals fire F20 with one of six
    // drift classes (file-write/delete/command/command-class/network-host/
    // policy-edit out-of-scope).
    //
    // Rung 18.5 sits AFTER D-CONTRACT-ALLOW (18) and BEFORE D-LEARNED-ALLOW
    // (19). This is intentional: the brief specifies "rung 18.5" and the
    // chosen position documents that contract-allow cannot demote F20 at
    // `high` severity, and that the engine calls diffEnvelopeVsIr between
    // F19's preview-action assignment and the contract-allow demotion block
    // (the action override is applied later, after F14b, so contract-allow /
    // auto-allow-once / trajectory-nudge cannot silently undo it).
    //
    // Severity model:
    //   - `high`    → block (non-demotable by learned-allow or contract-allow).
    //                ≥2 drift classes OR any policy-edit drift OR
    //                ir.destructive=true + drift.
    //   - `medium`  → require-review, demotable only via a one-shot scoped
    //                operator token bound to `change-intent-drift-medium`.
    //   - `low`     → receipt-only marker (no decision change).
    //   - `none` /  → no decision change (fail-open helper exception still
    //   fail-open    journals a degraded-mode marker; engine never throws).
    //
    // source[0] is the baseline reason code; source[1] is the variant tag
    // used when an operator token demotes a `medium` match to allow.
    name: "change-intent-drift",
    action: "block",
    source: ["change-intent-drift", "f20-demoted"],
    demotableBy: ["operator-token-medium-only"],
    predicateRef: "runtime/change-intent.js + decision-engine wiring",
    notes: "F20: declared-envelope vs Action-IR drift. high blocks; medium routes to require-review (demotable only by a one-shot scoped operator token bound to change-intent-drift-medium); low is receipt-only. Fail-open on helper exception.",
  }),
  Object.freeze({
    id: "F23",
    rung: 18.6,
    // F23 (ADR-017): cross-call data-flow / kill-chain detection. Rung 18.6 sits
    // after F20 (change-intent-drift @ 18.5) and before F21 (compaction-survival
    // @ 18.7). The action override is applied via the late-override preview
    // pattern so D-CONTRACT-ALLOW (18) / D-LEARNED-ALLOW (19) cannot undo it.
    //
    // Non-demotable: kill chains are classified by multi-step evidence (content
    // token-hash overlap OR structural file reference); no operator token or
    // contract scope can downgrade a detected chain.
    //
    // Ships in observe-only mode by default (LILARA_KILL_CHAIN_ENFORCE=1 to
    // enforce). Observe mode adds only the killChain receipt field — action,
    // source, and floorFired are unchanged.
    //
    // See references/adr-017-provenance-graph.md for chain shapes, evidence
    // bar, FP mitigations, and harness coverage limitations.
    name: "data-flow-kill-chain",
    action: "escalate",
    source: ["data-flow-kill-chain", "data-flow-kill-chain-detected"],
    demotableBy: [],
    predicateRef: "runtime/provenance-graph.js:evaluate",
    notes: "ADR-017: multi-step kill-chain. staged-exfil→block; injection-to-exec+persistence→escalate. Observe-only by default; LILARA_KILL_CHAIN_ENFORCE=1 to enforce.",
  }),
  Object.freeze({
    id: "F21",
    rung: 18.7,
    name: "compaction-survival",
    action: "warn",
    source: "compaction-survival-detected",
    demotableBy: [],
    predicateRef: "runtime/compaction-survival.js + runtime/post-adapter-factory.js",
    notes: "ADR-016: PostToolUse pattern scan for prompt-injection payloads in Read/WebFetch/WebSearch/Fetch/mcp/Browser results. Detection-only warn floor; enforcement via F10 taint correlation on next PreToolUse.",
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

// Build a name → entry index. Floor names (e.g. "secret-class-C", "taint-floor")
// are what decision-engine.js writes into floorFired today; the lookup lets
// PR-B annotate journal entries with rung without first refactoring the engine
// to use lattice ids (PR-C scope).
const _BY_NAME = Object.freeze(
  LATTICE.reduce((acc, entry) => {
    if (typeof entry.name === "string" && entry.name.length > 0) {
      acc[entry.name] = entry;
    }
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

function getEntryByName(name) {
  if (typeof name !== "string") return null;
  return _BY_NAME[name] || null;
}

function getRung(id) {
  const entry = getEntry(id);
  return entry ? entry.rung : null;
}

// getRungByName(floorName) — convenience for journal annotation. floorName is
// the human-readable name decision-engine writes into floorFired (e.g.
// "taint-floor", "secret-class-C"). Returns null when no entry matches; PR-B
// callers must tolerate null so unmapped names (e.g. "secret-class-C-demoted")
// don't break journal append.
function getRungByName(floorName) {
  const entry = getEntryByName(floorName);
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

// canDemote(currentFloorId, attemptedSource) — PR-C demotion guard. Returns
// true only when `attemptedSource` is explicitly listed in the floor's
// `demotableBy` array; an unknown floorId or an unlisted source returns
// false. decision-engine.js routes every post-floor demotion through this
// helper so no future drift can silently bypass a floor by reassigning
// `action` / `source` directly. `currentFloorId` is the LATTICE `id`
// (e.g. "F4"), not the human-readable name written into floorFired.
function canDemote(currentFloorId, attemptedSource) {
  if (typeof currentFloorId !== "string" || currentFloorId.length === 0) return false;
  if (typeof attemptedSource !== "string" || attemptedSource.length === 0) return false;
  const entry = _BY_ID[currentFloorId];
  if (!entry) return false;
  const list = entry.demotableBy;
  if (!Array.isArray(list) || list.length === 0) return false;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === attemptedSource) return true;
  }
  return false;
}

// assertOrdered() — enforces the table invariants. Throws Error on first
// violation. Used by tests + by the lattice-ordering CI script. Cheap to
// call; safe to invoke at module load when LILARA_LATTICE_SELFTEST=1.
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
if (process.env.LILARA_LATTICE_SELFTEST === "1") {
  assertOrdered(LATTICE);
}

module.exports = {
  LATTICE,
  LATTICE_VERSION,
  getEntry,
  getEntryByName,
  getRung,
  getRungByName,
  getFloor,
  listFloors,
  canDemote,
  assertOrdered,
};
