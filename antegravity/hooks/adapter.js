#!/usr/bin/env node
// adapter.js — antegravity PreToolUse adapter for Agent Runtime Guard (best-effort).
//
// antegravity hook API is not publicly documented. This adapter uses the broadest
// possible fallback chain to cover likely input shapes. Test against your
// actual antegravity hook payload before relying on this in production.
//
// To enable block mode: export HORUS_ENFORCE=1

"use strict";

const { createAdapter } = require("../../claude/hooks/hook-utils");

// TODO(F15/Task0.6): publish this via antegravity/manifest.json. Until then,
// treat antegravity as envelopeReporting: false.
const ADAPTER_CAPABILITIES = { envelopeReporting: false };
void ADAPTER_CAPABILITIES;

createAdapter({
  harness:        "antegravity",
  rateLimitKey:   "antegravity-adapter",
  extractCommand: (i) => String(i.command || i.cmd || i.tool_input?.command || i.input?.command || i.args?.command || i.params?.command || ""),
  extractCwd:     (i) => String(i.cwd || i.workdir || i.working_directory || i.tool_input?.cwd || i.input?.cwd || i.args?.cwd || ""),
  extractTool:    (i) => String(i.tool_name || i.tool || i.type || "Bash"),
  envelopeReporting: ADAPTER_CAPABILITIES.envelopeReporting,
});
