# ADR-021 — Bounded recursion for `canonical-json`

- **Status:** Proposed (2026-05-30)
- **Owner decision required:** yes — hardens a shared serialization primitive used in contract hashing.

## Problem

`runtime/canonical-json.js` (`canonicalJson`) serializes with **unbounded recursive descent**. On
deeply-nested input it overflows the stack:

```
canonicalJson(nest(100))   => OK
canonicalJson(nest(5000))  => RangeError: Maximum call stack size exceeded
```

`canonicalJson` is the deterministic serializer behind **contract hashing** (`contract.js`,
`check-mcp-security.sh`, receipt/IR hashing). Today the one decision-path caller that touches
attacker-influenceable structure — `action-ir._safeRawHash` — wraps it in `try/catch` and returns
`null` on throw, so a crash there is contained. The risk is **latent**: any future caller that
serializes untrusted structure *without* a catch turns a deep/cyclic payload into an uncaught
`RangeError` (availability / fail-uncontrolled).

## Evidence

- Reproduced via `node` probe (above), 2026-05-30.
- `action-ir.js` `_safeRawHash` try/catch confirmed as the current containment.

## Options considered

1. **Add a depth parameter + cap (~64) to `canonicalJson`**; on exceeding it, throw a *typed*
   `CanonicalJsonDepthError` (or return a sentinel) rather than letting V8 overflow at an
   unpredictable depth. Callers in security paths map the typed error to fail-safe
   (require-review / skip-demotion), never silent allow.
2. **Refactor to an iterative serializer** (explicit stack) — removes the limit entirely but is a
   larger change to a primitive that must stay byte-stable for hashing (regression risk on the hash
   output).
3. **Do nothing** — rely on every caller wrapping in try/catch (status quo; fragile by convention).

## Recommendation

**Option 1.** A depth cap with a typed error is small, keeps the byte-stable output identical for
all real inputs (real contracts/IR are shallow — depth << 64), and converts an unpredictable
stack-overflow into a deterministic, catchable signal that callers can map fail-safe. Avoid Option
2 unless a genuine need for unbounded depth appears — rewriting the hash serializer risks changing
`contractHash`/`irHash` for existing accepted contracts.

## FP analysis

- Real contracts, receipts, and IR are far shallower than any sane cap (≤ ~10 levels), so a cap of
  64 changes **no** existing hash and produces **no** behavior change on legitimate input — it only
  converts a pathological-depth crash into a typed error. Zero eval impact.

## Where it hooks

- `runtime/canonical-json.js` (`canonicalJson` signature + depth guard + exported error type).
- Security-path callers that must fail safe on the typed error: `runtime/action-ir.js`
  (`_safeRawHash` — already catches), `runtime/contract.js` (hashing), any receipt/IR hash site.
