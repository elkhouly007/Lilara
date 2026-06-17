#!/usr/bin/env node
// adapter.js — Hermes Agent handler-wrap adapter for Agent Runtime Guard.
//
// Hermes integration model (per references/hermes-license-check.md): Hermes tools are
// self-registering functions. The Lilara wrapper sits between Hermes's tool dispatcher
// and the underlying handler, calling runtime.decide() before the handler executes.
//
// Hermes-primary payload shape (the wrapper invokes this adapter with a normalized IR):
//   { "tool": "terminal", "cmd": "...", "cwd": "...", "args": [...],
//     "mcp_server": "...", "skill_name": "...", "session_id": "...", "tool_call_id": "..." }
//
// Falls back to Claude Code shapes for cross-harness compatibility (per the same
// shape-extraction pattern as the other Lilara adapters).
//
// Delegates all enforcement to runtime/pretool-gate.js.
//   LILARA_ENFORCE=1  -> block mode (high/critical risk returns block)
//   LILARA_KILL_SWITCH=1 -> unconditional block (emergency override)
//
// Lilara ADR-007 PR-B: hermes/manifest.json declares envelopeReporting=false (until
// Hermes's F15 wiring lands); exact arg/cwd fidelity; supported MCP/skill interception.
// The integration model is "handler-wrap" (not PreToolUse-hook-based); see
// hermes/WIRING_PLAN.md and hermes/manifest.json:integrationModel.

"use strict";

const { createAdapter, commandFrom, loadManifest } = require("../../claude/hooks/hook-utils");

createAdapter({
  harness:           "hermes",
  rateLimitKey:      "hermes-adapter",
  extractCommand:    (i) => String(
    i.cmd ||
    i.input?.cmd ||
    i.command ||
    i.args?.command ||
    i.tool_input?.command ||
    i.input?.command ||
    i.arguments?.cmd ||
    i.arguments?.command ||
    ""
  ),
  extractCwd:        (i) => String(
    i.cwd ||
    i.input?.cwd ||
    i.args?.cwd ||
    i.tool_input?.cwd ||
    i.input?.cwd ||
    i.arguments?.cwd ||
    ""
  ),
  extractTool:       (i) => String(
    i.tool ||
    i.tool_name ||
    i.input?.tool ||
    "terminal"
  ),
  envelopeReporting: false,
  extractTrustMeta:  () => loadManifest("hermes"),
});
