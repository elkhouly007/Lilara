# Skill: branch-strategy-advisor

---
name: branch-strategy-advisor
description: Analyse a repository's branch topology, contributor count, release cadence, and CI/CD configuration to recommend the best-fit branching strategy — trunk-based development, GitHub Flow, or Gitflow — with a scored comparison table and a concrete migration plan. Read-only analysis; produces an advisory report, not code changes.
---

# Branch Strategy Advisor

Diagnose the current branching reality from git history and recommend a strategy that matches the team's size, release rhythm, and CI/CD maturity — with concrete migration steps rather than generic advice.

## When to Use

- Onboarding a new engineering team and establishing workflow conventions
- Experiencing chronic merge pain, long-lived branches, or repeated "integration hell" episodes
- Planning a release process change (moving from ad-hoc to scheduled releases, or the reverse)
- Auditing a repository to align its branching with its CI/CD capability

## Process

1. **Map the current topology** — capture the actual branch graph:

   ```bash
   git log --graph --oneline --all --decorate | head -80
   git branch -a | head -40
   git tag --sort=-creatordate | head -20
   ```

   Note: number of long-lived branches, average age of open feature branches, distance from feature branches to main/master.

2. **Measure release cadence** — infer how often the team ships to production:

   ```bash
   git log --tags --simplify-by-decoration --pretty="%D %ci" | grep "tag:" | head -20
   ```

   Classify as: **continuous** (multiple deploys/day), **frequent** (weekly), **periodic** (monthly/quarterly), or **milestone** (version-gated).

3. **Profile the contributor footprint** — estimate team size and coordination pressure:

   ```bash
   git shortlog -sn --since="90 days ago" | head -20   # active contributors
   git log --oneline --since="90 days ago" | wc -l      # commit velocity
   ```

4. **Inspect CI/CD signals** — check for branch protection and workflow configuration:

   ```bash
   ls .github/workflows/ 2>/dev/null || echo "no workflows"
   cat .github/CODEOWNERS 2>/dev/null | head -20
   ```

   Note: whether PRs are required, whether main is protected, whether deploys are branch-gated.

5. **Score each candidate strategy** against four dimensions (1–5 per dimension):

   | Dimension          | Trunk-Based | GitHub Flow | Gitflow |
   |--------------------|-------------|-------------|---------|
   | Merge simplicity   | 5           | 4           | 2       |
   | Release flexibility| 2           | 3           | 5       |
   | CI/CD friendliness | 5           | 4           | 2       |
   | Team-size fit      | best≤20     | any         | best>20 |

   Apply weights for this specific repo based on the data gathered in steps 1–4.

6. **Write the recommendation** — identify the winning strategy, explain the scoring, and produce a phased migration plan:
   - **Phase 1** (immediate): branch naming conventions + protection rules
   - **Phase 2** (week 1–2): retire or merge long-lived branches; enforce PR-on-push for main
   - **Phase 3** (week 3+): update CI/CD pipelines to match the new model; add feature flags if needed for trunk-based

## Output Format

```
## Branch Strategy Recommendation — <repo-name>

### Current State
- Active branches: 7 (3 older than 14 days)
- Release cadence: weekly (inferred from 12 tags in 90 days)
- Active contributors: 6 (last 90 days)
- CI/CD: GitHub Actions — main is protected, PRs required

### Scored Comparison

| Strategy      | Merge  | Release | CI/CD | Team fit | TOTAL |
|---------------|--------|---------|-------|----------|-------|
| Trunk-Based   |   5    |    3    |   5   |    5     |  18  ✓ |
| GitHub Flow   |   4    |    3    |   4   |    4     |  15   |
| Gitflow       |   2    |    4    |   2   |    2     |  10   |

### Recommendation: Trunk-Based Development

Rationale: 6-person team, weekly releases, and existing PR-required
protection make TBD the lowest-friction option. Feature flags (LaunchDarkly
or a simple env-var gate) eliminate the need for long-lived feature branches.

### Migration Plan

Phase 1 (this sprint):
  - Rename default branch to `main` if not already done.
  - Enable branch protection: require 1 reviewer + CI green before merge.
  - Convention: all branches are `<type>/<ticket>-<slug>` and merged within 3 days.

Phase 2 (weeks 1–2):
  - Merge or close the 3 branches older than 14 days.
  - Add `--delete-branch-on-merge` to repository settings.

Phase 3 (weeks 3+):
  - Introduce a feature-flag wrapper for any work-in-progress features
    so they can be merged to main dark. See: LaunchDarkly / Flagsmith.
  - Update GitHub Actions: remove `on: push: branches: [feature/**]` triggers.
```

## Constraints

- Read-only analysis — this skill reads git history and config files but does not modify branches, create tags, or push anything.
- Cannot access remote repository settings (branch protection, PR rules) without GitHub CLI or API credentials; inspects only what is available locally.
- Gitflow scoring improves for teams with strict compliance or regulatory release gating — flag this context if it applies.
- Feature-flag infrastructure required for trunk-based development with work-in-progress features; the skill notes this dependency but does not provision it.
- Accuracy of cadence and contributor metrics depends on local git history being up to date — run `git fetch --all` before the analysis.
