#!/usr/bin/env node
// adapter.js — Claw Code PreToolUse adapter for Agent Runtime Guard.
//
// Verified against ClawCode v0.1.3 (deepelementlab/clawcode). The hook
// engine is a "minimal Claude Code compatible hook execution engine"
// (clawcode/plugin/hooks.py docstring at line 69) with one critical
// behavioural difference: ClawCode parses STDOUT JSON for the permission
// decision and IGNORES the exit code. See clawcode/plugin/hooks.py:38-51
// (decision extraction) and 252-280 (subprocess invocation).
//
// PreToolUse stdin payload shape (clawcode/llm/agent.py:1318-1323):
//   { session_id, tool_call_id, tool_name, tool_input }
// where tool_input for Bash tool calls carries { command, description? }.
//
// The adapter emits a ClawCode-compatible JSON decision on stdout via
// harnessOutput="permission-json", AND exits 2 on block for cross-harness
// consistency. Operators wiring this hook into Claude-Code-style harnesses
// that read exit codes still get the expected behaviour.
//
// To enable block mode: export LILARA_ENFORCE=1
// See clawcode/WIRING_PLAN.md for the verified wiring path.

"use strict";

const { createAdapter, loadManifest } = require("../../claude/hooks/hook-utils");

createAdapter({
  harness:           "clawcode",
  rateLimitKey:      "clawcode-adapter",
  extractCommand:    (i) => String(i.tool_input?.command || i.command || i.cmd || i.input?.command || i.args?.command || i.params?.command || ""),
  extractCwd:        (i) => String(i.tool_input?.cwd || i.cwd || i.workdir || i.working_directory || i.input?.cwd || i.args?.cwd || ""),
  extractTool:       (i) => String(i.tool_name || i.tool || i.type || "Bash"),
  // Lilara ADR-007 PR-B: clawcode/manifest.json declares verified hook protocol
  // (exact args, exact cwd, best-effort env). Envelope reporting NOT supported
  // — ClawCode hook surface does not expose execution-time env baselines.
  envelopeReporting: false,
  extractTrustMeta:  () => loadManifest("clawcode"),
  // ClawCode parses stdout JSON for the permission decision; exit code is
  // ignored. See clawcode/plugin/hooks.py:38-51 and llm/agent.py:1328-1336.
  harnessOutput:     "permission-json",
});
