# Skill: changelog-generator

---
name: changelog-generator
description: Generate or update CHANGELOG.md from git history using Conventional Commits. Groups commits by type (feat/fix/chore/etc.), formats entries under version headings, and optionally resolves PR numbers and authors.
---

# Changelog Generator

Generates or updates `CHANGELOG.md` from `git log`, grouping changes by Conventional Commits type under version headings. Produces the Keep a Changelog format.

## When to Use

- Cutting a new release and need a changelog entry
- CHANGELOG.md is missing or outdated
- Generating a changelog section for a PR description
- Reviewing what changed between two tags or commits

## Process

1. **Determine the range** — If a `CHANGELOG.md` exists with a previous version entry, use the tag of that version as the base: `git log <last_tag>..HEAD --oneline`. If no prior tag: use the full history.

2. **Extract commits** — `git log <range> --format="%H %s" --no-merges`. Parse each subject line for Conventional Commits:
   - `feat(scope)?: description` → Features
   - `fix(scope)?: description` → Bug Fixes
   - `chore(scope)?: description` → Maintenance
   - `docs(scope)?: description` → Documentation
   - `refactor(scope)?: description` → Refactoring
   - `test(scope)?: description` → Tests
   - `perf(scope)?: description` → Performance
   - `build|ci(scope)?: description` → Build / CI
   - `!:` suffix or `BREAKING CHANGE:` in footer → Breaking Changes section (first)
   - Non-conventional commits → Uncategorized (list at end, flag for cleanup)

3. **Resolve PR numbers** — If GitHub remote detected: `git log ... --format="%s"` and look for `(#N)` in subjects; include as links `([#N](url/pull/N))`.

4. **Determine version** — If a `package.json`, `pyproject.toml`, `go.mod`, or `Cargo.toml` exists: read the current version. Otherwise ask the operator or default to `Unreleased`.

5. **Write the entry** — Format under `## [version] - YYYY-MM-DD`:
   ```
   ### Breaking Changes
   ### Features
   ### Bug Fixes
   ### Performance
   ### Refactoring
   ### Documentation
   ### Maintenance
   ### Build / CI
   ### Uncategorized
   ```
   Omit empty sections.

6. **Prepend to CHANGELOG.md** — Insert the new entry at the top, after the title. If no CHANGELOG.md, create one with the standard header.

## Output Format

```markdown
# Changelog

All notable changes to this project will be documented here.
Format: [Keep a Changelog](https://keepachangelog.com), [Conventional Commits](https://conventionalcommits.org).

## [1.2.0] - 2026-05-25

### Features
- Add PR review skill and agent for diff compression and merge-readiness (#101)

### Bug Fixes
- Fix taint exemption for Grep/Read/Glob F10 on missing config (#99)
```

## Constraints

- Does not modify commit history. Reports only.
- Non-conventional commits are listed separately — does not guess their category.
- Date used is UTC today unless the range ends at a tag (in which case the tag date is used).
