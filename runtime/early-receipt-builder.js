#!/usr/bin/env node
"use strict";

// Early-block receipt builders + shared per-call state. Extracted from
// runtime/decision-engine.js by the monolith-decomposition sprint (2026-06).
//
// These helpers build the receipts for early-return paths (block, require-review)
// before decide() reaches the normal result path. They share per-call module-level
// state that decide() sets via the exported setters at the top of each invocation.

const { LATTICE_VERSION, getRungByName } = require("./decision-lattice");
const { append } = require("./decision-journal");
const { recordDecision } = require("./session-context");
const { floorCodeFor } = require("./floor-codes");
const { fireNotifyHook: _fireNotifyHook } = require("./notify-engine-hook");

// ---------------------------------------------------------------------------
// Per-call shared state — set by decide() via the setters below before any
// floor is evaluated. Semantics are identical to the original module-level
// vars in decision-engine.js; location changed, behavior unchanged.
// ---------------------------------------------------------------------------

// ADR-004 PR 37B: degraded-mode marker default for the early-block path.
let _earlyBlockDegradedDefault = null;
// ADR-015: notify hook reads the active contract on early-block returns.
let _earlyBlockContract = null;
// ADR-016: when dryRun is true, skip journal appends across all early-block paths.
let _earlyBlockDryRun = false;
// ADR-017 F23: kill-chain detail for early-block paths (F16/F17/etc.) that
// fire after the F23 preview is computed but before the normal result path.
let _earlyBlockF23 = null;

function setEarlyBlockDegradedDefault(v) { _earlyBlockDegradedDefault = v; }
function setEarlyBlockContract(v)        { _earlyBlockContract = v; }
function setEarlyBlockDryRun(v)          { _earlyBlockDryRun = v; }
function setEarlyBlockF23(v)             { _earlyBlockF23 = v; }

// ---------------------------------------------------------------------------
// irJournalExtras — ADR-007 PR-C: extra journal fields emitted by default.
// Disable with LILARA_IR_JOURNAL=0 for one release while consumers cut over.
// ---------------------------------------------------------------------------
function irJournalExtras(input, floorFired) {
  if (process.env.LILARA_IR_JOURNAL === "0") return null;
  const ir = input && input.ir;
  if (!ir || typeof ir.irHash !== "string" || ir.irHash.length === 0) return null;
  const extras = { irHash: ir.irHash, latticeVersion: LATTICE_VERSION };
  if (floorFired) {
    const r = getRungByName(floorFired);
    if (r != null) extras.rung = r;
  }
  return extras;
}

// ---------------------------------------------------------------------------
// harnessInScope — pure predicate used by F5 (harness-out-of-scope).
// ---------------------------------------------------------------------------
function harnessInScope(contract, harness) {
  return Array.isArray(contract?.harnessScope) && contract.harnessScope.includes(harness);
}

// ---------------------------------------------------------------------------
// buildEarlyBlock — early-block (action:"block") receipt + journal + notify.
// ---------------------------------------------------------------------------
function buildEarlyBlock(reasonCode, enriched, discovered, input, explanation, extra = {}) {
  // ADR-009 PR-C: any early-block decision that touched an ambient path
  // carries `ambientClass`/`ambientPath` in the receipt. F16 sets these
  // explicitly via `extra.ambientClass`/`extra.ambientPath`; other floors
  // get them from `extra.ambientTouch` populated by decide().
  const _ambientClass = extra.ambientClass || (extra.ambientTouch && extra.ambientTouch.class) || null;
  const _ambientPath  = extra.ambientPath  || (extra.ambientTouch && extra.ambientTouch.path)  || null;
  // F17 PR-A: lock-detail fields surface on the receipt + journal so audit
  // can identify the conflicting lock without leaking secrets. Owner is the
  // identity string the lock writer chose; lockPath/lockProject/lockExpiresAt
  // come straight from the lock record.
  const _lockOwner       = extra.lockOwner != null ? extra.lockOwner : null;
  const _lockPath        = extra.lockPath  != null ? extra.lockPath  : null;
  const _lockProject     = extra.lockProject != null ? extra.lockProject : null;
  const _lockExpiresAt   = extra.lockExpiresAt != null ? extra.lockExpiresAt : null;
  // ADR-004 PR 37B: degraded-mode marker — included verbatim from caller
  // when present. Early-block path inherits the same marker decide()
  // computed at the top so receipts on both code paths agree.
  const _degraded        = extra.degradedMode !== undefined
    ? extra.degradedMode
    : _earlyBlockDegradedDefault;
  // F19 (ADR-010): output-exfil detail — carried verbatim from caller when
  // present so confirmed-severity early-blocks surface the same receipt
  // fields (outputChannel, matchClasses, redactedSample,
  // compensatingRestrictionApplied) as the non-block F19 path below.
  const _f19            = extra.f19Detail || null;
  // ADR-017 F23: include kill-chain receipt when detection fired before this early block.
  const _killChain      = _earlyBlockF23 || null;
  const _code           = extra.code || floorCodeFor(reasonCode) || null;
  const _coaching       = extra.coaching || null;
  const result = {
    action: "block",
    enforcementAction: "block",
    floorFired: extra.floorFired || null,
    ...(_code     != null ? { code:     _code     } : {}),
    riskScore: 10,
    riskLevel: "critical",
    reasonCodes: [reasonCode],
    confidence: 1,
    decisionSource: extra.decisionSource || "contract-floor",
    policyKey: reasonCode,
    explanation,
    pendingSuggestion: null,
    promotionGuidance: null,
    promotionState: null,
    promotionLifecycleSummary: null,
    workflowRoute: null,
    actionPlan: null,
    trajectoryNudge: null,
    envelope: input.envelope || null,
    envelopeVerification: extra.envelopeVerification || null,
    networkEgress: extra.networkEgress || null,
    context: {},
    ...(_ambientClass ? { ambientClass: _ambientClass } : {}),
    ...(_ambientPath  ? { ambientPath:  _ambientPath  } : {}),
    ...(_lockOwner     != null ? { lockOwner:     _lockOwner     } : {}),
    ...(_lockPath      != null ? { lockPath:      _lockPath      } : {}),
    ...(_lockProject   != null ? { lockProject:   _lockProject   } : {}),
    ...(_lockExpiresAt != null ? { lockExpiresAt: _lockExpiresAt } : {}),
    ...(_degraded      != null ? { degradedMode:  _degraded      } : {}),
    ...(_f19          != null ? {
      outputChannel: _f19.outputChannel || null,
      matchClasses: Array.isArray(_f19.matchClasses) ? _f19.matchClasses : [],
      redactedSample: typeof _f19.redactedSample === "string" ? _f19.redactedSample : "",
      compensatingRestrictionApplied: Boolean(_f19.compensatingRestrictionApplied),
    } : {}),
    ...(_coaching     != null ? { coaching: _coaching } : {}),
    ...(_killChain    != null ? { killChain: _killChain } : {}),
  };
  // Still journal the early block so diff-decisions can replay it
  if (_earlyBlockDryRun) return result;
  try {
    const irExtras = irJournalExtras(input, result.floorFired);
    append({
      kind: "runtime-decision",
      action: "block",
      riskLevel: "critical",
      riskScore: 10,
      reasonCodes: [reasonCode],
      tool: input.tool || "",
      branch: input.branch || "",
      targetPath: input.targetPath || "",
      notes: `${result.decisionSource}:${reasonCode}`,
      ...(result.floorFired ? { floorFired: result.floorFired } : {}),
      ...(_ambientClass ? { ambientClass: _ambientClass } : {}),
      ...(_ambientPath  ? { ambientPath:  _ambientPath  } : {}),
      ...(_lockOwner     != null ? { lockOwner:     _lockOwner     } : {}),
      ...(_lockPath      != null ? { lockPath:      _lockPath      } : {}),
      ...(_lockProject   != null ? { lockProject:   _lockProject   } : {}),
      ...(_lockExpiresAt != null ? { lockExpiresAt: _lockExpiresAt } : {}),
      ...(_degraded      != null ? { degradedMode:  _degraded      } : {}),
      ...(_f19          != null ? { f19Detail:     _f19           } : {}),
      ...(_code         != null ? { code:          _code          } : {}),
      ...(_coaching     != null ? { coaching:      _coaching      } : {}),
      ...(_killChain    != null ? { killChain:     _killChain     } : {}),
      ...(irExtras || {}),
    });
    recordDecision({ action: "block", riskLevel: "critical", reasonCodes: [reasonCode] });
  } catch { /* journal is best-effort */ }
  // ADR-015: fire-and-forget notify hook. `_earlyBlockContract` is set by
  // decide() at top of call so kill-switch / contract-mismatch early blocks
  // can still emit a notification when the contract enables it.
  try { _fireNotifyHook(result, _earlyBlockContract, result.policyKey || null); } catch { /* */ }
  return result;
}

// buildEarlyReview — mirrors buildEarlyBlock but produces action:"require-review"
// with riskLevel:"medium" / riskScore:5.  Used by F25/F26 when a payload is
// unscannable (too complex / circular) — we gate rather than hard-block to
// prevent false positives on large benign bulk payloads.
function buildEarlyReview(reasonCode, enriched, discovered, input, explanation, extra = {}) {
  const _code     = extra.code || floorCodeFor(reasonCode) || null;
  const _degraded = extra.degradedMode !== undefined ? extra.degradedMode : _earlyBlockDegradedDefault;
  // ADR-009 PR-C: carry ambient-touch fields into require-review receipts so
  // audit can identify which ambient path was being touched when the gate fired.
  // Mirrors the identical pattern in buildEarlyBlock (lines ~219-222).
  const _ambientClass = extra.ambientClass || (extra.ambientTouch && extra.ambientTouch.class) || null;
  const _ambientPath  = extra.ambientPath  || (extra.ambientTouch && extra.ambientTouch.path)  || null;
  // ADR-017 F23: include kill-chain receipt when detection fired before this early review.
  const _killChain    = _earlyBlockF23 || null;
  const result = {
    action: "require-review",
    enforcementAction: "require-review",
    floorFired: extra.floorFired || null,
    ...(_code != null ? { code: _code } : {}),
    riskScore: 5,
    riskLevel: "medium",
    reasonCodes: [reasonCode],
    confidence: 0.5,
    decisionSource: extra.decisionSource || "contract-floor",
    policyKey: reasonCode,
    explanation,
    pendingSuggestion: null,
    promotionGuidance: null,
    promotionState: null,
    promotionLifecycleSummary: null,
    workflowRoute: null,
    actionPlan: null,
    trajectoryNudge: null,
    envelope: input.envelope || null,
    envelopeVerification: null,
    networkEgress: null,
    context: {},
    ...(_ambientClass ? { ambientClass: _ambientClass } : {}),
    ...(_ambientPath  ? { ambientPath:  _ambientPath  } : {}),
    ...(_degraded    != null ? { degradedMode: _degraded } : {}),
    ...(_killChain   != null ? { killChain: _killChain } : {}),
  };
  // ADR-016: dry-run mode skips journal/notify side-effects (sandbox previews).
  if (_earlyBlockDryRun) return result;
  try {
    const irExtras = irJournalExtras(input, result.floorFired);
    append({
      kind: "runtime-decision",
      action: "require-review",
      riskLevel: "medium",
      riskScore: 5,
      reasonCodes: [reasonCode],
      tool: input.tool || "",
      branch: input.branch || "",
      targetPath: input.targetPath || "",
      notes: `${result.decisionSource}:${reasonCode}`,
      ...(result.floorFired ? { floorFired: result.floorFired } : {}),
      ...(_ambientClass ? { ambientClass: _ambientClass } : {}),
      ...(_ambientPath  ? { ambientPath:  _ambientPath  } : {}),
      ...(_degraded    != null ? { degradedMode: _degraded } : {}),
      ...(_killChain   != null ? { killChain:    _killChain } : {}),
      ...(irExtras || {}),
    });
    recordDecision({ action: "require-review", riskLevel: "medium", reasonCodes: [reasonCode] });
  } catch { /* journal is best-effort */ }
  try { _fireNotifyHook(result, _earlyBlockContract, result.policyKey || null); } catch { /* */ }
  return result;
}

module.exports = {
  harnessInScope,
  buildEarlyBlock,
  buildEarlyReview,
  irJournalExtras,
  setEarlyBlockDegradedDefault,
  setEarlyBlockContract,
  setEarlyBlockDryRun,
  setEarlyBlockF23,
};
