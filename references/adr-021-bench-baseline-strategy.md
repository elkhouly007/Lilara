# ADR-021 — Bench-Perf-Regression Baseline Strategy

**Status:** Implemented — 2026-06-03 (quad-track bundle sprint). Option 2 landed via the
trust-boundary audit sprint CI work; key format diverges from the plan below (see
**Implementation note** at the end).  
**Area:** `scripts/bench-runtime-decision.sh`, `tests/perf/bench.js`, `.github/workflows/check.yml`  
**Scope:** how to seed and persist the per-platform baseline that the 1.5× regression gate uses.

---

## Problem

The performance regression gate (in `bench-runtime-decision.sh` and `tests/perf/bench.js`) compares
the current run's p99 against a stored baseline — but only if the baseline file exists:

```js
if (baseline && baseline[platformKey] && baseline[platformKey].p99) {
  // 1.5× gate runs here
} else {
  console.log(`  info    no baseline for ${key}; recording fresh baseline`);
  // Only the coarse platform p99 ceiling (500ms/5ms) enforces
}
```

In clean CI environments (new runner, first run on a branch, cache miss), there is no
`artifacts/bench/baseline.json` — the 1.5× regression detection is **silently skipped**. A
genuine 2× regression slips through on a cache miss, caught only by the coarse ceiling (which is
set at 500ms on Windows / 5ms on Linux — far above the warm-engine p99 of ~1ms on Linux).

**Evidence:**
- `bench-runtime-decision.sh:134-162`: the entire regression block is inside
  `if (baseline && baseline[platformKey] && baseline[platformKey].p99)`.
- `tests/perf/bench.js:198-200`: same — "no baseline; recording fresh baseline" is the silent skip.
- PR #92 widened the variance-floor headroom 0.1×→0.15× to reduce noise-floor false alarms, but
  that change only affects runs **with** a baseline — it doesn't help clean-env skips.
- `scripts/bench-ir.js:215` uses `0.15×` headroom (fixed in the same PR #92 batch; the
  "Track B ride-along" noted here was resolved; confirmed by live read 2026-06-03).

**What the existing design already handles:**
- **Platform-keyed baselines:** `platformKey` = `${process.platform}-${nodeMajor}` (or
  `${process.platform}-slowfs-${nodeMajor}` for WSL/mnt). Different platforms never cross-trigger.
- **CommitSha lineage guard** (`bench-runtime-decision.sh:151-158`): if the stored baseline's
  `commitSha` is not an ancestor of HEAD (stale cache from a sibling branch, rebase, or
  restore-key overshoot), the gate is skipped — safe against stale-cache false regressions.
- **3× divergence anti-spike guard** (`bench-runtime-decision.sh:170-172`): if the new p99 is 3×
  above the prior baseline, the baseline is NOT updated — FS-context drift guard.

---

## Options

### Option 1 — Commit a static baseline.json

Commit `artifacts/bench/baseline.json` (one entry per platform) to the repository.

**ROI:** low. Committing is simple but the stored `commitSha` would be the commit that shipped the
file — a fixed ancestor of every future PR. The lineage guard at
`bench-runtime-decision.sh:151-158` would SKIP the gate when `baseSha && !isAncestorOrSame(baseSha, headSha)` is... wait, actually `isAncestorOrSame` returns true when baseSha is an ancestor of HEAD (which a committed baseline always is). So the lineage guard would NOT skip.

**Problem:** hardware variance. A baseline recorded on one runner (say a fast CI machine)
over-constrains runs on slower runners. The existing adaptive record step would overwrite the
committed baseline on first run — making the commit ephemeral. More importantly, the `baseline.json`
would need to be updated every time decide() gets a structural performance change, creating
maintenance toil. If the committed baseline is stale by >3× (divergence guard), it never updates —
permanent skip.

**Verdict:** lowest engineering cost but fights the design. Not recommended as sole strategy.

### Option 2 — CI-cache record-on-master + fetch-on-PR (RECOMMENDED)

On every master push, run the bench, record `artifacts/bench/baseline.json` to the GitHub Actions
cache (keyed `bench-baseline-${{ runner.os }}-${{ matrix.node }}-${{ github.sha }}`). On PR
runs, restore with a prefix-key (e.g. `bench-baseline-${{ runner.os }}-${{ matrix.node }}-`)
so the most recent master baseline is fetched.

**How it hooks:**
- `.github/workflows/check.yml` — add an `actions/cache` restore step before the bench step
  (restore-keys prefix-match), and a save step after master merge (only on `refs/heads/master`).
  The bench scripts already write `artifacts/bench/baseline.json` on a clean run — CI cache
  just persists it.
- No code changes to bench scripts needed (they already handle the missing-baseline gracefully).

**ROI:** high. Baseline is always from a recent master run on the same runner class → comparable
hardware. The commitSha lineage guard prevents a restored baseline from over-constraining a
rebased PR (the guard already handles restore-key overshoot). First PR on a new runner class
gracefully skips (no cache miss downgrade — same behavior as today, but now it's the exception
not the rule).

**FP risk:** low. CommitSha lineage guard catches stale cache. 3× divergence guard prevents
a one-off spike from poisoning the baseline. Restore-key prefix-match means a PR always gets
the most recent master baseline for the same platform/node.

**Tradeoffs:**
- Requires a new `actions/cache` block in the CI workflow — new workflow surface.
- On the very first run after cache eviction (7-day GitHub cache TTL with no activity) or a new
  platform/node matrix entry, one PR silently skips the gate — acceptable, identical to today.
- Cache key design must be stable: changing the key format invalidates all baselines.

### Option 3 — Per-runner adaptive baseline with explicit invalidation

Record the baseline on the runner itself (no external store). Accept that every runner starts
fresh; treat the first run as a warm-up and the second+ as gated. Add a `LILARA_BENCH_INVALIDATE`
env var that operators can set to force a re-baseline.

**ROI:** medium. Eliminates CI-cache dependency but means every cold runner re-runs ungated.
For a public repo with ephemeral runners, "second run" may never happen in PR context — the gate
only runs consistently in long-lived self-hosted runner setups.

**Verdict:** best for self-hosted persistent runners; worst for GitHub Actions ephemeral runners.

---

## Recommendation (for implementation, pending approval)

**Option 2 — CI-cache record-on-master + fetch-on-PR.**

### Implementation plan (after approval)

1. **`.github/workflows/check.yml`** — add two steps to the bench job:
   ```yaml
   - name: Restore bench baseline (prefix-key)
     uses: actions/cache@v4
     with:
       path: artifacts/bench
       key: bench-baseline-${{ runner.os }}-node${{ matrix.node }}-${{ github.sha }}
       restore-keys: |
         bench-baseline-${{ runner.os }}-node${{ matrix.node }}-

   # ... existing bench step ...

   - name: Save bench baseline (master only)
     if: github.ref == 'refs/heads/master'
     uses: actions/cache/save@v4
     with:
       path: artifacts/bench
       key: bench-baseline-${{ runner.os }}-node${{ matrix.node }}-${{ github.sha }}
   ```
2. **`tests/perf/bench.js`** — same cache structure for the corpus-flow bench:
   Same restore/save pattern on `artifacts/perf`.
3. **Documentation** — update `README.md` or a new `docs/bench-baseline.md` explaining the
   cache strategy, key format, and how to manually invalidate (change the `restore-keys` prefix).

### Where NOT to touch (out of scope)
- `bench-runtime-decision.sh` core logic — already correct.
- `tests/perf/bench.js` baseline logic — already correct.
- `scripts/bench-ir.js` headroom inconsistency — addressed separately (Track B ride-along).

---

## FP analysis

The change can only cause a **false alarm** (the gate fires on a true regression) or a **false
pass** (the gate misses a true regression):
- **False alarm:** the restored baseline is from a significantly faster run (e.g. the previous
  master run happened on a fresh warm runner). Mitigated by: the 1.5× cap + 0.15× headroom
  multiplier + the 3× divergence guard (prevents catastrophic spikes from over-constraining).
  Net FP risk: **low**.
- **False pass (silent skip):** cache miss on the first PR for a new platform/node. Same as
  current behavior — not a regression relative to today.
- **No impact on eval/replay/fixture:** performance-only gate, never changes `decide()` outputs.

---

## Consequences

- **Implemented (Option 2 landed):** CI-cache restore/save steps exist in
  `.github/workflows/check.yml` (lines 180-212). No code changes to bench scripts needed.
- **No runtime behavior changes from this document.**

---

## Implementation note (2026-06-03)

Option 2 was implemented during the trust-boundary audit sprint as part of the CI hardening
work, before this ADR was formally approved. The implementation diverges from the proposed
key format in two ways:

| | ADR proposal | Actual implementation |
|---|---|---|
| Cache key | `bench-baseline-${{ runner.os }}-node${{ matrix.node }}-${{ github.sha }}` | `bench-baseline-${{ matrix.os }}-${{ github.sha }}` |
| Save guard | `if: github.ref == 'refs/heads/master'` | `if: always()` |

**Key format:** The implemented key omits the node-version component. This is safe because the
bench scripts already key baseline entries internally by `${platform}-${nodeMajor}` within the
JSON file — a single cache file per OS contains all per-node entries. The node version in the
cache key would create separate caches per node version (redundant given the internal key).

**Save guard:** `if: always()` saves the baseline even on failed runs. This is intentional:
if the bench PASSES but a later step fails, the baseline should still be persisted for future
PR comparisons. A saved baseline from a failing run is still a valid performance reference; the
regression gate on the next run will catch any genuine degradation.

**Cross-commit reuse (confirmed):** The key `bench-baseline-${{ matrix.os }}-${{ github.sha }}`
is per-commit by design — each run saves its own baseline under its SHA. Cross-commit reuse is
enabled by `restore-keys: bench-baseline-${{ matrix.os }}-` (line 185 in `check.yml`), which
prefix-matches the most recent prior baseline for the same OS regardless of SHA. Without this
`restore-keys` line the cache would be per-commit-useless; with it, every PR run restores the
most recent master baseline and the regression gate fires as intended.
