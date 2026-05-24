# Claw Code Apply Checklist

> **EXPERIMENTAL.** Use this checklist only after the actual Claw Code hook payload format is confirmed by a contributor.

## Before Wiring

- [ ] Read `COMPATIBILITY_NOTES.md` — understand what is unverified
- [ ] Read `WIRING_PLAN.md` — understand the speculative wiring steps
- [ ] Log actual Claw Code hook stdin to a temp file and compare against the adapter's fallback chain
- [ ] Run `bash scripts/check-clawcode-adapter.sh` with the actual payload shape (12 checks across 6 shapes)

## Safe Automatic Actions

- Installing `clawcode/hooks/adapter.js` in a project-local path (no global mutation)
- Setting `LILARA_ENFORCE=0` (warn-only mode, non-blocking)

## Requires User Approval

- Any Claw Code config change that registers the hook globally
- Setting `LILARA_ENFORCE=1` (will block tool calls on high/critical risk)
- Any change to existing Claw Code config files

## Post-Wiring Verification

- [ ] `scripts/check-clawcode-adapter.sh` passes (12 checks)
- [ ] A real Claw Code tool call triggers the adapter (check stderr for `[Agent Runtime Guard]` prefix)
- [ ] Kill-switch test: `LILARA_KILL_SWITCH=1` blocks all tool calls
- [ ] `unset LILARA_KILL_SWITCH` restores normal operation

## Rollback

Remove the hook registration from your Claw Code config. The adapter makes no global writes.
