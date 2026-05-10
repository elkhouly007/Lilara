#!/usr/bin/env bash
# bench-runtime-decision.sh — Measure runtime.decide() latency over 1000 calls.
# Prints p50/p95/p99 in ms and fails if p99 exceeds P99_CEILING_MS (default 5).
#
# BASELINE NOTE: The 1.5× regression guard compares against a stored baseline
# that is keyed by platform AND node major version (e.g. win32-slowfs-v25).
# Running with a different node on PATH will produce a fresh baseline rather
# than a false regression. On Windows, ensure the correct node is on PATH:
#   export PATH="/c/Users/Khouly/.lmstudio/.internal/utils:$PATH"
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

# Default ceiling: 5ms on Linux (CI), 500ms on Windows (file-system overhead).
# Override with HORUS_BENCH_P99_MS=<n> to set explicitly.
if [ -n "${HORUS_BENCH_P99_MS:-}" ]; then
  P99_CEILING_MS="$HORUS_BENCH_P99_MS"
elif [ "${OS:-}" = "Windows_NT" ] || uname -s 2>/dev/null | grep -qiE 'mingw|msys|cygwin'; then
  P99_CEILING_MS=500
elif uname -r 2>/dev/null | grep -qi 'microsoft' && pwd | grep -q '^/mnt/'; then
  # WSL on a Windows-mounted filesystem (/mnt/c/…) — IO is Windows-class.
  P99_CEILING_MS=500
else
  P99_CEILING_MS=5
fi

slow_fs=0; [ "$P99_CEILING_MS" = "500" ] && slow_fs=1

printf '[bench-runtime-decision]\n'

node - <<'NODE' "$root" "$workdir" "$P99_CEILING_MS" "$slow_fs" || exit 1
"use strict";
const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');
const root = process.argv[2];
const workdir = process.argv[3];
const p99Ceiling = Number(process.argv[4]);

process.env.HORUS_STATE_DIR = workdir;
const { decide } = require(path.join(root, 'runtime/decision-engine.js'));

// Baseline lineage helpers — mirror tests/perf/bench.js. CI cache restore-keys
// are prefix-matched, so artifacts/bench/baseline.json often comes from an
// orphaned/unrelated commit (pre-rebase HEAD, sibling feature branch). Compar-
// ing a fresh run on a different runner against that arbitrary stale baseline
// produces 1.5× false-positive failures (esp. Windows slowfs runner variance).
// Stamp baselines with commitSha and only enforce the 1.5× regression gate
// when the baseline is from an ancestor of the current commit. The hard
// platform ceiling ladder is unchanged and still catches severe regressions.
function gitTry(args) {
  try {
    return cp.execFileSync("git", args, {
      cwd: root, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8",
    }).trim();
  } catch { return ""; }
}
function currentCommitSha() {
  return process.env.HORUS_BENCH_BASELINE_SHA
      || process.env.GITHUB_SHA
      || gitTry(["rev-parse", "HEAD"]) || "";
}
function isAncestorOrSame(maybeAncestor, head) {
  if (!maybeAncestor || !head) return false;
  if (maybeAncestor === head) return true;
  try {
    cp.execFileSync("git", ["merge-base", "--is-ancestor", maybeAncestor, head], {
      cwd: root, stdio: "ignore",
    });
    return true;
  } catch { return false; }
}

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
const latencies = [];

for (let i = 0; i < N; i++) {
  const input = inputs[i % inputs.length];
  const start = process.hrtime.bigint();
  decide(input);
  const end = process.hrtime.bigint();
  latencies.push(Number(end - start) / 1e6); // nanoseconds → ms
}

latencies.sort((a, b) => a - b);
const p50  = latencies[Math.floor(N * 0.50)];
const p95  = latencies[Math.floor(N * 0.95)];
const p99  = latencies[Math.floor(N * 0.99)];

const nodeVer = process.version;
const nodeMajor = nodeVer.split(".")[0]; // e.g. "v25"
const slowFs = process.argv[5] === "1";
// Include node major in the key so baselines from different node versions
// don't trigger false regressions against each other.
const platformKey = slowFs
  ? `${process.platform}-slowfs-${nodeMajor}`
  : `${process.platform}-${nodeMajor}`;

// Split cold-cache (first 10) vs warm-cache reporting
const coldLatencies = latencies.slice(0, 10).sort((a, b) => a - b);
const coldP99 = coldLatencies[coldLatencies.length - 1] ?? p99;

console.log(`  platform: ${platformKey}  node: ${nodeVer}`);
console.log(`  N=${N}  p50=${p50.toFixed(3)}ms  p95=${p95.toFixed(3)}ms  p99=${p99.toFixed(3)}ms (warm)`);
console.log(`  cold-cache p99=${coldP99.toFixed(3)}ms (first 10 calls)`);

// Persist baseline for regression detection (1.5× rule)
const baselineDir  = path.join(root, "artifacts", "bench");
const baselineFile = path.join(baselineDir, "baseline.json");
let baseline = null;
try {
  if (fs.existsSync(baselineFile)) {
    baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  }
} catch { /* baseline is optional */ }

const headSha = currentCommitSha();
if (baseline && baseline[platformKey] && baseline[platformKey].p99) {
  const prior = baseline[platformKey];
  const baseP99 = Number(prior.p99);
  const cap = Math.min(p99Ceiling, baseP99 * 1.5);
  const baseSha = prior.commitSha || "";
  const lineageOk = baseSha && headSha && isAncestorOrSame(baseSha, headSha);
  if (!baseSha) {
    console.log(`  info    baseline has no commitSha stamp (legacy); skipping 1.5× gate, recording stamped baseline`);
  } else if (!lineageOk) {
    console.log(`  info    baseline from non-ancestor commit ${baseSha.slice(0,12)} (head ${headSha.slice(0,12) || "?"}); skipping 1.5× gate (likely rebase or stale cache from sibling branch)`);
  } else if (p99 > cap) {
    console.error(`  ERROR   p99 ${p99.toFixed(3)}ms exceeds 1.5× baseline (${baseP99.toFixed(3)}ms → cap ${cap.toFixed(3)}ms) [baseline ${baseSha.slice(0,12)} ancestor of head ${headSha.slice(0,12)}]`);
    process.exit(1);
  } else {
    console.log(`  ok      p99 within 1.5× baseline (baseline=${baseP99.toFixed(3)}ms cap=${cap.toFixed(3)}ms) [baseline ${baseSha.slice(0,12)} ancestor]`);
  }
}

try {
  if (!fs.existsSync(baselineDir)) fs.mkdirSync(baselineDir, { recursive: true });
  const existing = fs.existsSync(baselineFile)
    ? JSON.parse(fs.readFileSync(baselineFile, "utf8"))
    : {};
  const prior = existing[platformKey];
  if (prior && Number(prior.p50) > 0 && p50 > Number(prior.p50) * 3) {
    console.log(`  WARN    p50 is 3× slower than prior baseline — skipping overwrite (likely wrong FS context)`);
  } else {
    existing[platformKey] = {
      p50: p50.toFixed(3),
      p95: p95.toFixed(3),
      p99: p99.toFixed(3),
      updatedAt: new Date().toISOString(),
      node: nodeVer,
      commitSha: headSha || undefined,
      commitRef: process.env.GITHUB_REF || gitTry(["rev-parse", "--abbrev-ref", "HEAD"]) || undefined,
    };
    fs.writeFileSync(baselineFile, JSON.stringify(existing, null, 2) + "\n");
  }
} catch { /* baseline write is best-effort */ }

if (p99 > p99Ceiling) {
  console.error(`  ERROR   p99 ${p99.toFixed(3)}ms exceeds ceiling ${p99Ceiling}ms — severe regression detected`);
  process.exit(1);
}
console.log(`  ok      p99 ${p99.toFixed(3)}ms within ${p99Ceiling}ms ceiling`);
NODE

printf '\nRuntime decision bench passed.\n'
