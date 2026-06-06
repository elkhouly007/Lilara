# ADR-043 — Provenance Taint Engine Unit-Test Coverage

**Status:** Implemented

---

## Context

`runtime/provenance-graph.js` (438 lines) and `runtime/provenance-correlator.js` (68 lines)
are the two pure-function modules that drive the F23 kill-chain and F28 taint-egress floors.
Both are decision-influencing: `provenance-graph.evaluate()` produces the chain detection
result that `decide()` uses to fire F23 or F28 (ESCALATE/BLOCK), and
`provenance-correlator.correlate()` is the token-overlap detection kernel behind the F28
taint correlation (`taint.js` calls it).

Before this ADR:
- `provenance-graph.js`: only 2 helpers (`pathHash`, `tokenHashSet`) were exercised indirectly
  via imports in `tests/taint-egress-floor.test.js`. The 5 decision-critical exports
  (`overlapScore`, `classifyPathSensitivity`, `classifySink`, `evaluate`,
  `findPropagationSource`) had zero direct test coverage.
- `provenance-correlator.js`: **zero test references** in the entire test suite. This was
  the weakest coverage on decision-influencing code in the repository.

Both modules are pure (zero I/O, `require("crypto")` only), making them immediately
testable without any state-dir or require-cache scaffolding.

---

## Decision

Add direct unit tests for both modules. No runtime code changes — test-only.

### Why dedicated files rather than adding to `taint-egress-floor.test.js`

The taint-egress floor test is an integration test that verifies the full
F28 predicate + grant-suppression pipeline. Adding 60+ unit assertions there
would dilute the integration test's focus, grow it too large to scan quickly,
and make the provenance-graph coverage invisible to `check-runtime-core.sh`
(it would still show a single pass line). Dedicated files clarify ownership
and allow targeted "just the pure engine" regression runs.

---

## Scope Limits

- `classifyPathSensitivity` in `provenance-graph.js` returns `"high"|"low"` only.
  The similarly-named function in `claude/hooks/hook-utils.js` returns
  `"high"|"medium"|"low"`. They are distinct — do not confuse their test fixtures.
- The full-command substring check in `provenance-correlator.correlate()` fires before
  per-token extraction. Flag-style token filtering (`/^-{1,2}[a-z]/i`) only applies to
  the per-token phase; a short command that is itself a flag substring may still trigger
  the full-command arm.

---

## Implementation

**`tests/runtime/provenance-graph.test.js`** (42 tests)
- `tokenHashSet`: empty/non-string, short tokens, stopwords, 12-hex format, dedup, determinism, char class.
- `pathHash`: null/empty, format, Windows backslash normalization, case-insensitive, ~/expansion.
- `classifyPathSensitivity`: ssh/aws/env → high; normal → low; non-string → low; only high|low.
- `overlapScore`: empty, non-array, identical (Jaccard=1), disjoint, partial (correct Jaccard).
- `classifySink`: null, persistence-write, file-exec, network-send, exempt registry, @file refs, priority.
- `evaluate`: empty graph, staged-exfil structural, staged-exfil content-overlap, injection-to-exec, persistence, exempt target.
- `findPropagationSource`: empty/short hashes, empty graph, match, no-overlap.

**`tests/runtime/provenance-correlator.test.js`** (19 tests)
- Guard cases: empty/null command, empty/null/non-array reads.
- Full-command match: substring found → `command-in-external-read` + correct source.
- Token match: `command-token-in-external-read` + `matchedToken` field.
- No match: `{ tainted: false }`.
- Flag filtering: `--flag` / `-x` tokens are not extracted for per-token comparison.
- Short tokens: below MIN filtered in per-token phase (full-command check independent).
- minTokenLength override: clamped 4–32; values outside range use default 6.
- Multiple reads: match in non-first read returns that read's source; first match stops iteration.
- Empty-content read: skipped.

Both files wired into `scripts/check-runtime-core.sh`. No `check-counts.sh` change needed
(test files are not counted by the gates; no new `*.input` fixtures added).

---

## Related

- ADR-037 (F28 taint-egress, the consumer of provenance-graph.evaluate)
- ADR-017 (F23 kill-chain, the other consumer)
- `tests/taint-egress-floor.test.js` (integration test — not replaced, still runs)
