#!/usr/bin/env node
"use strict";

const { decide } = require("./decision-engine");
const { score } = require("./risk-score");
const { append, journalPaths } = require("./decision-journal");
const policy = require("./policy-store");
const session = require("./session-context");
const projectPolicy = require("./project-policy");
const contextDiscovery = require("./context-discovery");
const actionPlanner = require("./action-planner");
const promotionGuidance = require("./promotion-guidance");
const workflowRouter = require("./workflow-router");
const envelope = require("./envelope");
const { classifyIntent } = require("./intent-classifier");
const { resolveRoute, DEFAULT_ROUTING_TABLE, KNOWN_INTENTS } = require("./route-resolver");
// Lilara ADR-007 PR-A: Canonical Action IR + decision lattice. Exported as
// namespaces so existing flat consumers are unaffected. PR-B will switch
// pretool-gate to call actionIr.build(); PR-C will switch decision-engine
// to read decisionLattice.LATTICE for source/floor labels.
const actionIr = require("./action-ir");
const decisionLattice = require("./decision-lattice");
// Lilara ADR-004 PR 37A: tamper-evident hash-chained journal. Exposed as a
// namespace so existing consumers stay unaffected; CLI and tests reach in
// explicitly. No call site appends today — detection/reporting only.
const journalChain = require("./journal-chain");
// F16 PR-A: ambient-authority path classifier. Foundation only — no
// decision-engine wiring, no floor, no behavior change. Re-exported as a
// namespace so later PRs can read classifyAmbientPath without touching the
// flat re-export surface.
const ambient = require("./ambient");
// F17 PR-A: cross-agent-lock helper. Namespace export so future writer
// API (acquire/release) can grow under one surface without touching the
// flat re-exports.
const crossAgentLock = require("./cross-agent-lock");
const sessionMemory      = require("./session-memory");
const memorySearch       = require("./memory-search");
const workflowEnforcer   = require("./workflow-enforcer");
const spendEstimator     = require("./spend-estimator");
const sarifExport        = require("./sarif-export");
const gitHistoryScanner  = require("./git-history-scanner");

module.exports = { decide, score, append, journalPaths, envelopeBuild: envelope.build, envelopeVerify: envelope.verify, ...policy, ...session, ...projectPolicy, ...contextDiscovery, ...actionPlanner, ...promotionGuidance, ...workflowRouter, classifyIntent, resolveRoute, DEFAULT_ROUTING_TABLE, KNOWN_INTENTS, actionIr, decisionLattice, journalChain, ambient, crossAgentLock, sessionMemory, memorySearch, workflowEnforcer, spendEstimator, sarifExport, gitHistoryScanner };
