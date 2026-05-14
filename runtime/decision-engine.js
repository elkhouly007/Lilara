#!/usr/bin/env node
"use strict";

const { score } = require("./risk-score");
const { append } = require("./decision-journal");
const { getApprovalCount, isLearnedAllowed, decisionKey, getSuggestionForInput, getPolicyFacts, hasAutoAllowOnce, consumeAutoAllowOnce } = require("./policy-store");
const { getSessionRisk, recordDecision, getSessionTrajectory } = require("./session-context");
const { loadProjectPolicy } = require("./project-policy");
const { discover } = require("./context-discovery");
const { fineKey } = require("./decision-key");
const { build } = require("./action-planner");
const { evaluate } = require("./promotion-guidance");
const { recommend } = require("./workflow-router");
const { classifyCommand } = require("./decision-key");
const { classifyIntent } = require("./intent-classifier");
const { LATTICE_VERSION, getEntry, getRungByName, canDemote } = require("./decision-lattice");

// HAP ADR-007 PR-C: floor labels are LATTICE-derived, not literals. Each
// constant below resolves to the canonical name/source for its floor; the
// engine reads these instead of hard-coded strings so a future relabel
// only has to touch decision-lattice.js. `_LF`/`_LS` capture the floor
// name (used as floorFired) and decisionSource respectively. For F4 where
// `source` is an array, the demoted variant lives at index 1.
const _F1  = getEntry("F1");          // kill-switch
const _F2  = getEntry("F2");          // contract-hash-mismatch
const _F5  = getEntry("F5");          // strict-gated-no-cover (harness-out-of-scope)
const _F11 = getEntry("F11");         // validity-window
const _F12 = getEntry("F12");         // mcp-deny
const _F13 = getEntry("F13");         // skill-deny
const _F14 = getEntry("F14");         // budget-exceeded
const _F3  = getEntry("F3");          // critical-risk
const _F8  = getEntry("F8");          // protected-branch
const _F4  = getEntry("F4");          // secret-class-C
const _F10 = getEntry("F10");         // taint-floor
const _F9  = getEntry("F9");          // session-risk-floor
const _F6  = getEntry("F6");          // posture-strict-no-cover
const _F7  = getEntry("F7");          // intent-unknown-strict
const _F14b = getEntry("F14b");       // session-over-duration
const _F18 = getEntry("F18");         // network-egress
const _F18D007 = getEntry("F18-D007");// plaintext-target-blocked (D-007 Lane 4)
const _F15 = getEntry("F15");         // execution-envelope
const _F16 = getEntry("F16");         // ambient-authority (ADR-009 PR-B)
const _F17 = getEntry("F17");         // cross-agent-lock (PR-A)
const _F19 = getEntry("F19");         // output-channel-exfiltration (ADR-010)
const _CA  = getEntry("D-CONTRACT-ALLOW");  // contract-allow (sources[0/1])
const _LA  = getEntry("D-LEARNED-ALLOW");   // learned-allow
const _AAO = getEntry("D-AUTO-ALLOW-ONCE"); // auto-allow-once
const _TN  = getEntry("P-TRAJECTORY-NUDGE");// trajectory-nudge

// Demotion source identifiers used with canDemote(). Format mirrors the
// `demotableBy` strings in decision-lattice.js.
const _DEMOTE_F4_OPERATOR_TOKEN     = "operator-token:class-c-review-demote";
// ADR-010 F19: suspicious-severity output-channel matches demote via a one-shot
// scoped operator token. canDemote() reads `demotableBy` from the LATTICE entry,
// and the engine separately consumes the token via consumeScopedOperatorToken
// against `output-exfil-review-demote` (the scope used on `mintOperatorToken`).
const _DEMOTE_F19_SUSPICIOUS        = "operator-token-suspicious-only";
const _DEMOTE_F19_TOKEN_SCOPE       = "output-exfil-review-demote";
const _DEMOTE_F9_TOOL_ALLOW_MATCHED = "contract-allow:tool-allow-matched";
const _DEMOTE_F9_TOOL_ALLOW_SCOPE   = "contract-allow:tool-allow-tool-scope";

// HAP ADR-007 PR-C: extra journal fields are emitted by default. Disable
// with HORUS_IR_JOURNAL=0 for one release while consumers cut over.
function _irJournalExtras(input, floorFired) {
  if (process.env.HORUS_IR_JOURNAL === "0") return null;
  const ir = input && input.ir;
  if (!ir || typeof ir.irHash !== "string" || ir.irHash.length === 0) return null;
  const extras = { irHash: ir.irHash, latticeVersion: LATTICE_VERSION };
  if (floorFired) {
    const r = getRungByName(floorFired);
    if (r != null) extras.rung = r;
  }
  return extras;
}

// Taint-floor disablement: warn once per process if taint module unavailable.
let _taintWarnedOnce = false;

// Hoisted contract helpers - resolved once at module init so the decide() hot
// path doesn't pay per-call require() lookups (10x per decide pre-hoist on
// no-contract installs, dominant on macOS where cold requires are slow).
const _contractMod = require("./contract");
const {
  GATED_CLASSES: GATED_COMMAND_CLASSES,
  load: _contractLoad,
  verify: _contractVerify,
  getContextTrust: _contractGetContextTrust,
  scopeMatch: _contractScopeMatch,
  isInActiveWindow: _contractIsInActiveWindow,
  getMcpPolicy: _contractGetMcpPolicy,
  extractMcpServerName: _contractExtractMcpServerName,
  getSkillPolicy: _contractGetSkillPolicy,
  getSessionConstraints: _contractGetSessionConstraints,
  getBudgetLimits: _contractGetBudgetLimits,
  getNetworkPolicy: _contractGetNetworkPolicy,
  consumeScopedOperatorToken: _contractConsumeScopedOperatorToken,
} = _contractMod;
const {
  evaluate: _evalNet,
  evaluateDns: _evalNetDns,
  evaluateIpSet: _evalNetIpSet,
} = require("./network-egress");
// ADR-009 PR-B: ambient-authority classifier. Hoisted import; the F16 wiring
// site wraps evaluation in try/catch so an unexpected runtime throw inside
// ambient.js fails open (zero-dep / fail-open policy).
const { classifyAmbientPath: _classifyAmbientPath } = require("./ambient");
// F17 PR-A: cross-agent-lock helper. State-dir-local; reads
// `<HORUS_STATE_DIR>/cross-agent-locks/*.json` to detect a conflicting
// lock owned by another agent/session for a write-like call.
const { readLockState: _readLockState, findConflict: _findLockConflict } = require("./cross-agent-lock");
const { stateDir: _statePathStateDir } = require("./state-paths");
// ADR-004 PR 37B: degraded-mode descriptor + write-like classifier. The
// descriptor is computed once per process from journal-chain.verify(); when
// degraded, F4 operator-token demotion is suppressed and write-like `allow`
// is routed to `require-review`. Every receipt + journal entry carries a
// `degradedMode` marker so audit can distinguish degraded receipts.
const _degradedMode = require("./degraded-mode");
// Optional modules - fixtures rename these to *.disabled-test-bak to verify
// fail-open fallback, so the require itself must be guarded. Each cached as
// null when absent and call sites check before use.
let _scanSecrets = null;
try { _scanSecrets = require("./secret-scan").scanSecrets; } catch { /* optional */ }
let _correlateCommand = null;
try { _correlateCommand = require("./taint").correlateCommand; } catch { /* optional */ }
let _getCounters = null, _recordDestructiveOp = null;
try {
  const sb = require("./session-budget");
  _getCounters = sb.getCounters;
  _recordDestructiveOp = sb.recordDestructiveOp;
} catch { /* optional */ }

// Contract is loaded lazily - disabled only when HORUS_CONTRACT_ENABLED=0.
// `_contractLoaded` distinguishes "not yet loaded" from "loaded as null" so a
// missing contract file doesn't re-trigger fs.existsSync on every decide().
let _contract = null;
let _contractLoaded = false;
function getContract(projectRoot) {
  if (process.env.HORUS_CONTRACT_ENABLED === "0") return null;
  if (_contractLoaded) return _contract;
  try {
    _contract = _contractLoad(projectRoot || process.cwd());
  } catch { _contract = null; }
  _contractLoaded = true;
  return _contract;
}

// ---------------------------------------------------------------------------
// Helpers for early-block returns (keep decide() readable)
// ---------------------------------------------------------------------------

function harnessInScope(contract, harness) {
  return Array.isArray(contract?.harnessScope) && contract.harnessScope.includes(harness);
}

// ADR-004 PR 37B: degraded-mode marker default for the early-block path.
// decide() sets this at the top of each call so every buildEarlyBlock() call
// inherits the same marker without churning every call site's `extra`. The
// engine is synchronous within a single decide(), so this is safe to share
// across the floor checks that follow.
let _earlyBlockDegradedDefault = null;
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
  const result = {
    action: "block",
    enforcementAction: "block",
    floorFired: extra.floorFired || null,
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
  };
  // Still journal the early block so diff-decisions can replay it
  try {
    const irExtras = _irJournalExtras(input, result.floorFired);
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
      ...(irExtras || {}),
    });
    recordDecision({ action: "block", riskLevel: "critical", reasonCodes: [reasonCode] });
  } catch { /* journal is best-effort */ }
  return result;
}

// F16 (ADR-009 PR-B) — ambient-authority floor helpers. Pure; zero I/O.
// Path normalization mirrors runtime/ambient.js (backslash→slash, strip
// `file://`, trim trailing slash); comparisons lowercase for parity with
// case-insensitive HFS+/APFS/NTFS shapes.
function _normAmbientPath(p) {
  if (typeof p !== "string" || p.length === 0) return "";
  // ARG-PRE-D-002: decode `%2e`/`%2f` BEFORE backslash fold + segment walk so
  // URL-encoded traversal cannot string-prefix-match projectRoot. Narrow on
  // purpose — full decodeURIComponent throws on malformed input and decodes
  // characters we do not need to interpret here.
  let s = p.replace(/%2e/gi, ".").replace(/%2f/gi, "/");
  s = s.replace(/\\/g, "/").replace(/^file:\/\//i, "");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  // ARG-PRE-D-001: POSIX-style `.`/`..` collapse so `<projectRoot>/../foo`
  // no longer string-prefix-matches `<projectRoot>/`. Pure string algorithm —
  // path.resolve would inject the host cwd on relative inputs and break the
  // _f16Abs shape detector downstream.
  const drive = /^[A-Za-z]:\//.test(s) ? s.slice(0, 2) : "";
  const body  = drive ? s.slice(2) : s;
  const segs  = body.split("/");
  const out   = [];
  for (const seg of segs) {
    if (seg === "" || seg === ".") {
      if (out.length === 0 && body.startsWith("/")) out.push("");
      continue;
    }
    if (seg === "..") {
      if (out.length > 1 || (out.length === 1 && out[0] !== "")) out.pop();
      continue;
    }
    out.push(seg);
  }
  return drive + out.join("/");
}
function _isInsideProject(targetPath, projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) return false;
  const np = _normAmbientPath(targetPath).toLowerCase();
  const nr = _normAmbientPath(projectRoot).toLowerCase();
  if (!np || !nr) return false;
  return np === nr || np.startsWith(nr + "/");
}
// gitConfig/ideSettings have a legitimate in-project shape; every other
// ambient class still fires when project-local (e.g. `<proj>/.ssh/id_rsa`).
const _PROJECT_LOCAL_AMBIENT_CLASSES = new Set(["gitConfig", "ideSettings"]);
// Segment-aligned, case-insensitive opt-in match. pathPrefix is optional;
// when absent the entry permits ALL paths of `class`.
function _matchAmbientAllow(allow, ambientClass, normPath) {
  if (!Array.isArray(allow)) return false;
  for (const e of allow) {
    if (!e || typeof e !== "object" || e.class !== ambientClass) continue;
    if (e.pathPrefix == null || e.pathPrefix === "") return true;
    const np = _normAmbientPath(e.pathPrefix).toLowerCase();
    if (!np || normPath === np || normPath.startsWith(np + "/")) return true;
  }
  return false;
}
// ADR-009 PR-C: classify the first ambient touch on a decision. Independent
// of F16's fire/skip logic (project-local exception, scopes.ambient.allow) —
// used purely for receipt enrichment so audit can tell whether any decision
// touched ambient state. First-match-wins on the same candidate iteration as
// _evalAmbientFloor (targetPath → IR write/delete → envelope.targets).
function _classifyAmbientTouch(input) {
  for (const raw of _collectAmbientCandidatePaths(input)) {
    const cls = _classifyAmbientPath(raw);
    if (cls && cls !== "nonAmbient") return { class: cls, path: raw };
  }
  return { class: null, path: null };
}
// Collect write-class candidate paths: flat targetPath, IR fileTargets
// (write/delete only), envelope.targets. Deduped in insertion order.
function _collectAmbientCandidatePaths(input) {
  const out = []; const seen = Object.create(null);
  const push = (p) => { if (typeof p === "string" && p.length > 0 && !seen[p]) { seen[p] = true; out.push(p); } };
  if (input && typeof input.targetPath === "string") push(input.targetPath);
  const irT = input && input.ir && input.ir.fileTargets;
  if (Array.isArray(irT)) for (const t of irT) if (t && (t.intent === "write" || t.intent === "delete")) push(t.path);
  const envT = input && input.envelope && input.envelope.targets;
  if (Array.isArray(envT)) for (const t of envT) if (t) push(t.path);
  return out;
}
function _evalAmbientFloor(input, discovered, contract) {
  const projectRoot = (discovered && discovered.projectRoot) || (input && input.projectRoot) || "";
  const allow = contract && contract.scopes && contract.scopes.ambient && Array.isArray(contract.scopes.ambient.allow)
    ? contract.scopes.ambient.allow : null;
  for (const raw of _collectAmbientCandidatePaths(input)) {
    const cls = _classifyAmbientPath(raw);
    if (!cls || cls === "nonAmbient") continue;
    if (_isInsideProject(raw, projectRoot) && _PROJECT_LOCAL_AMBIENT_CLASSES.has(cls)) continue;
    // F16 PR-B v2: defer when we cannot prove the target is OUTSIDE projectRoot
    // — either projectRoot is unknown/empty, or the target is non-absolute and
    // has no anchor for prefix comparison — for ambient classes with a
    // legitimate in-project shape (.git/config, .vscode/, .claude/). Runtime
    // CLI wiring/review lanes are the right escalation; other ambient classes
    // (ssh, credentialHelper, shellRc, packageCache, ...) still fire.
    const _f16Abs = /^([A-Za-z]:[\\/]|\\\\|\/)/.test(raw);
    const _f16Shape = cls === "gitConfig" || cls === "ideSettings" || cls === "mcpConfig";
    if (_f16Shape && (!_f16Abs || !projectRoot)) continue;
    if (allow && _matchAmbientAllow(allow, cls, _normAmbientPath(raw).toLowerCase())) continue;
    return { fire: true, ambientClass: cls, path: raw };
  }
  return { fire: false };
}

// F19 (ADR-010) — output-channel-exfiltration floor. Classifier + floor
// evaluator both live in runtime/output-exfil.js; the engine only consumes
// the `{ fire, severity, channel, … }` result and decides routing.
const { evaluateFloor: _evalF19Floor } = require("./output-exfil");

// F17 PR-A — cross-agent-lock floor helpers. Pure decision read-side; the
// only I/O is the per-call lock-dir scan via readLockState() against the
// engine's stateDir (HORUS_STATE_DIR-aware). Owner identity for the current
// call falls back through input.owner → input.sessionId → discovered.sessionId
// so existing harness wiring needs no schema change.
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
function _evalCrossAgentLockFloor(input, discovered, enriched) {
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

function decide(input = {}) {
  if (process.env.HORUS_KILL_SWITCH === "1") {
    return {
      action: "block",
      enforcementAction: "block",
      floorFired: _F1.name,
      riskScore: 10,
      riskLevel: "critical",
      reasonCodes: [_F1.name],
      confidence: 1,
      decisionSource: _F1.source,
      policyKey: _F1.name,
      explanation: "kill-switch engaged — all decisions blocked",
      pendingSuggestion: null,
      promotionGuidance: null,
      promotionState: null,
      promotionLifecycleSummary: null,
      workflowRoute: null,
      actionPlan: null,
      trajectoryNudge: null,
      context: {},
    };
  }

  const discovered = discover(input);
  const explicit = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== "" && value != null)
  );
  const projectPolicy = loadProjectPolicy({ ...discovered, ...explicit });
  const mergedMarkers = [...new Set([
    ...(Array.isArray(projectPolicy.projectMarkers) ? projectPolicy.projectMarkers : []),
    ...(Array.isArray(discovered.projectMarkers) ? discovered.projectMarkers : []),
  ].filter(Boolean))];
  const enriched = {
    ...projectPolicy,
    ...discovered,
    ...explicit,
    projectMarkers: mergedMarkers,
    primaryStack: explicit.primaryStack || projectPolicy.primaryStack || discovered.primaryStack || null,
    repeatedApprovals: input.repeatedApprovals != null ? input.repeatedApprovals : getApprovalCount({ ...projectPolicy, ...discovered, ...explicit }),
    sessionRisk: input.sessionRisk != null ? input.sessionRisk : getSessionRisk(),
  };

  // ADR-009 PR-C: classify ambient-touch ONCE per decide(); threaded into
  // every receipt-emitting branch via `extra.ambientTouch` (early-block path)
  // and via the final result/journal spreads (non-block path).
  const _ambientTouch = _classifyAmbientTouch(input);

  // ADR-004 PR 37B: degraded-mode descriptor. Memoised in the helper module
  // for the process lifetime; tests reset via `_clearCache()`. Threaded into
  // every receipt-emitting site via `_degradedMarker` so both the early-block
  // path and the final return surface the same marker.
  const _degradedState  = _degradedMode.getCached();
  const _degradedMarker = _degradedMode.buildMarker(_degradedState);
  const _writeLike      = _degradedMode.isWriteLike(input);
  // Default for buildEarlyBlock() — set per-call so the early-block path
  // (kill-switch is the one exception above; it returns before this point)
  // sees the same marker as the final return.
  _earlyBlockDegradedDefault = _degradedMarker;

  // Classify command intent for routing intelligence and journaling
  const intentResult = classifyIntent(input.command || "");

  // ── Section 4.6 precedence matrix: contract verification (Steps 2 + 5) ──
  const contract    = getContract(discovered.projectRoot || process.cwd());

  // B2 commit 2: contextTrust per-branch posture override.
  // Replaces enriched.trustPosture for risk scoring only — does not affect scopes or floors.
  if (contract && enriched.branch) {
    try {
      const overridePosture = _contractGetContextTrust(contract, enriched.branch);
      if (overridePosture) {
        enriched.trustPosture = overridePosture;
      }
    } catch { /* override is best-effort; fall back to project policy */ }
  }

  const cmdClass    = classifyCommand(input.command || "");
  const isGated     = GATED_COMMAND_CLASSES.has(cmdClass);
  let contractAllow = false;
  let contractReason = null;
  let contractId    = contract?.contractId || null;

  if (contract) {
    // Step 2: contract-hash-mismatch in strict mode — block
    if (process.env.HORUS_CONTRACT_REQUIRED === "1") {
      try {
        const vResult = _contractVerify(discovered.projectRoot || process.cwd());
        if (!vResult.ok) {
          return buildEarlyBlock(
            "contract-hash-mismatch", enriched, discovered, input,
            `contract hash mismatch (${vResult.reason}) — failing closed`,
            { floorFired: _F2.name, decisionSource: _F2.source, ambientTouch: _ambientTouch }
          );
        }
      } catch (verifyErr) {
        // verify threw — fail closed in strict mode
        return buildEarlyBlock(
          "contract-hash-mismatch", enriched, discovered, input,
          `contract verify error (${verifyErr instanceof Error ? verifyErr.message : "unknown"}) — failing closed`,
          { floorFired: _F2.name, decisionSource: _F2.source, ambientTouch: _ambientTouch }
        );
      }
    }

    // Step 5: strict-mode + gated class + no contract coverage → block
    const harness = String(input.harness || enriched.harness || "");
    if (process.env.HORUS_CONTRACT_REQUIRED === "1" && harness && !harnessInScope(contract, harness)) {
      if (isGated) {
        return buildEarlyBlock("harness-out-of-scope", enriched, discovered, input,
          `harness '${harness}' not in contract harnessScope — run: horus-cli contract amend --add-harness ${harness}`,
          { floorFired: _F5.name, decisionSource: _F5.source, ambientTouch: _ambientTouch });
      }
    }

    // Step 11: contract scope-allow — may demote baseline (but never demotes floors)
    try {
      const sm = _contractScopeMatch(contract, {
        command: input.command, commandClass: cmdClass,
        targetPath: input.targetPath, branch: enriched.branch,
        payloadClass: enriched.payloadClass || "A",
        harness: input.harness, projectRoot: discovered.projectRoot,
      });
      if (sm.allowed) {
        contractAllow = true;
        contractReason = sm.reason;
      }
    } catch { /* scopeMatch error → contractAllow stays false */ }
  } else if (process.env.HORUS_CONTRACT_REQUIRED === "1" && isGated) {
    // No contract + strict mode + gated class → block
    return buildEarlyBlock("no-contract-strict", enriched, discovered, input,
      "no accepted contract — run: horus-cli contract init && horus-cli contract accept",
      { ambientTouch: _ambientTouch });
  }

  // F11: validity-window floor — contract-defined active hours/days.
  // Fires after scopeMatch capture so contractAllow has a chance to set,
  // and before risk classification so the floor can short-circuit.
  let validityResult = { inWindow: true, reason: "no-validity-block" };
  let validityWarning = null;
  if (contract) {
    try {
      validityResult = _contractIsInActiveWindow(contract);
    } catch { /* helper unavailable → treat as in-window (fail-open per zero-dep policy) */ }

    if (!validityResult.inWindow) {
      const payloadClass = String(input.payloadClass || enriched.payloadClass || "A").toUpperCase();
      const pcAction     = contract?.scopes?.payloadClasses?.[payloadClass] || "allow";
      if (pcAction === "warn" || pcAction === "block") {
        return buildEarlyBlock(
          "validity-window", enriched, discovered, input,
          `contract validity inactive (${validityResult.reason}); payloadClass=${payloadClass} action=${pcAction} — failing closed`,
          { floorFired: _F11.name, decisionSource: _F11.source, ambientTouch: _ambientTouch }
        );
      }
      // Non-gated payload class outside-window → annotate, action unchanged.
      validityWarning = { code: "outside-window", reason: validityResult.reason };
    }
  }

  // F12: mcp-deny floor — per-MCP-server policy (scopes.mcp).
  let mcpWarning = null;
  try {
    const serverName = input.mcpServer || _contractExtractMcpServerName(input.tool);
    if (serverName && contract) {
      const policy = _contractGetMcpPolicy(contract, serverName);
      if (policy === "block") {
        return buildEarlyBlock("mcp-deny", enriched, discovered, input,
          `MCP server '${serverName}' denied by contract scopes.mcp`,
          { floorFired: _F12.name, decisionSource: _F12.source, ambientTouch: _ambientTouch });
      }
      if (policy === "warn") {
        mcpWarning = { code: "policy-warn", name: serverName, policy: "warn" };
      }
    }
  } catch { /* helper unavailable → no-op */ }

  // F13: skill-deny floor — per-skill policy (scopes.skills).
  let skillWarning = null;
  try {
    const skillName = input.skillName;
    if (skillName && contract) {
      const policy = _contractGetSkillPolicy(contract, skillName);
      if (policy === "block") {
        return buildEarlyBlock("skill-deny", enriched, discovered, input,
          `Skill '${skillName}' denied by contract scopes.skills`,
          { floorFired: _F13.name, decisionSource: _F13.source, ambientTouch: _ambientTouch });
      }
      if (policy === "warn") {
        skillWarning = { code: "policy-warn", name: skillName, policy: "warn" };
      }
    }
  } catch { /* helper unavailable → no-op */ }

  // F14: budget-exceeded hard floor + session-duration require-review escalation (D47).
  let sessionDurationWarning = null;
  let sessionOverDuration    = false;
  try {
    const sessionId = enriched.sessionId || discovered.sessionId;

    const sessionCfg = _contractGetSessionConstraints(contract);
    const budgetCfg  = _contractGetBudgetLimits(contract);

    if (sessionId && (sessionCfg || budgetCfg) && _getCounters) {
      const counters = _getCounters({ sessionId });

      if (sessionCfg && Number.isFinite(sessionCfg.maxDurationMin)) {
        const ageMin = (Date.now() - counters.startTime) / 60000;
        if (ageMin > sessionCfg.maxDurationMin) {
          sessionDurationWarning = {
            code: "session-over-duration",
            ageMin: Math.round(ageMin),
            limitMin: sessionCfg.maxDurationMin,
          };
          sessionOverDuration = true;
        }
      }

      if (budgetCfg) {
        if (Number.isFinite(budgetCfg.maxDestructiveOps) &&
            counters.destructiveOps >= budgetCfg.maxDestructiveOps) {
          return buildEarlyBlock("budget-exceeded", enriched, discovered, input,
            `destructive-ops budget exceeded: ${counters.destructiveOps}/${budgetCfg.maxDestructiveOps}`,
            { floorFired: _F14.name, decisionSource: _F14.source, ambientTouch: _ambientTouch });
        }
        if (Number.isFinite(budgetCfg.maxExternalBytes) &&
            counters.externalBytes >= budgetCfg.maxExternalBytes) {
          return buildEarlyBlock("budget-exceeded", enriched, discovered, input,
            `external-bytes budget exceeded: ${counters.externalBytes}/${budgetCfg.maxExternalBytes}`,
            { floorFired: _F14.name, decisionSource: _F14.source, ambientTouch: _ambientTouch });
        }
      }
    }
  } catch { /* helper unavailable → no-op */ }

  // F18: network-egress floor (ADR-005) — per-contract domain allowlist for
  // outbound network calls. Default-deny: empty allowDomains blocks all network.
  // Additive opt-in: only enforces when the contract carries a
  // `scopes.network.allowDomains` array. Existing v1/v2/v3 contracts without
  // the field continue to operate exactly as before.
  if (contract) {
    try {
      const netPolicy = _contractGetNetworkPolicy(contract);
      const hasF18Signal = netPolicy && (
        Array.isArray(netPolicy.allowDomains) ||
        Array.isArray(netPolicy.denyDomains) ||
        typeof netPolicy.allowPlaintext === "boolean"
      );
      if (hasF18Signal) {
        const ne = _evalNet(input.command || "", netPolicy);
        if (ne.fired) {
          if (ne.reason === "plaintext-target-blocked") {
            return buildEarlyBlock(
              "plaintext-target-blocked",
              enriched,
              discovered,
              input,
              `network egress blocked: plaintext http:// target '${ne.host}' (set scopes.network.allowPlaintext=true to permit) (target=${ne.target})`,
              { floorFired: _F18D007.name, decisionSource: _F18D007.source, ambientTouch: _ambientTouch }
            );
          }
          const detail =
            ne.reason === "ip-literal-blocked"
              ? `IP-literal host '${ne.host}' blocked (use allowDomains hostnames; loopback exempt)`
              : ne.reason === "deny-domain-match"
                ? `host '${ne.host}' matched denyDomains`
                : `host '${ne.host}' not in network.allowDomains`;
          return buildEarlyBlock(
            "network-egress-denied",
            enriched,
            discovered,
            input,
            `network egress blocked: ${detail} (target=${ne.target})`,
            { floorFired: _F18.name, decisionSource: _F18.source, ambientTouch: _ambientTouch }
          );
        }

        // ADR-005 FC #4: DNS-failure path. When the caller pre-resolved DNS
        // and the lookup failed for an allow-matched host, F18 fires unless
        // the per-entry `allowOnLookupFailure` flag is true. Dormant when
        // input.dnsResolutions is absent (callers may skip resolution).
        if (input.dnsResolutions && typeof input.dnsResolutions === "object") {
          const dnsCheck = _evalNetDns(input.command || "", netPolicy, input.dnsResolutions);
          if (dnsCheck.fired) {
            return buildEarlyBlock(
              "network-egress-denied",
              enriched,
              discovered,
              input,
              `network egress blocked: DNS lookup failed for '${dnsCheck.host}' (resolver=${dnsCheck.resolverCode}) (target=${dnsCheck.target})`,
              {
                floorFired: _F18.name,
                decisionSource: _F18.source,
                ambientTouch: _ambientTouch,
                networkEgress: {
                  failureReason: "dns_lookup_failed",
                  hostname: dnsCheck.host,
                  resolverCode: dnsCheck.resolverCode,
                  target: dnsCheck.target,
                },
              }
            );
          }
        }

        // ADR-005 FC #5: envelope-bound IP recheck at exec-time. The
        // PreToolUse envelope carries the resolved-IP set; the harness
        // adapter reports the actual connected IP(s) via
        // input.observedConnectedIps. Fires if observed IP is not in the set.
        // O(1) Set membership — no DNS re-resolve here.
        if (
          input.envelope &&
          Array.isArray(input.envelope.networkTargets) &&
          Array.isArray(input.observedConnectedIps) &&
          input.observedConnectedIps.length > 0
        ) {
          const ipCheck = _evalNetIpSet(input.envelope.networkTargets, input.observedConnectedIps);
          if (ipCheck.fired) {
            return buildEarlyBlock(
              "network-egress-denied",
              enriched,
              discovered,
              input,
              `network egress blocked: exec-time IP ${ipCheck.observedIp} for host '${ipCheck.host}' not in envelope-bound set [${(ipCheck.envelopeBoundIps || []).join(",")}]`,
              {
                floorFired: _F18.name,
                decisionSource: _F18.source,
                ambientTouch: _ambientTouch,
                networkEgress: {
                  failureReason: "ip_set_mismatch",
                  hostname: ipCheck.host,
                  observedIp: ipCheck.observedIp,
                  envelopeBoundIps: ipCheck.envelopeBoundIps || [],
                },
              }
            );
          }
        }
      }
    } catch { /* network-egress unavailable → no-op (fail-open per zero-dep policy) */ }
  }

  // F15: execution-envelope divergence floor — fail closed when the adapter's
  // observed execution envelope differs from the decision envelope.
  let envelopeVerification = null;
  if (input.envelope && input.observedEnvelope) {
    try {
      const { verify } = require("./envelope");
      envelopeVerification = verify(input.envelope, input.observedEnvelope, {
        enforceEnvDiff: input.enforceEnvDiff !== false,
      });
      if (!envelopeVerification.ok) {
        return buildEarlyBlock(
          "execution-envelope-diverged",
          enriched,
          discovered,
          input,
          `execution envelope diverged (${envelopeVerification.reason}) — failing closed`,
          {
            floorFired: _F15.name,
            decisionSource: _F15.source,
            ambientTouch: _ambientTouch,
            envelopeVerification,
          }
        );
      }
    } catch (verifyErr) {
      return buildEarlyBlock(
        "execution-envelope-diverged",
        enriched,
        discovered,
        input,
        `execution envelope verify error (${verifyErr instanceof Error ? verifyErr.message : "unknown"}) — failing closed`,
        {
          floorFired: _F15.name,
          decisionSource: _F15.source,
          ambientTouch: _ambientTouch,
        }
      );
    }
  }

  // F16 (ADR-009 PR-B): ambient-authority floor — rung 17.5, after F15 (envelope)
  // and before the contract-allow demotion path. Non-demotable; the only legitimate
  // bypass is a matching `scopes.ambient.allow[]` entry. Fail-open on internal throw.
  try {
    const f16 = _evalAmbientFloor(input, discovered, contract);
    if (f16 && f16.fire) {
      return buildEarlyBlock(
        "ambient-authority-denied", enriched, discovered, input,
        `ambient-authority write blocked: class=${f16.ambientClass} path=${f16.path}`,
        { floorFired: _F16.name, decisionSource: _F16.source, ambientClass: f16.ambientClass, ambientPath: f16.path }
      );
    }
  } catch { /* fail-open per zero-dep policy */ }

  // F17 PR-A: cross-agent-lock floor — rung 17.75, after F16 and before
  // contract-allow demotion. Fires when a write-like call targets a
  // path/project already held by a different agent's lock that is not
  // expired. Non-demotable. Fail-CLOSED for write-like when lock state is
  // malformed (`state.ok=false`); other unexpected throws fail open per the
  // engine's zero-dep / fail-open policy.
  try {
    const f17 = _evalCrossAgentLockFloor(input, discovered, enriched);
    if (f17 && f17.fire) {
      const detail = f17.reason === "lock-state-malformed"
        ? "lock state malformed — failing closed"
        : `lock owner=${f17.lockOwner || ""} project=${f17.lockProject || ""}`;
      return buildEarlyBlock(
        "cross-agent-lock-denied", enriched, discovered, input,
        `cross-agent lock blocked: ${detail}`,
        {
          floorFired: _F17.name,
          decisionSource: _F17.source,
          ambientTouch: _ambientTouch,
          lockOwner: f17.lockOwner,
          lockPath: f17.lockPath,
          lockProject: f17.lockProject,
          lockExpiresAt: f17.lockExpiresAt,
        }
      );
    }
  } catch { /* fail-open per zero-dep policy */ }

  // F19 (ADR-010): output-channel-exfiltration floor — rung 17.875, after F17
  // and before the contract-allow demotion rung (18). Two paths:
  //
  //   - `confirmed` severity → early-block via buildEarlyBlock(). Non-demotable
  //     in the lattice (only `operator-token-suspicious-only` is listed in
  //     demotableBy, and that path is severity-gated below).
  //   - `suspicious` severity OR `compensating` (PreToolUse on a not-observed
  //     channel) → set action/source/floorFired so the rest of the engine flow
  //     sees `require-review`. Demotable to `allow` only by a one-shot scoped
  //     operator token (scope: `output-exfil-review-demote`); contract-allow
  //     cannot demote because action becomes `require-review` BEFORE the
  //     contract-allow check fires.
  //
  // Receipt enrichment fields (outputChannel, matchClasses, redactedSample,
  // compensatingRestrictionApplied) ride on `_f19Detail` and are spread into
  // both the final result + journal append below.
  let _f19Detail = null;
  let _f19PreviewAction = null; // pre-decision action when F19 fires non-block
  let _f19PreviewSource = null;
  try {
    const f19 = _evalF19Floor(input);
    if (f19 && f19.fire) {
      const matchClasses = (f19.matches || [])
        .map((m) => (m && typeof m.class === "string" ? m.class : null))
        .filter((c) => c != null);
      const baseDetail = {
        outputChannel: f19.channel,
        matchClasses,
        redactedSample: typeof f19.redactedSample === "string" ? f19.redactedSample : "",
        compensatingRestrictionApplied: Boolean(f19.compensatingApplied),
        compensatingRestriction: f19.compensatingRestriction || null,
        channelObservability: f19.channelObservability,
        severity: f19.severity,
        phase: f19.phase,
      };

      if (f19.severity === "confirmed") {
        return buildEarlyBlock(
          "output-exfil-denied", enriched, discovered, input,
          `output-channel exfiltration blocked: channel=${f19.channel} severity=confirmed classes=${matchClasses.join(",")}`,
          {
            floorFired: _F19.name,
            decisionSource: _F19.source[0],
            ambientTouch: _ambientTouch,
            f19Detail: baseDetail,
          }
        );
      }

      // Severity is `suspicious` or `compensating`.
      // Attempt operator-token demotion only when the LATTICE demotableBy
      // explicitly authorizes it for this severity. `compensating` requires
      // a declared compensatingRestriction to be eligible.
      const tokenEnv = process.env.HORUS_F19_DEMOTE_TOKEN || "";
      let demoted = false;
      const demotionLatticed = canDemote(_F19.id, _DEMOTE_F19_SUSPICIOUS);
      const severityEligible =
        f19.severity === "suspicious" ||
        (f19.severity === "compensating" && f19.compensatingRestriction);
      if (tokenEnv && demotionLatticed && severityEligible) {
        try {
          demoted = _contractConsumeScopedOperatorToken(tokenEnv, _DEMOTE_F19_TOKEN_SCOPE);
        } catch { /* token mech unavailable → fail closed (no demotion) */ }
      }
      if (demoted) {
        // Demotion path: result is allow, receipt records the override.
        // _F19.source[1] is the LATTICE-anchored demoted-variant tag.
        _f19PreviewAction = "allow";
        _f19PreviewSource = _F19.source[1];
        _f19Detail = { ...baseDetail, demoted: true };
      } else {
        _f19PreviewAction = "require-review";
        _f19PreviewSource = _F19.source[0];
        _f19Detail = { ...baseDetail, demoted: false };
      }
    }
  } catch { /* fail-open per zero-dep policy */ }

  const learnedAllow = isLearnedAllowed(enriched);
  const risk = score(enriched);
  const policyKey = fineKey(enriched);
  let action = "allow";
  let source = _F3.source; // baseline "risk-engine" — derived from LATTICE.F3.source
  // floorFired holds the LATTICE entry name of the first floor that fired
  // (string written into the receipt + journal). canDemote() lookups in this
  // function use the corresponding LATTICE id; the two stay in sync because
  // every assignment below routes through a _Fx.name read.
  let floorFired = null;

  if (risk.level === "critical") {
    action = "block";
    floorFired = _F3.name;
  } else if (risk.level === "high" && risk.reasons.includes("protected-branch")) {
    // Floor: protected-branch write always requires review; contract-allow cannot demote it (B4).
    action = "require-review";
    floorFired = _F8.name;
  } else if (risk.level === "high" && risk.reasons.includes("destructive-delete-pattern")) {
    // Learned-allow is permitted only for the destructive-delete-pattern case at high risk.
    action = learnedAllow ? "allow" : "require-tests";
  } else if (risk.level === "high") {
    action = "escalate";
  } else if (risk.level === "medium" && risk.reasons.includes("sensitive-target-path")) {
    // B2: sensitive-target medium risk is NOT demotable by learned-allow.
    action = "modify";
  } else if (risk.level === "medium") {
    // B2: generic medium risk is NOT demotable by learned-allow.
    action = "route";
  } else {
    action = "allow";
  }

  // Learned-allow source: only when it actually demoted a destructive-delete-pattern hit.
  if (learnedAllow && risk.level === "high" && risk.reasons.includes("destructive-delete-pattern") && action === "allow") {
    source = _LA.source;
  }

  // F4 (D26 + ADR-002 B): secret-class-C payload floor — rung 4 in the precedence matrix.
  // Fires when payloadClass is explicitly C, OR when the command text contains a
  // class-C secret pattern (API key, credential, private key). Floor = block by default.
  // Cannot be demoted by contract-allow. payloadClass D does not exist in the schema.
  //
  // ADR-002 Option B: an operator can demote F4 from `block` to `require-review` for
  // legitimate inspection use cases (incident response, customer-data audit, security
  // investigation) by minting a one-shot scoped token and passing it via
  // HORUS_F4_DEMOTE_TOKEN. The token is single-use and scope-bound to
  // `class-c-review-demote`. Without a valid token, F4 stays a hard block.
  if (action !== "block") {
    const isClassC = (enriched.payloadClass || "A") === "C";
    let secretInCommand = false;
    if (!isClassC && _scanSecrets) {
      try {
        secretInCommand = Boolean(_scanSecrets(input.command || ""));
      } catch { /* secret-scan unavailable — skip */ }
    }
    if (isClassC || secretInCommand) {
      // ADR-002 Option B: demotion authorization is the LATTICE.F4.demotableBy
      // gate via canDemote(F4.id, operator-token:class-c-review-demote). Token
      // presence is necessary but not sufficient — canDemote() is the sole
      // arbiter so future drift cannot bypass the lattice.
      let f4DemoteAllowed = false;
      const demoteToken = process.env.HORUS_F4_DEMOTE_TOKEN || "";
      // ADR-004 PR 37B: in degraded mode the F4 operator-token demotion is
      // suppressed entirely — F4 stays a hard block even with a valid token.
      // Token is not consumed (so the operator does not waste it during an
      // incident); clearing degraded mode lets the next decide() honor it.
      if (demoteToken && canDemote(_F4.id, _DEMOTE_F4_OPERATOR_TOKEN) && !_degradedState.degraded) {
        try {
          f4DemoteAllowed = _contractConsumeScopedOperatorToken(demoteToken, "class-c-review-demote");
        } catch { /* token mech unavailable — fail closed (no demotion) */ }
      }
      if (f4DemoteAllowed) {
        action = "require-review";
        // F4.source is ["secret-class-C", "f4-class-c-demoted"]; element 1 is
        // the demoted variant per LATTICE.F4.
        source = _F4.source[1];
        floorFired = floorFired || _F4.name;
      } else {
        action = "block";
        floorFired = floorFired || _F4.name;
      }
    }
  }

  // F10 (A2): taint floor — command overlaps with recently-read external content.
  // Fires at rung 8.5 (after protected-branch, before session-risk). Forces
  // require-review so the operator can confirm the command was not injected.
  // Best-effort: if taint module unavailable, skip silently.
  let taintResult = null;
  if (_correlateCommand) {
    try {
      taintResult = _correlateCommand(input.command || "", undefined, input.tool || "");
      if (taintResult.tainted && action !== "block") {
        action = "require-review";
        source = _F10.source;
        floorFired = floorFired || _F10.name;
      }
    } catch (taintErr) {
      if (!_taintWarnedOnce) {
        _taintWarnedOnce = true;
        try { append({ kind: "taint-floor-disabled", error: String(taintErr && taintErr.message || taintErr) }); } catch { /* journal is best-effort */ }
      }
    }
  } else if (!_taintWarnedOnce) {
    _taintWarnedOnce = true;
    try { append({ kind: "taint-floor-disabled", error: "module not found" }); } catch { /* journal is best-effort */ }
  }

  // F9 (B3): session-risk >= 3 — true floor. Escalate unconditionally before
  // contract-allow can demote (the demotion path below routes through canDemote).
  if (enriched.sessionRisk >= 3 && action !== "block" && action !== "escalate") {
    action = "escalate";
    source = _F9.source;
    floorFired = floorFired || _F9.name;
  }

  // F6 (D26): posture-strict-no-cover floor — rung 6 in the precedence matrix.
  // Fires when trust posture is strict AND the command class is gated AND
  // scopeMatch did not cover it (contractAllow=false, no operator-signal bypass).
  // Trigger: trustPosture === "strict" + isGated + !contractAllow. Floor = block.
  // Does NOT fire in balanced or relaxed posture — locked semantic per D26.
  if (action !== "block" && isGated && !contractAllow && enriched.trustPosture === "strict") {
    action = "block";
    source = _F6.source;
    floorFired = floorFired || _F6.name;
  }

  // F7 (D26 + ADR-001 D): intent-unknown-strict floor — rung 7 in the precedence matrix.
  // Fires when the intent classifier returns "unknown" AND trust posture is strict.
  // A command the classifier cannot recognize is inherently higher-risk in strict
  // mode — no contract scope can cover what the engine cannot categorise.
  // Trigger: intentResult.intent === "unknown" + trustPosture === "strict".
  // Action: require-review (operator must approve before execution).
  // Does NOT fire in balanced or relaxed posture — locked semantic per D26.
  // ADR-001 D: changed from "block" to "require-review" so descriptive commands
  // ("update module", "edit file") in strict mode prompt for review instead of
  // killing the work outright. Block remains for genuinely critical risk via
  // earlier rungs (kill-switch, critical-risk, etc.).
  if (action !== "block" && action !== "require-review" && intentResult.intent === "unknown" && enriched.trustPosture === "strict") {
    action = "require-review";
    source = _F7.source;
    floorFired = floorFired || _F7.name;
  }

  // Step 11: contract-allow — demotes baseline only; never demotes hard floors.
  // B4: protects require-review (protected-branch floor) from demotion.
  // W11: tool-allow reason permits escalate demotion. When an active F9
  // (session-risk-floor) is the escalating floor, the demotion routes through
  // canDemote(F9.id, contract-allow:tool-allow-*) so LATTICE.F9.demotableBy is
  // the sole arbiter. Non-F9 escalates (baseline risk-engine high-risk)
  // preserve the original W11 carve-out without consulting canDemote (no floor
  // to authorize against).
  const _attemptedF9DemoteSource = contractReason === "tool-allow-matched"
    ? _DEMOTE_F9_TOOL_ALLOW_MATCHED
    : contractReason === "tool-allow-tool-scope"
      ? _DEMOTE_F9_TOOL_ALLOW_SCOPE
      : null;
  const _isF9Escalate = floorFired === _F9.name;
  const _canDemoteF9 = _isF9Escalate && _attemptedF9DemoteSource != null &&
    canDemote(_F9.id, _attemptedF9DemoteSource);
  const _canDemoteBaselineEscalate = !_isF9Escalate &&
    (contractReason === "tool-allow-matched" || contractReason === "tool-allow-tool-scope");
  const canDemoteEscalate = contractAllow && (_canDemoteF9 || _canDemoteBaselineEscalate);
  if (contractAllow &&
      risk.level !== "critical" &&
      action !== "block" &&
      action !== "require-review" &&
      (action !== "escalate" || canDemoteEscalate)) {
    action = "allow";
    source = contractReason === "tool-allow-tool-scope" ? _CA.source[1] : _CA.source[0];
    // F9-demoted state — receipt reflects via source, clear the floor stamp.
    if (_canDemoteF9) floorFired = null;
  }

  // ADR-004 PR 37B: skip auto-allow-once consumption entirely when we are
  // degraded + write-like; the write-like override below would flip the
  // resulting allow→require-review anyway, and consuming the token here
  // would waste it during the incident the operator is investigating.
  if (
    source !== _LA.source &&
    !source.startsWith("contract-allow") &&
    risk.level !== "critical" &&
    risk.level !== "high" &&
    action !== "allow" &&
    hasAutoAllowOnce(policyKey) &&
    !(_degradedState.degraded && _writeLike)
  ) {
    consumeAutoAllowOnce(policyKey);
    action = "allow";
    source = _AAO.source;
  }

  const trajectory = getSessionTrajectory();
  const trajectoryThreshold = Number(process.env.HORUS_TRAJECTORY_THRESHOLD || "3");
  let trajectoryNudge = null;
  // Trajectory-nudge applies to baseline risk-engine decisions only. Floor-derived
  // sources (intent-unknown-strict, taint-floor, session-risk-floor, f4-class-c-demoted,
  // posture-strict-no-cover, etc.) are explicit policy decisions that already encode
  // the right severity for their trigger condition; nudging them further would compound
  // the escalation. ADR-001 D made this matter for F7 (was block, now require-review);
  // ADR-002 B made it matter for F4 demotion path. The contract-allow / learned-allow /
  // auto-allow-once exclusions are preserved (those are demotions, not floors).
  if (source === _F3.source && trajectory.recentEscalations >= trajectoryThreshold) {
    if (action === "allow") { action = "route"; trajectoryNudge = "allow\u2192route"; }
    else if (action === "route") { action = "require-review"; trajectoryNudge = "route\u2192require-review"; }
    else if (action === "require-review") { action = "escalate"; trajectoryNudge = "require-review\u2192escalate"; }
    if (trajectoryNudge) source = _TN.source;
  }

  // F14b: session-over-duration require-review escalation (D47).
  // Asserted AFTER all demotion blocks so contract-allow / auto-allow-once / trajectory-nudge
  // cannot silently undo it. Operator declared "after N minutes, stop and ask me" — same
  // pattern as F10 taint-floor: change action, not just annotate.
  if (sessionOverDuration) {
    action = "require-review";
    source = _F14b.source;
    floorFired = floorFired || _F14b.name;
  }

  // F19 (ADR-010): apply the suspicious / compensating override after F14b so
  // contract-allow / auto-allow-once / trajectory-nudge cannot silently undo
  // an F19-tagged require-review. Demoted-to-allow (via the operator token
  // consumed above) lands here too — but never weakens a stronger action that
  // a higher-priority floor (F3/F4/F8/F10/F14b/etc.) already wrote.
  if (_f19PreviewAction === "require-review") {
    if (action !== "block" && action !== "escalate") {
      action = "require-review";
    }
    source = _F19.source[0];
    floorFired = floorFired || _F19.name;
  } else if (_f19PreviewAction === "allow") {
    // Operator-token demoted F19 to allow. Preserve any stronger action that
    // an unrelated higher-priority floor produced (block/require-review/etc.).
    if (
      action !== "block" &&
      action !== "require-review" &&
      action !== "escalate" &&
      action !== "require-tests"
    ) {
      action = "allow";
      source = _F19.source[1];
    }
    floorFired = floorFired || _F19.name;
  }

  // ADR-004 PR 37B: degraded-mode write-like routing. When the journal hash
  // chain has failed verify (or HORUS_DEGRADED_MODE=1) AND this call is
  // write-like, any final `allow` is rerouted to `require-review`. Floors
  // that already produced require-review / escalate / block are preserved
  // verbatim — degraded mode never widens an allow nor weakens an existing
  // gate. The receipt's `degradedMode.writeRouting` records the original
  // action so audit can reconstruct the override.
  let _degradedWriteRouted = null;
  if (_degradedState.degraded && _writeLike && action === "allow") {
    _degradedWriteRouted = source;
    action = "require-review";
  }
  // Final marker for receipt/journal — includes writeRouting when the
  // override fired so audit can tell the difference between "degraded
  // chain, write-like allow rerouted" and "degraded chain, action was
  // already require-review/block".
  const _degradedReceiptMarker = _degradedState.degraded
    ? _degradedMode.buildMarker(_degradedState, _degradedWriteRouted
        ? { writeRouting: "allow-to-require-review" }
        : null)
    : null;

  const pendingSuggestion = getSuggestionForInput(enriched);
  const policyFacts = getPolicyFacts(enriched);
  const promotionState = policyFacts.acceptedSuggestion || policyFacts.dismissedSuggestion || policyFacts.pendingSuggestion || null;
  const explanationParts = [
    `action=${action}`,
    `risk=${risk.level}:${risk.score}`,
    `source=${source}`,
  ];
  if (risk.reasons.length > 0) explanationParts.push(`reasons=${risk.reasons.join(",")}`);
  if (pendingSuggestion?.status === "pending") explanationParts.push(`suggestion=pending:${policyKey}`);
  if (learnedAllow && source === _LA.source) explanationParts.push("learned-allow=matched");
  if (source === _AAO.source) explanationParts.push("auto-allow-once=consumed");
  if (trajectoryNudge) explanationParts.push(`trajectory-nudge=${trajectoryNudge} (${trajectory.recentEscalations} recent escalations in session)`);
  if (projectPolicy.projectScope && projectPolicy.projectScope !== 'global') explanationParts.push(`project=${projectPolicy.projectScope}`);
  if (discovered.primaryStack) explanationParts.push(`stack=${discovered.primaryStack}`);
  if (discovered.hasConfig === false && discovered.primaryStack) explanationParts.push('config=missing');
  if (projectPolicy.trustPosture) explanationParts.push(`trust=${projectPolicy.trustPosture}`);
  if (intentResult.intent !== "unknown") explanationParts.push(`intent=${intentResult.intent}`);
  if (validityWarning) explanationParts.push("validity-warn=outside-window");
  if (mcpWarning)            explanationParts.push(`mcp-warn=${mcpWarning.name}`);
  if (skillWarning)          explanationParts.push(`skill-warn=${skillWarning.name}`);
  if (sessionDurationWarning) explanationParts.push(`session-over-duration=age:${sessionDurationWarning.ageMin}min/limit:${sessionDurationWarning.limitMin}min`);
  if (input.envelope?.hash) explanationParts.push(`envelope=${input.envelope.hash}`);
  // ADR-004 PR 37B: surface degraded-mode + write-routing in the explanation
  // so receipts on disk (and `horus doctor`) make the override visible.
  if (_degradedState.degraded) {
    explanationParts.push(`degraded-mode=${_degradedState.reason}`);
    if (_degradedWriteRouted) explanationParts.push("degraded-write-routed=allow→require-review");
  }

  const actionPlan = build(action, enriched, risk, discovered, policyFacts);
  const promotionGuidance = evaluate(policyFacts, risk);

  if (promotionGuidance.stage !== "new" && promotionGuidance.stage !== "promoted") {
    explanationParts.push(`promotion=${promotionGuidance.stage}`);
  }
  if (source.startsWith("contract-allow") && contractId)  explanationParts.push(`contract=${contractId}`);
  if (source.startsWith("contract-allow") && contractReason) explanationParts.push(`scope=${contractReason}`);

  const lifecycleSummary = promotionState
    ? [
        promotionState.createdAt ? `created=${promotionState.createdAt}` : null,
        promotionState.eligibleAt ? `eligible=${promotionState.eligibleAt}` : null,
        promotionState.acceptedAt ? `accepted=${promotionState.acceptedAt}` : null,
        promotionState.dismissedAt ? `dismissed=${promotionState.dismissedAt}` : null,
        promotionState.lastApprovedAt ? `last-approved=${promotionState.lastApprovedAt}` : null,
      ].filter(Boolean).join(" | ")
    : null;

  const workflowRoute = recommend(action, enriched, risk, discovered);

  const result = {
    action,
    enforcementAction: ["block", "escalate", "require-review", "require-tests"].includes(action) ? "block" : "warn",
    floorFired: floorFired || null,
    riskScore: risk.score,
    riskLevel: risk.level,
    reasonCodes: risk.reasons,
    confidence: source === _LA.source
      ? 0.92
      : risk.level === "low"
        ? 0.9
        : risk.level === "medium"
          ? 0.75
          : risk.level === "high"
            ? 0.55
            : 0.95,
    decisionSource: source,
    policyKey,
    explanation: explanationParts.join(" | "),
    pendingSuggestion: pendingSuggestion?.status === "pending" ? pendingSuggestion.key : null,
    promotionGuidance,
    promotionState,
    promotionLifecycleSummary: lifecycleSummary,
    workflowRoute,
    actionPlan,
    trajectoryNudge,
    envelope: input.envelope || null,
    envelopeVerification,
    intent: intentResult.intent,
    context: risk.context,
    ...(validityWarning ? { validityWarning } : {}),
    ...(mcpWarning            ? { mcpWarning }            : {}),
    ...(skillWarning          ? { skillWarning }          : {}),
    ...(sessionDurationWarning ? { sessionDurationWarning } : {}),
    // ADR-009 PR-C: receipt enrichment on every ambient-touch decision.
    ...(_ambientTouch.class ? { ambientClass: _ambientTouch.class } : {}),
    ...(_ambientTouch.path  ? { ambientPath:  _ambientTouch.path  } : {}),
    // ADR-004 PR 37B: degraded-mode marker on every decision while the
    // chain has failed verify. Absent on healthy chains so existing
    // receipts stay byte-identical.
    ...(_degradedReceiptMarker ? { degradedMode: _degradedReceiptMarker } : {}),
    // F19 (ADR-010): output-channel exfiltration detail. Present only when
    // F19 fired (confirmed early-blocks are handled in buildEarlyBlock).
    ...(_f19Detail ? {
      outputChannel: _f19Detail.outputChannel || null,
      matchClasses: Array.isArray(_f19Detail.matchClasses) ? _f19Detail.matchClasses : [],
      redactedSample: typeof _f19Detail.redactedSample === "string" ? _f19Detail.redactedSample : "",
      compensatingRestrictionApplied: Boolean(_f19Detail.compensatingRestrictionApplied),
    } : {}),
  };

  const irExtras = _irJournalExtras(input, floorFired);
  append({
    kind: "runtime-decision",
    action: result.action,
    riskLevel: result.riskLevel,
    riskScore: result.riskScore,
    reasonCodes: result.reasonCodes,
    tool: input.tool || "",
    intent: intentResult.intent,
    branch: input.branch || "",
    targetPath: input.targetPath || "",
    notes: `${source}${input.notes ? ` | ${input.notes}` : ""}`,
    ...(contractId ? { contractId, contractRevision: contract?.revision } : {}),
    ...(source === _CA.source[0] ? { scopeHit: contractReason } : {}),
    ...(floorFired ? { floorFired } : {}),
    ...(taintResult?.tainted ? { taintSource: taintResult.source, taintReason: taintResult.reason } : {}),
    ...(validityWarning ? { validityWarning } : {}),
    ...(mcpWarning            ? { mcpWarning }            : {}),
    ...(skillWarning          ? { skillWarning }          : {}),
    ...(sessionDurationWarning ? { sessionDurationWarning } : {}),
    ...(_ambientTouch.class ? { ambientClass: _ambientTouch.class } : {}),
    ...(_ambientTouch.path  ? { ambientPath:  _ambientTouch.path  } : {}),
    ...(_degradedReceiptMarker ? { degradedMode: _degradedReceiptMarker } : {}),
    ...(_f19Detail ? { f19Detail: _f19Detail } : {}),
    ...(irExtras || {}),
    redact: Boolean(contract?.scopes?.secrets?.redactInJournal),
  });

  recordDecision({
    action: result.action,
    riskLevel: result.riskLevel,
    reasonCodes: result.reasonCodes,
  });

  // Increment destructive-op counter after an allowed destructive-delete — F14 checks at next decide().
  try {
    if (action === "allow" && cmdClass === "destructive-delete" && _recordDestructiveOp) {
      _recordDestructiveOp({ sessionId: enriched.sessionId || discovered.sessionId });
    }
  } catch { /* session-budget unavailable → no-op */ }

  return result;
}

module.exports = { decide };
