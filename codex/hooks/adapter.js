#!/usr/bin/env node
// adapter.js — Codex PreToolUse adapter for Lilara.
//
// Verified against openai/codex (codex-rs). Canonical PreToolUse payload
// shape from codex-rs/hooks/src/events/pre_tool_use.rs (PreToolUseRequest
// struct) with snake_case serialisation from codex-rs/hooks/src/types.rs:38
// (#[serde(rename_all = "snake_case")] on HookPayload):
//
//   { "session_id": "...", "turn_id": "...", "cwd": "/abs/path",
//     "tool_name": "Bash", "tool_use_id": "...",
//     "tool_input": { "command": "..." } }
//
// Exit-code protocol (developers.openai.com/codex/hooks): 0 = allow,
// 2 = block (stderr reason shown to model). Codex honours exit code 2,
// so no harnessOutput:"permission-json" opt-in is needed (contrast with
// ClawCode, which ignores the exit code and reads stdout JSON instead).
//
// To enable block mode: export LILARA_ENFORCE=1

"use strict";

const { createAdapter, loadManifest } = require("../../claude/hooks/hook-utils");

createAdapter({
  harness:           "codex",
  rateLimitKey:      "codex-adapter",
  // Lead with verified upstream field (codex-rs/hooks/src/events/pre_tool_use.rs:
  // tool_input is a Value containing "command" for Bash/apply_patch tools).
  extractCommand:    (i) => String(i.tool_input?.command || i.command || i.cmd || i.input?.command || i.args?.command || i.params?.command || ""),
  // Lead with verified upstream field (codex-rs/hooks/src/types.rs:41 — cwd: AbsolutePathBuf).
  extractCwd:        (i) => String(i.cwd || i.workdir || i.working_directory || i.tool_input?.cwd || i.input?.cwd || i.args?.cwd || ""),
  extractTool:       (i) => String(i.tool_name || i.tool || i.type || "Bash"),
  envelopeReporting: false,
  extractTrustMeta:  () => loadManifest("codex"),
});
