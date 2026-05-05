# Codex Wiring Plan (SPECULATIVE)

> **Status: EXPERIMENTAL.** This document describes the intended wiring once the Codex hook API is confirmed by a contributor. Do not follow these instructions as production guidance until the actual Codex hook payload format is verified.

## Goal

Wire Agent Runtime Guard into Codex as a project-local enforcement layer using the same `pretool-gate.js` spine used by Claude Code, OpenCode, and OpenClaw.

## Adapter

`codex/hooks/adapter.js` is a PreToolUse adapter that delegates to `claude/hooks/hook-utils.js → createAdapter()` → `runtime/pretool-gate.js`.

**Likely Codex input shapes (unverified):**
```json
{ "tool": "bash", "command": "...", "workdir": "..." }
{ "tool_name": "Bash", "tool_input": { "command": "..." } }
```
Also accepted via fallback chain: `cmd`, `tool_input.command`, `input.command`, `args.command`, `params.command`.

**Modes:**
- Warn mode (default): warns to stderr, exits 0 (tool call proceeds).
- Block mode: `export HORUS_ENFORCE=1` — exits 2 on high/critical risk.

## Wiring Steps (Unverified — Contributor Must Confirm)

1. Determine where Codex reads PreToolUse hook configuration.
2. Set hook entry point to the absolute path of `codex/hooks/adapter.js`.
3. Verify the actual hook payload by logging stdin to a temp file before the adapter runs.
4. If the payload shape differs from the above, update `extractCommand`/`extractCwd` in `codex/hooks/adapter.js`.
5. Confirm that `scripts/check-codex-adapter.sh` passes against real payloads.
6. File a PR updating this document and promoting the harness from EXPERIMENTAL to Supported.

## PostToolUse

No PostToolUse hook planned until PreToolUse wiring is confirmed and the Codex event model is understood.

## Rollback

Remove the hook registration from your Codex config. The adapter makes no global writes.

## Definition Of Done

- Contributor confirms actual Codex hook payload format
- `WIRING_PLAN.md` updated with verified wiring steps
- `scripts/check-codex-adapter.sh` passes against real payloads
- Harness status promoted from EXPERIMENTAL to Supported in `codex/README.md`
