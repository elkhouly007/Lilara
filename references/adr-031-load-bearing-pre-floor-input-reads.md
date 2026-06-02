# ADR-031 — Load-Bearing Pre-Floor `input.*` Reads Crash `decide()`

**Status:** Proposed — 2026-06-02. Audit-by-side-effect finding during ADR-030 sweep.  
**Severity:** HIGH (same class as ADR-025; enables floor-level fail-open on adversarial input)  
**Area:** `runtime/decision-engine.js` — load-bearing pre-floor reads of `input.*` outside any try/catch.

---

## Problem

ADR-030 swept `decide()` for **advisory** pre-floor `input.*` reads and guarded two sites
(`isWriteLike` at ~1025, `classifyIntent` at ~1032). Both are advisory — the no-touch
fallback is safe because the floor cascade decides. ADR-030 explicitly deferred the
**load-bearing** pre-floor reads, which read `input.*` outside any try/catch and cannot
be silently swallowed by a no-touch fallback.

A load-bearing read is one whose return value drives the security decision (e.g.
determines `isGated`, routes through a floor, or feeds contract-scope matching). Swallowing
it silently would be fail-OPEN, not fail-safe.

### Known load-bearing sites (pre-floor cascade at ~line 1457)

| Line | Call / read | Input property | Why load-bearing |
|------|-------------|----------------|-----------------|
| ~1057 | `_classifyCommandDual(input.command \|\| "")` | `input.command` | `cmdClass` → `isGated` → drives F2/F5 strict-mode blocks and contract scope match. Also note: `classifyIntent` at 1032 (ADR-030 guarded) reads the same `input.command` — a getter fires there first (now caught), but `_classifyCommandDual` fires next unguarded. |
| 1004 | `input.repeatedApprovals` (plain property read) | `input.repeatedApprovals` | Drives learned-allow demotion path; if the getter throws here, execution never reaches the floors. |
| 1005 | `input.sessionRisk` (plain property read) | `input.sessionRisk` | Risk scoring; same issue. |
| 1006 | `input.branch` (plain property read) | `input.branch` | Protected-branch scoring; same. |
| ~1040 | `input.dryRun` (plain property read) | `input.dryRun` | Dry-run mode; same. |
| ~1086 | `String(input.harness \|\| enriched.harness)` | `input.harness` | F5 harness-mismatch gate; same. |

The `input.command` coupling via `_classifyCommandDual` is the most exploitable: ADR-030's
`classifyIntent` guard catches the first throw on `input.command`, letting execution
continue, but `_classifyCommandDual` fires next at ~1057 — still unguarded. A non-
enumerable throwing getter on `input.command` therefore still crashes `decide()` before
the floor cascade.

### Why this is harder than ADR-030

For advisory calls, a no-touch fallback is safe (the floor cascade ignores the advisory
value). For load-bearing reads, the fallback MUST route to `require-review` (fail-safe)
rather than carrying any default value that would let the floor cascade assume safe input.

---

## Options

### Option 1 — Input materialization at `decide()` entry (RECOMMENDED)

Add a defensive input normalization step at the very top of `decide()` that materializes
all `input.*` property reads via an explicit safe-read loop, catching any throwing getter:

```js
function _safeRead(obj, key) {
  try { return obj[key]; }
  catch { return undefined; }
}
// Or: collect all enumerable AND known non-enumerable keys upfront
```

If any materialization throws (indicating a hostile input), route to `require-review`
immediately (before any other processing). This covers all pre-floor reads — enumerable
and non-enumerable — in a single place.

Challenge: the `Object.fromEntries(Object.entries(input))` spread at ~990 already covers
enumerable getters; this option needs to also cover non-enumerable getters for known
security-sensitive properties (`ir`, `envelope`, `command`, `file_path`, etc.).

### Option 2 — Per-site load-bearing guards with explicit fail-safe returns

Wrap each load-bearing site individually in a try/catch that returns
`buildEarlyReview("input-materialization-failed", ...)` on throw. More surgical but
verbose; requires identifying all sites exhaustively.

### Option 3 — Status quo + ADR-030 comment

Accept the residual risk for load-bearing reads. Non-enumerable throwing getters are a
niche attack vector; real harnesses produce plain objects. Add
`// ADR-031: load-bearing — see ADR-031 for the planned input-materialization fix`
at each unguarded site.

---

## Recommendation

**Option 1** — a single input-materialization gate at `decide()` entry. This closes the
entire class at once, future-proofs against newly-added pre-floor reads, and avoids
per-site boilerplate. Zero FP risk: materialization only changes behavior when a
getter throws — on adversarial inputs that were already making `decide()` crash.

---

## FP analysis

None. A throwing getter on any `input.*` property already makes `decide()` crash with an
uncaught exception. Routing to `require-review` instead is strictly safer.

---

## Cross-references

- ADR-025: caller-level fail-safe catches in `decide()` (the foundation).
- ADR-030: advisory pre-floor guard sweep that discovered this coupling.
- `runtime/decision-engine.js` ~lines 1004-1057 (the pre-floor input-read region).

---

## Engine/script hook points

- `runtime/decision-engine.js` — add input materialization before line 989 (`discover(input)`),
  or alternatively wrap lines 1004–1057 individually. The `classifyCommandDual` call at ~1057
  is the most urgently exploitable site given the ADR-030 `classifyIntent` getter chain.
