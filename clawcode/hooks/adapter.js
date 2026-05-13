#!/usr/bin/env node
// adapter.js — Claw Code PreToolUse adapter for Agent Runtime Guard (best-effort).
//
// Claw Code hook API is not publicly documented. This adapter uses the broadest
// possible fallback chain to cover likely input shapes. Test against your
// actual Claw Code hook payload before relying on this in production.
//
// To enable block mode: export HORUS_ENFORCE=1

"use strict";

const { createAdapter, loadManifest } = require("../../claude/hooks/hook-utils");

createAdapter({
  harness:           "clawcode",
  rateLimitKey:      "clawcode-adapter",
  extractCommand:    (i) => String(i.command || i.cmd || i.tool_input?.command || i.input?.command || i.args?.command || i.params?.command || ""),
  extractCwd:        (i) => String(i.cwd || i.workdir || i.working_directory || i.tool_input?.cwd || i.input?.cwd || i.args?.cwd || ""),
  extractTool:       (i) => String(i.tool_name || i.tool || i.type || "Bash"),
  // HAP ADR-007 PR-B: clawcode/manifest.json declares best-effort args/cwd
  // fidelity and unverified MCP/skill interception.
  envelopeReporting: false,
  extractTrustMeta:  () => loadManifest("clawcode"),
});
