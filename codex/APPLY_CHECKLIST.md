# Codex Apply Checklist

> **EXPERIMENTAL.** Use this checklist only after the actual Codex hook payload format is confirmed by a contributor.

## Before Wiring

- [ ] Read `COMPATIBILITY_NOTES.md` — understand what is unverified
- [ ] Read `WIRING_PLAN.md` — understand the speculative wiring steps
- [ ] Log actual Codex hook stdin to a temp file and compare against the adapter's fallback chain
- [ ] Run `bash scripts/check-codex-adapter.sh` with the actual payload shape

## Safe Automatic Actions

- Installing `codex/hooks/adapter.js` in a project-local path (no global mutation)
- Setting `HORUS_ENFORCE=0` (warn-only mode, non-blocking)

## Requires User Approval

- Any Codex config change that registers the hook globally
- Setting `HORUS_ENFORCE=1` (will block tool calls on high/critical risk)
- Any change to existing Codex config files

## Post-Wiring Verification

- [ ] `scripts/check-codex-adapter.sh` passes (12 checks)
- [ ] A real Codex tool call triggers the adapter (check stderr for `[Agent Runtime Guard]` prefix)
- [ ] Kill-switch test: `HORUS_KILL_SWITCH=1` blocks all tool calls
- [ ] `unset HORUS_KILL_SWITCH` restores normal operation

## Rollback

Remove the hook registration from your Codex config. The adapter makes no global writes.
