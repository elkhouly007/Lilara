# Antegravity Apply Checklist

**Status: VERIFIED — 2026-05-24.** Hook protocol confirmed against `google-gemini/gemini-cli` (Apache-2.0). See `WIRING_PLAN.md` for the full wiring guide.

## Before Wiring

- [ ] Read `WIRING_PLAN.md` — understand the migration trap (BeforeTool not PreToolUse; run_shell_command not Bash)
- [ ] Confirm which config file Antegravity reads on your install: `~/.gemini/settings.json` or `<project>/.gemini/settings.json` (or `.antigravity/`)
- [ ] If you have an existing `.claude/settings.local.json` with hooks, run `agy hooks migrate` to auto-convert
- [ ] Run `bash scripts/check-antegravity-adapter.sh` (all 16 checks must pass)

## Safe Automatic Actions

- Installing `antegravity/hooks/adapter.js` in a project-local path (no global mutation)
- Setting `LILARA_ENFORCE=0` (warn-only mode, non-blocking)

## Requires User Approval

- Any Antegravity config change that registers the hook globally (`~/.gemini/settings.json`)
- Setting `LILARA_ENFORCE=1` (will block tool calls on high/critical risk)
- Any change to existing Antegravity config files

## Post-Wiring Verification

- [ ] `scripts/check-antegravity-adapter.sh` passes (16 checks)
- [ ] A real Antegravity tool call triggers the adapter (check stderr for `[Lilara]` prefix or similar)
- [ ] Kill-switch test: `LILARA_KILL_SWITCH=1` blocks all tool calls
- [ ] `unset LILARA_KILL_SWITCH` restores normal operation
- [ ] (Optional) Capture a live payload using the recipe in `WIRING_PLAN.md` and compare to the verified `BeforeToolInput` shape

## Rollback

Remove the hook registration from your Antegravity config (`.gemini/settings.json`). The adapter makes no global writes.
