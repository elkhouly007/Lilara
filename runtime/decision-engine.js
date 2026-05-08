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

// Taint-floor disablement: warn once per process if taint module unavailable.
let _taintWarnedOnce = false;

// Contract is loaded lazily — disabled only when HORUS_CONTRACT_ENABLED=0
let _contract = null;
function getContract(projectRoot) {
  if (process.env.HORUS_CONTRACT_ENABLED === "0") return null;
  if (_contract !== null) return _contract;
  try {
    const { load } = require("./contract");
    _contract = load(projectRoot || process.cwd());
  } catch { _contract = null; }
  return _contract;
}

// Gated capability classes — single source of truth from contract.js.
const { GATED_CLASSES: GATED_COMMAND_CLASSES } = require("./contract");

// ---------------------------------------------------------------------------
// Helpers for early-block returns (keep decide() readable)
// ---------------------------------------------------------------------------

function harnessInScope(contract, harness) {
  return Array.isArray(contract?.harnessScope) && contract.harnessScope.includes(harness);
}

function buildEarlyBlock(reasonCode, enriched, discovered, input, explanation) {
  const result = {
    action: "block",
    enforcementAction: "block",
    riskScore: 10,
    riskLevel: "critical",
    reasonCodes: [reasonCode],
    confidence: 1,
    decisionSource: "contract-floor",
    policyKey: reasonCode,
    explanation,
    pendingSuggestion: null,
    promotionGuidance: null,
    promotionState: null,
    promotionLifecycleSummary: null,
    workflowRoute: null,
    actionPlan: null,
    trajectoryNudge: null,
    context: {},
  };
  // Still journal the early block so diff-decisions can replay it
  try {
    append({
      kind: "runtime-decision",
      action: "block",
      riskLevel: "critical",
      riskScore: 10,
      reasonCodes: [reasonCode],
      tool: input.tool || "",
      branch: input.branch || "",
      targetPath: input.targetPath || "",
      notes: `contract-floor:${reasonCode}`,
    });
    recordDecision({ action: "block", riskLevel: "critical", reasonCodes: [reasonCode] });
  } catch { /* journal is best-effort */ }
  return result;
}

function decide(input = {}) {
  if (process.env.HORUS_KILL_SWITCH === "1") {
    return {
      action: "block",
      enforcementAction: "block",
      riskScore: 10,
      riskLevel: "critical",
      reasonCodes: ["kill-switch"],
      confidence: 1,
      decisionSource: "kill-switch",
      policyKey: "kill-switch",
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

  // Classify command intent for routing intelligence and journaling
  const intentResult = classifyIntent(input.command || "");

  // ── Section 4.6 precedence matrix: contract verification (Steps 2 + 5) ──
  const contract    = getContract(discovered.projectRoot || process.cwd());
  const cmdClass    = classifyCommand(input.command || "");
  const isGated     = GATED_COMMAND_CLASSES.has(cmdClass);
  let contractAllow = false;
  let contractReason = null;
  let contractId    = contract?.contractId || null;

  if (contract) {
    // Step 2: contract-hash-mismatch in strict mode — block
    if (process.env.HORUS_CONTRACT_REQUIRED === "1") {
      try {
        const { verify } = require("./contract");
        const vResult = verify(discovered.projectRoot || process.cwd());
        if (!vResult.ok) {
          return buildEarlyBlock(
            "contract-hash-mismatch", enriched, discovered, input,
            `contract hash mismatch (${vResult.reason}) — failing closed`
          );
        }
      } catch (verifyErr) {
        // verify threw — fail closed in strict mode
        return buildEarlyBlock(
          "contract-hash-mismatch", enriched, discovered, input,
          `contract verify error (${verifyErr instanceof Error ? verifyErr.message : "unknown"}) — failing closed`
        );
      }
    }

    // Step 5: strict-mode + gated class + no contract coverage → block
    const harness = String(input.harness || enriched.harness || "");
    if (process.env.HORUS_CONTRACT_REQUIRED === "1" && harness && !harnessInScope(contract, harness)) {
      if (isGated) {
        return buildEarlyBlock("harness-out-of-scope", enriched, discovered, input,
          `harness '${harness}' not in contract harnessScope — run: horus-cli contract amend --add-harness ${harness}`);
      }
    }

    // Step 11: contract scope-allow — may demote baseline (but never demotes floors)
    try {
      const { scopeMatch } = require("./contract");
      const sm = scopeMatch(contract, {
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
      "no accepted contract — run: horus-cli contract init && horus-cli contract accept");
  }

  // F11: validity-window floor — contract-defined active hours/days.
  // Fires after scopeMatch capture so contractAllow has a chance to set,
  // and before risk classification so the floor can short-circuit.
  let validityResult = { inWindow: true, reason: "no-validity-block" };
  let validityWarning = null;
  if (contract) {
    try {
      const { isInActiveWindow } = require("./contract");
      validityResult = isInActiveWindow(contract);
    } catch { /* helper unavailable → treat as in-window (fail-open per zero-dep policy) */ }

    if (!validityResult.inWindow) {
      const payloadClass = String(input.payloadClass || enriched.payloadClass || "A").toUpperCase();
      const pcAction     = contract?.scopes?.payloadClasses?.[payloadClass] || "allow";
      if (pcAction === "warn" || pcAction === "block") {
        return buildEarlyBlock(
          "validity-window", enriched, discovered, input,
          `contract validity inactive (${validityResult.reason}); payloadClass=${payloadClass} action=${pcAction} — failing closed`
        );
      }
      // Non-gated payload class outside-window → annotate, action unchanged.
      validityWarning = { code: "outside-window", reason: validityResult.reason };
    }
  }

  const learnedAllow = isLearnedAllowed(enriched);
  const risk = score(enriched);
  const policyKey = fineKey(enriched);
  let action = "allow";
  let source = "risk-engine";
  // Tracks the first floor that constrained the final action (written to journal).
  let floorFired = null;

  if (risk.level === "critical") {
    action = "block";
    floorFired = "critical-risk";
  } else if (risk.level === "high" && risk.reasons.includes("protected-branch")) {
    // Floor: protected-branch write always requires review; contract-allow cannot demote it (B4).
    action = "require-review";
    floorFired = "protected-branch";
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
    source = "learned-allow";
  }

  // F10 (A2): taint floor — command overlaps with recently-read external content.
  // Fires at rung 8.5 (after protected-branch, before session-risk). Forces
  // require-review so the operator can confirm the command was not injected.
  // Best-effort: if taint module unavailable, skip silently.
  let taintResult = null;
  try {
    const { correlateCommand } = require("./taint");
    taintResult = correlateCommand(input.command || "");
    if (taintResult.tainted && action !== "block") {
      action = "require-review";
      source = "taint-floor";
      floorFired = floorFired || "taint-floor";
    }
  } catch (taintErr) {
    if (!_taintWarnedOnce) {
      _taintWarnedOnce = true;
      try { append({ kind: "taint-floor-disabled", error: String(taintErr && taintErr.message || taintErr) }); } catch { /* journal is best-effort */ }
    }
  }

  // B3: session-risk >= 3 — true floor. Escalate unconditionally before contract-allow can demote.
  if (enriched.sessionRisk >= 3 && action !== "block" && action !== "escalate") {
    action = "escalate";
    source = "session-risk-floor";
    floorFired = floorFired || "session-risk-floor";
  }

  // Step 11: contract-allow — demotes baseline only; never demotes hard floors.
  // B4: protects require-review (protected-branch floor) from demotion.
  // W11: tool-allow reason permits escalate demotion (explicit per-tool pre-approval).
  const canDemoteEscalate = contractAllow && contractReason === "tool-allow-matched";
  if (contractAllow &&
      risk.level !== "critical" &&
      action !== "block" &&
      action !== "require-review" &&
      (action !== "escalate" || canDemoteEscalate)) {
    action = "allow";
    source = "contract-allow";
  }

  if (source !== "learned-allow" && source !== "contract-allow" && risk.level !== "critical" && risk.level !== "high" && action !== "allow" && hasAutoAllowOnce(policyKey)) {
    consumeAutoAllowOnce(policyKey);
    action = "allow";
    source = "auto-allow-once";
  }

  const trajectory = getSessionTrajectory();
  const trajectoryThreshold = Number(process.env.HORUS_TRAJECTORY_THRESHOLD || "3");
  let trajectoryNudge = null;
  if (source !== "learned-allow" && source !== "auto-allow-once" && source !== "contract-allow" && trajectory.recentEscalations >= trajectoryThreshold) {
    if (action === "allow") { action = "route"; trajectoryNudge = "allow\u2192route"; }
    else if (action === "route") { action = "require-review"; trajectoryNudge = "route\u2192require-review"; }
    else if (action === "require-review") { action = "escalate"; trajectoryNudge = "require-review\u2192escalate"; }
    if (trajectoryNudge) source = "trajectory-nudge";
  }

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
  if (learnedAllow && source === "learned-allow") explanationParts.push("learned-allow=matched");
  if (source === "auto-allow-once") explanationParts.push("auto-allow-once=consumed");
  if (trajectoryNudge) explanationParts.push(`trajectory-nudge=${trajectoryNudge} (${trajectory.recentEscalations} recent escalations in session)`);
  if (projectPolicy.projectScope && projectPolicy.projectScope !== 'global') explanationParts.push(`project=${projectPolicy.projectScope}`);
  if (discovered.primaryStack) explanationParts.push(`stack=${discovered.primaryStack}`);
  if (discovered.hasConfig === false && discovered.primaryStack) explanationParts.push('config=missing');
  if (projectPolicy.trustPosture) explanationParts.push(`trust=${projectPolicy.trustPosture}`);
  if (intentResult.intent !== "unknown") explanationParts.push(`intent=${intentResult.intent}`);
  if (validityWarning) explanationParts.push("validity-warn=outside-window");

  const actionPlan = build(action, enriched, risk, discovered, policyFacts);
  const promotionGuidance = evaluate(policyFacts, risk);

  if (promotionGuidance.stage !== "new" && promotionGuidance.stage !== "promoted") {
    explanationParts.push(`promotion=${promotionGuidance.stage}`);
  }
  if (source === "contract-allow" && contractId)  explanationParts.push(`contract=${contractId}`);
  if (source === "contract-allow" && contractReason) explanationParts.push(`scope=${contractReason}`);

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
    riskScore: risk.score,
    riskLevel: risk.level,
    reasonCodes: risk.reasons,
    confidence: source === "learned-allow"
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
    intent: intentResult.intent,
    context: risk.context,
    ...(validityWarning ? { validityWarning } : {}),
  };

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
    ...(source === "contract-allow" ? { scopeHit: contractReason } : {}),
    ...(floorFired ? { floorFired } : {}),
    ...(taintResult?.tainted ? { taintSource: taintResult.source, taintReason: taintResult.reason } : {}),
    ...(validityWarning ? { validityWarning } : {}),
    redact: Boolean(contract?.scopes?.secrets?.redactInJournal),
  });

  recordDecision({
    action: result.action,
    riskLevel: result.riskLevel,
    reasonCodes: result.reasonCodes,
  });

  return result;
}

module.exports = { decide };
