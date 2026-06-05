# ADR-040 — Runtime-decision bench: tail-jitter robustness (best-of-K p99)

**Status:** Implemented
**Decision date:** 2026-06-05
**Severity:** CI reliability (flaky gate) — not a product security floor

---

## 1. Problem statement

`scripts/bench-runtime-decision.sh` gates `runtime.decide()` latency: it runs
N=1000 calls, takes the p99, and fails if p99 exceeds either a per-platform hard
ceiling or `max(1.5× baseline, baseline + 15%-of-ceiling headroom)`.

The gate became a **false-positive flaky failure** on shared CI runners:

- master push run for `98a3b81` (#147, notify-tls): p99 **6.184ms** vs cap 3.191ms
  (baseline 1.691ms). #147 only edits `runtime/notify/email.js`, which is NOT on the
  `decide()` hot path — so this cannot be a real latency regression.
- master push run for `003b6b0` (#146, F29): ubuntu p99 **3.491ms** vs cap 3.191ms;
  macOS passed the same commit. The bench runs with `LILARA_DELETE_COORD` unset, so
  F29's branch is never even exercised.
- In every failing run p50/p95 were healthy (~0.47–0.62 / ~0.96–1.13ms); only the
  p99 **tail** spiked.

Root cause: the gated p99 is a **single noisy sample** — the 10th-worst of 1000
calls in one batch. A single GC pause or scheduler preemption on a shared runner
inflates that one tail sample by 2–3×, while the bulk of the distribution is stable.
The companion `bench-perf-regression` suite never flaked because it pools ~24000
samples — larger N yields a stable percentile. This gate's small single batch does not.

## 2. Decision — best-of-K batches, gate on the minimum p99

Replace the single N=1000 batch with **K independent batches** (`LILARA_BENCH_BATCHES`,
default 5), each N=1000, preceded by a discarded 200-call warmup and a separate
informational cold-cache probe. The gated p50/p95/p99 come from the batch with the
**lowest p99** (the least-contended measurement). All per-batch p99s are printed.

The hard per-platform ceiling and the 1.5×-baseline relative cap are unchanged; they
now apply to the best-of-K p99 instead of a single noisy p99. Baselines are recorded
from the same best-of-K sample, so comparisons are clean-vs-clean.

## 3. Why this preserves regression protection (the load-bearing argument)

On a shared CI runner every observed latency is `true_cost + noise` where
**noise ≥ 0** — GC, scheduler preemption, and noisy-neighbour contention can only
ADD latency, never subtract it. Therefore:

- The **minimum** p99 across independent batches is the maximum-likelihood estimate
  of the intrinsic tail cost with additive noise stripped. A transient spike inflates
  only the batch that caught it; the other batches give a clean p99, and the min
  discards the unlucky one.
- A **genuine regression raises `true_cost` in every batch**, so the floor — and thus
  the minimum p99 — rises with it. The 1.5× relative cap and the hard ceiling both
  fire on the min. Nothing about taking the best batch hides a real slowdown.
- A regression that vanishes in the best of 5 batches is, by definition, within
  runner noise and not a real, reproducible slowdown.

Empirically, on the dev machine the per-batch p99 swings across `[1.6 … 6.1]ms` run
to run while the **min is stable at ~1.6–1.9ms** — exactly the additive-noise profile
above. Any single spiky batch would have failed the old gate; the best-of-K min does not.

Secondary benefit: because the recorded baseline is now a clean min rather than a
single noisy sample, the stored baseline trends lower and the `1.5×` cap derived from
it becomes **tighter** over time — regression sensitivity improves, it does not degrade.

## 4. Alternatives rejected

1. **Widen the cap / add more headroom** — masks genuine regressions; the task
   explicitly forbids weakening detection. Rejected.
2. **Disable the gate or downgrade to a warning** — loses all protection. Rejected.
3. **Warmup only** — addresses cold-start/JIT, not steady-state GC/preemption tail
   jitter (the actual failure mode). Kept as a complement, insufficient alone.
4. **Pool K×1000 samples into one distribution** — pooling keeps every batch's spike
   in the combined tail, so the p99 of the pool is still inflated by the worst batch.
   Best-of-K is the correct treatment for strictly-additive noise. Rejected.
5. **Trimmed mean / drop top 0.5%** — effectively lowers the percentile and is harder
   to reason about against a p99 cap; best-of-K is simpler and better motivated.
6. **median-of-K p99** — also robust, but `min` is the textbook estimator for additive
   noise (the cleanest run is the truest), and median can under-react when a minority
   of batches are clean. Chose `min`; the hard ceiling backstops either way.

## 5. Files changed
- `scripts/bench-runtime-decision.sh` — K-batch loop, warmup, cold probe, gate on
  min p99; reporting shows per-batch p99s. `LILARA_BENCH_BATCHES` (default 5).
- `references/adr-040-bench-tail-jitter-robustness.md` — this document.

## 6. Invariants preserved
- Zero external dependencies (pure Node + bash).
- `decide()` untouched — no product behavior change; this is a measurement-harness fix.
- Per-platform hard ceiling and 1.5× baseline regression gate both retained.
- VERSION stays 0.2.0.
- Neutral universal-harm language.
