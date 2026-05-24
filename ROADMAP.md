# Roadmap — Agent Runtime Guard

This document tracks forward-looking work only. For the implemented architecture, see [ARCHITECTURE.md](ARCHITECTURE.md). For the contract specification, see [CONTRACT.md](CONTRACT.md). For shipped changes, see [CHANGELOG.md](CHANGELOG.md). For the formal decision log, see [DECISIONS.md](DECISIONS.md).

---

## Executive Summary

ARG is a zero-dep Node runtime guard for AI coding agents. It pairs an explicit upfront contract (`lilara.contract.json`) with a single enforcement spine and hard safety floors that no contract or learning step can demote. The current product milestone — v0.5 "Incremental Hardened Daily" — is closed; the runtime is in soak.

### Three horizons

**Today — what runs (v3.1.0).** A single enforcement spine across Claude Code, OpenCode, and OpenClaw, plus best-effort adapters for Codex / ClawCode / Antegravity. Eighteen engine-baked floors (F1–F18) anchored in `runtime/decision-lattice.js` and consumed by `runtime/decision-engine.js`. Canonical Action IR (`runtime/action-ir.js`) normalises every adapter's raw payload before floors run. Receipts carry `irHash`, `rung`, `latticeVersion`, and floor-source tags. Tamper-evident hash-chained decision journal with verify CLI. Auto-snapshot before destructive ops. Audit-grade receipts schema with exporter and offline redactor. Notification routing to Discord / Slack / email (zero-dep, fire-and-forget). State portability (export/import bundle). F19 output-channel exfiltration guard. F20 change-intent diffing. v3 contract schema with backwards-compatible v1→v2→v3 migration scripts and CI gates. 371 fixtures plus 12 replay-corpus entries. 30 local CI gates. Runtime p99 1.2ms against a 10ms ceiling. Stress harness (8 graceful-degradation scenarios, nightly) and full adversarial G+Q library nightly with weekly summary.

**In flight — what we are building now.** Nothing. v3.1.0 is in soak; no PRs are open and `state/active-acp-runs.json` is empty.

**Target state — where this is going.** Intent-aware routing across skills, agents, rules, and checks; outcome-driven policy suggestions derived from the local decision journal; behavioral verification with autonomy and false-block metrics; canary / progressive rollout; cross-session learning aggregated locally by the operator, never by us.

See `references/runtime-autonomy-roadmap.md` for the longer arc and per-sprint history.

---

## [Unreleased]

Empty. v3.1.0 in soak; next-wave items are listed under "Post-v3.1 candidates" below.

---

## v0.5 milestone — Closed (2026-05-15, cut at v3.1.0)

Stages A–D delivered (PRs #37–#54). Highlights:

- **Stage A — ADR-007 canonical Action IR + explicit decision lattice** (PRs #34, #35, #36): `runtime/decision-lattice.js` + `runtime/action-ir.js`; adapter parity fixtures; lattice-anchored floor source tags; replay corpus + IR perf gate; sentinel pin to stop master CI drift.
- **Stage B — F16 ambient-authority floor** (PRs #38, #39, #40, #41): path classifier; `scopes.ambient.allow` opt-in; receipt enrichment with `ambientClass`; adversarial corpus + replay fixtures; unicode + path-traversal bypasses closed.
- **Stage C — F17 cross-agent-lock + g4 adapter capability manifests** (PRs #43, #44): per-action mutual-exclusion lock floor; adapter capability manifests hardened.
- **Stage D wave 1 — ADR-011 state portability + ADR-004 degraded-mode + tamper-evident journal** (PRs #45, #46, #37): export/import bundle; degraded-mode enforcement wiring + receipts; hash-chained journal core + verify CLI.
- **Stage D wave 2 — F19 + F20** (PRs #47, #48): ADR-010 output-channel exfiltration guard (F19); ADR-012 change-intent diffing (F20 declared-envelope vs IR drift).
- **Stage D wave 3 — auto-snapshot + audit-grade receipts** (PRs #49, #50, #51): ADR-013 auto-snapshot before destructive ops; stress harness with 8 graceful-degradation scenarios + nightly cron; ADR-014 audit-grade receipts schema + exporter + offline redactor.
- **Stage D wave 4 — full adversarial library + notification routing** (PRs #52, #53): nightly G+Q exercise + weekly summary; ADR-015 notification routing (Discord / Slack / email, zero-dep transports).
- **Milestone close** (PR #54): CHANGELOG cut `[Unreleased]` → `[3.1.0]`; `VERSION` 3.0.0 → 3.1.0; `references/full-power-status.md` v0.5 section rewritten to list all eleven Stage D items.

See `CHANGELOG.md` `[3.1.0]` and `DECISIONS.md` D49+ for the full record.

---

## Earlier shipped lines (summary)

- **v3.0.0 — 2026-04-27.** Brand rename (`ECC_*` → `LILARA_*`, contract / config / state path renames, contractId prefix renamed — see CHANGELOG for full chain). Phase 1 closed W1–W14 structural weaknesses; Phase 3 added autonomous routing foundation (`intent-classifier.js`, `route-resolver.js`).
- **v2.1.x — 2026-04-25.** Cross-harness secret-scan parity; PostToolUse output sanitization (Claude); enforce-mode fixture corrections; protected-branch glob matching; legacy 4-part learned-allow key removed; correctness hardening (hermetic fixtures, bench platform detection, fail-closed under LILARA_ENFORCE=1); telemetry aggregation.
- **v2.0.x — 2026-04-25.** Upfront security contract model. All fourteen W-series structural weaknesses addressed. Single enforcement spine, session-id partitioning, strict/readonly modes.
- **v1.x and v0.x — 2026-04-19 → 2026-04-25.** Pre-contract era. See CHANGELOG.

---

## Post-v3.1 candidates

Real gaps, ordered by security and operability impact. None are on a fixed timeline.

### High priority

**F15 manifest publication across non-Claude adapters.**
`{codex, clawcode, openclaw, opencode, antegravity}/hooks/post-adapter.js:6` each carry a `TODO(F15/Task0.6)` to publish the harness manifest via `<harness>/manifest.json` so envelope reporting is auto-discoverable rather than relying on factory wiring. Mechanical, additive, but touches all five adapter dirs at once.

**OpenCode PostToolUse output-sanitizer parity.**
`claude/hooks/output-sanitizer.js` scans tool output for the 23-pattern secret set. OpenCode is a Claude Code fork and very likely supports the same `PostToolUse` event, but in-repo wiring (`opencode/WIRING_PLAN.md`) documents PreToolUse only. Extension deferred until a contributor confirms upstream PostToolUse support and documents the wiring path. ASI04 in `references/owasp-agentic-coverage.md` honestly records this as PARTIAL.

**ASI04 runtime redaction.**
`scripts/redact-payload.sh` is an offline audit tool, not wired into hook execution. The runtime control is `secret-warning.js`. Closing this gap would mean either renaming the offline tool to make its scope obvious, or porting its logic into the runtime path. Documented honestly in `references/owasp-agentic-coverage.md`.

### Medium priority

**Live end-to-end hook confirmation for Codex and antegravity.**
Both adapters are source-trace verified, but neither has confirmed a live hook fire with the corrected event names (`tool_call.output` / `BeforeTool` + `run_shell_command`). Live confirmation is documented as a re-check trigger in `codex/WIRING_PLAN.md` and `antegravity/WIRING_PLAN.md`. A contributor with a live `codex` or `agy` install can append a captured payload fixture and mark the item complete.

**OpenClaw PostToolUse parity.**
Same deferral as OpenCode but for the OpenClaw harness; PostToolUse event model is unverified upstream.

### Low priority

**D23 — trademark clearance for "Lilara".**
RESOLVED (2026-05-24). Khouly accepted the risk and proceeded with the Lilara name (PR #59). USPTO/EUIPO/WIPO searches deferred; no blocking conflict found in initial review. Domain selection (`lilara.dev` vs `.ai`) deferred to M9 commercial track.

---

## Closed — archived

- v0.5 milestone (this page, "Closed" section above).
- `IMPROVEMENT_PLAN.md` and `references/unified-master-plan.md` tracked historical parity work (Phases 0–3 from the pre-v2.0 era); deleted in v3.0.0, superseded by this roadmap.
- Pre-implementation planning artifacts (MASTER_PLAN.md, AMPLIFICATION_PLAN.md, ENHANCEMENT_PLAN.md, MASTER_PLAN_PROMPT.md, OVERNIGHT_PROGRESS.md, OVERNIGHT_REPORT_2/3/4.md, CLAUDE_CODE_HANDOFF.md) live under `references/archive/2026-05-09-bootstrap/` from this PR onwards. They are frozen historical context, superseded by DECISIONS.md / CHANGELOG.md / references/adr-*.
