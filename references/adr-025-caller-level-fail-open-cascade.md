# ADR-025 — Caller-Level Fail-Open Cascade in `decide()`

**Status:** Proposed — 2026-06-02. Audit-by-side-effect finding from the June 2026 hardening sprint.  
**Severity:** HIGH  
**Area:** `runtime/decision-engine.js` — seven `catch { /* fail-open */ }` caller blocks in `decide()`.

---

## Problem

ADR-022 hardened the **inner** catches of `_evalMcpArgFloor` (F25) and
`_evalMcpRegistrationFloor` (F26), changing them from `return { fire: false }` (allow)
to `return { unscannable: true }` (require-review). This is correct and shipped.

However, the **caller-level** try/catch blocks in `decide()` — one per floor — are a
separate, outer layer that still fail-open. Any unexpected throw that escapes the floor
function itself (e.g., a throw in `buildEarlyBlock`/`buildEarlyReview`, or a floor that
has NO internal catch) falls to one of these outer blocks and silently allows the call.

### The seven outer fail-open catches in `decide()` (master line numbers)

| Line | Floor | Notes |
|------|-------|-------|
| `~1456` | F16 `_evalAmbientFloor` | No internal catch; depends entirely on this outer block |
| `~1472` | F24 `_evalCredPersistFloor` | No internal catch; depends entirely on this outer block |
| `~1505` | Rug-pull detection | Comment-justified: "must never block the engine" |
| `~1539` | F25 `_evalMcpArgFloor` caller | ADR-022 hardened the inner catch; outer still fails-open |
| `~1563` | F26 `_evalMcpRegistrationFloor` caller | ADR-022 hardened the inner catch; outer still fails-open |
| `~1593` | F17 `_evalCrossAgentLockFloor` | F17 itself fails-CLOSED for malformed lock state; outer fails-open |
| `~1671` | F19 `_evalF19Floor` (output-exfil) | No inner catch exposed in this module boundary |

### Worst-case impact per floor

- **F16 / F24:** These floors have NO internal try/catch. The outer block at ~1456 /
  ~1472 is the only protection. If the floor function throws (e.g., a glob-match helper
  fails, a contract field triggers an unexpected accessor), the catch silently allows
  ambient-authority writes and credential-persistence writes.
- **F25 / F26 outer (post-ADR-022):** The inner floor catch now returns `unscannable`.
  However, if `buildEarlyBlock` or `buildEarlyReview` itself throws after the floor
  returns (while building the early-return receipt), the outer catch swallows that throw
  and falls through — effectively allowing the call. This is lower-probability but real.
- **Rug-pull detection (~1505):** The comment "must never block the engine" is an
  explicit design choice. Agreed for rug-pull detection (which is advisory); this site
  may be correctly fail-open.
- **F17 (~1593):** F17 is notable because the floor itself fails-CLOSED for malformed
  lock state (returns `{ fire: true, reason: "lock-state-malformed" }`). But if F17
  throws unexpectedly before returning that shape, the outer catch overrides the
  fail-closed intent.
- **F19 (~1671):** Output-channel exfiltration detection. Failure to detect = blind spot
  on exfil channels.

### Pattern

```
// Current (fail-open):
try {
  const fN = _evalFloorN(input, ...);
  if (fN && fN.fire) { return buildEarlyBlock(...); }
  if (fN && fN.something) { return buildEarlyReview(...); }
} catch { /* fail-open per zero-dep policy */ }
```

---

## Options

### Option 1 — Per-floor fail-safe return (RECOMMENDED for F16, F24, F17)

For floors whose failure is unambiguously a security gap, replace the catch with an
explicit fail-safe return:

```js
// F16 example:
} catch {
  // Unexpected throw from ambient-authority evaluation.
  // Fail-safe: deny ambient writes on scanner failure.
  return buildEarlyReview("ambient-authority-scan-failed", enriched, discovered, input,
    "ambient-authority scanner threw unexpectedly; require review",
    { floorFired: _F16.name, decisionSource: _F16.source });
}
```

For F25 / F26 outer catches (post-ADR-022), the floor-internal catch now handles the
floor's own throw. The outer catch is a belt-and-suspenders for the `buildEarlyBlock`/
`buildEarlyReview` path — require-review is the appropriate fallback.

### Option 2 — Structured outer catch with diagnostic logging

Retain the fail-open behaviour but log the unexpected throw (stderr / decision-journal)
so operators can detect and diagnose. Does not change the security posture; improves
operational visibility.

### Option 3 — Status quo (conscious fail-open)

Document the seven sites as accepted fail-open per the zero-dep / fail-open policy.

---

## Recommendation

**Per-floor Option 1** for F16 and F24 (no internal catch; full exposure). F17 should
also use a fail-safe outer catch consistent with its own fail-closed inner posture.
Rug-pull detection (~1505) may remain fail-open (advisory detection; well-commented).
F25/F26 outer catches: require-review fallback (belt-and-suspenders post-ADR-022).
F19 outer catch: require-review fallback for exfiltration-channel scanner failure.

---

## FP risk

- **Option 1:** `require-review` (WARN class) — zero eval FP by definition. A benign
  call that triggers an unexpected throw in a floor goes to human review, not blocked.
  Operator experience: one require-review for a pathological payload. Proportionate.

---

## Engine/script hook point

`runtime/decision-engine.js` — the seven `catch { /* fail-open */ }` blocks surrounding
F16 (~1456), F24 (~1472), rug-pull (~1505), F25-caller (~1539), F26-caller (~1563),
F17 (~1593), F19 (~1671) in `decide()`.

---

## Consequences

- **If approved:** 4–6 one-line catch replacements in `decide()`. Zero new action
  classes; `require-review` routes through the existing `buildEarlyReview` path. Tests:
  one per floor — synthetic throw in each → assert `require-review` + appropriate
  `reasonCode`.
- **If declined:** Add explicit `// ADR-025: conscious fail-open` comments to each site
  with a short rationale, so future reviewers have context rather than just seeing a
  bare catch.
