# Skill: git-bisect-debugger

---
name: git-bisect-debugger
description: Automate regression hunting with git bisect run. Given a known-good commit and a failing test command, this skill constructs and executes a binary search that isolates the exact commit that introduced a regression — returning the culprit SHA, a condensed diff, and a recommended remediation (revert, forward-fix, or cherry-pick). Requires a clean working tree and a deterministic, fast test command.
---

# Git Bisect Debugger

Drive `git bisect run` automatically to pinpoint the commit that broke a passing behaviour, without manually checking out hundreds of revisions.

## When to Use

- A feature that previously worked now fails and you don't know which commit caused it
- CI is red on `main` and the recent commit window is large (more than 5 commits)
- A performance regression appeared but no single obvious change is responsible
- You need an exact SHA before opening a revert PR to satisfy a blame trail

## Process

1. **Define the range** — confirm which commit is the last known-good state. Use `git log --oneline --since="<date>"` or `git tag -l` to anchor on a release tag. Record both commits: `GOOD=<sha-or-tag>` and `BAD=HEAD` (or the first known-bad SHA).

2. **Craft the test command** — the command must exit `0` when the commit is good and non-zero when it is bad. Keep it fast (under 10 s). Examples:

   ```bash
   # Unit test for one function
   node --test tests/unit/auth.test.js

   # Compiled binary check
   cargo build --quiet 2>/dev/null && cargo test auth_token_expires -- --nocapture
   ```

   Avoid network calls, random seeds, or external-state reads — bisect will misclassify flaky results.

3. **Run the automated bisect** — from the repo root with a clean working tree (`git status` must show no uncommitted changes):

   ```bash
   git bisect start
   git bisect bad  "$BAD"
   git bisect good "$GOOD"
   git bisect run  <test-command>
   ```

   Git checks out roughly `log₂(N)` commits and prints the first bad commit when it converges.

4. **Capture the result** — after bisect terminates, record the culprit output:

   ```bash
   git bisect log       # full session with each step
   git show --stat HEAD # diff summary of the culprit commit
   git bisect reset     # restore the working tree to HEAD
   ```

5. **Analyse the diff** — read the culprit commit message and changed files. Determine the regression category:
   - **Accidental breakage** → prepare a minimal revert (`git revert <sha> --no-edit`)
   - **Intentional change with side-effects** → draft a targeted forward-fix
   - **Merged-in dependency change** → cherry-pick the fix from the dependency branch

6. **Write the remediation proposal** — include the culprit SHA, one-line summary of what changed, why it broke the target behaviour, and the recommended next action with the exact git command.

## Output Format

```
## Bisect Result

Culprit commit: abc1234
Author: Jane Smith <jane@example.com>
Date:   2026-04-17

    refactor(auth): consolidate token expiry checks

Changed files:
  src/auth/token.ts      (+12 / -3)
  tests/unit/auth.test.ts (+5  / -0)

## Root Cause
The refactor moved expiry validation from the middleware layer to the
token constructor, but the constructor now silently returns undefined
for malformed timestamps instead of throwing, causing the downstream
guard to pass expired tokens.

## Recommended Action
Forward-fix: add a guard for undefined expiry in token.ts line 47.
  git checkout -b fix/token-expiry-undefined abc1234^
  # apply fix, then cherry-pick or rebase
```

## Constraints

- Requires a clean working tree before `git bisect start` — stash or commit any local changes first.
- The test command must be deterministic; environmental flakiness (network, clock skew, file system order) will produce a wrong result without any warning.
- Does not modify the repository history — every command here is read-only except the final remediation action you choose to apply.
- Bisect steps are proportional to `log₂(commit-range-size)`; for ranges larger than 1 000 commits, narrow the range first with release tags.
- Merge commits can confuse bisect's traversal; if the repo uses merge-heavy workflows, pass `--first-parent` to git log when identifying the range.
