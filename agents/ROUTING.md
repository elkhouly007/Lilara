# Agent Routing Guide

Quick reference for selecting the right agent. Full machine-readable index: `agents/index.json`.

## By Task

| Situation | Agent(s) |
|-----------|----------|
| Review a PR or code change | `pr-reviewer` (mechanics + merge-readiness), then `code-reviewer` + language-specific reviewer |
| Security vulnerability suspected | `security-reviewer` |
| Full codebase SAST security audit (34-class taxonomy) | `security-scanner` |
| Build or compile is failing | `build-error-resolver` → language-specific build resolver |
| Planning a new feature | `architect` + `planner` |
| Breaking down a large task | `chief-of-staff` |
| Code is too complex or hard to read | `code-simplifier`, `refactor-cleaner` |
| Finding unused code / dead exports before a release or refactor | `dead-code-detector` |
| Writing tests / TDD | `tdd-guide` |
| Generating unit tests from source code | `test-generator` |
| E2E tests broken | `e2e-runner` |
| Performance is slow | `performance-optimizer` |
| Documentation out of sync | `doc-updater` |
| Generate README, API docs, changelog, or onboarding guide | `technical-writer` |
| Exploring unfamiliar codebase | `code-explorer` |
| UI accessibility issues | `a11y-architect` |
| Healthcare / HIPAA compliance | `healthcare-reviewer` |
| ML / GAN / PyTorch work | `gan-planner` → `gan-generator` → `gan-evaluator` |
| Open source fork or packaging | `opensource-forker`, `opensource-packager` |
| Improving harness / agent config | `harness-optimizer` |

## By Language

| Language | Reviewer | Build Resolver |
|----------|----------|----------------|
| Python | `python-reviewer` | `pytorch-build-resolver` (ML) |
| TypeScript / JavaScript | `typescript-reviewer` | `build-error-resolver` |
| Go | `go-reviewer` | `go-build-resolver` |
| Java | `java-reviewer` | `java-build-resolver` |
| Kotlin / Android | `kotlin-reviewer` | `kotlin-build-resolver` |
| Rust | `rust-reviewer` | `rust-build-resolver` |
| C++ | `cpp-reviewer` | `cpp-build-resolver` |
| C# / .NET | `csharp-reviewer` | `build-error-resolver` |
| Swift | `code-reviewer` | `build-error-resolver` |
| Flutter / Dart | `flutter-reviewer` | `dart-build-resolver` |
| Database / SQL | `database-reviewer` | — |

## Escalation Chain

```
Task arrives
  └─ General?        →  code-reviewer
  └─ Security risk?  →  security-reviewer
  └─ Build broken?   →  build-error-resolver → language-specific
  └─ Complex plan?   →  architect → planner → chief-of-staff
  └─ Multi-agent?    →  chief-of-staff (coordinates all others)
```

## Tags Index

See `agents/index.json` → `"tags"` for a full tag-to-agent mapping.
Search by tag: `security`, `review`, `build`, `ml`, `infra`, `compliance`, `accessibility`.
