#!/usr/bin/env node
// adapter.js — Codex PreToolUse adapter for Agent Runtime Guard (best-effort).
//
// Codex hook API is not publicly documented. This adapter uses the broadest
// possible fallback chain to cover likely input shapes. Test against your
// actual Codex hook payload before relying on this in production.
//
// Likely Codex shapes (not verified):
//   { "tool": "bash", "command": "...", "workdir": "..." }
//   { "tool_name": "Bash", "tool_input": { "command": "..." } }  (Claude Code compat)
//
// To enable block mode: export HORUS_ENFORCE=1

"use strict";

const { createAdapter } = require("../../claude/hooks/hook-utils");

// TODO(F15/Task0.6): publish this via codex/manifest.json. Until then,
// treat Codex as envelopeReporting: false.
const ADAPTER_CAPABILITIES = { envelopeReporting: false };
void ADAPTER_CAPABILITIES;

createAdapter({
  harness:        "codex",
  rateLimitKey:   "codex-adapter",
  extractCommand: (i) => String(i.command || i.cmd || i.tool_input?.command || i.input?.command || i.args?.command || i.params?.command || ""),
  extractCwd:     (i) => String(i.workdir || i.cwd || i.working_directory || i.tool_input?.cwd || i.input?.cwd || i.args?.cwd || ""),
  extractTool:    (i) => String(i.tool_name || i.tool || i.type || "Bash"),
  envelopeReporting: ADAPTER_CAPABILITIES.envelopeReporting,
});
