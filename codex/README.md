# Codex Harness — VERIFIED

> **VERIFIED — 2026-05-24.** Hook protocol source-traced against openai/codex (codex-rs). PreToolUse / PostToolUse payload shapes confirmed from `codex-rs/hooks/src/events/`. Exit-code decision protocol confirmed via the Codex public docs. Adapter exercised end-to-end against the canonical payload shape. See `codex/WIRING_PLAN.md` for full verification details.

## What This Is

`hooks/adapter.js` delegates to `claude/hooks/hook-utils.js → createAdapter()`, which calls `runtime/pretool-gate.js` — the same single enforcement spine used by the Claude Code, OpenCode, OpenClaw, and ClawCode adapters. The adapter leads with the verified upstream field path (`i.tool_input?.command`, `i.cwd`) and retains the full fallback chain for defensive parsing.

CI: `scripts/check-codex-adapter.sh` — 16 checks covering fallback input shapes (1–12) and verified canonical payload assertions (13–16).

## Verified scope

| Capability | Status |
|---|---|
| PreToolUse blocking (exit code 2) | Supported |
| PostToolUse observation (secret-scan + taint) | Supported |
| args fidelity (`tool_input.command`) | Exact |
| cwd fidelity (`i.cwd` — `AbsolutePathBuf`) | Exact |
| MCP tool interception | Partial — handler coverage gaps (openai/codex#20204) |
| Skill interception | Partial — same handler-coverage gaps |
| Kill switch (`LILARA_KILL_SWITCH=1`) | Supported |
| Envelope reporting | Not available (no harness-side env capture) |

## Decision protocol

Codex honours exit code 2 for blocks. No stdout JSON is needed (contrast with ClawCode, which ignores exit codes). See `WIRING_PLAN.md` for the full protocol comparison.

## Known limitations

See `COMPATIBILITY_NOTES.md` for a structured breakdown of what is verified, what is still unverified (MCP/Skill coverage gaps), and the source-trace appendix.

## Wiring

See `WIRING_PLAN.md` for the verified wiring steps and a concrete `.codex/hooks.json` example.
