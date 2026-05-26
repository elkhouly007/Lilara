# Skill: ci-pipeline-generator

---
name: ci-pipeline-generator
description: Analyzes a project's lockfile, test command, linter, build script, and deployment target to generate a complete, production-ready CI pipeline. Outputs a GitHub Actions workflow YAML or GitLab CI YAML with matrix builds, package-manager-specific cache keys, branch protection-compatible job names, secrets handling, and status check naming. Covers lint, test, build, and optional deploy stages with correct dependency ordering.
---

# CI Pipeline Generator

Turn a project analysis into a complete, runnable CI pipeline — matrix builds, cache, secrets, and deployment — without starting from a blank YAML file.

## When to Use

- A new project has no CI/CD configuration and needs a full pipeline from scratch
- An existing pipeline is missing key stages (caching, matrix, deploy) and needs a structured rebuild
- Migrating from one CI platform to another (e.g., Circle CI to GitHub Actions, Jenkins to GitLab CI)
- Standardizing pipeline structure across multiple repositories in an organization

## Process

1. **Analyze the project** — read the following files to determine pipeline requirements:

   | File | Inferred from |
   |---|---|
   | `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` / `pom.xml` / `build.gradle` | Language, package manager, scripts |
   | `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` / `Cargo.lock` / `poetry.lock` | Lock file type for cache key |
   | `.eslintrc*` / `pyproject.toml[tool.ruff]` / `golangci.yml` | Linter present/configured |
   | `Dockerfile` / `docker-compose.yml` | Container build stage needed |
   | `.github/`, `.gitlab-ci.yml` | Existing CI to extend or replace |
   | `scripts/deploy*` / `Makefile` (deploy target) | Deployment command |
   | `README.md` (CI badge, test command docs) | Confirmed test command |

2. **Determine CI platform** — default to GitHub Actions unless the project has `.gitlab-ci.yml` or explicit GitLab remote. Ask if ambiguous.

3. **Design the job graph** — structure stages with correct dependency ordering:

   ```
   lint → test → build → [deploy-staging (on main)] → [deploy-production (on tag)]
   ```

   - `lint` and `test` run in parallel when there are no dependencies between them
   - `build` depends on `test` passing (not `lint`, to avoid blocking build on style issues in parallel)
   - Deploy jobs depend on `build` and run only on protected branches/tags

4. **Generate the GitHub Actions workflow** — write `.github/workflows/ci.yml`:

   ```yaml
   name: CI

   on:
     push:
       branches: [main, "release/**"]
     pull_request:
       branches: [main]

   concurrency:
     group: ${{ github.workflow }}-${{ github.ref }}
     cancel-in-progress: true

   jobs:
     lint:
       name: Lint
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: "20"
             cache: "npm"
         - run: npm ci
         - run: npm run lint

     test:
       name: Test (Node ${{ matrix.node }})
       runs-on: ubuntu-latest
       strategy:
         matrix:
           node: ["18", "20", "22"]
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: ${{ matrix.node }}
             cache: "npm"
         - run: npm ci
         - run: npm test

     build:
       name: Build
       runs-on: ubuntu-latest
       needs: test
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: "20"
             cache: "npm"
         - run: npm ci
         - run: npm run build
         - uses: actions/upload-artifact@v4
           with:
             name: dist
             path: dist/

     deploy-staging:
       name: Deploy to Staging
       runs-on: ubuntu-latest
       needs: build
       if: github.ref == 'refs/heads/main'
       environment: staging
       steps:
         - uses: actions/checkout@v4
         - uses: actions/download-artifact@v4
           with:
             name: dist
             path: dist/
         - run: bash scripts/deploy.sh staging
           env:
             DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
   ```

5. **Apply platform-specific best practices**:
   - **Cache keys**: use `hashFiles('**/package-lock.json')` for npm, `hashFiles('**/Cargo.lock')` for Rust, `hashFiles('**/poetry.lock')` for Python. Never cache without a lockfile hash — stale caches silently break builds.
   - **Concurrency**: cancel in-progress runs for the same branch to avoid queue buildup.
   - **Matrix exclusion**: exclude known-broken combos (e.g., Windows + Node 18 for projects with native addons) with `matrix.exclude`.
   - **Secrets**: never echo secrets; use `${{ secrets.NAME }}` directly in env blocks, never in `run` commands where they appear in logs.
   - **Job names**: match branch protection rule names exactly (e.g., `Test (Node 20)` must be the exact string in the required status check setting).
   - **Timeouts**: set `timeout-minutes: 10` on lint/test, `timeout-minutes: 20` on build, `timeout-minutes: 30` on deploy to prevent indefinitely-hung runners.

6. **Generate the GitLab CI alternative** (if GitLab platform detected) — write `.gitlab-ci.yml` with equivalent stages, cache configuration (using `key: ${CI_COMMIT_REF_SLUG}` + lockfile hash), and `rules:` blocks for branch-conditional jobs.

7. **Output the secrets inventory** — list every `secrets.NAME` reference in the generated workflow and where to configure each in the GitHub repo settings (Settings → Secrets and variables → Actions).

## Output Format

```
## CI Pipeline Generator — Output

Platform: GitHub Actions
Language: Node.js (npm)
Stages: lint → test (matrix: Node 18/20/22) → build → deploy-staging (main only)

Generated: .github/workflows/ci.yml

### Secrets Required

| Secret Name | Where to set | Purpose |
|---|---|---|
| DEPLOY_TOKEN | Repo → Settings → Secrets → Actions | Staging deploy authentication |

### Status Check Names (for branch protection)

Enable these exact strings in Settings → Branches → Branch protection rules → Require status checks:
- "Lint"
- "Test (Node 18)"
- "Test (Node 20)"
- "Test (Node 22)"
- "Build"

### Cache Strategy

Cache key: node-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
Restore keys: node-${{ runner.os }}-

Estimated cache hit rate: 80–90% on repeated commits to same branch.

### Next Steps

1. Copy .github/workflows/ci.yml to your repository.
2. Add DEPLOY_TOKEN to repository secrets.
3. Enable required status checks in branch protection settings.
4. Push to a feature branch and verify the pipeline runs green.
```

## Constraints

- The generated pipeline uses the package manager detected from lockfiles — if multiple lockfiles exist (`package-lock.json` + `yarn.lock`), the skill flags the conflict and asks which to use.
- Matrix builds default to the 2 most recent LTS versions plus current stable; adjust `matrix.node` to match your actual support matrix.
- Deploy stages are generated as stubs with `bash scripts/deploy.sh <env>` — the deploy script must already exist in the project; the skill does not generate deployment logic.
- Secrets are referenced by conventional names (`DEPLOY_TOKEN`, `DOCKER_PASSWORD`, etc.) — rename to match the actual secrets configured in the CI environment.
- The skill does not push the generated file or trigger any CI run — it writes the file locally for review before commit.
