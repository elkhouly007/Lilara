# Runtime Test Coverage Triage — 2026-06-01

**Phase 1 — Investigation only.**
All 39 `tests/runtime/*.test.js` files were run in isolation with real exit codes.
No code changes made. Khouly approves which reds to fix before any Phase-2 work.

---

## Methodology

| Parameter | Value |
|---|---|
| Invocation | Gate-faithful hybrid: `node <file>` for 38 plain-assertion scripts; `node --test <file>` for `change-intent.test.js` (the only `node:test` consumer) |
| Isolation | Fresh `mktemp -d` per file; `HOME=<tmp> LILARA_STATE_DIR=<tmp> LILARA_DECISION_JOURNAL=0` |
| Gate baseline | `bash scripts/check-runtime-core.sh` → EXIT:0 (all 10 WIRED files pass) |
| Node version | v24.15.0 |
| Branch | master @ 445e99a (v0.1.6) |
| Working tree | Two pre-existing mods (`.claude/settings.local.json`, `references/adr-020-…md`); neither touched by this triage |

---

## Inventory (all 39 files)

| File | Status | Wired |
|---|---|:---:|
| ambient.test.js | PASS | |
| ambient-adversarial-replay.test.js | PASS | |
| ambient-floor.test.js | PASS | |
| ambient-receipt-enrichment.test.js | PASS | |
| ambient-traversal-normalization.test.js | PASS | |
| change-intent.test.js | PASS | |
| coaching-envelope.test.js | PASS | |
| collect-text.test.js | PASS | ✓ |
| command-normalize.test.js | PASS | |
| compaction-survival.test.js | **FAIL-STALE-FIXTURE** | |
| cross-agent-lock.test.js | PASS | |
| degraded-mode.test.js | PASS | |
| dogfood-config.test.js | PASS | ✓ |
| eval-runner.test.js | PASS | ✓ |
| floor-codes.test.js | **FAIL-REGRESSION** | |
| git-history-scanner.test.js | PASS | |
| journal-chain.test.js | PASS | |
| markdown-link-scan.test.js | PASS | ✓ |
| mcp-floor-adversarial.test.js | PASS | ✓ |
| mcp-pin.test.js | PASS | ✓ |
| notify-scrub.test.js | PASS | |
| notify-transport.test.js | **FAIL-STALE-FIXTURE** | |
| output-exfil.test.js | PASS | |
| post-adapter-harness-payloads.test.js | PASS | ✓ |
| post-adapter-mcp-injection.test.js | PASS | ✓ |
| protected-branch-gating.test.js | PASS | ✓ |
| receipt-export.test.js | PASS | |
| receipt-redaction.test.js | PASS | |
| receipt-schema.test.js | PASS | |
| sandbox-dry-run.test.js | PASS | |
| sarif-export.test.js | PASS | |
| session-memory.test.js | **FAIL-STALE-FIXTURE** | |
| session-resume.test.js | PASS | ✓ |
| skill-scorer.test.js | PASS | |
| snapshot.test.js | PASS | |
| spend-estimator.test.js | PASS | |
| state-bundle.test.js | PASS | |
| vcs-adapter.test.js | PASS | |
| workflow-enforcer.test.js | PASS | |

**Counts:** PASS 34 (incl. 10 WIRED) · FAIL-STALE-FIXTURE 3 · FAIL-REGRESSION 1 · OBSOLETE 0

---

## Per-FAIL Detail

### 1. `compaction-survival.test.js` — FAIL-STALE-FIXTURE

**Failing assertion (exact stderr):**
```
FAIL PATTERNS has 7 entries: Expected values to be strictly equal:
8 !== 7
AssertionError [ERR_ASSERTION] at compaction-survival.test.js:45
```

**What passed:** 23 of 24 tests pass (all CS-001–CS-006 match, all fixtures, all helpers).

**Root-cause hypothesis:**
PR #62 (`b3fb112`) introduced the module with 7 patterns (CS-001–CS-007) and wrote the test
asserting `PATTERNS.length === 7`. PR #68 (`4822c15`, "7 v0.2.0 blocker fixes") added `CS-008`
to `runtime/compaction-survival.js` but did not update the test's count. The production
module is at 8 patterns; the test fixture is stale at 7.

**Recommended action:** Fix test fixture — bump assertion from 7 to 8 and add a spot-check
for CS-007 and CS-008 IDs (neither test was added when they were introduced).

---

### 2. `floor-codes.test.js` — FAIL-REGRESSION

**Failing assertion (exact stderr):**
```
FAIL no two distinct floor numbers share a code value:
Two different codes share the same floor number '23':
'F23_DATA_FLOW_KILL_CHAIN' vs 'F23_MCP_RESULT_INJECTION'
AssertionError [ERR_ASSERTION] at floor-codes.test.js:68
```

**What passed:** 6 of 7 tests pass (frozen check, format check, null-guard, spot-checks,
reachability, decision-engine code field).

**Root-cause hypothesis:**
PR #70 (`d2d3f98`, "Deep MCP security layer") registered `mcp-result-injection` →
`F23_MCP_RESULT_INJECTION` in `runtime/floor-codes.js`. The PR commit message says it was
intended as an "F23b sub-signal" and the comment in the source file explicitly labels the
section `// ── F23b mcp-result-injection (ADR-017 extension)`. However the code value was
written as `F23_MCP_RESULT_INJECTION` (no `B` suffix), which is numerically indistinguishable
from `F23_DATA_FLOW_KILL_CHAIN`. The uniqueness invariant in the test uses regex
`F([0-9]+[A-Z]?)` — `F23B_MCP_RESULT_INJECTION` would extract floor `23B` and pass;
`F23_MCP_RESULT_INJECTION` extracts `23` and collides. The test is correct; the production
code value is wrong.

**Recommended action:** Fix production code — rename `F23_MCP_RESULT_INJECTION` →
`F23B_MCP_RESULT_INJECTION` everywhere in `runtime/floor-codes.js` (and any callers that
reference the string literal). This matches the ADR-017 intent documented in the comment.

---

### 3. `notify-transport.test.js` — FAIL-STALE-FIXTURE

**Failing output (exact stderr):**
```
Error: read ECONNRESET
    at TCP.onStreamRead (node:internal/stream_base_commons:216:20)
Emitted 'error' event on Socket instance
```
Process crashes with EXIT:1.

**What passed:** 6 of the test's cases emit `ok` (4 discord, 2 slack). The crash occurs
during or after the SMTP mock server section of the test.

**Root-cause hypothesis:**
The mock TCP/SMTP server (used in the "email" tests) creates `net.createServer((sock) => {...})`
but never attaches a `sock.on('error', () => {})` error handler to the accepted socket. When
the transport closes the connection (QUIT / timeout path), the server-side socket can receive a
TCP RST and emits an unhandled `error` event. In Node v24 this propagates as an uncaught
exception and crashes the process. Identical pattern in the "socket timeout enforced" test
(`net.createServer(() => { /* never reply */ })` — no socket error handler). Production
`runtime/notify/email.js` is not involved; the fault is in the mock infrastructure.

**Recommended action:** Fix test fixture — add `sock.on('error', () => {})` to each
`net.createServer` callback socket in `notify-transport.test.js`. No production code change.

---

### 4. `session-memory.test.js` — FAIL-STALE-FIXTURE

**Failing assertion (exact stderr):**
```
FAIL search with empty query returns top-k by recency
     Expected values to be strictly equal:
'beta' !== 'gamma'
```

**What passed:** 7 of 8 tests pass (addFact, listFacts, pruneExpired, keyword search,
consolidate, consolidate dry-run, tokenise).

**Root-cause hypothesis:**
The failing test adds three facts ("alpha", "beta", "gamma") with sequential `addFact` calls
and then calls `search("", { topK: 2 })`, expecting "gamma" (most recently added) as the first
result. A live repro confirms that `beta` and `gamma` are assigned **identical millisecond
timestamps** (`2026-06-01T11:55:15.946Z` in the repro run) because modern hardware executes
both `addFact` calls within the same millisecond. The `memory-search` empty-query code path
sorts by timestamp descending, but a stable sort is not guaranteed for equal values. The test
assumption that three sequential writes produce distinct ms timestamps is stale; it held on
slower hardware (or older Node) but fails reliably on v24.

**Recommended action:** Fix test fixture — either inject explicit distinct timestamps into
the three facts, or add a small `await` gap between writes to guarantee distinct ms values.
No production code change needed (the recency-sort logic in `memory-search.js` is correct).

---

## Totals

| Category | Count | Files |
|---|---|---|
| PASS (ungated) | 25 | see inventory |
| PASS (WIRED) | 10 | see inventory |
| FAIL-STALE-FIXTURE | 3 | compaction-survival, notify-transport, session-memory |
| FAIL-REGRESSION | 1 | floor-codes |
| OBSOLETE | 0 | — |

**PASS total: 35/39 · FAIL total: 4/39**

---

## Surprises and Methodology Notes

1. **`node:test` vs plain-assertion split:** Only `change-intent.test.js` uses the real
   `node:test` framework (`require("node:test")`). All other 38 files use a homegrown
   `function test(name, fn){ try{ fn(); passed++ } catch { failed++ } }` pattern and rely
   on `process.exit(1)` at the bottom. The gate (`check-runtime-core.sh`) runs them all with
   bare `node`. Running any of the 38 under `node --test` would not register their assertions
   as runner tests and would silently pass empty suites.

2. **Count tracking bug in the runner script:** The initial triage runner had a display-only
   bug in the per-file status echo (grepped the beginning of the accumulating log, not the
   latest entry), causing all files to show "done (exit 0)" in console output. The actual
   exit codes in the structured log file were correct; parsing them revealed the 4 failures.
   No data integrity issue — just misleading live console output.

3. **Zero OBSOLETE findings:** All 39 files successfully load their target modules, find
   their required exports, and run at least some assertions. No orphaned tests detected.

---

## Recommended Phase-2 PR Structure

**Finding size:** 4 failures — 1 FAIL-REGRESSION (production code) + 3 FAIL-STALE-FIXTURE
(test-only fixes) + gate wiring for 29 ungated files.

Given the mixed categories, a **two-PR approach** is recommended:

### PR A — Test fixtures + production regression fix (1–2 files changed)
Fixes the 4 red tests in a single atomic PR:
- `runtime/floor-codes.js` — rename `F23_MCP_RESULT_INJECTION` → `F23B_MCP_RESULT_INJECTION`
  (FAIL-REGRESSION; the only production code change in the entire batch)
- `tests/runtime/compaction-survival.test.js` — bump `7` → `8`, add CS-007/CS-008 id checks
- `tests/runtime/notify-transport.test.js` — add `sock.on('error', () => {})` to TCP mock sockets
- `tests/runtime/session-memory.test.js` — guarantee distinct timestamps in the recency test

All 4 fixes are small and isolated. Including the floor-codes production fix here (rather than
a separate PR) is safe because the rename is a pure code-value rename with no semantic change
to the floor's behavior — it only corrects the F-number namespace collision.

### PR B — Gate wiring (scripts/check-runtime-core.sh + script preamble)
Wire all 29 currently ungated files into `check-runtime-core.sh`. After PR A lands and all
39 tests pass, wire them. This is a separate PR because:
- It will bump the `pass` count in CI output (doc-only readers notice)
- Keeping the wiring orthogonal to the fixes makes the gate diff easy to review
- If any file needs further investigation before wiring (e.g., timing sensitivity on CI),
  it can be held back without blocking the others

**One-PR option:** If Khouly prefers, PRs A and B can be combined into a single
"fix + wire" PR. The 4 fixes are all small; 29 gate-wiring lines in one script is
manageable. Recommend the two-PR split only because the production code rename in
`floor-codes.js` deserves its own review cycle.
