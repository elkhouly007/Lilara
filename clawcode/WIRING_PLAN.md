# Claw Code Wiring Plan (SPECULATIVE)

> **Status: EXPERIMENTAL.** This document describes the intended wiring once the Claw Code hook API is confirmed by a contributor. Do not follow these instructions as production guidance until the actual Claw Code hook payload format is verified.

## Goal

Wire Agent Runtime Guard into Claw Code as a project-local enforcement layer using the same `pretool-gate.js` spine used by Claude Code, OpenCode, and OpenClaw.

## Adapter

`clawcode/hooks/adapter.js` is a PreToolUse adapter that delegates to `claude/hooks/hook-utils.js → createAdapter()` → `runtime/pretool-gate.js`.

**Likely Claw Code input shapes (unverified):**
```json
{ "command": "...", "cwd": "..." }
{ "cmd": "...", "cwd": "..." }
{ "tool_input": { "command": "..." } }
```
Also accepted via fallback chain: `input.command`, `args.command`, `params.command`.

**Modes:**
- Warn mode (default): warns to stderr, exits 0 (tool call proceeds).
- Block mode: `export HORUS_ENFORCE=1` — exits 2 on high/critical risk.

**CI:** `scripts/check-clawcode-adapter.sh` verifies 12 checks across 6 input shapes. This is the most tested of the three EXPERIMENTAL harnesses.

## Wiring Steps (Unverified — Contributor Must Confirm)

1. Determine where Claw Code reads PreToolUse hook configuration.
2. Set hook entry point to the absolute path of `clawcode/hooks/adapter.js`.
3. Verify the actual hook payload by logging stdin to a temp file before the adapter runs.
4. If the payload shape differs from the above, update `extractCommand`/`extractCwd` in `clawcode/hooks/adapter.js`.
5. Confirm that `scripts/check-clawcode-adapter.sh` passes against real payloads.
6. File a PR updating this document and promoting the harness from EXPERIMENTAL to Supported.

## PostToolUse

No PostToolUse hook planned until PreToolUse wiring is confirmed and the Claw Code event model is understood.

## Rollback

Remove the hook registration from your Claw Code config. The adapter makes no global writes.

## Definition Of Done

- Contributor confirms actual Claw Code hook payload format
- `WIRING_PLAN.md` updated with verified wiring steps
- `scripts/check-clawcode-adapter.sh` passes against real payloads
- Harness status promoted from EXPERIMENTAL to Supported in `clawcode/README.md`
