"use strict";

const assert = require("node:assert");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("  ok      " + name);
    passed++;
  } catch (e) {
    console.error("  FAIL    " + name);
    console.error("          " + e.message);
    failed++;
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spend-test-"));
}

const se = require("../../runtime/spend-estimator");

test("estimateTokens: empty string returns 0", () => {
  assert.strictEqual(se.estimateTokens(""), 0);
});

test("estimateTokens: 4-char string returns 1", () => {
  assert.strictEqual(se.estimateTokens("abcd"), 1);
});

test("estimateTokens: 400-char string returns ~100", () => {
  const r = se.estimateTokens("a".repeat(400));
  assert.strictEqual(r, 100);
});

test("addSpend accumulates totals", () => {
  const d = tmpDir();
  process.env.LILARA_STATE_DIR = d;
  se.addSpend({ tool: "Read", inputTokens: 100, outputTokens: 200 });
  se.addSpend({ tool: "Bash", inputTokens: 50,  outputTokens: 150 });
  const s = se.getSpend(d);
  assert.strictEqual(s.total.input, 150);
  assert.strictEqual(s.total.output, 350);
  assert.strictEqual(s.byTool.Read.calls, 1);
  assert.strictEqual(s.byTool.Bash.input, 50);
  delete process.env.LILARA_STATE_DIR;
  fs.rmSync(d, { recursive: true, force: true });
});

test("shouldWarn: returns warn=false when below all thresholds", () => {
  const d = tmpDir();
  process.env.LILARA_STATE_DIR = d;
  se.addSpend({ tool: "T", inputTokens: 10, outputTokens: 10 });
  const r = se.shouldWarn([100000, 500000], d);
  assert.strictEqual(r.warn, false);
  delete process.env.LILARA_STATE_DIR;
  fs.rmSync(d, { recursive: true, force: true });
});

test("shouldWarn: returns warn=true when total crosses threshold", () => {
  const d = tmpDir();
  process.env.LILARA_STATE_DIR = d;
  se.addSpend({ tool: "T", inputTokens: 60000, outputTokens: 60000 });
  const r = se.shouldWarn([100000], d);
  assert.strictEqual(r.warn, true);
  assert.strictEqual(r.threshold, 100000);
  delete process.env.LILARA_STATE_DIR;
  fs.rmSync(d, { recursive: true, force: true });
});

test("getSpend: returns zero record when file absent", () => {
  const d = tmpDir();
  const s = se.getSpend(d);
  assert.strictEqual(s.total.input, 0);
  assert.strictEqual(s.total.output, 0);
  fs.rmSync(d, { recursive: true, force: true });
});

console.log();
console.log("spend-estimator: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
