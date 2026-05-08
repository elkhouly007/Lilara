# OVERNIGHT_REPORT_3.md — B2 Phase 1 (v2 contract wire-up)

**Date:** 2026-05-08  
**Session scope:** B2 Phase 1 — wire 4 v2 schema fields end-to-end into `decide()`. Single PR, 4 commits.

---

## Summary

All 4 commits landed on `feat/b2-v2-wireup`. [PR #19](https://github.com/elkhouly007/agent-runtime-guard/pull/19) opened, awaiting review. No hard stops encountered. OVERNIGHT_QUEUE_3.md not needed.

---

## Commit 1 — F11 validity floor

**Branch:** `feat/b2-v2-wireup`  
**PR:** [#19](https://github.com/elkhouly007/agent-runtime-guard/pull/19)  
**Status:** Committed. PR open, awaiting review.

**What was done:**

Wired `validity.activeHoursUtc` + `validity.activeDays` into `decide()` as a new F11 floor (rung 10.5 — after scopeMatch capture, before risk classification).

**New exports from `runtime/contract.js`:**
- `getValidity(contract)` — returns `contract.validity` or null
- `isInActiveWindow(contract, now)` — checks UTC hour range + active days; handles midnight-crossing windows (start > end)

**F11 floor behavior:**
- Outside-window + `scopes.payloadClasses[class]` === `"warn"` or `"block"` → `buildEarlyBlock("validity-window", ...)` with `source="validity-outside-window"`, `floorFired="validity-window"`
- Outside-window + class === `"allow"` (default) → `validityWarning: { code: "outside-window", reason }` annotation on decision return + journal; action unchanged
- No `validity` field → no-op (preserves all existing behavior)

**Fixtures:** 3 inline tests in `run-fixtures.sh` (237 total passing):
- `validity:in-window-allow` — 14:00 UTC inside 09:00–18:00 → inWindow=true
- `validity:out-window-block` — 22:00 UTC outside 09:00–18:00 → inWindow=false
- `validity:wrong-day-of-week` — Sunday with weekday-only activeDays → inWindow=false

**CI:** All 7 gates green. Bench p99=56.2ms (Run 3 baseline 63.0ms, cap 94.5ms).

**Docs:** ARCHITECTURE.md F11 row added to precedence ladder; MODULES.md updated; CHANGELOG Added entry; G7 annotated `[validity wired]`.

---

## Commit 2 — contextTrust per-branch posture override

**Branch:** `feat/b2-v2-wireup`  
**Status:** Committed.

**What was done:**

Wired `contextTrust` array into `decide()` — overrides `enriched.trustPosture` before `score()` runs.

**New export from `runtime/contract.js`:**
- `getContextTrust(contract, branch)` — iterates `contextTrust[]`, returns first matching entry's `trustPosture` (first-match-wins per schema)

**Order semantics** (quoted verbatim from `schemas/horus.contract.schema.json:47`): *"v2: Per-branch trust posture overrides. Entries are evaluated in order; first match wins. Falls back to top-level trustPosture if no entry matches."* Authors must order entries by specificity.

**Effect:** Affects risk-score posture adjustment only (`risk-score.js:171-177`). Does not affect scopes or floors.

**Fixtures:** 3 inline tests (240 total passing):
- `context-trust:main-strict` — exact branch match
- `context-trust:feature-relaxed` — glob `feature/*`
- `context-trust:specificity` — first-match-wins with two overlapping patterns

**CI:** All 7 gates green. Bench p99=55.2ms. Delta vs commit 1: -1.0ms.

**Docs:** ARCHITECTURE.md demotion rules note added; MODULES.md updated; CHANGELOG Added entry; G7 annotated `[contextTrust wired]`.

---

## Commit 3 — scopes.tools.perToolAllow per-tool allowlist

**Branch:** `feat/b2-v2-wireup`  
**Status:** Committed.

**What was done:**

Extended `scopeMatch` in `runtime/contract.js` to check `scopes.tools.perToolAllow[]` before class-specific gates. Threaded new source value `contract-allow-tool-scope` through `decide()`.

**scopeMatch extension:**
- Iterates `perToolAllow[]` for entries where `entry.tool === input.tool`
- `commandGlobs` optional (omitted = unconstrained); `pathGlobs` optional (omitted = unconstrained)
- On match: `return { allowed: true, reason: "tool-allow-tool-scope", gated: true }`
- Additive semantics — cannot restrict general scope

**decide() threading:**
- `canDemoteEscalate` extended to include `contractReason === "tool-allow-tool-scope"` (W11 carve-out)
- `source` set to `"contract-allow-tool-scope"` when `contractReason === "tool-allow-tool-scope"`
- `auto-allow-once` and trajectory-nudge exclusions updated to `!source.startsWith("contract-allow")`
- Explanation appenders use `source.startsWith("contract-allow")` for contract/scope lines

**Fixtures:** 3 inline tests (243 total passing):
- `tool-scope:bash-allow` — `npm install lodash` matches `npm *` → tool-allow-tool-scope
- `tool-scope:bash-deny` — `rm -rf /` doesn't match `npm *` → falls through to destructive-delete-not-in-scope
- `tool-scope:per-tool-overrides-general` — Edit on `docs/README.md` matching `docs/**` → tool-allow-tool-scope

**CI:** All 7 gates green. Bench p99=56.0ms. Delta vs commit 2: +0.8ms.

**Docs:** ARCHITECTURE.md Step 11 source-distinction note; MODULES.md updated; CHANGELOG Added entry; G7 annotated `[perToolAllow wired]`.

---

## Commit 4 — Docs + example contract + G7 consolidation

**Branch:** `feat/b2-v2-wireup`  
**Status:** Committed.

**What was done:**

Documentation and operator-facing examples. No new code paths.

**CONTRACT.md** — three new v2 sections:
- **v2 Validity Windows** — F11 floor + validityWarning semantics; midnight-crossing note
- **v2 ContextTrust Per-Branch Override** — order semantics quoted verbatim from schema; specificity ordering note
- **v2 scopes.tools.perToolAllow** — additive allowlist semantics; combine-with-restrictive-general note

**NEW FILE: `horus.contract.v2.json.example`** (version: 2, all four v2 field families populated). Chose separate-file path up-front rather than injecting a sentinel key into the existing v1 example — `schemas/horus.contract.schema.json` enforces `additionalProperties: false` at the top level (line 173) and 14+ nested objects, so `_v2_examples`-style injection would be rejected by `validateContract()`. v1 example unchanged. v2 example validates cleanly: `{ valid: true, errors: [] }`.

**G7 lines** — `AMPLIFICATION_PLAN.md:57` and `ENHANCEMENT_PLAN.md:53` transition from NOT YET to PARTIAL with the four wired fields enumerated (PR #19).

**Integration fixture:** `b2-phase-1:integration-all-three` — exercises all three wires (validity, contextTrust, perToolAllow) together via direct helper calls.

**CI:** All 7 gates green. Bench p99=60.6ms. Cumulative delta vs Run 3 baseline (63.0ms): -2.4ms.

---

## Open PRs At End Of Session

| PR | Branch | What |
|---|---|---|
| [#10](https://github.com/elkhouly007/agent-runtime-guard/pull/10) | feat/a5-rate-limit-toctou | Wave 1 A5 — do NOT merge (standing instruction) |
| [#11](https://github.com/elkhouly007/agent-runtime-guard/pull/11) | feat/a1-shell-ast | Wave 1 A1 — awaiting review |
| [#12](https://github.com/elkhouly007/agent-runtime-guard/pull/12) | feat/a2-taint-claude | Wave 1 A2 — awaiting review |
| [#13](https://github.com/elkhouly007/agent-runtime-guard/pull/13) | feat/a3-posttool-parity | Wave 1 A3 — awaiting review |
| [#14](https://github.com/elkhouly007/agent-runtime-guard/pull/14) | feat/b3-accept-gate-hardening | Wave 2 B3 — awaiting review |
| [#15](https://github.com/elkhouly007/agent-runtime-guard/pull/15) | docs/e2-wiring-parity | Wave 2 E2 — awaiting review |
| [#16](https://github.com/elkhouly007/agent-runtime-guard/pull/16) | research/b1-payload-shapes | Wave 2 B1 — awaiting review |
| [#17](https://github.com/elkhouly007/agent-runtime-guard/pull/17) | docs/wave1-followup-decisions | Wave 2 D33-D36 + D31 bench — awaiting review |
| [#18](https://github.com/elkhouly007/agent-runtime-guard/pull/18) | (if any) | — |
| [#19](https://github.com/elkhouly007/agent-runtime-guard/pull/19) | feat/b2-v2-wireup | Wave 2 B2 Phase 1 — awaiting review |

---

## Decision Inventory

No new design decisions filed this session. This is a wiring PR; the four field-shape decisions (adapt to existing schema names, no feature flags in committed code, annotate non-gated outside-window, keep rung-numbered ladder) were locked during the planning phase and are not tracked in DECISIONS.md (they reflect the schema as-is, not new design choices).

**D38 candidate** (for morning review): Whether to file a decision documenting the additive-allowlist semantics of `perToolAllow` (i.e., it cannot restrict general scope). This may be worth recording in DECISIONS.md for future contributors.

---

## What Is Needed From Morning Review

1. **Review PR #19** (`feat/b2-v2-wireup`) — B2 Phase 1 v2 contract wire-up. 4 commits, 10 new fixtures, all 7 CI gates green per commit. No merge yet — awaiting review.
2. **Confirm Phase 2 scope** — B2 Phase 2 (v3 schema additions: `scopes.mcp`, `scopes.skills`, `scopes.session.maxDurationMin`, `scopes.budget` + v2→v3 migration script) is the natural follow-on. Confirm it should be the next overnight.
3. Wave 1 PRs (#11–#13) remain open — A1→A2→A3 merge order still applies.
