#!/usr/bin/env node
"use strict";

const PROMOTION_THRESHOLD = 3;

/**
 * Determine the promotion lifecycle stage and return structured guidance.
 *
 * Stages:
 *   "ineligible"  — critical/high risk, learned allows cannot apply
 *   "new"         — 0 approvals, just seen
 *   "approaching" — 1–2 approvals, building history
 *   "eligible"    — >=3 approvals, pending suggestion exists
 *   "promoted"    — learned allow is active
 *   "dismissed"   — suggestion was dismissed, still countable
 *
 * @param {object} policyFacts — from policy-store.getPolicyFacts()
 * @param {object} risk        — from risk-score.score()
 * @returns {{ stage, approvalCount, remaining, guidance, cliHint }}
 */
function evaluate(policyFacts = {}, risk = {}) {
  const approvalCount = Number(policyFacts.approvalCount || 0);
  const learnedAllow = Boolean(policyFacts.learnedAllow);
  const pendingSuggestion = policyFacts.pendingSuggestion || null;
  const policyKey = String(policyFacts.key || "");
  const riskLevel = String(risk.level || "low");

  if (riskLevel === "critical") {
    return {
      stage: "ineligible",
      approvalCount,
      remaining: null,
      guidance: "Critical-risk patterns are never eligible for learned allows. Each occurrence requires explicit review.",
      cliHint: null,
    };
  }

  if (riskLevel === "high" && !(risk.reasons || []).includes("destructive-delete-pattern")) {
    return {
      stage: "ineligible",
      approvalCount,
      remaining: null,
      guidance: "High-risk patterns without a well-known destructive class are not eligible for learned allows. Review is always required.",
      cliHint: null,
    };
  }

  if (learnedAllow) {
    return {
      stage: "promoted",
      approvalCount,
      remaining: 0,
      guidance: "This pattern is an active learned allow. It will proceed automatically at this risk level.",
      cliHint: policyKey ? `lilara-cli.sh runtime state  # review active learned allows` : null,
    };
  }

  if (pendingSuggestion && pendingSuggestion.status === "pending") {
    return {
      stage: "eligible",
      approvalCount,
      remaining: 0,
      guidance: `This pattern has ${approvalCount} approvals and a pending suggestion. Promote it to a reviewed local default when you are ready.`,
      cliHint: policyKey ? `lilara-cli.sh runtime promote '${policyKey}'` : null,
    };
  }

  if (approvalCount > 0 && approvalCount < PROMOTION_THRESHOLD) {
    const remaining = PROMOTION_THRESHOLD - approvalCount;
    return {
      stage: "approaching",
      approvalCount,
      remaining,
      guidance: `This pattern has ${approvalCount}/${PROMOTION_THRESHOLD} approvals. ${remaining} more will make it eligible for a reviewed local default.`,
      cliHint: policyKey ? `lilara-cli.sh runtime record-approval --tool <tool> --command '<cmd>' --target <path>  # record next approval` : null,
    };
  }

  if (approvalCount >= PROMOTION_THRESHOLD && !pendingSuggestion) {
    // Suggestion was dismissed previously
    return {
      stage: "dismissed",
      approvalCount,
      remaining: 0,
      guidance: `This pattern has ${approvalCount} approvals but its suggestion was previously dismissed. Re-record an approval to regenerate the suggestion.`,
      cliHint: policyKey ? `lilara-cli.sh runtime record-approval --tool <tool> --command '<cmd>' --target <path>` : null,
    };
  }

  return {
    stage: "new",
    approvalCount: 0,
    remaining: PROMOTION_THRESHOLD,
    guidance: `This pattern is new. After ${PROMOTION_THRESHOLD} reviewed approvals it becomes eligible for a local default.`,
    cliHint: null,
  };
}

module.exports = { evaluate, PROMOTION_THRESHOLD };
