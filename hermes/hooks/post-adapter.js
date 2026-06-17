#!/usr/bin/env node
// post-adapter.js — Hermes Agent PostToolUse-equivalent adapter for Agent Runtime Guard.
//
// Hermes's handler-wrap integration does not have a PreToolUse/PostToolUse hook pair
// (Hermes is Python; its tool-dispatch model is handler-based, not hook-based).
// Instead, the Lilara wrapper captures the handler's return value as the "tool output"
// and runs this post-adapter on it before passing it back to Hermes.
//
// Behavior (matches the other Lilara PostToolUse adapters per the parity gate
// scripts/check-post-adapter-parity.sh):
//   1. scanSecrets() — scan the captured tool output for the 23 secret patterns.
//      If found, mark the result as `secretInOutput: true` so the next decide() call
//      raises payloadClass to C (the F4 hard floor fires).
//   2. recordExternalRead() — if the tool is a known external-source tool (per
//      post-adapter-factory.js), record the output into the provenance window so the
//      F10 taint floor can detect injected commands on the next turn.
//
// Hermes-specific note: Hermes tools include `web_search`, `browser_screenshot`,
// `terminal` (with curl/wget subprocesses), `mcp_*` (MCP servers), and Hermes's
// built-in `honcho_*` tools. All external-source outputs are recorded.

"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
const { loadManifest } = require("../../claude/hooks/hook-utils");

createPostAdapter({
  harness:           "hermes",
  envelopeReporting: false,
  extractTrustMeta:  () => loadManifest("hermes"),
});
