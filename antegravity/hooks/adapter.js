#!/usr/bin/env node
// adapter.js — antegravity BeforeTool adapter for Lilara (verified via upstream source).
//
// Hook protocol verified against google-gemini/gemini-cli (Apache-2.0):
//   Payload shape:  packages/core/src/hooks/types.ts — BeforeToolInput
//   Decision proto: packages/core/src/hooks/hookRunner.ts — exit 2 = deny
//
// IMPORTANT: Antegravity uses Gemini CLI event names, NOT Claude Code names.
//   ✓ Use "BeforeTool" / "AfterTool" in ~/.gemini/settings.json (or .gemini/settings.json)
//   ✗ Do NOT use "PreToolUse" / "PostToolUse" — those are Claude Code names
//   ✓ Use "run_shell_command" as the tool matcher (not "Bash")
//
// Run `agy hooks migrate` to auto-convert .claude/settings.local.json → .gemini/settings.json.
//
// To enable block mode: export LILARA_ENFORCE=1

"use strict";

const { createAdapter, loadManifest } = require("../../claude/hooks/hook-utils");

createAdapter({
  harness:           "antegravity",
  rateLimitKey:      "antegravity-adapter",
  extractCommand:    (i) => String(i.command || i.cmd || i.tool_input?.command || i.input?.command || i.args?.command || i.params?.command || ""),
  extractCwd:        (i) => String(i.cwd || i.workdir || i.working_directory || i.tool_input?.cwd || i.input?.cwd || i.args?.cwd || ""),
  extractTool:       (i) => String(i.tool_name || i.tool || i.type || "Bash"),
  // Lilara ADR-007 PR-B: antegravity/manifest.json declares best-effort args/cwd
  // fidelity and unverified MCP/skill interception.
  envelopeReporting: false,
  extractTrustMeta:  () => loadManifest("antegravity"),
});
