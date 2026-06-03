# ADR-032 — State-Dir Validation: Full Consumer Sweep (Beyond ADR-028)

**Status:** Partially Implemented — 2026-06-03 (feat/adr-032-envelope-validation for envelope.js — the HIGH finding; feat/adr-032-state-dir-full-sweep for all remaining consumers). Originally proposed 2026-06-02 as audit-by-side-effect finding during ADR-028 implementation. Full sweep (18 consumers total, 10 newly found by the comprehensive trust-boundary audit) covered in two PRs per the bundle shape.  
**Severity:** MED-HIGH (envelope.js loadBaseline() was HIGH — fail-UNSAFE; rest are MED/LOW)  
**Area:** `runtime/envelope.js` (this PR), then `runtime/journal-chain.js`, `runtime/contract.js`, `runtime/snapshot.js`, `runtime/receipt-export.js`, `runtime/state-bundle.js`, `runtime/sarif-export.js`, `runtime/telemetry.js`, `runtime/session-budget.js`, `runtime/session-memory.js`, `runtime/session-resume.js`, `runtime/spend-estimator.js`, `runtime/workflow-enforcer.js`, `runtime/memory-search.js` (PR 4).

---

## Problem

ADR-028 hardened the four highest-severity state consumers (`decision-journal.js`,
`policy-store.js`, `session-context.js`, `cross-agent-lock.js`). The ADR-028 reference
document's consumer table (lines 18-27) listed seven total consumers; three were explicitly
descoped as MED-severity:

| Module | State written | Descoped reason |
|--------|---------------|-----------------|
| `runtime/snapshot.js` | Pre-write snapshots | MED — can suppress recovery artifacts |
| `runtime/receipt-export.js` | Decision receipts (read-only export) | MED — audit artifact |
| `runtime/state-bundle.js` | Bundled state export | MED — export artifact |

Additionally, one consumer was **not in ADR-028's table at all**:

| Module | State written | Why unlisted |
|--------|---------------|--------------|
| `runtime/envelope.js` | `<stateDir>/envelope.json`, `<stateDir>/envelope-baselines/`, `<stateDir>/pending-envelopes/` | Not in ADR-028's table; discovered during audit |

`envelope.js` is notable because `loadDeclaredEnvelope` is called on **every `decide()`**
invocation (F15 floor input) via `runtime/decision-engine.js`. A world-writable state dir
lets an attacker pre-write a declared envelope that diverges from the observed execution
envelope, bypassing F15 or causing false-positive F15 blocks.

---

## The unlisted consumer: `envelope.js`

`loadDeclaredEnvelope()` reads `<stateDir>/envelope.json` on every `decide()` call and
feeds F15 (execution-envelope divergence floor). Write paths:
- `buildAndPersistEnvelope()` → writes `envelope.json` (atomic tmp+rename)
- `persistEnvelopeBaseline()` → writes to `<stateDir>/envelope-baselines/<hash>.json`
- Pending-envelope CRUD → writes to `<stateDir>/pending-envelopes/<id>.json`

All three write paths resolve to `stateDir()` but do NOT call `ensureStateDirSafe`.

---

## Options

### Option 1 — Apply ADR-028 pattern to all remaining consumers (RECOMMENDED)

Extend the `ensureBaseDirSafe`/`ensureStateDirSafe` pattern (shipped in ADR-028) to:
1. `envelope.js`: validate on `loadDeclaredEnvelope` (read-path, fail returns `null` — F15 skips) and on each write path.
2. `snapshot.js`: validate on write paths (snapshot creation). Fail: return early, no snapshot.
3. `receipt-export.js`: read-only; validate before reading journal. Fail: return empty export.
4. `state-bundle.js`: validate on both read (import) and write (export). Fail: return error.

### Option 2 — Status quo + comments

Accept the residual risk. These consumers are lower severity (no direct allow-gate bypass).
Document with `// ADR-032: unvalidated state-dir — see SECURITY.md` at each `ensureDir` call.

---

## Recommendation

**Option 1** for `envelope.js` (HIGH — F15 input, called every `decide()`). Option 2 is
acceptable for `snapshot.js`, `receipt-export.js`, and `state-bundle.js` (MED — not in
the hot path).

---

## FP analysis

None. State-dir validation never changes `decide()`'s `action` output. F15 skip-on-unsafe
is existing behavior when `loadDeclaredEnvelope()` returns `null` (no declared envelope →
F15 no-ops).

---

## Engine/script hook points

- `runtime/envelope.js` — `loadDeclaredEnvelope()` + write paths.
- `runtime/snapshot.js` — `createSnapshot()` or equivalent write path.
- `runtime/receipt-export.js` — `exportReceipts()` or equivalent read path.
- `runtime/state-bundle.js` — `exportBundle()` / `importBundle()`.

---

## Cross-references

- ADR-024: `ensureStateDirSafe` primitive (the foundation).
- ADR-028: first consumer sweep (decision-journal, policy-store, session-context, cross-agent-lock).
- `runtime/state-dir.js:ensureBaseDirSafe` — the write-path helper added in ADR-028.
