#!/usr/bin/env node
// dangerous-command-gate.js — Claude PreToolUse adapter for Agent Runtime Guard.
// Delegates all enforcement to runtime/pretool-gate.js. LILARA_ENFORCE=1 = block mode.

"use strict";

const { createAdapter, commandFrom, loadManifest } = require("./hook-utils");

createAdapter({
  harness:           "claude",
  rateLimitKey:      "dangerous-command-gate",
  extractCommand:    (i) => commandFrom(i),
  extractCwd:        (i) => String(i.cwd || i.args?.cwd || i.tool_input?.cwd || ""),
  extractTool:       (i) => String(i.tool_name || i.tool || "Bash"),
  envelopeReporting: true,
  // Lilara ADR-007 PR-B: claude/manifest.json declares envelopeReporting=true,
  // exact arg/cwd fidelity, and supported MCP/skill interception. The IR uses
  // these to populate trustMeta + outputChannels for downstream floors.
  extractTrustMeta:  () => loadManifest("claude"),
});
