#!/usr/bin/env node
"use strict";

const path = require("path");
const runtime = require(path.join(__dirname, "..", "runtime"));

const cmd = process.argv[2] || "show";
const arg = process.argv[3] || "";

function parseOptions(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[i + 1];
    out[key] = value;
    i += 1;
  }
  return out;
}

function show() {
  const policy = runtime.loadPolicy();
  const session = runtime.loadState();
  const summary = runtime.summarizePolicy();
  const suggestions = runtime.listSuggestions();
  const accepted = runtime.listAcceptedSuggestions();
  const dismissed = runtime.listDismissedSuggestions();

  console.log("[runtime-state]");
  console.log(`  learned-allows: ${summary.learnedAllowCount}`);
  console.log(`  approval-keys: ${summary.approvalKeyCount}`);
  console.log(`  pending-suggestions: ${summary.pendingSuggestionCount}`);
  console.log(`  promoted-defaults: ${summary.acceptedSuggestionCount}`);
  console.log(`  dismissed-defaults: ${summary.dismissedSuggestionCount}`);
  console.log(`  session-risk: ${runtime.getSessionRisk()}`);
  console.log(`  recent-decisions: ${Array.isArray(session.recent) ? session.recent.length : 0}`);

  if (suggestions.length > 0) {
    console.log("\n[pending-suggestions]");
    for (const item of suggestions) {
      console.log(`  - ${item.key}  approvals=${item.approvalCount}`);
      console.log(`    promote: lilara-cli.sh runtime promote '${item.key}'`);
    }
  }

  if (accepted.length > 0) {
    console.log("\n[promoted-defaults]");
    for (const item of accepted.slice(0, 20)) {
      console.log(`  - ${item.key}  approvals=${item.approvalCount}`);
      if (item.createdAt) console.log(`    created-at: ${item.createdAt}`);
      if (item.eligibleAt) console.log(`    eligible-at: ${item.eligibleAt}`);
      if (item.acceptedAt) console.log(`    accepted-at: ${item.acceptedAt}`);
      if (item.lastApprovedAt) console.log(`    last-approved-at: ${item.lastApprovedAt}`);
    }
    if (accepted.length > 20) console.log(`  ... and ${accepted.length - 20} more`);
  }

  if (dismissed.length > 0) {
    console.log("\n[dismissed-defaults]");
    for (const item of dismissed.slice(0, 20)) {
      console.log(`  - ${item.key}  approvals=${item.approvalCount}`);
      if (item.createdAt) console.log(`    created-at: ${item.createdAt}`);
      if (item.eligibleAt) console.log(`    eligible-at: ${item.eligibleAt}`);
      if (item.dismissedAt) console.log(`    dismissed-at: ${item.dismissedAt}`);
      if (item.lastApprovedAt) console.log(`    last-approved-at: ${item.lastApprovedAt}`);
    }
    if (dismissed.length > 20) console.log(`  ... and ${dismissed.length - 20} more`);
  }

  const learnedKeys = Object.entries(policy.learnedAllows || {}).filter(([, enabled]) => enabled).map(([key]) => key);
  if (learnedKeys.length > 0) {
    console.log("\n[learned-allows]");
    for (const key of learnedKeys.slice(0, 20)) console.log(`  - ${key}`);
    if (learnedKeys.length > 20) console.log(`  ... and ${learnedKeys.length - 20} more`);
  }
}

function accept(key) {
  if (!key) {
    console.error("Usage: runtime-state.js accept <policy-key>");
    process.exit(2);
  }
  if (!runtime.acceptSuggestion(key)) {
    console.error(`No pending suggestion found for key: ${key}`);
    process.exit(1);
  }
  console.log(`Accepted learned allow: ${key}`);
}

function promote(key) {
  if (!key) {
    console.error("Usage: runtime-state.js promote <policy-key>");
    process.exit(2);
  }
  if (!runtime.acceptSuggestion(key)) {
    console.error(`No pending promotion found for key: ${key}`);
    process.exit(1);
  }
  console.log(`Promoted reviewed local default: ${key}`);
}

function dismiss(key) {
  if (!key) {
    console.error("Usage: runtime-state.js dismiss <policy-key>");
    process.exit(2);
  }
  if (!runtime.dismissSuggestion(key)) {
    console.error(`No pending suggestion found for key: ${key}`);
    process.exit(1);
  }
  console.log(`Dismissed suggestion: ${key}`);
}

function recordApproval(argv) {
  const opts = parseOptions(argv);
  const input = {
    tool: opts.tool || "Bash",
    command: opts.command || "",
    targetPath: opts.target || opts.targetPath || "",
    payloadClass: opts.payloadClass || "A",
    branch: opts.branch || "",
    projectRoot: opts.projectRoot || "",
  };

  if (!input.command) {
    console.error("Usage: runtime-state.js record-approval --tool Bash --command 'sudo systemctl restart app' --target ops/service [--payloadClass A]");
    process.exit(2);
  }

  const discovered = runtime.discover(input);
  const enriched = { ...input, ...discovered };
  const count = runtime.recordApproval(enriched);
  const key = runtime.decisionKey(enriched);
  const suggestion = runtime.getSuggestionForInput(enriched);
  console.log(`Recorded approval: ${key} (count=${count})`);
  if (suggestion?.status === "pending") {
    console.log(`Pending suggestion created: ${suggestion.key}`);
  }
}

function autoAllowOnce(key) {
  if (!key) {
    console.error("Usage: runtime-state.js auto-allow-once <policy-key>");
    process.exit(2);
  }
  if (!runtime.grantAutoAllowOnce(key)) {
    console.error(`No eligible pending suggestion found for key: ${key}`);
    console.error("Only policies with a pending suggestion (approvalCount >= 3) may receive an auto-allow-once grant.");
    process.exit(1);
  }
  console.log(`Granted auto-allow-once for: ${key}`);
}

function explain(argv) {
  const opts = parseOptions(argv);
  const input = {
    tool: opts.tool || "Bash",
    command: opts.command || "",
    targetPath: opts.target || opts.targetPath || "",
    payloadClass: opts.payloadClass || "A",
    branch: opts.branch || "",
    projectRoot: opts.projectRoot || "",
  };

  if (!input.command) {
    console.error("Usage: runtime-state.js explain --tool Bash --command 'sudo systemctl restart app' --target ops/service [--payloadClass A]");
    process.exit(2);
  }

  const discovered = runtime.discover(input);
  const decision = runtime.decide({ ...discovered, ...input });
  console.log("[runtime-explain]");
  console.log(`  action: ${decision.action}`);
  console.log(`  enforcement-action: ${decision.enforcementAction}`);
  console.log(`  risk: ${decision.riskLevel}:${decision.riskScore}`);
  console.log(`  source: ${decision.decisionSource}`);
  console.log(`  branch: ${decision.context.branch || discovered.branch || '-'}`);
  console.log(`  project-root: ${decision.context.projectScope || discovered.projectRoot || '-'}`);
  console.log(`  project-config: ${discovered.hasConfig ? 'present' : 'missing'}`);
  console.log(`  project-stack: ${discovered.primaryStack || '-'}`);
  if (Array.isArray(discovered.projectMarkers) && discovered.projectMarkers.length > 0) {
    console.log(`  project-markers: ${discovered.projectMarkers.join(',')}`);
  }
  console.log(`  policy-key: ${decision.policyKey}`);
  console.log(`  explanation: ${decision.explanation}`);
  if (decision.pendingSuggestion) console.log(`  pending-suggestion: ${decision.pendingSuggestion}`);
  if (decision.promotionGuidance) {
    console.log(`  promotion-stage: ${decision.promotionGuidance.stage}`);
    console.log(`  promotion-guidance: ${decision.promotionGuidance.guidance}`);
    if (decision.promotionGuidance.cliHint) console.log(`  promotion-cli: ${decision.promotionGuidance.cliHint}`);
  }
  if (decision.promotionLifecycleSummary) console.log(`  promotion-lifecycle: ${decision.promotionLifecycleSummary}`);
  if (decision.promotionState?.createdAt) console.log(`  promotion-created-at: ${decision.promotionState.createdAt}`);
  if (decision.promotionState?.eligibleAt) console.log(`  promotion-eligible-at: ${decision.promotionState.eligibleAt}`);
  if (decision.promotionState?.acceptedAt) console.log(`  promotion-accepted-at: ${decision.promotionState.acceptedAt}`);
  if (decision.promotionState?.dismissedAt) console.log(`  promotion-dismissed-at: ${decision.promotionState.dismissedAt}`);
  if (decision.promotionState?.lastApprovedAt) console.log(`  promotion-last-approved-at: ${decision.promotionState.lastApprovedAt}`);
  if (decision.workflowRoute?.lane) console.log(`  workflow-lane: ${decision.workflowRoute.lane}`);
  if (decision.workflowRoute?.reason) console.log(`  workflow-reason: ${decision.workflowRoute.reason}`);
  if (decision.workflowRoute?.suggestedSurface) console.log(`  workflow-surface: ${decision.workflowRoute.suggestedSurface}`);
  if (decision.workflowRoute?.suggestedTarget) console.log(`  workflow-target: ${decision.workflowRoute.suggestedTarget}`);
  if (decision.workflowRoute?.suggestedCommand) console.log(`  workflow-command: ${decision.workflowRoute.suggestedCommand}`);
  if (decision.actionPlan?.summary) console.log(`  action-plan-summary: ${decision.actionPlan.summary}`);
  if (Array.isArray(decision.actionPlan?.commands) && decision.actionPlan.commands.length > 0) {
    console.log('  action-plan-commands:');
    for (const cmd of decision.actionPlan.commands) console.log(`    - ${cmd}`);
  }
  if (decision.actionPlan?.reviewType) console.log(`  action-plan-review: ${decision.actionPlan.reviewType}`);
  if (Array.isArray(decision.actionPlan?.modificationHints) && decision.actionPlan.modificationHints.length > 0) {
    console.log('  action-plan-hints:');
    for (const hint of decision.actionPlan.modificationHints) console.log(`    - ${hint}`);
  }
  if (decision.actionPlan?.promotionHint) {
    console.log(`  action-plan-promotion: ${decision.actionPlan.promotionHint}`);
  }
}

switch (cmd) {
  case "show":
    show();
    break;
  case "accept":
    accept(arg);
    break;
  case "dismiss":
    dismiss(arg);
    break;
  case "promote":
    promote(arg);
    break;
  case "record-approval":
    recordApproval(process.argv.slice(3));
    break;
  case "auto-allow-once":
    autoAllowOnce(arg);
    break;
  case "explain":
    explain(process.argv.slice(3));
    break;
  default:
    console.error(`Unknown runtime-state command: ${cmd}`);
    process.exit(2);
}
