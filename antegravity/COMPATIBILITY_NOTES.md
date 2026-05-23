# antegravity Compatibility Notes — Planned Integration

Status: **planned, not implemented**

## What Is Unknown

- Whether antegravity exposes a PreToolUse / PostToolUse hook event model compatible with Agent Runtime Guard hooks
- Whether hook scripts are invoked as Node.js processes, shell commands, or some other mechanism
- Whether `LILARA_ENFORCE=1` exit-code-2 blocking is honored
- How stdin payload format compares to Claude Code's JSON shape
- Whether `settings.json` wiring is the correct entry point

## What Is Assumed (Not Verified)

None. This stub makes no assumptions about the antegravity API.

## Deferred Decisions

- Trust posture defaults for antegravity sessions
- Whether antegravity sessions use the same `lilara.config.json` runtime config or a separate file
- Rate-limiting behavior under antegravity invocation patterns

## Path to Support

1. Document the antegravity hook lifecycle API (with a source reference)
2. Verify at least one hook type (PreToolUse Bash) works end-to-end
3. Write `WIRING_PLAN.md` with verified wiring steps
4. Add wizard path and apply-status rows
5. Add check-harness-support.sh validation for the new harness
