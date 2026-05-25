# Dangerous-Pattern Rationale Files

This directory contains per-pattern rationale companion files for the critical
and high-severity entries in `claude/hooks/dangerous-patterns.json`.

## Convention

Each file is named `<pattern-id>.rationale.md` where `<pattern-id>` matches
the kebab-case of the `name:` field in `dangerous-patterns.json` (lowercased,
spaces → hyphens, special chars stripped).

## File structure

Each rationale file contains:

| Section | Purpose |
|---------|---------|
| `## Rationalization Table` | Excuse \| Reality two-column table for this specific pattern |
| `## Red Flags (STOP thoughts)` | Trigger thoughts that signal the agent has entered rationalization mode for this pattern |
| `## Why this pattern is here` | Real-world failure mode defended against |
| `## Safer alternative` | Concrete safer command or workflow to use instead |

See `rules/common/rationalization-defense.md` for the master defense methodology.

## Covered patterns (severity order)

| File | Pattern name | Severity |
|------|-------------|----------|
| `rm-recursive-force.rationale.md` | rm recursive force | critical |
| `rm-no-preserve-root.rationale.md` | rm no-preserve-root | critical |
| `git-push-force.rationale.md` | git push force | critical |
| `drop-database.rationale.md` | DROP DATABASE / DROP TABLE | critical |
| `curl-pipe-to-shell.rationale.md` | curl pipe to shell | critical |
| `mkfs-disk-format.rationale.md` | mkfs (disk format) | critical |
| `dd-destructive-disk-write.rationale.md` | dd destructive disk write | critical |
| `sudo-with-destructive-command.rationale.md` | sudo with destructive command | critical |
| `npx-y-auto-download.rationale.md` | npx -y (auto-download execution) | high |
| `chmod-world-writable.rationale.md` | chmod world-writable | high |

## Adding new rationale files

1. Add the pattern to `claude/hooks/dangerous-patterns.json` with `name`, `pattern`,
   `severity`, and `reason` fields.
2. Copy an existing `*.rationale.md` as a template.
3. Run `bash scripts/check-counts.sh` — update `EXPECTED_RULES` if the count drifts.
