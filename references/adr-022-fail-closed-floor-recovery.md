# ADR-022 — Fail-Closed F25/F26 Floor Recovery

**Status:** Implemented — header reconciled 2026-06-12, Phase-0 ledger reconciliation (proposed 2026-06-01). Shipped in
commit 40784ca (PR #106): both fail-closed catches live today in `runtime/floor-mcp.js` (`internal-error-scanning-args`
returns for F25 and F26; the floors moved there from decision-engine.js in the PR #128 decomposition); adversarial tests
ADR022-T15/T16 in `tests/runtime/mcp-floor-adversarial.test.js`.  
**Severity:** HIGH  
**Area:** `runtime/decision-engine.js` `_evalMcpArgFloor` (F25) and `_evalMcpRegistrationFloor` (F26).

---

## Problem

Both MCP security floors (`_evalMcpArgFloor` at line 703 and `_evalMcpRegistrationFloor` at line
821) end with:

```js
} catch { return { fire: false }; } // fail-open
```

This is the **only gate** that prevents dangerous commands from appearing in MCP arg payloads and
MCP config writes. If the catch fires, the engine silently allows the tool call.

### How the catch could fire

1. **Attacker-crafted object with a getter that throws.** `_extractStringValues` uses
   `Object.values()` and recursive traversal (lines 590–630). If `tool_input` contains a property
   with a getter (`{ get sql() { throw new Error("boom"); } }`), the traversal throws inside the
   floor. The outer catch returns `{ fire: false }` — the MCP call is allowed.
2. **Maximum-depth + large-string payload.** The node cap is 1000 nodes (line 589). When hit,
   `_extractStringValues` returns `{ strings: [], truncated: true }`. The floor then returns
   `{ unscannable: true }` — correctly fail-closed via `require-review`. But a throw before the
   truncation guard is hit would fall to the outer catch.
3. **Module load error or unexpected V8 behavior.** Less realistic but possible in adversarial
   environments.

### What "fail-open" means here

`fire: false` is the "allow" signal. The caller at `decision-engine.js:1474`:

```js
if (f25 && f25.fire) { return buildEarlyBlock(...); }
if (f25 && (f25.unscannable || f25.review)) { return buildEarlyReview(...); }
// else: falls through to the remaining floor cascade → eventually resolves to allow/route
```

If F25 catches internally and returns `{ fire: false }`, neither the block nor the review branch
fires — the call proceeds to lower floors, which for a pure MCP arg payload may do nothing.
**The dangerous command passes.**

---

## Options

### Option 1 — Change F25/F26 catches to return `unscannable` (RECOMMENDED)

Replace:
```js
} catch { return { fire: false }; } // fail-open
```
With:
```js
} catch (e) {
  // Fail-closed: any unexpected throw during arg scanning → require-review.
  // This is safer than fail-open (fire:false = allow) for a floor whose sole
  // job is blocking dangerous commands. The caller maps unscannable → buildEarlyReview.
  return { unscannable: true, reason: "internal-error-scanning-args" };
}
```

**FP analysis:** `unscannable` maps to `require-review` (WARN class), not `block`. A benign call
that triggers an unexpected throw goes to human review, not blocked. Zero eval FP by definition
(WARN class). Zero regression risk on existing corpus (existing calls don't throw; catches have
never fired in production).

### Option 2 — Validate input shape before traversal

Add a defensive `instanceof` / `typeof` check before calling `Object.values()`. This prevents
getter-throw attacks but adds complexity and may miss new adversarial input shapes.

### Option 3 — Status quo (conscious fail-open)

Documented in the code as intentional. The ADR explicitly acknowledges the risk. No change.

---

## Recommendation

**Option 1.** One-line change per floor catch, zero functional regression, measurably safer
posture. The CHANGELOG from the June 2026 sprint documents the vector; this ADR closes it.

### What tests would prove the fix

1. Add a unit test in `tests/runtime/mcp-floor-adversarial.test.js` that passes a `tool_input`
   with a throwing getter → expect `result.action === "require-review"` and
   `result.reasonCodes.includes("mcp-arg-shape-unscannable")`.
2. Eval corpus: add a borderline entry representing a pathological input → confirm 0.0%/0.0% (it
   is borderline, not safe or dangerous, so it doesn't affect FP/FN).

---

## FP risk

- **None by eval definition.** `require-review` = WARN class; FP = label `safe` → `block` only.
- **Operator experience risk: low.** A pathological payload triggering the catch is already
  suspicious; one require-review is the proportionate response.

---

## Consequences

- **If approved:** two one-line changes to `_evalMcpArgFloor` (line 703) and
  `_evalMcpRegistrationFloor` (line 821) + one new adversarial unit test.
- **If declined:** document the fail-open behavior explicitly in the code comment (change "fail-open"
  to a full explanation of the threat model and the decision to accept the risk).
