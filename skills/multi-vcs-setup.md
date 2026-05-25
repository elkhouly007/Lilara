# Skill: multi-vcs-setup

---
name: multi-vcs-setup
description: Configure Lilara to work correctly in GitHub Actions, GitLab CI, and Bitbucket Pipelines. Documents the environment variables each platform exposes and how Lilara's VCS adapter resolves branch names and protected branches in each context.
---

# Multi-VCS Setup

Configure Lilara to detect and adapt to different CI/VCS environments. The `runtime/vcs-adapter.js` module reads standard CI environment variables to resolve the current branch, base branch, and diff summary without hardcoding git commands in each context.

## When to Use

- Setting up Lilara in a GitHub Actions workflow for the first time
- Migrating a project from GitHub to GitLab or Bitbucket
- Debugging branch-detection issues in CI (wrong branch name, wrong protected-branch list)
- Adding Lilara to a monorepo with multiple CI environments

## Process

1. **Verify the VCS environment detection** — from a hook or script in your pipeline:

   ```bash
   node -e "const { detectVcs } = require('./runtime/vcs-adapter'); console.log(detectVcs())"
   ```

   Expected output: `github`, `gitlab`, `bitbucket`, or `local`.

2. **Set the platform-specific environment variables** — Lilara reads these automatically if the platform sets them:

   | Platform | Branch variable | Base branch variable |
   |---|---|---|
   | GitHub Actions | `GITHUB_HEAD_REF` or `GITHUB_REF_NAME` | `GITHUB_BASE_REF` |
   | GitLab CI | `CI_COMMIT_REF_NAME` | `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` |
   | Bitbucket Pipelines | `BITBUCKET_BRANCH` | `BITBUCKET_PR_DESTINATION_BRANCH` |
   | Local / override | `LILARA_BRANCH_OVERRIDE` | (from `lilara.config.json`) |

3. **Wire Lilara hooks in your CI pipeline** — the session-start hook and decision engine will pick up the correct branch automatically. Example for GitHub Actions:

   ```yaml
   - name: Run Lilara hooks
     env:
       LILARA_ENFORCE: "1"
     run: node claude/hooks/session-start.js < /dev/null
   ```

4. **Verify branch and protected-branch detection**:

   ```bash
   node -e "
   const { getCurrentBranch, getProtectedBranches } = require('./runtime/vcs-adapter');
   console.log('branch:', getCurrentBranch());
   console.log('protected:', getProtectedBranches());
   "
   ```

5. **Use `LILARA_BRANCH_OVERRIDE`** to force a specific branch name for testing or non-standard CI setups:

   ```bash
   LILARA_BRANCH_OVERRIDE=main bash scripts/lilara-cli.sh ci
   ```

## Output Format

Verification commands above print:
- `detectVcs()` → a single string: `"github"`, `"gitlab"`, `"bitbucket"`, or `"local"`
- `getCurrentBranch()` → branch name string (e.g. `"feature/my-branch"`)
- `getProtectedBranches()` → array of strings (e.g. `["main", "production"]`)

## Constraints

- `detectVcs()` uses environment variable detection only — it does not query any remote API.
- `LILARA_BRANCH_OVERRIDE` always wins, regardless of CI platform. Use with caution in production pipelines.
- `getDiffSummary()` falls back to `origin/main...HEAD` if no base SHA is available. Ensure `origin/main` is fetched in your CI pipeline (`git fetch --no-tags origin main`).
- On local machines without CI env vars, all functions fall back to git commands. No behavior change from current.
