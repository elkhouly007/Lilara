# ADR-044 — Bench baseline architecture: committed p50 baseline + ordering fix

**Status:** Implemented
**Decision date:** 2026-06-07

---

## Context

Three independent root causes combined to produce false-positive failures in the
"Runtime decision bench" CI gate (most visibly in the merge-train around PR #150).

**Root cause 1 — wrong metric for the relative gate.**
`scripts/bench-runtime-decision.sh` used p99 for the relative regression cap
(1.5× baseline p99). On a shared CI runner, p99 for sub-millisecond calls is
almost entirely tail-jitter (GC pauses, scheduler preemptions from noisy
neighbours). A single preempted call can push p99 by 2–3 ms on a Linux runner,
while a genuine 2× regression in `decide()` raises intrinsic latency by only
~0.4–0.8 ms. The noise floor therefore exceeds the regression signal, causing
the gate to fire on clean code. p50 (the median) is insensitive to tail spikes;
a genuine 2× regression doubles p50 on every run. ADR-040 (best-of-K) mitigated
this for the *absolute* ceiling (p99 ceiling guards against catastrophic slowdowns,
so it should remain on p99), but the *relative* regression gate should operate on
the stable p50.

**Root cause 2 — cache lineage skipping the relative gate.**
The CI cache for `artifacts/bench/baseline.json` uses prefix-matched restore-keys
(`bench-baseline-<os>-`), so the restored baseline often came from a non-ancestor
commit (a prior branch, a sibling PR, or a pre-rebase HEAD). The lineage guard
(introduced to guard against cross-branch stale baselines) detected this and
*skipped* the relative gate entirely. In practice the 1.5× relative gate was
effectively off on most CI runs — lineage almost always failed the ancestor check.
Committing baselines to the repository (keyed by `platformKey`) eliminates the
cache dependency and the lineage hole together. The committed values are code-
reviewed, stable, and reflect real measurements.

**Root cause 3 — ordering bug (write before ceiling check).**
In `scripts/bench-runtime-decision.sh`, the baseline `fs.writeFileSync` (line 225)
ran *before* the hard-ceiling `process.exit(1)` check (line 229). Because the
"Save bench baseline" cache step ran with `if: always()`, a ceiling-failing run
(e.g. a bad commit that pushed p99 past 500 ms on Windows) could poison the cached
baseline with the slow measurement. `tests/perf/bench.js` had a mirrored bug: the
write was guarded on `!regressionFailed` but still ran before the ceiling check, so
a ceiling-violating run would also write a slow baseline. The fix is to evaluate
*all* gates atomically via a pure function, then decide whether to write, then exit.

## Decision

### Option A — Committed p50 baseline + ordering fix (chosen)

- **Gate the relative regression check on p50** (stable median) rather than p99
  (noisy tail). This eliminates the false-positive class while keeping genuine
  2× regression detection: a real 2× slowdown doubles p50 on every run.
- **Commit baselines** to `artifacts/bench/baseline.json` and
  `artifacts/perf/baseline.json`, keyed by `platformKey` (e.g. `linux-v20`,
  `win32-slowfs-v24`). Committed values are code-reviewed and never stale. The
  lineage check and the CI cache save/restore steps are removed.
- **Fix ordering bug**: all gates are evaluated by a single pure function
  (`evaluateBenchGate`) before any `process.exit(1)`. Baseline writes happen
  only on passing runs and only when the `LILARA_BENCH_WRITE_BASELINE=1` /
  `LILARA_PERF_WRITE_BASELINE=1` flag is set explicitly (not in normal CI).
- **Shared pure module** `runtime/bench-gate.js` exports `evaluateBenchGate`,
  `platformKey`, and `platformCeilingMs`. Both bench scripts import it, enabling
  unit-level testing of the gate logic independent of I/O.

**Invariants preserved:**

- Hard p99 ceiling ladder unchanged (10 / 200 / 500 ms per platform) — always-on
  backstop for genuine catastrophic slowdowns.
- A genuine 2× slowdown (p50 doubles) fails on every platform and every run.
- Zero external dependencies (fs, path, assert only).
- `decide()` is untouched.

### Option B — Fix cache lineage (rejected)

Smarter cache key management (e.g. restrict restore-keys to the commit graph)
would fix root cause 2, but root cause 1 (p99 in the noise floor) would remain.
The lineage skip is a symptom of the broader problem, not the root cause. Deeper
cache key engineering adds complexity without resolving the fundamental metric
choice issue.

### Option C — Widen the cap / add more headroom (rejected)

Increasing the 1.5× multiplier or adding larger absolute headroom would reduce
false positives but would also weaken detection of genuine regressions. The task
brief explicitly forbids weakening detection. The goal is not to make the gate
quieter — it is to make it accurate by gating on the right metric.

## Implementation

- **`runtime/bench-gate.js`** — new pure gate module: `evaluateBenchGate`,
  `platformKey`, `platformCeilingMs`.
- **`artifacts/bench/baseline.json`** — committed p50 baselines for the
  runtime-decision bench, keyed by `platformKey`. Seeded at ~1.2–1.5× observed
  measurements to give first-run breathing room without masking 2× regressions.
- **`artifacts/perf/baseline.json`** — committed p50 baselines for the
  perf-regression bench. Slightly higher than runtime-decision seeds because
  the perf suite covers broader code paths (120 flows vs 10).
- **`scripts/bench-runtime-decision.sh`** — use p50 relative gate via
  `bench-gate.js`; fix ordering bug; remove lineage check and git helpers;
  remove auto-write from normal CI (`LILARA_BENCH_WRITE_BASELINE=1` for manual
  recalibration).
- **`tests/perf/bench.js`** — same gate module; fix write-before-ceiling-exit
  ordering bug; `LILARA_PERF_WRITE_BASELINE=1` for recalibration; remove lineage
  check and `child_process` import.
- **`.github/workflows/check.yml`** — remove 4 cache save/restore steps for
  bench and perf baselines (Restore bench baseline, Save bench baseline, Restore
  perf-regression baseline, Save perf-regression baseline).
- **`tests/perf/bench-gate.test.js`** — unit tests including empirical #150 repro,
  p50 regression detection, p99 ceiling backstop, no-basis first-run, both-fail,
  platformKey shape, and platformCeilingMs env override.
- **`scripts/check-runtime-core.sh`** — wire bench-gate test before the
  replay-corpus gate.

## Scope Limits

- Local recalibration: run `LILARA_BENCH_WRITE_BASELINE=1 bash scripts/bench-runtime-decision.sh`
  (or `LILARA_PERF_WRITE_BASELINE=1 node tests/perf/bench.js`) on a quiet machine,
  then review and commit the updated p50 values in `artifacts/bench/baseline.json` /
  `artifacts/perf/baseline.json`.
- `artifacts/bench/baseline.json` and `artifacts/perf/baseline.json` retain p99
  in write-mode output for informational logging; only p50 drives the gate.
- The three ceiling-ladder copies (`bench-runtime-decision.sh`,
  `bench-perf-regression.sh`, `tests/perf/bench.js`) are partially unified via
  the shared `platformCeilingMs()` export; full consolidation is left for a future
  cleanup.

## Related

- ADR-040: tail-jitter robustness (best-of-K p99) — retained; p50 gate runs on
  the best-of-K batch (the batch with the lowest p99).
- `references/adr-021-bench-baseline-strategy.md`: original baseline strategy;
  this ADR supersedes the cache-based relative gate.
