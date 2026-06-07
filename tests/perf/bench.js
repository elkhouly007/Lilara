"use strict";
// Phase 0 task 0.12 - p99 regression guard.
// Runs iterations against each flow in tests/perf/corpus.js.
// Asserts the global p99 stays under the platform ceiling and the global p50
// stays within 1.5× the committed per-platform p50 baseline (ADR-044).
//
// ADR-044 changes vs original:
//   - Gate relative regression on p50 (stable median), NOT p99 (noisy tail).
//   - Baselines are committed in artifacts/perf/baseline.json (no CI cache).
//   - Ordering fix: evaluate ALL gates before any process.exit(1).
//   - Baseline auto-write removed from normal CI; use LILARA_PERF_WRITE_BASELINE=1
//     for manual recalibration (run passes to write).
//
// Differences vs scripts/bench-runtime-decision.sh:
//   - This suite is broader (120 flows × 200 iter vs 10 × 1000) —
//     designed to catch p99 regressions in *less-hot* code paths
//     (intent classifier, posture overrides, payload-class branches,
//     ambient-path checks, etc.) that the smaller hot bench can miss.
//   - Reports per-tool p99 to surface any tool-specific regressions.
//
// Run:  node tests/perf/bench.js
// Env:  LILARA_PERF_P99_MS           - override p99 ceiling (ms)
//       LILARA_PERF_ITER              - override iterations per flow (default 200
//                                      for CI; spec calls for 1000 - run manually
//                                      with LILARA_PERF_ITER=1000 for full sweep)
//       LILARA_PERF_SUITE_BUDGET_S   - override suite wall-clock budget (s)
//       LILARA_STATE_DIR             - override state dir (recommend mktemp)
//       LILARA_PERF_WRITE_BASELINE=1 - update artifacts/perf/baseline.json after a
//                                      passing run (review and commit the result)

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const corpus = require("./corpus.js");
const { evaluateBenchGate, platformKey: mkPlatformKey, platformCeilingMs } = require(path.join(root, "runtime", "bench-gate.js"));

if (!process.env.LILARA_STATE_DIR) {
  process.env.LILARA_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-perf-"));
}
const { decide } = require(path.join(root, "runtime", "decision-engine.js"));

const ITER = Number(process.env.LILARA_PERF_ITER || 200);

// Suite wall-clock budget mirrors the platform ladder: Linux/macOS runners
// complete 24K samples in ~200s, but Windows runners observe a ~5x IO
// multiplier (same shape as the p99 ladder). Hard-budgeting Windows at 300s
// produced false-positive failures even when p99 was well within ceiling.
function suiteBudgetSec() {
  if (process.env.LILARA_PERF_SUITE_BUDGET_S) return Number(process.env.LILARA_PERF_SUITE_BUDGET_S);
  return platformCeilingMs("LILARA_PERF_P99_MS") === 500 ? 900 : 300;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)));
  return sorted[idx];
}

function fmt(n) {
  return Number(n).toFixed(3);
}

function run() {
  const ceiling = platformCeilingMs("LILARA_PERF_P99_MS");
  const slow = ceiling === 500;
  const key = mkPlatformKey(slow);
  const startWall = Date.now();
  console.log(`[perf-regression]`);
  console.log(`  platform: ${key}  node: ${process.version}`);
  console.log(`  flows: ${corpus.length}  iter/flow: ${ITER}  ceiling: ${ceiling}ms`);

  const allLatencies = [];
  const perTool = {};

  // Warm-up pass (stabilize V8 inlining, JIT, module-cache hits).
  for (const input of corpus) decide(input);

  for (const input of corpus) {
    const tool = input.tool || "unknown";
    if (!perTool[tool]) perTool[tool] = [];
    for (let i = 0; i < ITER; i++) {
      const start = process.hrtime.bigint();
      decide(input);
      const end = process.hrtime.bigint();
      const ms = Number(end - start) / 1e6;
      allLatencies.push(ms);
      perTool[tool].push(ms);
    }
  }

  allLatencies.sort((a, b) => a - b);
  const p50 = quantile(allLatencies, 0.50);
  const p95 = quantile(allLatencies, 0.95);
  const p99 = quantile(allLatencies, 0.99);
  const p999 = quantile(allLatencies, 0.999);
  const max = allLatencies[allLatencies.length - 1];

  const elapsedSec = (Date.now() - startWall) / 1000;
  console.log(`  N=${allLatencies.length}  p50=${fmt(p50)}ms  p95=${fmt(p95)}ms  p99=${fmt(p99)}ms  p99.9=${fmt(p999)}ms  max=${fmt(max)}ms  elapsed=${fmt(elapsedSec)}s`);

  console.log(`  per-tool p99:`);
  for (const tool of Object.keys(perTool).sort()) {
    const sorted = perTool[tool].slice().sort((a, b) => a - b);
    console.log(`    ${tool.padEnd(12)} N=${sorted.length}  p99=${fmt(quantile(sorted, 0.99))}ms`);
  }

  // Read committed baseline from artifacts/perf/baseline.json (ADR-044).
  // No cache dependency; no lineage check needed.
  const baselineFile = path.join(root, "artifacts", "perf", "baseline.json");
  let baseline = {};
  try {
    if (fs.existsSync(baselineFile)) {
      baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    }
  } catch { /* baseline optional — ceiling still enforced */ }

  const basisP50 = Number((baseline[key] || {}).p50 || 0);
  if (basisP50 > 0) {
    console.log(`  basis   p50 baseline=${fmt(basisP50)}ms (ADR-044)`);
  } else {
    console.log(`  info    no p50 baseline for ${key}; relative gate skipped (ceiling still enforced)`);
  }

  // ADR-044 ordering fix: evaluate ALL gates FIRST, then decide write, then exit.
  const gateResult = evaluateBenchGate({ basisP50, measuredP50: p50, measuredP99: p99, p99Ceiling: ceiling });

  // Print per-failure diagnostics.
  for (const f of gateResult.failures) {
    if (f.kind === "p50-regression") {
      console.error(`  ERROR   p50 ${fmt(f.measuredP50)}ms exceeds cap ${fmt(f.capP50)}ms (basis=${fmt(f.basisP50)}ms × 1.5, ADR-044)`);
    } else if (f.kind === "p99-ceiling") {
      console.error(`  ERROR   p99 ${fmt(f.measuredP99)}ms exceeds ceiling ${f.p99Ceiling}ms - severe regression`);
    }
  }

  if (gateResult.pass) {
    if (basisP50 > 0) {
      console.log(`  ok      p50 ${fmt(p50)}ms within cap ${fmt(gateResult.capP50)}ms; p99 ${fmt(p99)}ms within ${ceiling}ms ceiling`);
    } else {
      console.log(`  ok      p99 ${fmt(p99)}ms within ${ceiling}ms ceiling`);
    }
  }

  // Baseline write: ONLY when LILARA_PERF_WRITE_BASELINE=1 (not in normal CI).
  // Only write on a passing run to avoid poisoning baseline with slow measurements.
  if (process.env.LILARA_PERF_WRITE_BASELINE === "1") {
    if (gateResult.pass) {
      try {
        const baselineDir = path.join(root, "artifacts", "perf");
        if (!fs.existsSync(baselineDir)) fs.mkdirSync(baselineDir, { recursive: true });
        const existing = fs.existsSync(baselineFile)
          ? JSON.parse(fs.readFileSync(baselineFile, "utf8"))
          : {};
        const prior = existing[key];
        if (prior && Number(prior.p50) > 0 && p50 > Number(prior.p50) * 3) {
          console.log(`  WARN    p50 is 3× prior baseline - skipping baseline update (likely wrong FS context)`);
        } else {
          existing[key] = {
            p50: fmt(p50), p99: fmt(p99),
            flows: corpus.length, iter: ITER,
            updatedAt: new Date().toISOString(),
            node: process.version,
          };
          fs.writeFileSync(baselineFile, JSON.stringify(existing, null, 2) + "\n");
          console.log(`  write   artifacts/perf/baseline.json updated for ${key} — review and commit`);
        }
      } catch (e) {
        console.log(`  WARN    baseline write failed: ${e.message}`);
      }
    } else {
      console.log(`  WARN    gate failed — baseline NOT updated (run only passes to recalibrate)`);
    }
  }

  // AC: suite must complete within the platform-scaled wall-clock budget.
  const budgetSec = suiteBudgetSec();
  if (elapsedSec > budgetSec) {
    console.error(`  ERROR   suite elapsed ${fmt(elapsedSec)}s exceeds ${budgetSec}s budget`);
    // Exit after all checks are reported.
    process.exit(1);
  }

  // Exit AFTER all gate evaluation and write decisions.
  if (!gateResult.pass) process.exit(1);

  console.log(`\nPerf regression suite passed.`);
}

run();
