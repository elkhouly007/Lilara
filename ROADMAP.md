# Roadmap — Agent Runtime Guard

This document tracks forward-looking work only. For the implemented architecture, see [ARCHITECTURE.md](ARCHITECTURE.md). For the contract specification, see [CONTRACT.md](CONTRACT.md). For shipped changes, see [CHANGELOG.md](CHANGELOG.md).

---

## Executive Summary

ARG aims to become an adaptive, safety-bounded operating layer for AI agents. The destination is an intelligent runtime substrate that decides which capability should run for an intent, on which harness, within which scope; learns reviewed local defaults from operator-approved patterns; and enforces hard safety floors that no contract or learning step can demote.

ECC — the upfront-contract model — is the foundation we build on, not the finished product.

### Three horizons

**Today — what runs.** A single enforcement spine across Claude Code, OpenCode, and OpenClaw; contract verification including acceptance, hash-checking, and schema validation; learned-allow with project-scoped fineKey; session trajectory nudges; workflow-shaped actions; a JSONL audit trail; an `HORUS_KILL_SWITCH=1` emergency block; an amplification surface of agents, rules, and skills, plus a unified CLI. Cross-harness secret-scan parity (all harnesses call `scanSecrets()` and upgrade payloadClass to C on a hit); post-tool output sanitization (`output-sanitizer.js` PostToolUse hook); protected-branch glob matching (`release/*` patterns now match in `risk-score.js`); telemetry aggregation (`horus-cli telemetry report`). 183 fixture pairs, 13 hooks. A post-ship audit (v2.1.1) closed gaps in the contract acceptance path and verification scripts.

**In flight — what we are building now.** All three "in flight" items (contract schema v2 evolution, legacy 4-part key removal, scope-defined contract CI gate) are now closed — see `[Unreleased]` in CHANGELOG.md.

**Target state — where this is going.** Intent-aware routing across skills, agents, rules, and checks; outcome-driven policy suggestions derived from the local decision journal; behavioral verification with autonomy and false-block metrics; canary / progressive rollout; cross-session learning aggregated locally by the operator, never by us.

See `references/runtime-autonomy-roadmap.md` for the longer arc and per-sprint history.

---

## [Unreleased]

Cross-harness and post-tool hardening batch: secret-scan parity across all harnesses; PostToolUse output sanitization; protected-branch glob matching; enforce-mode fixture classification correction; 183 fixture pairs, 13 hooks. See [CHANGELOG.md](CHANGELOG.md) for the full diff.

Correctness hardening batch (H1–H3 + doc sync):

- **H1 — Hermetic fixture state**: `scripts/run-fixtures.sh` now exports `HORUS_STATE_DIR=$(mktemp -d)` at suite level and uses a per-fixture `HORUS_STATE_DIR` for each hook invocation, preventing trajectory state from accumulating across fixtures. Also adds `require-tests` to the `enforcementAction` block set in `runtime/decision-engine.js` so high-risk destructive-delete commands block (not just warn) under HORUS_ENFORCE=1. Fixture count: 158 pass, 0 fail.
- **H2 — Bench platform detection + baseline reset**: `scripts/bench-runtime-decision.sh` now detects Windows via `OS=Windows_NT`, MinGW/MSYS/Cygwin, and WSL-on-`/mnt/`; passes a `slow_fs` flag to Node; keys the baseline by `platformKey` (`win32-slowfs` on Windows, `linux` on real Linux CI) instead of raw `process.platform`. Added a 3× sanity guard to prevent overwriting the baseline when the filesystem context is wrong. `artifacts/bench/baseline.json` reset: the prior `"linux"` entry contained Windows-magnitude p99=178.876ms (~30–50× real Linux latency), written during a WSL-on-`/mnt/c` session where `process.platform === "linux"` but FS IO was Windows-class.
- **H3 — Fail-closed under HORUS_ENFORCE=1 when decide() throws**: `runtime/pretool-gate.js` catch block now blocks (exit 2) under enforce when any non-trivial signal is present: a dangerous-pattern hit at any severity, a secret-bearing payload, or a high-sensitivity path. Previously only critical/high pattern hits triggered fail-closed; medium patterns, secret-only payloads, and sensitive-path signals were silently allowed.
- **H4 — OpenCode PostToolUse parity**: deferred. In-repo wiring (`opencode/WIRING_PLAN.md`) documents PreToolUse only; no confirmed upstream PostToolUse support. See `Post-v2.1 Candidates` below.
- **H5 — Doc sync**: `SECURITY_MODEL.md` documents the decide()-throw fail-closed semantics. `references/owasp-agentic-coverage.md` updated: ASI05 now reflects the Claude Code `output-sanitizer.js` implementation and honest deferral status for OpenCode and OpenClaw.

---

## v2.1.1 — Shipped (2026-04-25)

Post-implementation reality audit: contract accept/verify broken by integer-type validator bug (fixed); two check scripts were structurally vacuous (fixed); docs drifted from behavior (fixed). See [CHANGELOG.md](CHANGELOG.md) for the full diff.

---

## v2.1.0 — Shipped (2026-04-25)

Phase D hardening: macOS CI required, bench baseline persisted via `actions/cache`, three new best-effort adapters (codex, clawcode, antegravity), telemetry aggregation (`horus-cli telemetry report`).

---

## v2.0.1 — Shipped (2026-04-25)

Security hotfix. Seven enforcement gaps found by post-ship audit. See [CHANGELOG.md](CHANGELOG.md) for the full diff.

Key fixes:
- `decide()` now runs on **every** tool call — previously bypassed for commands with no dangerous-pattern match (C1)
- `blockResult` undefined reference in strict-mode hash-mismatch path fixed — was silently allowing tampered contracts (C2)
- Kill-switch is now `exit 2` (block) across all 10 PreToolUse hooks — was `exit 0` (silent allow) (C3, C4)
- `scopeMatch()` uses multi-target `arg-extractor` with symlink/escape protection — was single `targetPath` string (C5, C6)
- `fineKey` (5-part, project-scoped) now used for learned-allow — closes cross-project allow loophole (C7)
- `session-risk >= 3` is now a true escalate floor before `contract-allow` can demote (C8)
- Learned-allow narrowed to `destructive-delete` at high risk only; medium-risk actions no longer demotable (C9)
- `require-review` (protected-branch floor) protected from `contract-allow` demotion (C10)
- `floorFired` field written to all journal entries (C11)
- `contract amend` is a real implementation — no longer a print stub (C12)
- `GATED_CLASSES` unified: single export from `contract.js`, imported by `decision-engine.js` (C13)
- `auto-download` reads `remoteExecAllow` — was always denying regardless of contract (C14)
- `hard-reset`, `destructive-db`, `disk-write` now handled in `scopeMatch()` via `destructiveAllow` by class (C15)
- 59 scripts, 12 hooks, 49 agents, 22 skills, 174 fixture pairs

---

## v2.0.0 — Shipped (2026-04-25)

The upfront security contract model. All fourteen structural weaknesses (W1–W14) from the v2.0 plan audit are addressed.

Key deliverables:
- Upfront `horus.contract.json` pre-agrees all permissions before agent work starts
- Single enforcement spine (`runtime/pretool-gate.js`) for all harnesses
- Session-id partitioning for correct `session-risk` floors
- `HORUS_CONTRACT_REQUIRED=1` strict mode gates by capability class
- `HORUS_READONLY_CONTRACT=1` read-only mode for CI/review runs
- macOS added to CI matrix
- 57 scripts, 12 hooks, 49 agents, 22 skills, 130 fixture pairs

---

## Post-v2.1 Candidates

These are real gaps, ordered by security impact. None are on a fixed timeline.

### High Priority

~~**Cross-harness secret scanning parity**~~ — CLOSED. `pretool-gate.js` now calls `scanSecrets()` for all harnesses and upgrades `payloadClass` to C on a hit. The enrichment path (user-facing hints) is now also in the shared spine.

~~**Post-tool output sanitization**~~ — CLOSED. `claude/hooks/output-sanitizer.js` PostToolUse hook scans tool output for the same 23-pattern set and warns when a credential is echoed.

~~**Enforce fixture coverage gap**~~ — CLOSED for classification parity. Fixtures now correctly distinguish: commands that score critical/escalate block (exit 2), commands that score medium warn (exit 0) even in enforce mode. Wrong expected_exit values in opencode/openclaw hard-reset and npx-y fixtures were corrected; claude gains matching enforce fixtures.

### Medium Priority

~~**Scope-defined contract CI gate**~~ — CLOSED. `scripts/check-decision-replay.sh` ships a sample journal (`artifacts/journal/sample-journal.jsonl`, 12 representative entries covering allow/route/modify/require-tests/escalate/block) and replays it through the current decision engine in CI. The step runs in `.github/workflows/check.yml` with `HORUS_CONTRACT_ENABLED=0 HORUS_TRAJECTORY_WINDOW_MIN=0` for deterministic replay. Exit 1 on any action divergence. Regenerate the sample journal when the risk model or decision routing changes.

~~**Contract schema v2 evolution**~~ — CLOSED. `schemas/horus.contract.schema.json` now accepts `version: 2` and adds three optional top-level sections: `validity` (UTC time-windows, day-of-week), `contextTrust` (per-branch trust posture overrides), and `scopes.tools` (per-tool commandGlobs/pathGlobs allowlists). `scripts/migrateV1ToV2.js` upgrades a v1 contract in-place: bumps version and revision, recomputes `contractHash`, validates the result. `scripts/check-migrate-v1-v2.sh` verifies round-trip correctness in CI.

~~**Protected-branch glob matching**~~ — CLOSED. `risk-score.js` now uses `globMatch()` from `runtime/glob-match.js`; `release/*` patterns correctly match `release/1.2` and similar branch names.

~~**Legacy 4-part learned-allow key removal**~~ — CLOSED. `policy-store.js` now reads only the 5-part `fineKey` in `isLearnedAllowed()`, `getApprovalCount()`, `recordApproval()`, `getSuggestionForInput()`, and `getPolicyFacts()`. The legacy 4-part read fallback (shipped for one-release compat in v2.0.1) is removed.

### Low Priority

**Codex / ClawCode / Antegravity adapter verification**
Best-effort adapters shipped in v2.1.0 (`codex/hooks/adapter.js`, etc.) using a broad input-shape fallback chain. Not yet verified against real hook payloads. Once a contributor confirms the actual hook format for any of these harnesses, the adapter can be tightened and the harness status promoted from "NOT YET SUPPORTED" to "Supported".

**OpenCode PostToolUse output-sanitizer parity**
`claude/hooks/output-sanitizer.js` scans tool output for the 23-pattern set and warns when a credential is echoed. OpenCode is a Claude Code fork and likely supports the same PostToolUse hook event model, but in-repo wiring (`opencode/WIRING_PLAN.md`) documents PreToolUse only. Extension deferred until a contributor confirms upstream OpenCode PostToolUse support and documents the wiring path.

~~**Telemetry aggregation**~~ — CLOSED. `horus-cli.sh telemetry report` prints event summary by type with count and lastSeen. `telemetry clear` removes the local log.

~~**Phase 3 entry condition (D24)**~~ — CLEARED 2026-05-07. `MASTER_PLAN.md` §7 (Component Inventory) and §8 (Host Compatibility Matrix) are authored and substantive; Phase 3 (Three-Mode UX) planning is unblocked. See `DECISIONS.md` D24.

---

## Closed — Archived

`IMPROVEMENT_PLAN.md` and `references/unified-master-plan.md` tracked historical parity work (Phases 0–3 from the pre-v2.0 era). Those files are deleted; this roadmap supersedes them.
