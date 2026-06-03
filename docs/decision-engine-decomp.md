# decision-engine.js Decomposition Module Map

**Sprint:** Monolith Decomposition — June 2026  
**Baseline:** master `7210a79`, VERSION 0.1.7, `runtime/decision-engine.js` = **2422 lines**  
**Goal:** Carve cohesive concerns into modules under `runtime/`. `decide()` stays the orchestrator; public API unchanged.  
**Arbiter:** Byte-identical replay over 105 corpus entries (`corpus.jsonl` + `adversarial.jsonl` + `f16-adversarial.jsonl` + `f24-credential-persistence.jsonl` + `mcp-security.jsonl`).

---

## Structural Overview (pre-decomposition)

| Region | Lines | What lives here |
|--------|-------|-----------------|
| Module header — requires | 1–23 | 22 external `require()` calls |
| LATTICE entry constants | 24–61 | `_F1`–`_TN` (32 floor/source entries) |
| Demotion source identifiers | 62–78 | 8 `_DEMOTE_*` string constants |
| `_irJournalExtras()` | 79–91 | IR extras helper (stays — used in buildEarlyBlock + decide) |
| Process-level flags | 92–96 | `_taintWarnedOnce` |
| Hoisted requires (contract, network, etc.) | 97–181 | contract, network-egress, action-ir, provenance-graph, glob-match, ambient, cross-agent-lock, state-paths, mcp-pin, degraded-mode, snapshot, notify lazy loader, optional modules, input-materializer |
| `getContract()` lazy loader | 183–196 | Contract load/cache (stays — needed by decide + early-block notify path) |
| `harnessInScope()` + buildEarlyBlock shared state | 198–221 | 4 module-level shared state vars set by decide(), consumed by builders |
| `buildEarlyBlock()` | 222–326 | Early-block receipt + journal + notify (105 lines) |
| `buildEarlyReview()` | 327–395 | Early-review receipt + journal + notify (69 lines) |
| F16 ambient-authority helpers | 397–498 | `_normAmbientPath`, `_isInsideProject`, `_PROJECT_LOCAL_AMBIENT_CLASSES`, `_matchAmbientAllow`, `_classifyAmbientTouch`, `_collectAmbientCandidatePaths`, `_evalAmbientFloor` (102 lines) |
| F24 credential-persist helpers | 500–562 | `_collectWriteTargets`, `_isHighSensitivityPath`, `_isPersistencePath`, `_evalCredPersistFloor` (63 lines) |
| F25 MCP-arg-danger helpers | 564–711 | `_classifyCommandDual` alias, `_ESV_NODE_CAP`, `_RAW_SCAN_CAP`, `_extractStringValues`, `_GATED_CMD_CLASSES`, `_evalMcpArgFloor` (148 lines) |
| F26 MCP-registration-write helpers | 713–835 | `_collectMcpWriteContent`, `_evalMcpRegistrationFloor` (123 lines) |
| F19 + F20 inline requires | 837–845 | Import of output-exfil + change-intent (stays inline — pure module boundary) |
| Notify hook helpers | 848–960 | `_notifyModule` lazy loader, `_notifyDegradedSeen`, `_getNotify`, `_classifyNotifyEvent`, `_fireNotifyHook` (113 lines incl. lazy-loader at 148–155) |
| F17 cross-agent-lock helpers | 847–916 | `_isWriteLikeForLock`, `_collectLockCandidatePaths`, `_evalCrossAgentLockFloor` (70 lines) |
| `decide()` — kill-switch (F1) | 962–988 | Env-var gate, inline receipt build + notify |
| `decide()` — input materialization | 990–1031 | ADR-031 _materializeInput, fail-closed inline receipt |
| `decide()` — context enrichment | 1032–1101 | discover(), loadProjectPolicy(), enriched, ambient-touch, degraded, writeLike, intentResult, contract, earlyBlock* setters |
| `decide()` — contract/F2/F5/scopeMatch | 1103–1172 | Contract hash verify, harness scope, scope-match |
| `decide()` — F11–F15 floor cascade | 1174–1427 | F11 validity, F12 mcp-deny, F13 skill-deny, F14 budget, F18 network, F15 envelope |
| `decide()` — F23 kill-chain | 1429–1509 | Provenance graph evaluate + propagation |
| `decide()` — F16/F24/F25/F26/F17 invocations | 1511–1707 | Call the helper evaluators + early-block returns |
| `decide()` — F19 output-exfil evaluation | 1709–1794 | Inline F19 orchestration (token demotion, preview action) |
| `decide()` — F20 change-intent evaluation | 1796–1880 | Inline F20 orchestration (load envelope, diff, token demotion) |
| `decide()` — baseline risk cascade | 1882–2040 | learnedAllow, risk score, action derivation, F4/F10/F9/F6/F7 |
| `decide()` — demotion + auto-allow-once | 2042–2092 | Contract-allow demotion, canDemoteF9, auto-allow-once |
| `decide()` — trajectory nudge | 2094–2109 | Session-trajectory escalation |
| `decide()` — late overrides | 2111–2215 | F14b, F19 late, F20 late, F23 late, degraded write routing |
| `decide()` — explanation assembly | 2217–2253 | explanationParts build |
| `decide()` — receipt field computation | 2255–2291 | policyFacts, promotionGuidance, lifecycleSummary, workflowRoute, snapshot |
| `decide()` — result assembly | 2293–2357 | `result` object literal |
| `decide()` — journal + recordDecision + counter | 2359–2411 | append(), recordDecision(), _recordDestructiveOp |
| `decide()` — notify + return | 2413–2422 | _fireNotifyHook, return result, module.exports |

---

## Candidate Modules

### M1 — `runtime/floor-credential-persist.js`

**Source lines:** 500–562 (63 lines)  
**Functions:**
- `_collectWriteTargets(input)` — gather write-intent target paths from flat field, IR fileTargets
- `_isHighSensitivityPath(p)` — regex match on .ssh, .aws, .gnupg, etc.
- `_isPersistencePath(p)` — match against PERSISTENCE_PATTERNS from provenance-graph
- `_evalCredPersistFloor(input, contract)` — F24 decision evaluator

**Inbound deps (what it requires from other modules):**
- `./provenance-graph` → `PERSISTENCE_PATTERNS`
- `./ambient` → `isAmbientPath`
- `./glob-match` → `globMatch`

**Outbound (who calls it):**
- `decide()` only — F24 invocation at lines 1541–1558

**Replay-sensitive:** YES — F24 fires early-block; outcome feeds `action`/`floorFired`

**Extraction risk:** LOW — all pure functions, zero shared state, clean interface

**Test coverage today:** `tests/fixtures/replay-corpus/f24-credential-persistence.jsonl` (4 entries), `tests/runtime/ambient-floor.test.js` (indirect), `tests/runtime/ambient-adversarial-replay.test.js` (indirect)

**After extraction — removable from DE.js:** `PERSISTENCE_PATTERNS` from the `provenance-graph` require at line 123

---

### M2 — `runtime/floor-cross-agent-lock-eval.js`

**Source lines:** 847–916 (70 lines)  
**Functions:**
- `_isWriteLikeForLock(input)` — identify write-like tool calls
- `_collectLockCandidatePaths(input)` — gather candidate paths for lock conflict check
- `_evalCrossAgentLockFloor(input, discovered, enriched)` — F17 decision evaluator; reads live lock state via `readLockState(_statePathStateDir())`

**Inbound deps:**
- `./cross-agent-lock` → `readLockState`, `findConflict`
- `./state-paths` → `stateDir`

**Outbound:**
- `decide()` only — F17 invocation at lines 1680–1707

**Replay-sensitive:** YES — F17 fires early-block; determinism handled by replay's fresh LILARA_STATE_DIR (no live locks in replay env)

**Extraction risk:** LOW — clean interface, no shared state, all I/O routed through injected stateDir

**Test coverage today:** `tests/runtime/cross-agent-lock.test.js`, `tests/runtime/state-dir-consumers.test.js`

**After extraction — removable from DE.js:** lines 132–133 (`cross-agent-lock` and `state-paths` requires)

---

### M3 — `runtime/floor-ambient-authority.js`

**Source lines:** 397–498 (102 lines)  
**Functions:**
- `_normAmbientPath(p)` — URL-decode, backslash-fold, dot/dot-dot collapse
- `_isInsideProject(targetPath, projectRoot)` — prefix check
- `_PROJECT_LOCAL_AMBIENT_CLASSES` — Set constant
- `_matchAmbientAllow(allow, ambientClass, normPath)` — segment-aligned allow-list check
- `_classifyAmbientTouch(input)` — classify first ambient touch for receipt enrichment
- `_collectAmbientCandidatePaths(input)` — deduped write-class path collector
- `_evalAmbientFloor(input, discovered, contract)` — F16 decision evaluator

**Inbound deps:**
- `./ambient` → `classifyAmbientPath`, `isAmbientPath`
- `./glob-match` → (used indirectly via `_matchAmbientAllow` — actually no, _matchAmbientAllow uses prefix matching not globMatch; verify)

Actually `_matchAmbientAllow` does NOT use `_globMatch`. It uses string prefix matching. `_globMatch` appears in F24's `_evalCredPersistFloor` and F26's `_evalMcpRegistrationFloor` only.  
**Corrected inbound deps:** `./ambient` → `classifyAmbientPath`, `isAmbientPath` only.

**Outbound:**
- `decide()` — ambient-touch classification at line 1060, F16 invocation at lines 1517–1533

**Replay-sensitive:** YES — F16 fires early-block; `_classifyAmbientTouch` result flows into receipt fields on all paths

**Extraction risk:** LOW-MEDIUM — pure functions, complex path normalization logic, no shared state; path normalization was subject of prior ARG-PRE-D-001/D-002 hardening

**Test coverage today:** `tests/runtime/ambient-floor.test.js`, `tests/runtime/ambient-adversarial-replay.test.js`, `tests/runtime/ambient-receipt-enrichment.test.js`, `tests/runtime/ambient-traversal-normalization.test.js`, `tests/fixtures/replay-corpus/f16-adversarial.jsonl` (28 entries)

**After extraction — removable from DE.js:** `classifyAmbientPath`, `isAmbientPath` from `./ambient` require at line 128 (only after M4 is also extracted; `_isAmbientPath` used in M1/F24 which moves with M1)

Wait — `_isAmbientPath` used in F24 which is M1 (floor-credential-persist). After M1+M3 both extracted, the `./ambient` require in DE.js can be fully removed.

---

### M4 — `runtime/floor-mcp.js`

**Source lines:** 564–835 (272 lines) — F25 + F26 combined  
**Rationale for combining:** F25 and F26 share `_extractStringValues`, `_classifyCommandDual`, `_GATED_CMD_CLASSES`, `_ESV_NODE_CAP`, `_RAW_SCAN_CAP`. Splitting them would require a third shared-util module or duplication, both worse than bundling.

**Functions:**
- `_classifyCommandDual` alias → `_classifyCommandDualFromKey`
- `_ESV_NODE_CAP`, `_RAW_SCAN_CAP` — scan budget constants
- `_extractStringValues(obj)` — iterative, cycle-safe string-value collector (shared by F25+F26)
- `_GATED_CMD_CLASSES` — Set of hard-block command classes
- `_evalMcpArgFloor(input, contract, enriched, driftForThisServerTool)` — F25 evaluator
- `_collectMcpWriteContent(input)` — gather write content from Write/Edit/MultiEdit shapes
- `_evalMcpRegistrationFloor(input, contract)` — F26 evaluator

**Inbound deps:**
- `./decision-key` → `classifyCommandDual` (as `_classifyCommandDualFromKey`), `GATED_REVIEW_CLASSES`
- `./shell-bypass-detector` → `isBase64PipeExec`, `isNetworkProcessSub`
- `./ambient` → `classifyAmbientPath` (used in F26 to check if target is mcpConfig class)
- `./glob-match` → `globMatch` (used in F25 + F26 opt-out checks)

**Note on `_classifyCommandDual` in decide():** `decide()` itself uses `_classifyCommandDual` at line 1116. After M4 extraction, DE.js still needs the `classifyCommandDual` import from `decision-key.js` for that call site. The alias `const _classifyCommandDual = _classifyCommandDualFromKey` (line 570) moves to M4; DE.js replaces it with a direct reference.

**Outbound:**
- `decide()` — MCP drift + F25 invocation (lines 1605, 1617), F26 invocation (lines 1645, 1653)

**Replay-sensitive:** YES — F25/F26 fire early-block + early-review; outcome feeds `action`/`floorFired`

**Extraction risk:** LOW-MEDIUM — largest pure extraction; complex internal logic (iterative scanner, dual-path classifier) but no shared state and already thoroughly tested

**Test coverage today:** `tests/runtime/mcp-floor-adversarial.test.js`, `tests/runtime/classify-dual-gateway.test.js`, `tests/fixtures/replay-corpus/mcp-security.jsonl` (4 entries)

**After extraction — removable from DE.js:**
- `GATED_REVIEW_CLASSES` from line 14 decision-key import
- `isBase64PipeExec`, `isNetworkProcessSub` from line 19 shell-bypass-detector import
- `_globMatch` from line 124 (once M1+M2+M4 all extracted — the only remaining user in DE.js would be none)
- Line 570: `const _classifyCommandDual = _classifyCommandDualFromKey` alias (DE.js still uses `_classifyCommandDual` at 1116, so alias stays but the import-source is unchanged)

Actually wait: after M4, DE.js at line 1116 still calls `_classifyCommandDual`. That alias was defined at line 570 as `const _classifyCommandDual = _classifyCommandDualFromKey`. We have two options:
1. Keep the alias in DE.js referencing the imported `_classifyCommandDualFromKey` (no change to line 1116 call site) — simplest mechanical approach.
2. Rename the call site to `_classifyCommandDualFromKey` directly — cleaner but refactoring.

Option 1 is the pure mechanical extraction choice. The alias stays in DE.js; the alias **body** (`_classifyCommandDualFromKey`) is not exported — it's just a local alias. The M4 module gets its own alias.

---

### M5 — `runtime/notify-engine-hook.js`

**Source lines:** 148–155 (lazy loader, currently inside the hoisted requires block) + 918–960 (helpers) = ~50 lines  
**Functions:**
- `_notifyModule` — lazy-loaded module reference (null until first `_getNotify()` call)
- `_notifyDegradedSeen` — process-lifetime de-dup flag for "degraded-mode-entered" event
- `_getNotify()` — lazy loader with try/catch
- `_classifyNotifyEvent(result)` — map a decision result → notification event kind+severity
- `_fireNotifyHook(result, contract, decisionKey)` — fire-and-forget hook; never throws, never awaited

**Shared state:**
- `_notifyDegradedSeen`: process-lifetime bool; set once when a degraded-mode event fires. Moves to the new module. Decision-engine.js no longer touches it directly. Behavior is identical: the flag lives in the same Node.js module scope, just in a different file.

**Inbound deps:**
- `./notify` — lazy-required inside `_getNotify()` (stays lazy; no change)
- `./decision-lattice` — needs `getEntry("F1")` for `_classifyNotifyEvent` (new import in the extracted module; duplicates the `_F1` binding from DE.js top-level, isolated to this module)

**Why M5 before M6:** `buildEarlyBlock` (M6) calls `_fireNotifyHook`. To avoid a circular dependency during M6 extraction, M5 must be extracted first so `buildEarlyBlock` can `require` from `notify-engine-hook.js` instead of an in-scope closure.

**Outbound:**
- `buildEarlyBlock` — calls `_fireNotifyHook(result, _earlyBlockContract, result.policyKey)` at line 324
- `buildEarlyReview` — calls `_fireNotifyHook` at line 393
- `decide()` — kill-switch path at line 987, and final at line 2417

**Replay-sensitive:** NO — notification hook is fire-and-forget; `result.notifyAttempted` is an additive field that does not feed `action`, `floorFired`, `decisionSource`, or `irHash`. Does not affect corpus replay.

**Extraction risk:** LOW-MEDIUM — moves process-lifetime flag; must verify `_notifyDegradedSeen` reset is handled in tests that call `_clearCache()`. Notify transport tests mock the module, so refactoring is safe.

**Test coverage today:** `tests/runtime/notify-transport.test.js`, `tests/runtime/notify-scrub.test.js`

---

### M6 — `runtime/early-receipt-builder.js`

**Source lines:** 198–395 (198 lines — harnessInScope, 4 shared state vars, buildEarlyBlock, buildEarlyReview)  
**Functions:**
- `harnessInScope(contract, harness)` — 3-line pure predicate
- `_earlyBlockDegradedDefault`, `_earlyBlockContract`, `_earlyBlockDryRun`, `_earlyBlockF23` — 4 module-level shared state vars
- `buildEarlyBlock(reasonCode, enriched, discovered, input, explanation, extra)` — block receipt + journal + notify
- `buildEarlyReview(reasonCode, enriched, discovered, input, explanation, extra)` — require-review receipt + journal + notify

**Shared state challenge:**  
The 4 `_earlyBlock*` vars are SET by `decide()` at the top of each call and CONSUMED by `buildEarlyBlock`/`buildEarlyReview`. Moving them to the extracted module requires a setter exported from the new module that `decide()` calls at the same points it currently assigns the vars.

**Extraction mechanic:**
```js
// In early-receipt-builder.js (new)
let _earlyBlockDegradedDefault = null;
let _earlyBlockContract = null;
let _earlyBlockDryRun = false;
let _earlyBlockF23 = null;

function setEarlyBlockCtx({ degradedDefault, contract, dryRun }) { … }
function setEarlyBlockF23(v) { _earlyBlockF23 = v; }
function clearEarlyBlockF23() { _earlyBlockF23 = null; }

module.exports = { harnessInScope, buildEarlyBlock, buildEarlyReview,
                   setEarlyBlockCtx, setEarlyBlockF23, clearEarlyBlockF23 };
```

`decide()` in DE.js calls `setEarlyBlockCtx(...)` where it currently assigns the four vars, and calls `setEarlyBlockF23` / `clearEarlyBlockF23` where it currently writes `_earlyBlockF23`. Semantics are identical; only location of state changes.

**Inbound deps:**
- `./decision-journal` → `append`
- `./session-context` → `recordDecision`
- `./floor-codes` → `floorCodeFor`
- `./decision-lattice` → `LATTICE_VERSION`, `getRungByName`
- `./notify-engine-hook` → `_fireNotifyHook` (requires M5 to be extracted first)
- `_irJournalExtras` — either stays in DE.js and is passed as a parameter, OR `_irJournalExtras` is exported from DE.js (circular — BAD), OR it moves to the new module

**_irJournalExtras coupling issue:**  
`_irJournalExtras` is called from both `buildEarlyBlock` (line 294) and `decide()` (line 2359). If both callers are in different files, `_irJournalExtras` needs to be in a third file (or inline-duplicated, or passed as a callback, or moved to `early-receipt-builder.js` with `decide()` importing it back).

Cleanest mechanical approach: move `_irJournalExtras` to `early-receipt-builder.js` and EXPORT it so `decide()` can `require` it from there. This avoids circular imports since `decide()` already requires from other extracted modules.

```js
// early-receipt-builder.js exports _irJournalExtras
module.exports = { …, irJournalExtras };

// decision-engine.js
const { …, irJournalExtras: _irJournalExtras } = require("./early-receipt-builder");
```

**Outbound:**
- `decide()` — every early-return path calls `buildEarlyBlock` or `buildEarlyReview` (20+ call sites); `setEarlyBlockCtx` called once at top of each `decide()` invocation

**Replay-sensitive:** YES — these functions build the receipt for every early-exit path; all receipt fields (action, floorFired, decisionSource) must stay byte-identical

**Extraction risk:** MEDIUM-HIGH — setter pattern for shared state; `_irJournalExtras` circular solution requires careful wiring; must run replay corpus after this PR before pushing

**Test coverage today:** All tests that exercise early-block paths (F1–F26 floors, replay corpus, adversarial tests) implicitly cover `buildEarlyBlock`. No dedicated unit tests for `buildEarlyBlock` itself.

---

## Extraction Ordering (leaf → root, lowest risk first)

| Order | Task | File | Lines | Risk | Notes |
|-------|------|------|-------|------|-------|
| 1 | M1: F24 helpers | `floor-credential-persist.js` | 63 | Low | Smallest, pure, no deps on other candidates |
| 2 | M2: F17 helpers | `floor-cross-agent-lock-eval.js` | 70 | Low | Clean interface, all I/O via stateDir() |
| 3 | M3: F16 helpers | `floor-ambient-authority.js` | 102 | Low-Med | Pure, path normalization has prior hardening |
| 4 | M4: F25+F26 helpers | `floor-mcp.js` | 272 | Low-Med | Largest pure extraction; combined for shared utils |
| 5 | M5: notify hook | `notify-engine-hook.js` | ~50 | Low-Med | Must precede M6; moves _notifyDegradedSeen state |
| 6 | M6: receipt builders | `early-receipt-builder.js` | 198 | Med-High | Shared state setters, _irJournalExtras wiring |

**Total estimated extraction:** ~755 lines  
**DE.js projected after all 6:** ~2422 − 755 + ~25 (new require lines) ≈ **1692 lines** (~30% reduction)

---

## What Stays in `decision-engine.js`

The following code is NOT extracted — it either cannot be or extraction provides no structural benefit:

| Concern | Why it stays |
|---------|-------------|
| LATTICE entry constants (`_F1`–`_TN`) | Used in decide()'s floor cascade AND by buildEarlyBlock via extra.floorFired — would require every call site to pass them; simpler to keep them in the orchestrator |
| Demotion source identifiers | Tightly coupled to decide()'s branching logic; 8 strings, minimal mass |
| `getContract()` | Called in decide() AND the earlyBlock notify path; avoid double-require complexity |
| F19 inline evaluation | No pre-existing helper boundary; output-exfil evaluator is already external (output-exfil.js) |
| F20 inline evaluation | Same — change-intent evaluator is already external (change-intent.js) |
| F23 kill-chain inline | References 3 optional module-level vars (_provenanceGraph etc.) + _earlyBlockF23; extractable in a future sprint after the optional-module-var pattern is rationalized |
| decide() baseline risk cascade | 30+ local variable references; this IS the orchestration body |
| Final result assembly + journal + return | 160 lines tightly referencing every local in decide() |

---

## Guardrails Restatement

- Byte-identical replay on every PR before push (non-negotiable)
- `decide()`'s public signature, export, and entry sequence unchanged
- No refactoring of extracted code's internal logic in same PR
- Zero external dependencies
- Full local gate set: `run-fixtures` + `runtime-core` + `bench-runtime-decision` + `check-version` + `replay-decisions` + `eval-decision-quality`

---

## Status

| Module | Status | SHA | PR |
|--------|--------|-----|-----|
| M1 — floor-credential-persist.js | Planned | — | — |
| M2 — floor-cross-agent-lock-eval.js | Planned | — | — |
| M3 — floor-ambient-authority.js | Planned | — | — |
| M4 — floor-mcp.js | Planned | — | — |
| M5 — notify-engine-hook.js | Planned | — | — |
| M6 — early-receipt-builder.js | Planned | — | — |
