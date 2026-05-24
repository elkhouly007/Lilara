# Codex Apply Checklist

**Status: VERIFIED — 2026-05-24.** Hook protocol confirmed against openai/codex source. Follow the wiring path in `WIRING_PLAN.md`.

## Before Wiring

- [ ] Read `WIRING_PLAN.md` — covers the verified payload shapes, decision protocol, and a concrete `.codex/hooks.json` example
- [ ] Read `COMPATIBILITY_NOTES.md` — covers known MCP/Skill coverage gaps
- [ ] Run `bash scripts/check-codex-adapter.sh` — 16 checks must pass (fallback coverage + verified shape assertions)

## Safe Automatic Actions

- Installing `codex/hooks/adapter.js` in a project-local `.codex/hooks.json` (no global mutation)
- Setting `LILARA_ENFORCE=0` (warn-only mode, non-blocking)

## Requires User Approval

- Any Codex config change that registers the hook at the user level (`~/.codex/hooks.json`)
- Setting `LILARA_ENFORCE=1` (will block tool calls on high/critical risk via exit code 2)
- Any change to existing Codex config files

## Post-Wiring Verification

- [ ] `scripts/check-codex-adapter.sh` passes (all 16 checks)
- [ ] A real Codex tool call triggers the adapter (check stderr for `[Lilara]` prefix)
- [ ] Kill-switch test: `LILARA_KILL_SWITCH=1` blocks all tool calls
- [ ] `unset LILARA_KILL_SWITCH` restores normal operation

## Rollback

Remove the hook entry from `.codex/hooks.json`. The adapter makes no global writes.
