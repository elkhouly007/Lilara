"use strict";
// runtime/bench-gate.js — ADR-044 shared bench gate logic
// Pure module: no I/O, no side effects. Used by both
// scripts/bench-runtime-decision.sh and tests/perf/bench.js.
//
// Exports:
//   evaluateBenchGate({ basisP50, measuredP50, measuredP99, p99Ceiling })
//     → { pass, failures, capP50 }
//   platformKey(slowFs)
//     → e.g. "linux-v20", "win32-slowfs-v20"
//   platformCeilingMs(envVarName)
//     → number (ms)

const fs = require("fs");

/**
 * Evaluate both bench gates atomically.
 *
 * Relative gate:  capP50 = min(p99Ceiling, basisP50 * 1.5)
 *                 Fails if measuredP50 > capP50.
 *                 Skipped (but logged) when basisP50 is 0 or falsy.
 * Absolute gate:  Fails if measuredP99 > p99Ceiling.
 *
 * Returns { pass, failures, capP50 }.
 * failures is an array of { kind, ... } objects:
 *   kind "p50-regression" — relative p50 gate fired
 *   kind "p99-ceiling"    — absolute p99 ceiling gate fired
 */
function evaluateBenchGate({ basisP50, measuredP50, measuredP99, p99Ceiling }) {
  const failures = [];

  // Compute cap regardless (callers may want it for logging).
  const capP50 = basisP50 > 0
    ? Math.min(p99Ceiling, basisP50 * 1.5)
    : p99Ceiling; // no basis — cap is the ceiling (relative gate skipped)

  // Relative p50 gate.
  if (!basisP50 || basisP50 <= 0) {
    // No basis: skip relative gate. Ceiling still enforced below.
  } else if (measuredP50 > capP50) {
    failures.push({
      kind: "p50-regression",
      measuredP50,
      capP50,
      basisP50,
      p99Ceiling,
    });
  }

  // Absolute p99 ceiling gate.
  if (measuredP99 > p99Ceiling) {
    failures.push({
      kind: "p99-ceiling",
      measuredP99,
      p99Ceiling,
    });
  }

  return { pass: failures.length === 0, failures, capP50 };
}

/**
 * Stable per-platform baseline key.
 *
 * @param {boolean} slowFs — true when the platform p99 ceiling is 500 ms
 *   (Windows native or WSL on Windows-mounted filesystem).
 * @returns {string} e.g. "linux-v20", "win32-slowfs-v20", "darwin-v24"
 */
function platformKey(slowFs) {
  const nodeMajor = process.version.split(".")[0]; // "v20", "v24", etc.
  return slowFs
    ? `${process.platform}-slowfs-${nodeMajor}`
    : `${process.platform}-${nodeMajor}`;
}

/**
 * Platform p99 ceiling in milliseconds.
 *
 * @param {string|null} envVarName — env var to check first (e.g.
 *   "LILARA_BENCH_P99_MS"). Pass null to skip env lookup.
 * @returns {number}
 */
function platformCeilingMs(envVarName) {
  if (envVarName && process.env[envVarName]) {
    return Number(process.env[envVarName]);
  }
  if (process.platform === "win32") return 500;
  // WSL on a Windows-mounted filesystem (/mnt/c/…) — IO is Windows-class.
  try {
    const r = fs.readFileSync("/proc/version", "utf8").toLowerCase();
    if (r.includes("microsoft") && process.cwd().startsWith("/mnt/")) return 500;
  } catch { /* not Linux or /proc unavailable */ }
  if (process.platform === "darwin") return 200;
  return 10;
}

module.exports = { evaluateBenchGate, platformKey, platformCeilingMs };
