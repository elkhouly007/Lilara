#!/usr/bin/env node
// adapter.js — OpenCode PreToolUse adapter for Agent Runtime Guard.
// OpenCode uses Claude Code's hook format: { "tool_name": "Bash", "tool_input": { "command": "..." } }
// Delegates all enforcement to runtime/pretool-gate.js. HORUS_ENFORCE=1 = block mode.

"use strict";

const { createAdapter, commandFrom } = require("../../claude/hooks/hook-utils");

// TODO(F15/Task0.6): publish this via opencode/manifest.json. Until then,
// treat OpenCode as envelopeReporting: false.
const ADAPTER_CAPABILITIES = { envelopeReporting: false };
void ADAPTER_CAPABILITIES;

createAdapter({
  harness:        "opencode",
  rateLimitKey:   "opencode-adapter",
  extractCommand: (i) => commandFrom(i),
  extractCwd:     (i) => String(i.cwd || i.args?.cwd || i.tool_input?.cwd || i.input?.cwd || ""),
  extractTool:    (i) => String(i.tool_name || i.tool || "Bash"),
  envelopeReporting: ADAPTER_CAPABILITIES.envelopeReporting,
});
