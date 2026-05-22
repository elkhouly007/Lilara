# OVERNIGHT_REPORT_4.md — B2 Phase 2: v3 Schema + Migration

**Date:** 2026-05-08  
**Session scope:** B2 Phase 2 — add `scopes.mcp`, `scopes.skills`, `scopes.session`, `scopes.budget` to the v3 contract schema; ship a v2→v3 migration tool; close G7. Branch: `feat/b2-v3-schema-migration` from master `72f83af`. No hard stops encountered. OVERNIGHT_QUEUE_4.md not needed.

---

## Summary

4 commits, 13 new inline fixtures (246 total), 8 CI gates green per commit. G7 PARTIAL → **COVERED**. PR #20 open, do not merge until PR #19 (B2 Phase 1) is reviewed.

---

## Commit 1 — scopes.mcp + scopes.skills (F12, F13)

**Commit:** `dabc937`  
**Files:** `schemas/horus.contract.schema.json`, `runtime/contract.js`, `runtime/decision-engine.js`, `scripts/run-fixtures.sh`, `ARCHITECTURE.md`, `MODULES.md`, `CHANGELOG.md`, `AMPLIFICATION_PLAN.md`, `ENHANCEMENT_PLAN.md`, `scripts/hooks-baseline.sha256`

**What was done:**

- Extended `version` enum from `[1, 2]` to `[1, 2, 3]`.
- Added `mcp` and `skills` named properties to `scopes.properties`. Within each, `additionalProperties: <policy schema>` allows any-key maps while `additionalProperties: false` at the `scopes` level is preserved.
- Added `getMcpPolicy(contract, serverName)`, `getSkillPolicy(contract, skillName)`, `extractMcpServerName(toolName)` to `runtime/contract.js`.
- Wired F12 (mcp-deny) and F13 (skill-deny) hard floors in `decide()` after the `no-contract-strict` early block. `block` → `buildEarlyBlock`; `warn` → `mcpWarning`/`skillWarning` annotation on result + journal.
- F12 server name extracted from `mcp__<server>__<tool>` regex; falls back to `input.mcpServer`.
- F13 skill name from `input.skillName` only; absent means silently no-ops.

**Fixtures (6):** `mcp:server-block`, `mcp:server-warn`, `mcp:server-allow-default`, `skill:skill-block`, `skill:skill-warn`, `skill:skill-allow-default`.

**Bench p99:** 57.8ms (D31 baseline 61.2ms, cap 91.8ms).

---

## Commit 2 — scopes.session + scopes.budget (F14 / F14b)

**Commit:** `e590112`  
**Files:** `schemas/horus.contract.schema.json`, `runtime/contract.js`, `runtime/decision-engine.js`, `runtime/session-budget.js` (NEW), `scripts/run-fixtures.sh`, `ARCHITECTURE.md`, `MODULES.md`, `CHANGELOG.md`, `AMPLIFICATION_PLAN.md`, `ENHANCEMENT_PLAN.md`

**What was done:**

- Added `session` and `budget` named properties to `scopes.properties`.
- Created `runtime/session-budget.js`: per-session `destructiveOps` / `externalBytes` / `startTime` counters. Atomic `tmp+renameSync` writes with `{ mode: 0o600 }`. Storage at `~/.horus/session-budget/<session-id>.json`. API: `getCounters`, `recordDestructiveOp`, `recordExternalBytes`, `resetCounters`.
- Added `getSessionConstraints(contract)` and `getBudgetLimits(contract)` to `runtime/contract.js`.
- Wired F14 hard floor: if `destructiveOps >= maxDestructiveOps` or `externalBytes >= maxExternalBytes` at decide-time → `buildEarlyBlock("budget-exceeded", ...)`. Fires after F13.
- Wired F14b session-over-duration (D47): if session age > `maxDurationMin`, sets `sessionOverDuration = true`. The override `action = "require-review"` / `source = "session-over-duration"` is asserted **after all demotion blocks** (contract-allow, auto-allow-once, trajectory-nudge) so it cannot be silently undone. `sessionDurationWarning` annotation attached to result + journal.
- `recordDestructiveOp` wired at end of `decide()` after `allow` on `destructive-delete`-class commands.

**Key design decision (D47):** `scopes.session.maxDurationMin` forces `require-review`, not soft annotation. Operator declared "after N minutes, stop and ask me." Same escalation pattern as F10 taint-floor — annotation alone is too easy to read past.

**Fixtures (3):** `budget:destructive-block`, `budget:bytes-block`, `session:over-duration-require-review`.

**Bench p99:** 55.7ms.

---

## Commit 3 — v2→v3 Migration + CI Gate + v3 Example

**Commit:** `363fe84`  
**Files:** `scripts/migrateV2ToV3.js` (NEW), `scripts/check-migrate-v2-v3.sh` (NEW), `horus.contract.v3.json.example` (NEW), `.github/workflows/check.yml`, `scripts/run-fixtures.sh`, `MODULES.md`, `CHANGELOG.md`, `AMPLIFICATION_PLAN.md`, `ENHANCEMENT_PLAN.md`

**What was done:**

- Created `scripts/migrateV2ToV3.js`: zero-dep Node tool. Reads v1/v2 contract, validates, sets `version: 3`, recomputes `contractHash`, writes to `horus.contract.json.draft`.
  - **Never overwrites** the live `horus.contract.json`; refuses to overwrite an existing `.draft`.
  - **Idempotent** (D48): v3 input → `process.exit(0)` + stderr "already version 3, no migration needed"; no draft written. Alembic/knex convention — broken pipelines that pass a v3 contract won't fail.
  - **Lossless**: all v2 fields byte-equal in draft (canonical-JSON verified).
- Created `scripts/check-migrate-v2-v3.sh`: end-to-end CI gate. Synthesizes a minimal v2 fixture, runs migration, asserts losslessness + schema validity + hash correctness + idempotency.
- Registered gate in `.github/workflows/check.yml` as "Contract migration v2→v3 gate" after run-fixtures step.
- Created `horus.contract.v3.json.example` with all four v3 field families and correct `contractHash`.

**Fixtures (2):** `migrate:v2-to-v3-lossless`, `migrate:v3-idempotent-noop`.

**Bench p99:** 56.0ms.

---

## Commit 4 — Documentation + G7 → COVERED + Integration Test

**Commit:** `8704377`  
**Files:** `CONTRACT.md`, `AMPLIFICATION_PLAN.md`, `ENHANCEMENT_PLAN.md`, `references/owasp-agentic-coverage.md`, `scripts/run-fixtures.sh`, `CHANGELOG.md`

**What was done:**

- Added 5 subsections to `CONTRACT.md`: "v3 — scopes.mcp", "v3 — scopes.skills", "v3 — scopes.session", "v3 — scopes.budget", "v3 — Migrating from v2". Each documents behavior, JSON example, and edge cases.
- G7 transitioned PARTIAL → **COVERED** in `AMPLIFICATION_PLAN.md`, `ENHANCEMENT_PLAN.md`. PR #20 pinned.
- OWASP coverage matrix: ASI02 + ASI06 + ASI10 gain B2 Phase 2 addendum notes (no status changes — all were already COVERED before Phase 2). No ASI rows were gated on G7.
- Added consolidated B2 Phase 2 summary entry to `CHANGELOG.md`.

**Fixture (1):** `b2-phase-2:integration-all-four` — 11 sub-checks covering all 5 helpers and both `mcp`/`skills` policy lookups.

**Final bench p99:** 57.2ms (D31 baseline 61.2ms, cap 91.8ms, delta vs Run 4 baseline 54.6ms: +2.6ms).

---

## Open PRs At End Of Session

| PR | Branch | What |
|---|---|---|
| [#10](https://github.com/elkhouly007/agent-runtime-guard/pull/10) | feat/a5-rate-limit-toctou | Wave 1 A5 — standing: do NOT merge |
| [#11](https://github.com/elkhouly007/agent-runtime-guard/pull/11) | feat/a1-shell-ast | Wave 1 A1 — awaiting review |
| [#12](https://github.com/elkhouly007/agent-runtime-guard/pull/12) | feat/a2-taint-claude | Wave 1 A2 — awaiting review |
| [#13](https://github.com/elkhouly007/agent-runtime-guard/pull/13) | feat/a3-posttool-parity | Wave 1 A3 — awaiting review |
| [#14](https://github.com/elkhouly007/agent-runtime-guard/pull/14) | feat/b3-accept-gate-hardening | B3 accept gate — awaiting review |
| [#15](https://github.com/elkhouly007/agent-runtime-guard/pull/15) | docs/e2-wiring-parity | E2 wiring docs — awaiting review |
| [#16](https://github.com/elkhouly007/agent-runtime-guard/pull/16) | research/b1-payload-shapes | B1 PostToolUse research — awaiting review |
| [#17](https://github.com/elkhouly007/agent-runtime-guard/pull/17) | docs/wave1-followup-decisions | D33-D36 + D31 bench — awaiting review |
| [#19](https://github.com/elkhouly007/agent-runtime-guard/pull/19) | feat/b2-v2-wireup | B2 Phase 1 (v2 wire-up) — **review before #20** |
| [#20](https://github.com/elkhouly007/agent-runtime-guard/pull/20) | feat/b2-v3-schema-migration | B2 Phase 2 (v3 + migration) — do NOT merge until #19 reviewed |

---

## Decision Inventory

New decisions filed this session:

**D46 — MCP server name extraction regex (`mcp__<server>__<rest>`)**

Decision: Use `^mcp__([^_]+(?:_[^_]+)*?)__` to extract the server name from a Claude/MCP tool name. If `input.mcpServer` is explicitly provided, that takes precedence. Absent `mcp__` prefix → F12 silently no-ops (no contract lookup).

Why: The `mcp__<server>__<tool>` naming convention is stable across harnesses. The lazy quantifier `*?` prevents over-greedy matches when server names contain underscores. Explicit `input.mcpServer` is a clean override for harnesses that surface the server name separately from the tool name.

---

**D47 — `scopes.session.maxDurationMin` escalates to `require-review` (not soft annotation)**

Decision: When session age > `maxDurationMin`, set `action = "require-review"` + `source = "session-over-duration"`. The `sessionDurationWarning` annotation is also attached, but the action change is the load-bearing signal.

Why: The operator declared "after N minutes, stop and ask me." A soft annotation (`sessionDurationWarning` only, action unchanged) would be silently ignored if the agent keeps calling `decide()` and getting `allow` back. The F10 taint-floor precedent (which also sets `require-review`) is the right model: the floor changes the action, not just decorates the result. The override is asserted AFTER all demotion blocks (contract-allow, auto-allow-once, trajectory-nudge) so it cannot be undone.

---

**D48 — Migration writes to `.draft`, never live file; idempotent no-op-exit-0 on v3 input**

Decision: `migrateV2ToV3.js` writes only to `horus.contract.json.draft`. It refuses to overwrite an existing draft. On v3 input, it exits 0 with a "already version 3" stderr message and writes nothing.

Why: Never-overwrites-live ensures the operator reviews before `contract accept` finalizes. The idempotent-exit-0 convention follows alembic/knex: migration tools that error on already-migrated input break pipelines that pipe contracts through `migrate` unconditionally. Exiting 0 + stderr message is machine-parseable (check exit code) and human-readable (check message).

---

## What Is Needed From Morning Review

1. **Review PR #19 (B2 Phase 1 v2 wire-up)** before reviewing PR #20. Phase 2 branches from master before Phase 1, so when both merge there will be a conflict at the F11/F12 insertion point. The correct merge order is: Phase 1 first (adds F11 validity floor), then Phase 2 (adds F12–F14 floors after F11).
2. **Review PR #20 (this PR)** after #19 is understood. 8 gates green on each of 4 commits; bench p99=57.2ms (within D31 cap 91.8ms).
3. **PRs #11–#14** (Wave 1 + B3) remain open and need review. Suggested order: A1 (#11) → A2 (#12) → A3 (#13) → B3 (#14).
4. **Natural follow-ons after both Phase 1 and Phase 2 merge:**
   - **Track C** — taint-correlator depth + provenance heuristics polish (D33/D34 follow-ups)
   - **Track D** — observability + decision-journal ergonomics (operator UX on review of warnings)
   - Treat each as a separate overnight task.
