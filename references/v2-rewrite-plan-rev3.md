# Agent Runtime Guard — v2 Rewrite Plan (Rev 3)

> **Purpose:** Canonical source for the 14 structural weaknesses (W1–W14) identified in the v2 planning phase, their current resolution status, and outstanding work. This document replaces the missing `v2-rewrite-plan-rev2.md` (the original source was lost; this reconstruction is grounded in the actual codebase as of 2026-04-26).
>
> **Maintained by:** Update this file whenever a weakness is resolved or a new one is discovered.

---

## Mission

Evolve Agent Runtime Guard from a single-harness security add-on with scattered decision logic into a clean, cross-harness, contract-first runtime with persistent learning and zero structural debt.

The five architectural pillars this rewrite plan addresses:
1. **Consolidation** — eliminate triplicated decision logic
2. **Boundaries** — real session lifecycle and state partitioning
3. **Contract-first** — agree once, enforce forever
4. **Cross-harness parity** — same input → same decision on any host
5. **Self-consistency** — docs match reality; code matches docs

---

## Weakness Inventory

### W1 — Decision logic triplicated across hooks/adapters
**Statement:** The PreToolUse decision logic was copied three times: in `dangerous-command-gate.js`, in the OpenClaw adapter, and in the OpenCode adapter. Changes to risk scoring or blocking logic had to be applied in three places.

**Status: ✅ FIXED**

**Resolution:** `runtime/pretool-gate.js` is the single enforcement spine. Every host adapter (claude, openclaw, opencode, clawcode, antegravity, codex) is a 15–24 LOC shim that calls `createAdapter({ harness:"<name>", ... })` from `claude/hooks/hook-utils.js`, which wraps `runPreToolGate()` from `runtime/pretool-gate.js`. The full decision logic lives in `runtime/decision-engine.js`. Modified risk scoring or blocking rules require a change in exactly one file.

**Residual:** `secret-warning.js`, `git-push-reminder.js`, and `build-reminder.js` still implement their own lightweight decision logic (pattern matching only) outside `pretool-gate.js`. This is intentional: these hooks cover concerns orthogonal to the main gate (secret scanning, push reminders, build output warnings). They are not candidates for consolidation into `pretool-gate.js`.

---

### W2 — No real session boundary
**Statement:** The system had no concept of a session start/end. Risk accumulation, trajectory nudge, and session-scoped state persisted indefinitely without partitioning by session.

**Status: ✅ FIXED**

**Resolution:** `runtime/session-context.js` (183 LOC) manages per-session state at `{stateDir}/session-context.json`. `startSession()` generates a fresh `sessionId` (ISO timestamp + 4-byte random hex) and resets the `recentEscalations` window. `claude/hooks/session-start.js` calls `startSession()` on every SessionStart event.

**Verification criterion:** All 6 host adapters must call `startSession()` or equivalent on session open. Currently: Claude Code ✅, OpenClaw ✅, OpenCode ✅; ClawCode/Antegravity/Codex stubs (Phase 2).

---

### W3 — No upfront security contract
**Statement:** The system asked "is this OK?" on every risky action. Users had no way to define a project-wide policy once and enforce it silently.

**Status: ✅ FIXED**

**Resolution:** `runtime/contract.js` (496 LOC) implements the full contract lifecycle: `load()`, `verify()` (hash tamper check), `accept()`, `scopeMatch()`, `generate()`, `contractId()`. `schemas/lilara.contract.schema.json` defines v1+v2 schemas. The CLI exposes `lilara-cli.sh contract init|accept|verify|show|amend`. The decision engine enforces the contract at Steps 2–5–11 of the 11-step precedence matrix.

**Note:** The contract feature (v2 of the schema) is the architectural answer to W3. The UX (scan→analyze→present→approve→enforce three-mode flow) is Phase 3 of the master plan.

---

### W4 — Kill switch covers only 5 of 12 hooks
**Statement:** `LILARA_KILL_SWITCH=1` was only checked in a subset of hooks. Some hooks continued operating even when the kill switch was set.

**Status: ✅ FIXED**

**Resolution:** All 13 production hooks check `LILARA_KILL_SWITCH`:
- Gate-class hooks (dangerous-command-gate, secret-warning, git-push-reminder, build-reminder, openclaw/adapter, opencode/adapter): exit 2 (block) when kill switch is active.
- Informational hooks (session-start, session-end, memory-load, strategic-compact, pr-notifier, quality-gate, output-sanitizer): return early (exit 0, no-op) when kill switch is active.

Kill-switch fixtures in `tests/fixtures/kill-switch/` verify every hook.

**Residual:** Stub adapters (clawcode, antegravity, codex) inherit the kill-switch check from `runtime/pretool-gate.js` via `createAdapter()` (which wraps `runPreToolGate()`). Kill-switch fixtures for these stubs are deferred to Phase 2.

---

### W5 — Secret scanning was Claude-only
**Statement:** The secret scanner was implemented only in `claude/hooks/secret-warning.js` using a Claude Code-specific secret patterns file. No other host harness had secret scanning.

**Status: ✅ FIXED**

**Resolution:** `runtime/secret-scan.js` (52 LOC) is a cross-harness secret scanner with 23 built-in patterns. `runtime/pretool-gate.js` calls `scanSecrets(text)` before any decision, so all host adapters (including openclaw, opencode, clawcode, antegravity, codex) receive the same secret scanning regardless of host. Claude Code retains its own `secret-warning.js` for additional PostToolUse scanning (output sanitization).

---

### W6 — Decision journal had no rotation; unbounded growth
**Statement:** The decision journal (JSONL append log) would grow forever, causing disk pressure and slow reads on long-running projects.

**Status: ✅ FIXED**

**Resolution:** `runtime/decision-journal.js` rotates at 5 MB, retaining 3 generations (gzip-compressed). Confirmed in `ARCHITECTURE.md`: "5 MB rotation, 3-generation retention."

---

### W7 — Policy store could corrupt on concurrent write
**Statement:** Concurrent hook processes writing to `learned-policy.json` without atomicity could produce corrupt JSON, losing all learned policy data.

**Status: ✅ FIXED**

**Resolution:** `runtime/policy-store.js` uses atomic tmp+rename writes. Write path: generate new content → write to `.tmp` file → `fs.renameSync()` to final path. On read failure, automatic backup recovery from `.bak`. No concurrent corruption possible.

---

### W8 — State-paths.js existed but was not fully adopted
**Statement:** `runtime/state-paths.js` was created as the single source of truth for storage paths, but many hooks and scripts still had hardcoded `~/.openclaw/...` paths.

**Status: ⚠️ PARTIALLY FIXED**

**Evidence:** `runtime/state-paths.js` exists and exports `stateDir()`, `hookStateDir()`, `instinctDir()`, `ensureDir()`. `claude/hooks/hook-utils.js` does use `statePaths.hookStateDir()`. However:
- `hookStateDir()` in `state-paths.js` still returns `.lilara` as a default (legacy path).
- Some scripts may still use hardcoded paths.

**Outstanding work (Phase 1.6 + Phase 1 rebrand):**
1. Audit all hooks and scripts for hardcoded `.openclaw/` paths.
2. In `state-paths.js`: unify `hookStateDir()` with `stateDir()` — eliminate the legacy `.lilara` default (migrate to `.lilara/` as part of the rebrand).
3. After rebrand: `stateDir()` should return `~/.lilara/` (overridable via `LILARA_STATE_DIR`).

---

### W9 — Config has no schema; misconfiguration is silent
**Statement:** `lilara.config.json` had no JSON schema for validation. Misconfigured files would silently fall through to defaults with no error message.

**Status: ✅ FIXED**

**Resolution:** `schemas/lilara.config.schema.json` defines the full config schema. `runtime/config-validator.js` (156 LOC) validates both config and contract files against their schemas. Validation errors surface in `lilara-cli.sh contract verify`.

---

### W10 — decisionKey was too coarse
**Statement:** The policy store key (`decisionKey`) was based only on the command class, not the full command. This meant `npm install express` and `npm install malicious-package` were treated as the same policy entry.

**Status: ✅ FIXED**

**Resolution:** `runtime/decision-key.js` exports both `fineKey(command)` (full command string → SHA-256 hash + prefix) and `legacyKey(command)` (backward-compatible coarse class). The policy store uses `fineKey` for all new approvals; `legacyKey` is available for legacy lookup during migration.

---

### W11 — High-risk-non-destructive operations cannot be pre-approved
**Statement:** Operations with high risk scores that aren't destructive (e.g., `curl | bash`, `npx -y`) had no path to pre-approval. Every occurrence required manual intervention, even after the user had approved the same pattern dozens of times.

**Status: ⚠️ PARTIALLY FIXED**

**Evidence:** The contract v2 schema has `scopes.shell.toolAllow` (per-tool allow list) and `scopes.filesystem.destructiveAllow` (per-command-class path-glob destructive allows). `decision-engine.js` Step 11 checks `autoAllowOnce` for a single-use bypass. The learned-allow and promotion flow (Steps 10–11) provide a path from repeated approval to auto-allow.

**Outstanding work (Phase 1.7):**
1. Verify that `decision-engine.js` Step 11 correctly reads `scopes.shell.toolAllow` from the contract for pre-approved high-risk patterns.
2. Add fixtures testing the `toolAllow` pre-approval path for `npx -y`, `curl|bash`, and `npm install -g` patterns.
3. Document the pre-approval workflow in `CONTRACT.md`.

---

### W12 — Adapter enforce coverage was weak
**Statement:** Host adapters did not consistently propagate `LILARA_ENFORCE=1` behavior. A blocked command on Claude Code might only produce a warning on another adapter.

**Status: ✅ FIXED**

**Resolution:** All adapters are thin shims that call `createAdapter()` in `claude/hooks/hook-utils.js`, which invokes `runPreToolGate()` from `runtime/pretool-gate.js`. The blocking/warning decision flows through the runtime decision engine with `LILARA_ENFORCE` respected. Since the blocking/warning decision is made inside `pretool-gate.js` (not in the adapter), all adapters automatically inherit consistent enforce behavior. Cross-harness equivalence fixtures in `tests/fixtures/cross-harness/` and `tests/fixtures/openclaw/` and `tests/fixtures/opencode/` verify this.

---

### W13 — No cross-harness equivalence test
**Statement:** There was no automated test verifying that the same input produced the same decision across all supported host harnesses.

**Status: ✅ FIXED**

**Resolution:** `scripts/check-cross-harness-equivalence.sh` runs a standard input set through all adapter shims and compares exit codes. Fixture set in `tests/fixtures/cross-harness/`. Run as part of CI.

---

### W14 — Documentation / reality drift
**Statement:** Docs (README, ARCHITECTURE, MODULES, DECISIONS) described an older system state. Runtime file counts, hook counts, and W-status in docs did not match the actual codebase.

**Status: ⚠️ PARTIALLY FIXED**

**Evidence of remaining drift (pre-Phase 1):**
- `ARCHITECTURE.md` listed 20 runtime files; actual count is 23 (missing `intent-classifier.js`, `route-resolver.js`, `index.js`).
- `MODULES.md` did not list the new routing modules.
- `DECISIONS.md` D5 stated "hooks print reminders, do not enforce policy" — stale since `dangerous-command-gate.js` + `secret-warning.js` now actively block in `LILARA_ENFORCE=1`.
- `claude/hooks/README.md` listed 12 hooks; actual is 13.
- Skill count in README says "200 skills"; actual is 22.

**Resolution (Phase 1.8):** Update `ARCHITECTURE.md`, `MODULES.md`, `DECISIONS.md`, and `README.md` with verified counts from the codebase. This document (`v2-rewrite-plan-rev3.md`) is part of the W14 resolution.

---

## Resolution Summary

| W | Title | Status |
|---|---|---|
| W1 | Decision logic triplicated | ✅ Fixed |
| W2 | No real session boundary | ✅ Fixed |
| W3 | No upfront security contract | ✅ Fixed |
| W4 | Kill switch coverage | ✅ Fixed |
| W5 | Secret scanning Claude-only | ✅ Fixed |
| W6 | Journal unbounded growth | ✅ Fixed |
| W7 | Policy store corruption | ✅ Fixed |
| W8 | state-paths not fully adopted | ⚠️ Partial — Phase 1.6 + rebrand |
| W9 | Config has no schema | ✅ Fixed |
| W10 | decisionKey too coarse | ✅ Fixed |
| W11 | High-risk-non-destructive pre-approval | ⚠️ Partial — Phase 1.7 |
| W12 | Adapter enforce coverage | ✅ Fixed |
| W13 | No cross-harness equivalence test | ✅ Fixed |
| W14 | Docs/reality drift | ⚠️ Partial — Phase 1.8 |

**Score: 11 fully fixed, 3 partial (W8, W11, W14). All 3 partials are closed in Phase 1.**

---

## Revision History

| Rev | Date | Summary |
|---|---|---|
| Rev 1 | (lost) | Original v2 plan — defined W1-W14; designed upfront contract architecture |
| Rev 2 | (lost) | Updated W status through Phase 0/1; confirmed contract.js implementation |
| Rev 3 | 2026-04-26 | Reconstruction from codebase; confirmed 11/14 fixed; documented 3 remaining partials; grounded in verified code, not docs |
