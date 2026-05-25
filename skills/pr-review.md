# Skill: pr-review

---
name: pr-review
description: Production-grade PR review — compresses large diffs, checks commit hygiene, evaluates PR description quality, interprets CI signals, and assesses merge-readiness. Delegates correctness and security deep-dives to code-reviewer and security-reviewer.
---

# PR Review

Full pull-request review: diff quality, commit hygiene, PR description, CI signals, and merge-readiness. Delegates correctness and security deep-dives to existing specialists.

## When to Use

- Reviewing a pull request before merge
- Checking a branch diff for PR-readiness before opening
- Summarizing what a large change actually does before the code review begins
- Assessing commit hygiene on a feature branch

## Process

1. **Fetch the diff** — `git diff origin/master...HEAD` (or the PR base). Record total lines changed.

2. **Compress if large** — If diff exceeds 10 000 lines: keep the first 200 lines of each file's hunk verbatim, then emit `[... N lines unchanged — <summary of what this section does> ...]`, then keep the last 50 lines. Never skip added/removed lines (lines starting with `+` or `-`); only compress context lines.

3. **Commit hygiene sweep** — Validate every commit message on the branch:
   - Follows Conventional Commits: `type(scope)!: description` (`feat|fix|chore|docs|style|refactor|test|build|ci|perf|revert`)
   - First line ≤ 72 characters
   - No WIP commits on a branch targeting a protected branch
   - No fixup!/squash! commits left uncommitted
   Report violating commit SHAs with the specific rule broken.

4. **PR description quality** — If the PR description is available (via `gh pr view --json body`): check it has a summary section, lists what changed and why, and has a test plan. Flag if empty or placeholder text.

5. **CI signal interpretation** — Run `gh pr checks` (or equivalent). Surface any failing checks with the failure message. Flag flaky checks if the same check name appears in both pass and fail states.

6. **Scope / intent alignment** — Compare the PR title and description against what the diff actually changes. Flag: files modified outside the stated scope, unexpected dependency changes, migrations not mentioned in the description.

7. **Delegate deep-dives** — For each file with CRITICAL-class patterns (auth, crypto, exec, eval, SQL), invoke `code-reviewer` and `security-reviewer` with the compressed diff of that file. Do not re-implement their logic; cite their findings in the final report.

8. **Emit structured report** — See Output Format below.

## Output Format

```
## PR Review — <branch-name> → <base>

**Merge-readiness:** READY | NEEDS CHANGES | BLOCKED
**Commits reviewed:** N  |  **Lines changed:** +X -Y

### Commit Hygiene
- [PASS/FAIL] <sha> — <rule>

### PR Description
- [PASS/WARN/FAIL] <finding>

### CI Status
- [PASS/FAIL] <check-name> — <status>

### Scope Alignment
- [IN-SCOPE/OUT-OF-SCOPE] <file or change>

### Findings (from code-reviewer / security-reviewer delegation)
#### [CRITICAL] …
#### [HIGH] …
#### [MEDIUM] …
#### [LOW] …

### Verdict
<one paragraph: merge-readiness decision with rationale>
```

## Constraints

- Does not re-implement correctness or OWASP security checks — delegates those to `code-reviewer` and `security-reviewer`.
- Does not auto-merge or auto-approve. Reports; the operator decides.
- Compression is lossless for added/removed lines — only context lines are elided.
- Works without a GitHub remote: skips `gh` commands and notes the gap in the report.
