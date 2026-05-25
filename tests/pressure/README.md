# Pressure Tests

This directory contains RED → GREEN → REFACTOR pressure tests for Lilara rules.

## What is a pressure test?

A pressure test systematically validates that a rule:

1. **RED** — is actually needed (baseline without the rule lets dangerous action proceed).
2. **GREEN** — correctly fires when in place (warn / block depending on mode).
3. **REFACTOR** — holds under adversarial bypass attempts (flag reordering, shell
   metacharacters, two-step indirection, encoding tricks, etc.).

The methodology is adapted from `obra/superpowers` v5.0.7 pressure-testing discipline.
See `templates/pressure-test-template.md` for the full authoring guide.

## Files in this directory

| File | Pattern tested | Source |
|------|---------------|--------|
| `rm-rf.pressure.md` | `rm recursive force` (critical) | `claude/hooks/dangerous-patterns.json` |
| `curl-pipe-to-shell.pressure.md` | `curl pipe to shell` (critical) | `claude/hooks/dangerous-patterns.json` |
| `force-push.pressure.md` | `git push force` (critical) | `claude/hooks/dangerous-patterns.json` |

## Adding new pressure tests

1. Copy `templates/pressure-test-template.md` to `tests/pressure/<rule-slug>.pressure.md`.
2. Fill in every section (the CI check verifies all six H2 headers are present).
3. Run `bash scripts/check-pressure-tests.sh` locally to confirm structure.

Priority order for future tests (from `references/competitive-audit.md` + ROADMAP):

- `sql-drop-truncate.pressure.md` (critical)
- `dd-disk-overwrite.pressure.md` (critical)
- `mkfs-disk-format.pressure.md` (critical)
- `git-reset-hard.pressure.md` (high)
- `chmod-777.pressure.md` (high)

## CI integration

`scripts/check-pressure-tests.sh` is wired into `lilara-cli.sh check`. It verifies
every `*.pressure.md` file has all six required H2 headings. The check is
structural only — it does not run the commands.
