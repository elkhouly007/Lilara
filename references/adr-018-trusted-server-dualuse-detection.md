# ADR-018 — Trusted-Server Dual-Use Detection

**Status:** **Implemented** — 2026-06-01. Option 1 shipped: drift hoisted above F25, boolean
threaded into `_evalMcpArgFloor`, new branch `optedOut && GATED_REVIEW_CLASSES.has(cls) && driftForThisServerTool`
at `decision-engine.js:698`. Fixture A (`15-f25-trusted-dualuse-nodrift-allow`) + inline B/C multi-call
tests in `check-mcp-security.sh`. Eval 0.0%/0.0%; replay corpus byte-identical.
**Area:** F25 MCP arg floor (`runtime/decision-engine.js` `_evalMcpArgFloor`) + rug-pull pin
(`runtime/mcp-pin.js`).
**Scope:** add **detection** for the trusted-server dual-use residual **without** hard-blocking
legitimate trusted-server use. Eval must stay 0.0% FP / 0.0% FN.

---

## Problem

A per-server `scopes.mcp[<server>].policy = "allow"` marks a server **trusted**. That trust is
intentionally **decoupled** across floors (Khouly decision, 2026-05-29, documented at
`decision-engine.js:636–646`):

- **HARD_BLOCK** args from a trusted server (`rm -rf /`, `curl|sh`, …) degrade to `require-review`
  — never silent allow (`decision-engine.js:675`).
- **GATED_REVIEW dual-use** args from a trusted server **are allowed** — that is the legitimate use
  case (a DB connector *receives* `DROP TABLE`; a package MCP *receives* `npm i -g`).

The residual is that last branch. In `_evalMcpArgFloor`, the dual-use accumulator is guarded by
`!optedOut` (`decision-engine.js:678`):

```js
if (!optedOut && GATED_REVIEW_CLASSES.has(cls)) sawGatedReview = true;
```

So for a **trusted** server, a GATED_REVIEW class (`destructive-db` = `DROP DATABASE/TABLE/SCHEMA` /
`TRUNCATE`, `auto-download`, `global-pkg-install`) leaves `sawGatedReview = false`, falls through to
`{ fire: false }` (`:689`), and **resolves to `allow`**. Concretely: a `policy:allow` server sending
`DROP DATABASE prod` is allowed today.

This is a **conscious tradeoff** — hard-gating every `DROP` for a DB MCP would break its core
function. The only detection signal that exists today is the **rug-pull pin** (`mcp-pin.js`), and it
is currently **advisory-only**: `decision-engine.js:1496–1523` computes `checkArgShapeDrift(...)`,
attaches a `mcpToolDrift` field to the receipt, and **never changes `action`/`source`/`floorFired`**.
The signal is computed and then thrown away for enforcement purposes.

---

## Decision (recommended): Option 1 — rug-pull-pin-driven escalation

Escalate the trusted-server dual-use branch from `allow` → **`require-review`** **only when both**:

1. the rug-pull pin reports **arg-shape drift** for this `{server, tool}` (the server changed its
   behavioral shape since first seen), **and**
2. a **GATED_REVIEW dual-use class** is present in the same call.

**Rationale.** This is precisely the rug-pull threat model: a server that *pivots* behavior and ships
a destructive class. A steady-state DB MCP (stable arg-shape, routine `DROP`) produces **no drift** →
still allowed → core function preserved. A server that usually reads logs but suddenly emits
`DROP DATABASE` (shape change **and** dual-use) → one human gate. It also *reuses* the existing pin —
no new subsystem — and converts a today-wasted signal into a proportionate response.

**Why `require-review`, not `block`.** A block would break legitimate dual-use the moment a trusted
server's schema legitimately evolves. `require-review` is an auditable human gate, not a denial; the
pin re-pins on drift (`mcp-pin.js:78–83`) so the *next* identical call is clean — the gate is
one-shot and self-healing.

### Hook location & threading constraint

- **Hook:** in `_evalMcpArgFloor` at `decision-engine.js:678`, when
  `optedOut && GATED_REVIEW_CLASSES.has(cls) && driftForThisServerTool`, return
  `{ review: true, reason: "trusted-server-dualuse-after-drift:command-class=" + cls }`.
- **Threading (the one real subtlety):** `checkArgShapeDrift` is **stateful** — it re-pins on
  detection, so calling it twice would make the second call report no drift. Today it is invoked
  *after* the floor cascade (`:1509`). The implementation must **compute drift once** and **thread
  the boolean into `_evalMcpArgFloor`** — i.e. hoist the existing `:1509` call above the floor
  evaluation and pass its result in, **replacing** (not duplicating) the call site. The advisory
  `mcpToolDrift` receipt field is retained for observability.

---

## Option comparison

| Option | Mechanism | Auto-detect? | Behavior change | FP risk | Verdict |
|--------|-----------|:---:|:---:|:---:|--------|
| **1. Rug-pull escalation** | drift **AND** dual-use → `require-review` | **yes** | allow→review on the narrow co-occurrence | **low** (zero by eval defn) | **recommended** |
| 2. Advisory journal entry | observe-only `trusted-server-dual-use` marker | no | none | zero | zero-risk **precursor** to (1) |
| 3. Anomaly stats | per-server command-class distribution | partial | none until thresholded | medium (needs learning/tuning) | most complex; defer |
| 4. Opt-in `dualUseAlso: review` | operator flag forces review for dual-use | no (operator-driven) | only when opted in | zero | complementary **override** |

Option 1 is the only option that **automatically detects** the specific threat and responds
proportionately. Option 2 is the strongest *zero-risk* increment but is weakest as detection (it does
not change the decision). Option 3 needs a normal-distribution learning phase per server type. Option
4 is a clean knob but shifts the burden to the operator and detects nothing on its own.

**Recommended path:** ship Option 1 as the headline. Optionally stage Option 2 first (pure
observability, zero risk) to gather drift+dual-use frequency before flipping on the escalation, and
expose Option 4 as an explicit operator override for stricter installs. Options 2 and 4 compose with
1 without conflict.

---

## FP-risk analysis (why eval stays 0.0/0.0)

1. **Escalation target is `require-review` = WARN class.** The eval harness
   (`evals/decision-replay.eval.js`) defines **FP = label `safe` → `block`** and **FN = label
   `dangerous` → `allow`**; `require-review` maps to the WARN class (`ALLOW/WARN/BLOCK`
   partition). Therefore Option 1 can **never** produce an eval FP by construction, and where it
   fires on a dangerous case it *reduces* FN.
2. **Existing corpora are unaffected.** Eval-corpus and replay-corpus entries are evaluated
   first-sight/stateless; the pin returns `drift:false` on first sight (`mcp-pin.js:72–76`), so
   condition (1) of the trigger is false for every existing entry. Existing verdicts — including the
   recorded replay-corpus `action`/`decisionSource`/`floorFired`/`irHash` — are **byte-unchanged**.
   The 0.0/0.0 baseline holds trivially.
3. **Residual real-world FP is rare and self-healing.** The only non-eval FP is a *legitimate* shape
   evolution co-occurring with a *legitimate* dual-use call (e.g. a DB MCP adds an optional param on
   the same call that runs a benign `DROP TABLE tmp_scratch`). That yields one `require-review`
   prompt, after which the pin re-pins and subsequent calls are clean — and a shape change paired
   with a destructive class is arguably worth one human glance, not a false alarm.

---

## What tests would prove no new FP

1. **`scripts/check-mcp-security.sh` fixtures** (this gate already constructs
   `scopes.mcp[<server>].policy:allow` contracts — the natural home for trusted-server scenarios):
   - **A — no drift:** trusted server, first-sight, `mcp__db__query` with `DROP DATABASE prod` →
     `allow` (unchanged; steady-state legit use preserved).
   - **B — drift + dual-use:** seed the pin with shape X (benign call), then shape Y carrying
     `DROP DATABASE prod` → `require-review` (detection fires).
   - **C — drift, no dual-use:** shape change carrying a benign command → `allow` (drift **alone**
     never escalates; guards against over-escalation / new FP).
2. **Regression:** full `tests/eval-corpus.json` + `scripts/check-replay-corpus.sh` → still
   **0.0% FP / 0.0% FN**, recorded verdicts unchanged (first-sight, unaffected).
3. **Unit:** `tests/runtime/mcp-pin.test.js` + `tests/runtime/mcp-floor-adversarial.test.js` cover
   the threaded `drift && dual-use` predicate (including the stateful single-evaluation requirement —
   the floor and the receipt advisory must read the *same* drift computation).

Note: the stateful pin cannot be exercised by the stateless eval-corpus; cases B/C must be
multi-call fixtures in `check-mcp-security.sh`, not single-shot eval-corpus rows.

---

## Honest alternative

If even a one-shot `require-review` on the drift+dual-use co-occurrence is judged too aggressive for
trusted DB tooling, the **residual is defensible as-is** and the strongest *zero-behavior-change*
step is Option 2 (advisory journal) — it adds forensic detection with no possibility of an FP. But
given the eval-neutrality argument above, Option 1 is the recommended way to actually *close* the
detection gap rather than only observe it.

---

## Consequences

- **If approved:** a follow-up implementation PR threads the drift signal into `_evalMcpArgFloor`,
  adds the `check-mcp-security.sh` A/B/C fixtures, and confirms eval/replay regression at 0.0/0.0.
- **If declined:** the residual remains a documented, conscious tradeoff with the rug-pull pin as the
  advisory-only signal (status quo).
- No runtime behavior changes from this document.
