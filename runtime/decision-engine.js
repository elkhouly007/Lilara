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
const _F15 = getEntry("F15");         // execution-envelope
const _CA  = getEntry("D-CONTRACT-ALLOW");  // contract-allow (sources[0/1])
const _LA  = getEntry("D-LEARNED-ALLOW");   // learned-allow
const _AAO = getEntry("D-AUTO-ALLOW-ONCE"); // auto-allow-once
const _TN  = getEntry("P-TRAJECTORY-NUDGE");// trajectory-nudge

// Demotion source identifiers used with canDemote(). Format mirrors the
// `demotableBy` strings in decision-lattice.js.
const _DEMOTE_F4_OPERATOR_TOKEN     = "operator-token:class-c-review-demote";
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

function buildEarlyBlock(reasonCode, enriched, discovered, input, explanation, extra = {}) {
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
      ...(irExtras || {}),
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
            { floorFired: _F2.name, decisionSource: _F2.source }
          );
        }
      } catch (verifyErr) {
        // verify threw — fail closed in strict mode
        return buildEarlyBlock(
          "contract-hash-mismatch", enriched, discovered, input,
          `contract verify error (${verifyErr instanceof Error ? verifyErr.message : "unknown"}) — failing closed`,
          { floorFired: _F2.name, decisionSource: _F2.source }
        );
      }
    }

    // Step 5: strict-mode + gated class + no contract coverage → block
    const harness = String(input.harness || enriched.harness || "");
    if (process.env.HORUS_CONTRACT_REQUIRED === "1" && harness && !harnessInScope(contract, harness)) {
      if (isGated) {
        return buildEarlyBlock("harness-out-of-scope", enriched, discovered, input,
          `harness '${harness}' not in contract harnessScope — run: horus-cli contract amend --add-harness ${harness}`,
          { floorFired: _F5.name, decisionSource: _F5.source });
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
      "no accepted contract — run: horus-cli contract init && horus-cli contract accept");
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
          { floorFired: _F11.name, decisionSource: _F11.source }
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
          { floorFired: _F12.name, decisionSource: _F12.source });
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
          { floorFired: _F13.name, decisionSource: _F13.source });
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
            { floorFired: _F14.name, decisionSource: _F14.source });
        }
        if (Number.isFinite(budgetCfg.maxExternalBytes) &&
            counters.externalBytes >= budgetCfg.maxExternalBytes) {
          return buildEarlyBlock("budget-exceeded", enriched, discovered, input,
            `external-bytes budget exceeded: ${counters.externalBytes}/${budgetCfg.maxExternalBytes}`,
            { floorFired: _F14.name, decisionSource: _F14.source });
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
      if (netPolicy && Array.isArray(netPolicy.allowDomains)) {
        const ne = _evalNet(input.command || "", netPolicy);
        if (ne.fired) {
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
            { floorFired: _F18.name, decisionSource: _F18.source }
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
        }
      );
    }
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
      if (demoteToken && canDemote(_F4.id, _DEMOTE_F4_OPERATOR_TOKEN)) {
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

  if (source !== _LA.source && !source.startsWith("contract-allow") && risk.level !== "critical" && risk.level !== "high" && action !== "allow" && hasAutoAllowOnce(policyKey)) {
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
