"use strict";
// tests/perf/bench-gate.test.js — unit tests for runtime/bench-gate.js (ADR-044)
// Zero external deps; standalone Node script with local mini-harness.

const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..", "..");
const { evaluateBenchGate, platformKey, platformCeilingMs } = require(path.join(root, "runtime", "bench-gate.js"));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok      ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL    ${name}`);
    console.error(`          ${err.message}`);
    failed++;
  }
}

console.log("[bench-gate.test]");

// ── #150 repro / pass-when-correct ───────────────────────────────────────────
// The original false-positive: p50 is fine, p99 has a tail spike but stays
// within the ceiling. With p50 gate this must pass.
test("#150 repro / pass-when-correct", () => {
  const r = evaluateBenchGate({
    basisP50: 0.400, measuredP50: 0.420, measuredP99: 2.955, p99Ceiling: 10,
  });
  assert.strictEqual(r.pass, true, `expected pass, got failures: ${JSON.stringify(r.failures)}`);
  assert.strictEqual(r.failures.length, 0);
  // capP50 = min(10, 0.400 * 1.5) = 0.600
  assert.ok(Math.abs(r.capP50 - 0.6) < 0.001, `capP50 should be ~0.600, got ${r.capP50}`);
});

// ── fail-when-truly-regressed (p50) ──────────────────────────────────────────
test("fail-when-truly-regressed (p50)", () => {
  const r = evaluateBenchGate({
    basisP50: 0.400, measuredP50: 0.800, measuredP99: 1.000, p99Ceiling: 10,
  });
  assert.strictEqual(r.pass, false, "expected fail");
  assert.strictEqual(r.failures.length, 1);
  assert.strictEqual(r.failures[0].kind, "p50-regression");
});

// ── ceiling backstop ─────────────────────────────────────────────────────────
test("ceiling backstop", () => {
  const r = evaluateBenchGate({
    basisP50: 0.400, measuredP50: 0.410, measuredP99: 12.000, p99Ceiling: 10,
  });
  assert.strictEqual(r.pass, false, "expected fail");
  assert.strictEqual(r.failures.length, 1);
  assert.strictEqual(r.failures[0].kind, "p99-ceiling");
});

// ── no-basis (first run) ─────────────────────────────────────────────────────
test("no-basis (first run) — relative gate skipped, ceiling ok", () => {
  const r = evaluateBenchGate({
    basisP50: 0, measuredP50: 0.420, measuredP99: 1.000, p99Ceiling: 10,
  });
  assert.strictEqual(r.pass, true, `expected pass, got failures: ${JSON.stringify(r.failures)}`);
  assert.strictEqual(r.failures.length, 0);
});

// ── no-basis, null variant ────────────────────────────────────────────────────
test("no-basis null variant — relative gate skipped, ceiling ok", () => {
  const r = evaluateBenchGate({
    basisP50: null, measuredP50: 0.420, measuredP99: 1.000, p99Ceiling: 10,
  });
  assert.strictEqual(r.pass, true, `expected pass, got failures: ${JSON.stringify(r.failures)}`);
});

// ── both fail ────────────────────────────────────────────────────────────────
test("both fail (p50 regression + p99 ceiling)", () => {
  const r = evaluateBenchGate({
    basisP50: 0.400, measuredP50: 0.900, measuredP99: 15, p99Ceiling: 10,
  });
  assert.strictEqual(r.pass, false, "expected fail");
  assert.strictEqual(r.failures.length, 2);
  const kinds = r.failures.map(f => f.kind).sort();
  assert.deepStrictEqual(kinds, ["p50-regression", "p99-ceiling"]);
});

// ── platformKey ──────────────────────────────────────────────────────────────
test("platformKey(false) starts with process.platform", () => {
  const k = platformKey(false);
  assert.ok(k.startsWith(process.platform), `expected to start with ${process.platform}, got ${k}`);
});

test("platformKey(true) contains '-slowfs-'", () => {
  const k = platformKey(true);
  assert.ok(k.includes("-slowfs-"), `expected slowfs in key, got ${k}`);
});

test("platformKey node major is in key", () => {
  const nodeMajor = process.version.split(".")[0]; // e.g. "v20"
  const k = platformKey(false);
  assert.ok(k.endsWith(nodeMajor), `expected key to end with ${nodeMajor}, got ${k}`);
});

// ── platformCeilingMs env override ───────────────────────────────────────────
test("platformCeilingMs env override", () => {
  process.env.LILARA_BENCH_P99_MS = "42";
  const ms = platformCeilingMs("LILARA_BENCH_P99_MS");
  delete process.env.LILARA_BENCH_P99_MS;
  assert.strictEqual(ms, 42);
});

test("platformCeilingMs null envVar skips env", () => {
  // With envVarName=null, env var is not checked.
  process.env.LILARA_BENCH_P99_MS = "999";
  const ms = platformCeilingMs(null);
  delete process.env.LILARA_BENCH_P99_MS;
  // Should return a platform-based value, not 999.
  assert.notStrictEqual(ms, 999, "should not use env var when envVarName is null");
  assert.ok(ms > 0, "should return a positive ceiling");
});

// ── capP50 never exceeds p99Ceiling ──────────────────────────────────────────
test("capP50 never exceeds p99Ceiling", () => {
  const r = evaluateBenchGate({
    basisP50: 100, measuredP50: 50, measuredP99: 5, p99Ceiling: 10,
  });
  assert.ok(r.capP50 <= 10, `capP50 ${r.capP50} should not exceed p99Ceiling 10`);
});

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
