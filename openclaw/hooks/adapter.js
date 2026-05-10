#!/usr/bin/env node
// adapter.js — OpenClaw PreToolUse adapter for Agent Runtime Guard.
// OpenClaw primary shape: { "tool": "shell", "cmd": "...", "cwd": "..." }
// Falls back to Claude Code shapes for cross-harness compatibility.
// Delegates all enforcement to runtime/pretool-gate.js. HORUS_ENFORCE=1 = block mode.

"use strict";

const { createAdapter } = require("../../claude/hooks/hook-utils");

// TODO(F15/Task0.6): publish this via openclaw/manifest.json. Until then,
// treat OpenClaw as envelopeReporting: false.
const ADAPTER_CAPABILITIES = { envelopeReporting: false };
void ADAPTER_CAPABILITIES;

createAdapter({
  harness:        "openclaw",
  rateLimitKey:   "openclaw-adapter",
  extractCommand: (i) => String(i.cmd || i.input?.cmd || i.command || i.args?.command || i.tool_input?.command || i.input?.command || ""),
  extractCwd:     (i) => String(i.cwd || i.input?.cwd || i.args?.cwd || i.tool_input?.cwd || ""),
  extractTool:    (i) => String(i.tool || "shell"),
  envelopeReporting: ADAPTER_CAPABILITIES.envelopeReporting,
});
