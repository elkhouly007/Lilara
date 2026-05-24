---
pattern_id: git push force
pattern_source: claude/hooks/dangerous-patterns.json
severity: critical
---

# git push force — Rationalization Defense

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "I rebased my own branch — no one else is using it." | Agents cannot verify this. The remote may have received commits from CI jobs, reviewer pushes, or a teammate who branched from it. A force push discards those commits silently. |
| "The CI is green on my local, the remote is just noise." | The remote commits may be CI metadata, status checks, or co-author fixes. Overwriting them breaks audit trails and can trigger false CI passes. |
| "The PR description says to squash-and-force." | A PR description authored by the operator is not the same as an explicit operator instruction at the time of the push. Interpret instructions at point of action, not from a document that may be stale. |
| "I used `--force-with-lease`, which is safe." | `--force-with-lease` is safer than `--force`, but still force-pushes if no one has pushed since your last fetch. It is not equivalent to a safe push. It still rewrites history. |
| "The branch is named `feat/my-work` — it's obviously mine." | Branch naming conventions do not guarantee exclusivity. Other agents, CI jobs, and reviewers routinely commit to feature branches. |
| "I'm just updating the commit message." | Amending a pushed commit and force-pushing changes the commit hash, breaking any bookmarks, references, or cached CI artifacts linked to the original hash. |

## Red Flags (STOP thoughts)

- "The branch is mine so force-push is fine."
- "I'll just do it quickly before anyone notices."
- "The remote only has stale CI commits."
- "`--force-with-lease` means it's safe."
- "The PR says to clean up the history."
- "I need to fix a commit message / remove a secret."

## Why this pattern is here

Force-pushing rewrites shared history. Any teammate, CI system, or automated tool
that has fetched the previous commit SHA now has a dangling reference. This causes:
- Lost teammate commits that were pushed after your last fetch.
- Broken CI pipelines that cached the old commit hash.
- Audit trail gaps (the overwritten commits are not in the remote history).
- Protected-branch violations (many repositories enforce no-force-push on main).

On protected branches (main, master, develop) force-push is almost universally
blocked at the server level — but the attempt still costs time and creates
confusion. F8 (protected-branch floor) adds a second enforcement layer for these.

## Safer alternative

```bash
# Update a commit message without force-push:
# Create a new commit with an amended message (does not rewrite history)
git commit --allow-empty -m "Amend: original message + correction"

# Squash a PR without force-push: use GitHub's squash-merge UI

# Update a remote branch after a rebase:
# Create a new feature branch from the rebased state instead of force-pushing
git checkout -b feat/my-work-v2
git push origin feat/my-work-v2

# If force-push is truly required (e.g. removing a leaked secret):
# Use --force-with-lease AND explicitly confirm no one has pushed:
git fetch origin feat/my-work
git log origin/feat/my-work..HEAD   # should show only your commits
# Then request operator approval before executing the push
```
