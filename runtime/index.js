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
// HAP ADR-007 PR-A: Canonical Action IR + decision lattice. Exported as
// namespaces so existing flat consumers are unaffected. PR-B will switch
// pretool-gate to call actionIr.build(); PR-C will switch decision-engine
// to read decisionLattice.LATTICE for source/floor labels.
const actionIr = require("./action-ir");
const decisionLattice = require("./decision-lattice");

module.exports = { decide, score, append, journalPaths, envelopeBuild: envelope.build, envelopeVerify: envelope.verify, ...policy, ...session, ...projectPolicy, ...contextDiscovery, ...actionPlanner, ...promotionGuidance, ...workflowRouter, classifyIntent, resolveRoute, DEFAULT_ROUTING_TABLE, KNOWN_INTENTS, actionIr, decisionLattice };
