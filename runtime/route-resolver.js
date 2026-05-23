#!/usr/bin/env node
"use strict";

// route-resolver.js — Static intent-to-workflow-lane routing for Agent Runtime Guard.
//
// Maps a classified intent (from intent-classifier.js) to a workflow lane and
// an optional suggested target (script, review gate, etc.).
//
// The routing table is static by default and can be overridden per-project
// via lilara.config.json (intentRoutes key). Custom tables are merged with the
// defaults: custom entries win; unspecified intents fall back to defaults.
//
// Lanes:
//   direct       — proceed immediately; no gate required
//   verification — run tests / checks before continuing
//   review       — human review gate required before proceeding
//
// Design constraints:
//   - Zero external dependencies.
//   - No file I/O at call time (config is pre-loaded by the caller if needed).
//   - Pure function: same input → same output.
//
// Usage:
//   const { resolveRoute } = require("./route-resolver");
//   const result = resolveRoute("build");
//   // → { intent: "build", lane: "verification", rationale: "...", target: "...", source: "..." }

/**
 * Default routing table: intent → { lane, rationale, target }
 * Changing this table is a contract-schema-level decision — document the reason.
 */
const DEFAULT_ROUTING_TABLE = {
  explore: {
    lane:      "direct",
    rationale: "Read-only exploration — no state mutation; proceed directly.",
    target:    null,
  },
  build: {
    lane:      "verification",
    rationale: "Build and test operations should be verified before continuing work.",
    target:    "scripts/lilara-cli.sh check",
  },
  deploy: {
    lane:      "review",
    rationale: "Deployment operations mutate production or shared state — human review required.",
    target:    "scripts/lilara-cli.sh review",
  },
  modify: {
    lane:      "verification",
    rationale: "File modifications should be verified (lint, tests) before continuing.",
    target:    "scripts/lilara-cli.sh check",
  },
  configure: {
    lane:      "verification",
    rationale: "Package installs should be checked for supply-chain safety before use.",
    target:    "scripts/lilara-cli.sh check",
  },
  cleanup: {
    lane:      "review",
    rationale: "Removal operations are difficult to undo — review before executing.",
    target:    null,
  },
  debug: {
    lane:      "direct",
    rationale: "Debug and introspection commands are read-only or ephemeral — proceed directly.",
    target:    null,
  },
  unknown: {
    lane:      "direct",
    rationale: "Unknown intent — no routing override applied; risk engine governs.",
    target:    null,
  },
};

/**
 * Resolve a workflow route for the given intent.
 *
 * @param {string} intent         — classified intent string (e.g. "build", "deploy")
 * @param {object} [context]      — optional context
 * @param {object} [context.routingTable] — per-project overrides merged with defaults
 * @returns {{ intent: string, lane: string, rationale: string, target: string|null, source: string }}
 */
function resolveRoute(intent, context = {}) {
  const intentStr = String(intent || "unknown").toLowerCase().trim();

  // Merge project overrides with defaults (overrides win per-key)
  const table = (context && context.routingTable && typeof context.routingTable === "object")
    ? Object.assign({}, DEFAULT_ROUTING_TABLE, context.routingTable)
    : DEFAULT_ROUTING_TABLE;

  const entry = table[intentStr] || table.unknown;
  const source = (context && context.routingTable && context.routingTable[intentStr])
    ? "project-config"
    : "default-routing-table";

  return {
    intent:    intentStr,
    lane:      entry.lane,
    rationale: entry.rationale,
    target:    entry.target,
    source,
  };
}

/**
 * All valid intent strings (exported for validation and documentation).
 */
const KNOWN_INTENTS = Object.keys(DEFAULT_ROUTING_TABLE);

module.exports = { resolveRoute, DEFAULT_ROUTING_TABLE, KNOWN_INTENTS };
