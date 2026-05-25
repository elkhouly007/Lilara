---
last_reviewed: 2026-05-24
version_target: 0.1.0
pattern_id: rm recursive force
pattern_source: claude/hooks/dangerous-patterns.json
severity: critical
---

# rm recursive force — Rationalization Defense

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "It's just the `dist/` or `build/` directory — it regenerates automatically." | Regeneration assumes the build system is intact. If you're deleting `dist/` because something is broken, the build system may also be broken. Deletion does not fix the underlying issue. |
| "I checked the path — it's definitely safe." | Path checks fail under race conditions, shell expansion surprises (`$PROJ_ROOT` being empty means `rm -rf /`), and typos. The check happened before execution; the path resolves at execution time. |
| "The user asked me to clean up." | "Clean up" is ambiguous. The operator asked for a result; `rm -rf` is one tool that achieves that result with no recovery path if the path is wrong. Ask for confirmation or use a safer scoped deletion. |
| "I'll create a backup / snapshot first." | Backups do not exist until they are verified. Auto-snapshot (ADR-013) may or may not have fired. Never assume a backup exists without confirming the snapshot reference in the receipt. |
| "This is a CI environment — data loss doesn't matter." | CI environments often have credential caches, coverage artifacts, and runner-state files. Deleting them mid-run breaks parallel jobs and can expose secrets via log output of failed recovery. |
| "The flag is `-rRf` not `-rf` — technically different." | Functionally identical. The regex covers both. The point of the rule is not the flag spelling, it is the irreversibility of the operation. |

## Red Flags (STOP thoughts)

- "The path is obviously correct."
- "It's just temp files / build artifacts / a test directory."
- "I'll back up first, so it's fine."
- "The user said 'clean everything.'"
- "This is safe because it's CI / Docker / a throwaway VM."
- "I already did a dry-run with `ls` and it looked right."

## Why this pattern is here

`rm -rf` is the single most common cause of accidental and agent-driven data loss
in development environments. A single character off in the path (trailing space,
empty variable, wrong cwd) turns a project cleanup into a root-filesystem wipe.

Real incidents: entire home directories deleted because `$PROJECT` was unset;
production databases wiped because the deploy script ran in the wrong environment;
source repositories deleted during a "stale branch cleanup" that expanded a glob
more broadly than expected.

The OWASP Agentic Security Initiative (ASI02) lists unguarded destructive
filesystem operations as a top-5 autonomous-agent risk.

## Safer alternative

```bash
# See what would be deleted before deleting it
find ./dist -type f | head -20

# Explicit scoped removal (no wildcard)
rm -rf ./dist/bundle.js ./dist/bundle.js.map

# Or move to trash instead of permanent deletion (Linux/macOS)
trash ./dist/

# For CI cleanup: define a Makefile target with an explicit path list
make clean   # auditable, version-controlled, peer-reviewed
```
