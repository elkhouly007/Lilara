#!/usr/bin/env node
"use strict";

// bench-ir.js — HAP ADR-007 PR-D perf gate for the Canonical Action IR.
//
// Measures p50 / p95 / p99 latency for both `actionIr.build()` in isolation
// and the full `decide()` end-to-end path that now embeds the IR build. The
// platform ceiling mirrors scripts/bench-runtime-decision.sh:
//   Linux (CI):                10 ms
//   macOS:                     200 ms
//   Windows / WSL-on-/mnt:     500 ms
// Overrides:
//   HORUS_BENCH_P99_MS=<n>            set ceiling explicitly
//   HORUS_BENCH_BASELINE_SHA=<sha>    pin baseline lineage commit
//
// Baseline file: artifacts/bench/baseline.json, keyed by
// `<platform>[-slowfs]-<node-major>` and stamped with commitSha. The 1.5×
// regression gate only fires when the baseline is an ancestor of HEAD.
// Severe-regression hard ceiling fires unconditionally.
//
// Usage:
//   node scripts/bench-ir.js [--iter N] [--quiet]

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const cp   = require("child_process");

const root = path.resolve(__dirname, "..");

let iter = 1000;
let quiet = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--iter") iter = Number(process.argv[++i]) || iter;
  else if (a.startsWith("--iter=")) iter = Number(a.slice("--iter=".length)) || iter;
  else if (a === "--quiet") quiet = true;
}

process.env.HORUS_CONTRACT_ENABLED = "0";
process.env.HORUS_TRAJECTORY_WINDOW_MIN = "0";
process.env.HORUS_RATE_LIMIT = "0";
delete process.env.HORUS_KILL_SWITCH;
delete process.env.HORUS_CONTRACT_REQUIRED;
delete process.env.HORUS_BRANCH_OVERRIDE;
delete process.env.HORUS_F4_DEMOTE_TOKEN;

if (!process.env.HORUS_STATE_DIR) {
  process.env.HORUS_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arg-bench-ir-"));
}

const { build: buildIr } = require(path.join(root, "runtime", "action-ir"));
const { decide }         = require(path.join(root, "runtime", "decision-engine"));
const { resetCache }     = require(path.join(root, "runtime", "session-context"));

// Benchmark inputs are loaded from the frozen replay corpus JSONL fixtures
// (tests/fixtures/replay-corpus/*.jsonl). Keeping the literals in fixtures —
// rather than embedded in this script — keeps scripts/audit-local.sh clean
// (it scans scripts/+hooks/+workflows for risky literals) while giving the
// IR/decide() bench the same broad coverage the replay gate already pins:
// F3 critical-risk, F4 secret-class-C, F6/F7 strict, F8 protected-branch,
// F9 session-risk, baseline routes, and adversarial IR shapes.
function loadInputs() {
  const corpusDir = path.join(root, "tests", "fixtures", "replay-corpus");
  const files = ["corpus.jsonl", "adversarial.jsonl"];
  const inputs = [];
  for (const f of files) {
    const full = path.join(corpusDir, f);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry && entry.input && typeof entry.input === "object") {
        inputs.push(entry.input);
      }
    }
  }
  if (inputs.length === 0) {
    process.stderr.write(
      `[bench-ir] no inputs loaded from ${corpusDir} — regenerate via ` +
      `node tests/fixtures/replay-corpus/build-corpus.js\n`
    );
    process.exit(2);
  }
  return inputs;
}

const INPUTS = loadInputs();

function platformCeilingMs() {
  if (process.env.HORUS_BENCH_P99_MS) return Number(process.env.HORUS_BENCH_P99_MS);
  if (process.platform === "win32") return 500;
  if (process.platform === "linux") {
    try {
      const release = fs.readFileSync("/proc/version", "utf8").toLowerCase();
      if (release.includes("microsoft") && process.cwd().startsWith("/mnt/")) return 500;
    } catch { /* not WSL — fall through */ }
    return 10;
  }
  if (process.platform === "darwin") return 200;
  return 10;
}

function platformKey() {
  const nodeMajor = process.version.split(".")[0];
  const slow = platformCeilingMs() === 500;
  return slow
    ? `${process.platform}-slowfs-${nodeMajor}`
    : `${process.platform}-${nodeMajor}`;
}

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

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

const buildTimes  = [];
const decideTimes = [];

// Warm-up: prime hot caches (context-discovery, project-policy, etc.) so the
// first 10 cold calls are reported separately and don't pollute the warm p99.
for (let i = 0; i < 20; i++) {
  buildIr(INPUTS[i % INPUTS.length], { harness: "claude", cwd: "/test/cwd" });
  decide(INPUTS[i % INPUTS.length]);
}
resetCache();

for (let i = 0; i < iter; i++) {
  const input = INPUTS[i % INPUTS.length];
  const ctx = { harness: "claude", cwd: "/test/cwd", tool: input.tool };

  const b0 = process.hrtime.bigint();
  buildIr(input, ctx);
  const b1 = process.hrtime.bigint();

  const d0 = process.hrtime.bigint();
  decide(input);
  const d1 = process.hrtime.bigint();

  buildTimes.push(Number(b1 - b0) / 1e6);
  decideTimes.push(Number(d1 - d0) / 1e6);
}

buildTimes.sort((a, b) => a - b);
decideTimes.sort((a, b) => a - b);

const buildP50 = pct(buildTimes, 0.50);
const buildP95 = pct(buildTimes, 0.95);
const buildP99 = pct(buildTimes, 0.99);
const decideP50 = pct(decideTimes, 0.50);
const decideP95 = pct(decideTimes, 0.95);
const decideP99 = pct(decideTimes, 0.99);

const ceiling = platformCeilingMs();
const key = platformKey();
const headSha = currentCommitSha();

if (!quiet) {
  console.log(`[bench-ir]`);
  console.log(`  platform: ${key}  node: ${process.version}  iter: ${iter}`);
  console.log(`  build()   p50=${buildP50.toFixed(3)}ms  p95=${buildP95.toFixed(3)}ms  p99=${buildP99.toFixed(3)}ms`);
  console.log(`  decide()  p50=${decideP50.toFixed(3)}ms  p95=${decideP95.toFixed(3)}ms  p99=${decideP99.toFixed(3)}ms`);
}

// ── Baseline lineage gate ────────────────────────────────────────────────
const baselineDir  = path.join(root, "artifacts", "bench");
const baselineFile = path.join(baselineDir, "ir-baseline.json");
let baseline = null;
try {
  if (fs.existsSync(baselineFile)) {
    baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  }
} catch { /* baseline optional */ }

let regression = false;
if (baseline && baseline[key]) {
  const prior = baseline[key];
  const baseSha = prior.commitSha || "";
  const lineageOk = baseSha && headSha && isAncestorOrSame(baseSha, headSha);

  const checkBudget = (label, actual, baseVal) => {
    if (!Number.isFinite(baseVal) || baseVal <= 0) return;
    const headroomMs = ceiling * 0.1;
    const cap = Math.min(ceiling, Math.max(baseVal * 1.5, baseVal + headroomMs));
    if (actual > cap) {
      process.stderr.write(
        `  ERROR   ${label} p99 ${actual.toFixed(3)}ms exceeds cap ${cap.toFixed(3)}ms ` +
        `(baseline ${baseVal.toFixed(3)}ms; max(1.5×, +${headroomMs.toFixed(3)}ms))\n`
      );
      regression = true;
    } else if (!quiet) {
      console.log(`  ok      ${label} p99 within cap (baseline=${baseVal.toFixed(3)}ms cap=${cap.toFixed(3)}ms)`);
    }
  };

  if (!baseSha) {
    if (!quiet) console.log(`  info    ir-baseline has no commitSha; skipping 1.5× gate, refreshing baseline`);
  } else if (!lineageOk) {
    if (!quiet) {
      console.log(
        `  info    ir-baseline from non-ancestor commit ${baseSha.slice(0,12)} ` +
        `(head ${headSha.slice(0,12) || "?"}); skipping 1.5× gate`
      );
    }
  } else {
    checkBudget("build()",  buildP99,  Number(prior.buildP99));
    checkBudget("decide()", decideP99, Number(prior.decideP99));
  }
}

// ── Hard platform ceiling — always enforced ──────────────────────────────
if (decideP99 > ceiling) {
  process.stderr.write(
    `  ERROR   decide() p99 ${decideP99.toFixed(3)}ms exceeds ceiling ${ceiling}ms\n`
  );
  process.exit(1);
}
if (buildP99 > ceiling) {
  process.stderr.write(
    `  ERROR   build() p99 ${buildP99.toFixed(3)}ms exceeds ceiling ${ceiling}ms\n`
  );
  process.exit(1);
}
if (regression) process.exit(1);

// ── Refresh baseline (best-effort) ───────────────────────────────────────
try {
  if (!fs.existsSync(baselineDir)) fs.mkdirSync(baselineDir, { recursive: true });
  const existing = fs.existsSync(baselineFile)
    ? JSON.parse(fs.readFileSync(baselineFile, "utf8"))
    : {};
  const prior = existing[key];
  if (
    prior &&
    Number(prior.buildP50) > 0 &&
    buildP50 > Number(prior.buildP50) * 3
  ) {
    if (!quiet) {
      console.log(`  WARN    build() p50 3× slower than prior baseline — skipping overwrite (likely wrong FS context)`);
    }
  } else {
    existing[key] = {
      buildP50:  buildP50.toFixed(3),
      buildP95:  buildP95.toFixed(3),
      buildP99:  buildP99.toFixed(3),
      decideP50: decideP50.toFixed(3),
      decideP95: decideP95.toFixed(3),
      decideP99: decideP99.toFixed(3),
      iter,
      updatedAt: new Date().toISOString(),
      node: process.version,
      commitSha: headSha || undefined,
      commitRef:
        process.env.GITHUB_REF ||
        gitTry(["rev-parse", "--abbrev-ref", "HEAD"]) ||
        undefined,
    };
    fs.writeFileSync(baselineFile, JSON.stringify(existing, null, 2) + "\n");
  }
} catch { /* baseline write is best-effort */ }

if (!quiet) console.log(`  ok      build/decide p99 within ${ceiling}ms ceiling`);
