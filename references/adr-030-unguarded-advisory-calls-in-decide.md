# ADR-030 — Unguarded Advisory Enrichment Calls in `decide()`

**Status:** Proposed — 2026-06-02. Audit-by-side-effect finding during ADR-025 implementation.
**Severity:** HIGH (same class as ADR-025; enables floor-level fail-open regression if missed)
**Area:** `runtime/decision-engine.js` — advisory pre-floor calls outside any try/catch.

---

## Problem

ADR-025 converted the 6 caller-level fail-open catches in `decide()` to fail-safe
(`buildEarlyReview`). While implementing, a structural blocker for the F16 fail-safe was
discovered: `_classifyAmbientTouch(input)` at **line 1012** is called **outside any try/catch**,
before any security floor runs.

`_classifyAmbientTouch` calls `_collectAmbientCandidatePaths(input)`, which reads:
- `input.targetPath`
- `input.ir.fileTargets[].path` (for write/delete targets)
- `input.envelope.targets[].path`

An adversarially crafted input (e.g. a `tool_input` with a getter that throws on `.path`) can
make `_classifyAmbientTouch` throw, which propagates out of the unguarded call and crashes
`decide()` before any floor runs — pre-empting all security checks.

### Why this was the blocker for ADR-025 F16

F16's `_evalAmbientFloor` reads the same candidate paths. If `_classifyAmbientTouch` throws
unguarded at line 1012, the throw exits `decide()` entirely and never reaches F16's caller
catch. ADR-025's F16 fail-safe would therefore be:

1. **Cosmetically correct** in the code but **unreachable** in practice for input-driven throws.
2. **Untestable** — any synthetic-throw test would abort `decide()` at 1012, not at F16.

ADR-025 fixed this by guarding line 1012. This ADR documents the broader class for a
follow-up sweep.

### The class: unguarded advisory enrichment calls

`_classifyAmbientTouch` is advisory — it enriches the receipt with the first ambient path
found, but does not affect the security decision. There may be other advisory enrichment calls
in `decide()` with the same property: invoked outside try/catch, reading from `input` or
`enriched`, where a throw crashes `decide()` instead of landing at a floor-level catch.

Known instance fixed by ADR-025 (one-line guard, zero behavior drift):
- `line 1012`: `_classifyAmbientTouch(input)` → now `try { ... } catch { = {class:null,path:null} }`

Candidates to audit:
1. `classifyIntent(input.command || "")` (line ~1027) — pure string; unlikely to throw,
   but if `input.command` has a getter, it fires here.
2. `getContract(discovered.projectRoot || process.cwd())` (line ~1030) — has its own
   internal try/catch; safe.
3. Any `enriched.ir.*` or `enriched.*` reads outside of a floor's try block.

---

## Options

### Option 1 — Audit + guard all unguarded advisory calls (RECOMMENDED)

Sweep `decide()` for advisory pre-floor calls that read from `input`/`enriched` outside any
try/catch. For each: wrap in a fail-safe guard with a descriptive comment. Zero behavior
change for non-throwing inputs.

### Option 2 — Validate input shape at decide() entry

Add a defensive input normalization step at the top of `decide()` that materializes all
`input.*` property reads via `Object.entries` into a plain object, stripping getters. Broader
coverage but more invasive; `Object.entries` skips non-enumerable getters only — enumerable
throwing getters (rare, but possible from hostile environments) still propagate.

### Option 3 — Status quo + comments

Accept the risk for non-F16 advisory calls (low-probability attack vector), add
`// ADR-030: conscious unguarded — advisory only, low throw risk` comments at each site.

---

## Recommendation

**Option 1 sweep** of decide()'s pre-floor and inter-floor advisory reads, scoped to reads
of `input.*` and `enriched.*` outside any try/catch. The ADR-025 guard at line 1012 is
the template. Zero FP/FN risk (advisory only). Estimate: 2–5 one-line guards.

---

## FP risk

None. Advisory enrichment reads do not affect action output on non-throwing paths. Guards
only change behavior when the read would throw — i.e., on adversarial inputs that were
already making `decide()` crash.

---

## Consequences

- **If approved:** A targeted sweep of `decide()` for unguarded advisory enrichment reads
  from `input.*`. Each gets a `try { ... } catch { = <safe default> }` guard. One commit
  per batch of sites, or one per logical group. Tests: add synthetic-throw cases for any
  advisory call whose guard cannot be proven trivially safe.
- **If declined:** Document each unguarded advisory call with `// ADR-030: conscious
  unguarded` comments so future reviewers understand the choice.

---

## Engine/script hook points

`runtime/decision-engine.js` — advisory pre-floor calls outside try/catch. Current known
instance (already fixed by ADR-025 line 1012 guard):

```
line ~1012  _classifyAmbientTouch(input)          [FIXED by ADR-025]
line ~1027  classifyIntent(input.command || "")   [candidate — audit]
```

---

## Cross-references

- ADR-025 §Audit-discovered enabling fix: the line 1012 guard that ships with ADR-025.
- ADR-022: inner-catch fail-safe pattern for F25/F26 (the established precedent).
