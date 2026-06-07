#!/usr/bin/env bash
# bench-runtime-decision.sh — Measure runtime.decide() latency.
# Prints p50/p95/p99 in ms and fails if:
#   1. p50 exceeds 1.5× the committed per-platform p50 baseline (relative gate).
#   2. p99 exceeds the platform ceiling (absolute backstop gate).
#
# ADR-044: Gate on p50 (stable median), NOT p99, for the relative regression
# check. p99 on a shared CI runner is dominated by GC pauses and scheduler
# preemptions; for sub-ms decide() calls, runner noise (~2–3 ms on one tail
# call) exceeds a real 2× regression signal (~0.8 ms). p50 is stable across
# runs. Baselines are committed to artifacts/bench/baseline.json (not cached)
# so the lineage-skip hole is eliminated.
#
# TAIL-JITTER ROBUSTNESS (ADR-040): the gated p50/p99 are from the BEST batch
# (lowest p99) across LILARA_BENCH_BATCHES independent batches (default 5)
# of N=1000 calls each, after a discarded warmup.
#
# BASELINE RECALIBRATION: run with LILARA_BENCH_WRITE_BASELINE=1 to update
# artifacts/bench/baseline.json with the current measured p50, then review
# and commit the change.
#   LILARA_BENCH_WRITE_BASELINE=1 bash scripts/bench-runtime-decision.sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

# Default ceiling: 10ms on Linux (CI), 500ms on Windows (file-system overhead),
# 200ms on macOS. Override with LILARA_BENCH_P99_MS=<n> to set explicitly.
if [ -n "${LILARA_BENCH_P99_MS:-}" ]; then
  P99_CEILING_MS="$LILARA_BENCH_P99_MS"
elif [ "${OS:-}" = "Windows_NT" ] || uname -s 2>/dev/null | grep -qiE 'mingw|msys|cygwin'; then
  P99_CEILING_MS=500
elif uname -r 2>/dev/null | grep -qi 'microsoft' && pwd | grep -q '^/mnt/'; then
  # WSL on a Windows-mounted filesystem (/mnt/c/…) — IO is Windows-class.
  P99_CEILING_MS=500
elif uname -s 2>/dev/null | grep -qi 'darwin'; then
  P99_CEILING_MS=200
else
  P99_CEILING_MS=10
fi

slow_fs=0; [ "$P99_CEILING_MS" = "500" ] && slow_fs=1

printf '[bench-runtime-decision]\n'

node - <<'NODE' "$root" "$workdir" "$P99_CEILING_MS" "$slow_fs" || exit 1
"use strict";
const path = require('path');
const fs   = require('fs');
const root = process.argv[2];
const workdir = process.argv[3];
const p99Ceiling = Number(process.argv[4]);
const slowFs = process.argv[5] === "1";

process.env.LILARA_STATE_DIR = workdir;
const { decide } = require(path.join(root, 'runtime/decision-engine.js'));
const { evaluateBenchGate, platformKey } = require(path.join(root, 'runtime/bench-gate.js'));

const inputs = [
  { command: 'npm test',                   tool: 'Bash', targetPath: 'src/app.ts',      sessionRisk: 0, repeatedApprovals: 0 },
  { command: 'npm run build',              tool: 'Bash', targetPath: 'src/',             sessionRisk: 0, repeatedApprovals: 0 },
  { command: 'git status',                 tool: 'Bash', targetPath: '.',                sessionRisk: 0, repeatedApprovals: 0 },
  { command: 'sudo systemctl restart app', tool: 'Bash', targetPath: 'ops/service',      sessionRisk: 0, repeatedApprovals: 2 },
  { command: 'npx -y tsx scripts/run.ts',  tool: 'Bash', targetPath: 'scripts/run.ts',   sessionRisk: 0, repeatedApprovals: 0 },
  { command: 'cat .env',                   tool: 'Bash', targetPath: '.env',             sessionRisk: 0, repeatedApprovals: 0 },
  { command: 'edit module',                tool: 'Edit', targetPath: 'src/runtime.ts',   sessionRisk: 0, repeatedApprovals: 0 },
  { command: 'update docs',               tool: 'Bash', targetPath: 'docs/readme.md',   sessionRisk: 1, repeatedApprovals: 0 },
  { command: 'rm -rf /tmp/build',          tool: 'Bash', targetPath: '/tmp/build',       sessionRisk: 0, repeatedApprovals: 0 },
  { command: 'git push origin main',       tool: 'Bash', targetPath: 'src/',             sessionRisk: 0, repeatedApprovals: 0 },
];

const N = 1000;
const BATCHES = Math.max(1, Number(process.env.LILARA_BENCH_BATCHES || 5));
const WARMUP = 200;

// One batch of N timed decide() calls → sorted {p50,p95,p99}.
function runBatch() {
  const lat = [];
  for (let i = 0; i < N; i++) {
    const input = inputs[i % inputs.length];
    const start = process.hrtime.bigint();
    decide(input);
    const end = process.hrtime.bigint();
    lat.push(Number(end - start) / 1e6); // nanoseconds → ms
  }
  lat.sort((a, b) => a - b);
  return {
    p50: lat[Math.floor(N * 0.50)],
    p95: lat[Math.floor(N * 0.95)],
    p99: lat[Math.floor(N * 0.99)],
  };
}

// Cold-cache probe (informational, never gated): first 10 calls on the
// freshly-required engine, BEFORE warmup, to capture first-call JIT cost.
const coldLat = [];
for (let i = 0; i < 10; i++) {
  const input = inputs[i % inputs.length];
  const s = process.hrtime.bigint();
  decide(input);
  coldLat.push(Number(process.hrtime.bigint() - s) / 1e6);
}
coldLat.sort((a, b) => a - b);
const coldP99 = coldLat[coldLat.length - 1];

// Warmup: stabilize JIT/inline caches before measurement. Discarded.
for (let w = 0; w < WARMUP; w++) decide(inputs[w % inputs.length]);

// Best-of-K (ADR-040): run BATCHES independent batches; gate on the batch with
// the LOWEST p99 — the least-contended measurement. Additive CI noise can only
// inflate a batch's tail, so the minimum p99 is the truest estimate of intrinsic
// latency; a real regression raises every batch's p99, so the min still trips
// the cap. The other batches' p99s are printed for transparency.
const batches = [];
for (let b = 0; b < BATCHES; b++) batches.push(runBatch());
const best = batches.reduce((m, s) => (s.p99 < m.p99 ? s : m), batches[0]);
const p50 = best.p50;
const p95 = best.p95;
const p99 = best.p99;
const allP99 = batches.map((s) => s.p99.toFixed(3)).join(", ");

const nodeVer = process.version;
const key = platformKey(slowFs);

console.log(`  platform: ${key}  node: ${nodeVer}`);
console.log(`  N=${N}×${BATCHES} batches  p50=${p50.toFixed(3)}ms  p95=${p95.toFixed(3)}ms  p99=${p99.toFixed(3)}ms (best-of-${BATCHES})`);
console.log(`  per-batch p99: [${allP99}] ms — gated on min (tail-jitter robust, ADR-040)`);
console.log(`  cold-cache p99=${coldP99.toFixed(3)}ms (first 10 calls, pre-warmup)`);

// Read committed baseline from artifacts/bench/baseline.json (ADR-044).
// No cache dependency; no lineage check needed.
const baselineFile = path.join(root, "artifacts", "bench", "baseline.json");
let baseline = {};
try {
  if (fs.existsSync(baselineFile)) {
    baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  }
} catch { /* baseline is optional — ceiling gate still enforced */ }

const basisP50 = Number((baseline[key] || {}).p50 || 0);

// ADR-044: evaluate ALL gates before any process.exit(1).
const gateResult = evaluateBenchGate({ basisP50, measuredP50: p50, measuredP99: p99, p99Ceiling });

if (basisP50 > 0) {
  console.log(`  basis   p50 baseline=${basisP50.toFixed(3)}ms  cap=${gateResult.capP50.toFixed(3)}ms (1.5×, ADR-044)`);
} else {
  console.log(`  info    no p50 baseline for ${key}; relative gate skipped (ceiling still enforced)`);
}

// Print per-failure diagnostics.
for (const f of gateResult.failures) {
  if (f.kind === "p50-regression") {
    console.error(`  ERROR   p50 ${f.measuredP50.toFixed(3)}ms exceeds cap ${f.capP50.toFixed(3)}ms (basis=${f.basisP50.toFixed(3)}ms × 1.5, ADR-044)`);
  } else if (f.kind === "p99-ceiling") {
    console.error(`  ERROR   p99 ${f.measuredP99.toFixed(3)}ms exceeds ceiling ${f.p99Ceiling}ms — severe regression detected`);
  }
}

if (gateResult.pass) {
  if (basisP50 > 0) {
    console.log(`  ok      p50 ${p50.toFixed(3)}ms within cap ${gateResult.capP50.toFixed(3)}ms; p99 ${p99.toFixed(3)}ms within ${p99Ceiling}ms ceiling`);
  } else {
    console.log(`  ok      p99 ${p99.toFixed(3)}ms within ${p99Ceiling}ms ceiling`);
  }
}

// Baseline write: ONLY when LILARA_BENCH_WRITE_BASELINE=1 (not in normal CI).
// Write AFTER gate evaluation; skip if failing (don't poison the baseline).
if (process.env.LILARA_BENCH_WRITE_BASELINE === "1") {
  if (gateResult.pass) {
    try {
      const baselineDir = path.join(root, "artifacts", "bench");
      if (!fs.existsSync(baselineDir)) fs.mkdirSync(baselineDir, { recursive: true });
      const existing = fs.existsSync(baselineFile)
        ? JSON.parse(fs.readFileSync(baselineFile, "utf8"))
        : {};
      const prior = existing[key];
      if (prior && Number(prior.p50) > 0 && p50 > Number(prior.p50) * 3) {
        console.log(`  WARN    p50 is 3× slower than prior baseline — skipping write (likely wrong FS context)`);
      } else {
        existing[key] = {
          p50: p50.toFixed(3),
          p99: p99.toFixed(3),
          updatedAt: new Date().toISOString(),
          node: nodeVer,
        };
        fs.writeFileSync(baselineFile, JSON.stringify(existing, null, 2) + "\n");
        console.log(`  write   artifacts/bench/baseline.json updated for ${key} — review and commit`);
      }
    } catch (e) {
      console.log(`  WARN    baseline write failed: ${e.message}`);
    }
  } else {
    console.log(`  WARN    gate failed — baseline NOT updated (run only passes to recalibrate)`);
  }
}

// Exit AFTER all gate evaluation and write decisions.
if (!gateResult.pass) process.exit(1);
NODE

printf '\nRuntime decision bench passed.\n'
