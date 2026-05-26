# Full-Power Status

Last updated: 2026-04-23
Source of truth for counts: `references/parity-matrix.json`

## Current State Summary

Agent Runtime Guard currently includes:

- cross-tool policy layers for OpenClaw, OpenCode, and Claude Code;
- reviewed capability packs for MCP, wrappers, plugins, browser, notifications, and daemons;
- ARG amplification philosophy throughout: every agent, rule, and skill is purpose-built for this project;
- **61 specialist agents** following the ARG amplification philosophy — Mission, ARG-aware Activation, numbered Protocol, measurable Done When;
- **103 rule files** covering 12 language directories plus common, database, infrastructure, and web domains;
- **39 skills** for ARG debug, policy tuning, capability auditing, code analysis, git workflows, orchestration design, and more;
- 20 approval-boundary scenarios and 14 prompt-injection scenarios;
- executable fixture coverage with **359/359 passing**;
- clean verification across audit, smoke, payload protection, fixtures, integration smoke, installation/profile checks, config/settings integration checks, apply-status validation, executable hygiene, setup-wizard edge cases, per-tool wiring-doc coverage, unified status-artifact checks, policy-lint, sensitive-data-detection, and superiority-evidence checks.

## Verification Snapshot

Current verified state:

- `audit-local.sh` — passing
- `audit-examples.sh` — passing
- `check-registries.sh` — passing
- `check-scenarios.sh` — passing
- `run-fixtures.sh` — passing (359/359)
- `test-payload-protection.sh` — passing
- `check-integration-smoke.sh` — passing
- `smoke-test.sh` — passing
- `check-skills.sh --errors-only` — passing
- `check-installation.sh` — passing
- `check-config-integration.sh` — passing
- `check-apply-status.sh` — passing
- `check-executables.sh` — passing
- `check-setup-wizard.sh` — passing
- `check-wiring-docs.sh` — passing
- `check-superiority-evidence.sh` — passing
- `check-status-docs.sh` — passing
- `check-status-artifact.sh` — passing
- `policy-lint.sh` — passing
- `detect-sensitive-data.sh` — passing
- `status-summary.sh` — passing

## Capability Snapshot

| Component | Prior Baseline | Current | Original | Notes |
|---|---:|---:|---:|---|
| Agents | 0 | 61 | 61 | All written for ARG amplification philosophy |
| Rules | 0 | 103 | 103 | 12 languages + common/database/infra/web domains |
| Skills | 0 | 39 | 39 | ARG debug, policy, analysis, orchestration, git workflows |

## Sprint Status

### Closed parity-to-superiority program
- **Sprint 1, Truth and Verification**: complete
- **Sprint 2, Rules Parity Wave**: complete
- **Sprint 3, Skills Parity Wave**: complete
- **Sprint 4, Runtime Activation and Evidence**: complete

### Current follow-on runtime sprint
- **Sprint R2, Runtime autonomy follow-on / policy lifecycle auditability**: complete
- Delivered emphasis: adaptive action plans, explicit promotion flows, reviewed-default lifecycle visibility, lifecycle timing, and audit-friendly runtime history
- **Sprint R3, Routing and workflow fidelity**: CLOSED
- Sprint R3 delivered: `payloadClass` and `sessionRisk` flow through the hook path at full fidelity; `escalate` action has a dedicated human-gated workflow lane; one-time opt-in auto-allow (eligible-gated, single-use); session-trajectory-driven routing nudges actions up after repeated escalations (threshold/window env-tunable); `LILARA_KILL_SWITCH=1` emergency block.

## Runtime Performance

Measured with `scripts/bench-runtime-decision.sh` (N=1000 representative decisions):

| Platform | Node | p50 | p95 | p99 | Ceiling |
|----------|------|-----|-----|-----|---------|
| win32 (Windows 11, Git Bash) | v25.5.0 | ~39ms | ~76ms | ~99ms | 500ms |
| ubuntu-latest (CI) | v20 (expected) | <1ms | <2ms | <5ms | 5ms |

Note: Windows numbers are dominated by `fs.appendFileSync` / `fs.writeFileSync` in the decision journal and session state recorder (~40ms per `decide()` call). Linux numbers are IO-bound only on first call due to module cache warmup.

## Honest Power Estimate

All content in Agent Runtime Guard is original — written specifically for the ARG amplification philosophy. There is no upstream comparison because this project has no upstream source.

- **Agents**: 61 original specialists; every file encodes Mission, Activation, Protocol, Amplification Techniques, and measurable Done-When criteria
- **Rules**: 103 original files; 12 language domains plus common/database/infra/web; YAML frontmatter with `last_reviewed` and `version_target` on every file
- **Skills**: 39 original skills spanning ARG configuration, analysis, orchestration, git workflows, and amplification workflows
- **Runtime**: fully verified; bounded autonomous decision layer with kill-switch, learned-allow, auto-allow-once, session-trajectory nudge, payload classification, and JSONL audit trail

The correct current description is:

> **Agent Runtime Guard is a purpose-built, all-original agentic policy and amplification framework with a verified runtime decisioning layer, comprehensive rule coverage across 12 languages, and 249 passing integration fixtures.**

## v0.5 milestone — closed 2026-05-15 (released as 3.1.0)

Stages A–D delivered across PRs #37–#53. Master green; 30 local CI gates pass; 371 fixtures + 12 replay entries with 0 divergences; p99 1.2ms.

**Floors added (engine-baked, non-demotable):**
- F16 ambient-authority (rung 17.5) — denies writes touching ssh / shellRc / packageCache / credentialHelper / mcpConfig / browserProfile / osKeychain unless `scopes.ambient.allow[]` opts in. ADR-009.
- F17 cross-agent lock (rung 17.75) — blocks writes when another agent holds an unexpired exclusive lock on the path / project.
- F19 output-channel exfiltration guard (rung 17.875) — blocks confirmed-class secrets on stdout / generated files / commit messages / PR text; compensating-rule for `not-observed` channels. ADR-010.
- F20 change-intent drift (rung 18.5) — blocks IR actions outside the declared envelope's file targets / commands / command-classes / network hosts / policy paths. ADR-012.

**Operational infrastructure:**
- ADR-004 tamper-evident hash-chained journal core + verify CLI; degraded-mode wiring routes write-like allows through require-review when `LILARA_DEGRADED=1`.
- ADR-011 portable state export / import bundle (`horus state {export,import,doctor}`) with manifest sha256.
- ADR-013 auto-snapshot before destructive ops (`horus snapshot {list,show,restore,prune,doctor}`).
- ADR-014 audit-grade receipts: JSON Schema for journal entries, exporter (jsonl / CSV, deterministic), optional redact mode, SOC2 informal mapping. `horus receipts {validate,export,schema,doctor}`.
- ADR-015 notification routing (wave-4): opt-in Discord / Slack / email transports, fire-and-forget hook, allowlist PII scrub. Default disabled; absent `notifications` block keeps receipts byte-identical.
- G4 adapter capability manifests: every adapter declares positive + negative capabilities + `outputChannelObservability` map; CI-gated.

**Test infrastructure (added in Stage D):**
- Stress harness: 8 scenarios, nightly cron, observability-only (does not block PR merges).
- Adversarial track: full G+Q library exercised nightly (Linux only); bypass detection auto-files high-priority issue.

**What's intentionally not in 0.5 (deferred to v1.0 / v1.5 / M9):** multi-channel approval handshake, Telegram / mobile-push / voice notifications, skill-orchestration runtime, public open-source release prep. See `workstreams/agent-runtime-guard-plan.md` §4.2–§4.6.

## v1.0.x Runtime Sprint Highlights

The runtime sprint (R1–R3, now closed) delivered:

1. runtime decisioning with local learned policy, session context, and project-aware config,
2. bounded workflow actions such as `require-review`, `require-tests`, and `modify`,
3. adaptive action plans based on repeated approvals and pending suggestions,
4. lifecycle-aware promotion guidance with explicit CLI next steps,
5. a dedicated `runtime promote` flow for reviewed local defaults,
6. promoted and dismissed default tracking with audit timestamps,
7. lifecycle timing output (`created-at`, `eligible-at`, accepted/dismissed, `last-approved-at`),
8. compact lifecycle summaries in `runtime explain`,
9. `LILARA_KILL_SWITCH=1` emergency block; `auto-allow-once` single-use eligibility-gated grants; session-trajectory-driven routing nudges,
10. clean verification across `check-runtime-core.sh`, `check-runtime-cli.sh`, and the full `lilara-cli.sh check` path.
