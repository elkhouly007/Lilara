# Skill: onboarding-guide

---
name: onboarding-guide
description: Generate a new-contributor onboarding document by analyzing the codebase — architecture, dev setup, test workflow, conventions, key files, and gotchas. Produces a CONTRIBUTING.md or ONBOARDING.md that a new developer can follow from clone to first PR.
---

# Onboarding Guide Generator

Generates an onboarding document for new contributors by reading the actual project structure, setup steps, test commands, and architectural decisions. Produces a `CONTRIBUTING.md` or `ONBOARDING.md` that a new developer can follow end-to-end.

## When to Use

- Project has no contributor documentation
- Onboarding a new team member or external contributor
- Creating contributor docs before open-sourcing a project
- After a major architecture change that made the old docs stale

## Process

1. **Read setup prerequisites** — Check for `.nvmrc`, `.python-version`, `rust-toolchain.toml`, `go.mod`, `Dockerfile`, `docker-compose.yml`. List required tools and versions.

2. **Read the install flow** — `npm install`, `pip install -e .`, `go mod tidy`, `cargo build`. Check for setup scripts (`scripts/install.sh`, `Makefile`). Document the exact commands in order.

3. **Read the test workflow** — Test command from `package.json` scripts or equivalent. Find: how to run all tests, how to run a single test, how to run with coverage. Note which tests are slow or require services.

4. **Map the architecture** — Read top-level directories and key files. Read `ARCHITECTURE.md` or equivalent if present. Produce a one-paragraph "how the code is organized" summary.

5. **Extract conventions** — Read `rules/common/coding-style.md`, `rules/common/git-workflow.md`, `rules/common/commit-conventions.md` (or equivalent). Summarize the rules new contributors must follow.

6. **Find the gotchas** — Check recent git commit messages for "fix", "bug", "workaround". Read ADRs if present. List: known footguns, non-obvious setup steps, environment quirks, CI-only tests.

7. **Write the guide** — See Output Format below.

## Output Format

```markdown
# Contributing to <Project>

## Prerequisites
<list of required tools + versions>

## Setup
<numbered clone + install steps>

## Running Tests
<test commands for all, single, with coverage>

## Architecture Overview
<1–2 paragraphs>

## Project Layout
| Directory | Purpose |
|-----------|---------|
| src/ | … |

## Conventions
- Commit format: <Conventional Commits>
- Branch naming: <pattern>
- Code style: <key rules>

## Gotchas
- <footgun 1>
- <footgun 2>

## First PR Checklist
- [ ] Tests pass locally
- [ ] Commit message follows convention
- [ ] CHANGELOG updated
```

## Constraints

- Does not invent gotchas or conventions — only documents what is actually enforced or present in the project.
- Does not overwrite an existing CONTRIBUTING.md without operator confirmation.
- Skips sections with no derivable content rather than writing "TBD" placeholders.
