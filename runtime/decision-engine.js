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

  // B2 commit 2: contextTrust per-branch posture override.
  // Replaces enriched.trustPosture for risk scoring only — does not affect scopes or floors.
  if (contract && enriched.branch) {
    try {
      const { getContextTrust } = require("./contract");
      const overridePosture = getContextTrust(contract, enriched.branch);
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

  // F12: mcp-deny floor — per-MCP-server policy (scopes.mcp).
  let mcpWarning = null;
  try {
    const { getMcpPolicy, extractMcpServerName } = require("./contract");
    const serverName = input.mcpServer || extractMcpServerName(input.tool);
    if (serverName && contract) {
      const policy = getMcpPolicy(contract, serverName);
      if (policy === "block") {
        return buildEarlyBlock("mcp-deny", enriched, discovered, input,
          `MCP server '${serverName}' denied by contract scopes.mcp`);
      }
      if (policy === "warn") {
        mcpWarning = { code: "policy-warn", name: serverName, policy: "warn" };
      }
    }
  } catch { /* helper unavailable → no-op */ }

  // F13: skill-deny floor — per-skill policy (scopes.skills).
  let skillWarning = null;
  try {
    const { getSkillPolicy } = require("./contract");
    const skillName = input.skillName;
    if (skillName && contract) {
      const policy = getSkillPolicy(contract, skillName);
      if (policy === "block") {
        return buildEarlyBlock("skill-deny", enriched, discovered, input,
          `Skill '${skillName}' denied by contract scopes.skills`);
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
    const { getSessionConstraints, getBudgetLimits } = require("./contract");
    const { getCounters } = require("./session-budget");
    const sessionId = enriched.sessionId || discovered.sessionId;

    const sessionCfg = getSessionConstraints(contract);
    const budgetCfg  = getBudgetLimits(contract);

    if (sessionId && (sessionCfg || budgetCfg)) {
      const counters = getCounters({ sessionId });

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
            `destructive-ops budget exceeded: ${counters.destructiveOps}/${budgetCfg.maxDestructiveOps}`);
        }
        if (Number.isFinite(budgetCfg.maxExternalBytes) &&
            counters.externalBytes >= budgetCfg.maxExternalBytes) {
          return buildEarlyBlock("budget-exceeded", enriched, discovered, input,
            `external-bytes budget exceeded: ${counters.externalBytes}/${budgetCfg.maxExternalBytes}`);
        }
      }
    }
  } catch { /* helper unavailable → no-op */ }

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
    if (!isClassC) {
      try {
        const { scanSecrets } = require("./secret-scan");
        secretInCommand = Boolean(scanSecrets(input.command || ""));
      } catch { /* secret-scan unavailable — skip */ }
    }
    if (isClassC || secretInCommand) {
      // Check for operator-token demotion (ADR-002 B)
      let f4DemoteAllowed = false;
      const demoteToken = process.env.HORUS_F4_DEMOTE_TOKEN || "";
      if (demoteToken) {
        try {
          const { consumeScopedOperatorToken } = require("./contract");
          f4DemoteAllowed = consumeScopedOperatorToken(demoteToken, "class-c-review-demote");
        } catch { /* token mech unavailable — fail closed (no demotion) */ }
      }
      if (f4DemoteAllowed) {
        action = "require-review";
        source = "f4-class-c-demoted";
        floorFired = floorFired || "secret-class-C-demoted";
      } else {
        action = "block";
        floorFired = floorFired || "secret-class-C";
      }
    }
  }

  // F10 (A2): taint floor — command overlaps with recently-read external content.
  // Fires at rung 8.5 (after protected-branch, before session-risk). Forces
  // require-review so the operator can confirm the command was not injected.
  // Best-effort: if taint module unavailable, skip silently.
  let taintResult = null;
  try {
    const { correlateCommand } = require("./taint");
    taintResult = correlateCommand(input.command || "", undefined, input.tool || "");
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

  // F6 (D26): posture-strict-no-cover floor — rung 6 in the precedence matrix.
  // Fires when trust posture is strict AND the command class is gated AND
  // scopeMatch did not cover it (contractAllow=false, no operator-signal bypass).
  // Trigger: trustPosture === "strict" + isGated + !contractAllow. Floor = block.
  // Does NOT fire in balanced or relaxed posture — locked semantic per D26.
  if (action !== "block" && isGated && !contractAllow && enriched.trustPosture === "strict") {
    action = "block";
    source = "posture-strict-no-cover";
    floorFired = floorFired || "posture-strict-no-cover";
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
    source = "intent-unknown-strict";
    floorFired = floorFired || "intent-unknown-strict";
  }

  // Step 11: contract-allow — demotes baseline only; never demotes hard floors.
  // B4: protects require-review (protected-branch floor) from demotion.
  // W11: tool-allow reason permits escalate demotion (explicit per-tool pre-approval).
  const canDemoteEscalate = contractAllow && (
    contractReason === "tool-allow-matched" ||
    contractReason === "tool-allow-tool-scope"
  );
  if (contractAllow &&
      risk.level !== "critical" &&
      action !== "block" &&
      action !== "require-review" &&
      (action !== "escalate" || canDemoteEscalate)) {
    action = "allow";
    source = contractReason === "tool-allow-tool-scope" ? "contract-allow-tool-scope" : "contract-allow";
  }

  if (source !== "learned-allow" && !source.startsWith("contract-allow") && risk.level !== "critical" && risk.level !== "high" && action !== "allow" && hasAutoAllowOnce(policyKey)) {
    consumeAutoAllowOnce(policyKey);
    action = "allow";
    source = "auto-allow-once";
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
  if (source === "risk-engine" && trajectory.recentEscalations >= trajectoryThreshold) {
    if (action === "allow") { action = "route"; trajectoryNudge = "allow\u2192route"; }
    else if (action === "route") { action = "require-review"; trajectoryNudge = "route\u2192require-review"; }
    else if (action === "require-review") { action = "escalate"; trajectoryNudge = "require-review\u2192escalate"; }
    if (trajectoryNudge) source = "trajectory-nudge";
  }

  // F14b: session-over-duration require-review escalation (D47).
  // Asserted AFTER all demotion blocks so contract-allow / auto-allow-once / trajectory-nudge
  // cannot silently undo it. Operator declared "after N minutes, stop and ask me" — same
  // pattern as F10 taint-floor: change action, not just annotate.
  if (sessionOverDuration) {
    action = "require-review";
    source = "session-over-duration";
    floorFired = floorFired || "session-over-duration";
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
  if (mcpWarning)            explanationParts.push(`mcp-warn=${mcpWarning.name}`);
  if (skillWarning)          explanationParts.push(`skill-warn=${skillWarning.name}`);
  if (sessionDurationWarning) explanationParts.push(`session-over-duration=age:${sessionDurationWarning.ageMin}min/limit:${sessionDurationWarning.limitMin}min`);

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
    ...(mcpWarning            ? { mcpWarning }            : {}),
    ...(skillWarning          ? { skillWarning }          : {}),
    ...(sessionDurationWarning ? { sessionDurationWarning } : {}),
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
    ...(mcpWarning            ? { mcpWarning }            : {}),
    ...(skillWarning          ? { skillWarning }          : {}),
    ...(sessionDurationWarning ? { sessionDurationWarning } : {}),
    redact: Boolean(contract?.scopes?.secrets?.redactInJournal),
  });

  recordDecision({
    action: result.action,
    riskLevel: result.riskLevel,
    reasonCodes: result.reasonCodes,
  });

  // Increment destructive-op counter after an allowed destructive-delete — F14 checks at next decide().
  try {
    if (action === "allow" && cmdClass === "destructive-delete") {
      const { recordDestructiveOp } = require("./session-budget");
      recordDestructiveOp({ sessionId: enriched.sessionId || discovered.sessionId });
    }
  } catch { /* session-budget unavailable → no-op */ }

  return result;
}

module.exports = { decide };
