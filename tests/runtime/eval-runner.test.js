#!/usr/bin/env node
"use strict";

// eval-runner.test.js — Unit tests for runtime/eval-runner.js
//
// Tests discover(), runAll(), and toJUnit() in isolation using a temp evals dir
// controlled by LILARA_EVAL_DIR.
//
// Run: node tests/runtime/eval-runner.test.js

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-eval-runner-"));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stderr.write(`  FAIL ${name}: ${err && (err.stack || err.message) || err}\n`);
  }
}

// Helper: create a temp eval dir with one eval file.
function makeEvalDir(evalFiles) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, "evals-"));
  for (const [name, content] of Object.entries(evalFiles)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function loadRunner(evalDir) {
  process.env.LILARA_EVAL_DIR = evalDir;
  const runnerPath = path.join(__dirname, "..", "..", "runtime", "eval-runner");
  delete require.cache[require.resolve(runnerPath)];
  return require(runnerPath);
}

// ────────────────────────────────────────────────────────────────────────────

test("discover returns empty array when evals dir does not exist", () => {
  const runner = loadRunner("/does/not/exist");
  const files = runner.discover();
  assert.strictEqual(files.length, 0);
});

test("discover finds *.eval.js files in the evals dir", () => {
  const dir = makeEvalDir({
    "foo.eval.js": `module.exports = { name: "foo", description: "test", run: async () => ({ passed: 0, failed: 0, total: 0, failures: [] }) };`,
    "bar.eval.js": `module.exports = { name: "bar", description: "test", run: async () => ({ passed: 0, failed: 0, total: 0, failures: [] }) };`,
    "not-an-eval.js": `module.exports = {};`,
    "README.md": "not a js file",
  });
  const runner = loadRunner(dir);
  const files  = runner.discover();
  assert.strictEqual(files.length, 2);
  assert.ok(files.some((f) => f.name === "foo"), "expected foo");
  assert.ok(files.some((f) => f.name === "bar"), "expected bar");
});

test("toJUnit produces valid XML with failures", () => {
  const { toJUnit } = loadRunner("/does/not/exist");
  const results = [
    {
      name: "my-eval",
      passed: 1,
      failed: 1,
      total: 2,
      failures: [{ id: "e1", expected: "allow", got: "block", note: "false positive" }],
      error: null,
    },
  ];
  const xml = toJUnit(results);
  assert.ok(xml.startsWith("<?xml"), "expected XML declaration");
  assert.ok(xml.includes("<testsuites"), "expected testsuites");
  assert.ok(xml.includes("my-eval"), "expected suite name");
  assert.ok(xml.includes("false positive"), "expected failure note");
  assert.ok(xml.includes("</testsuite>"), "expected closing testsuite tag");
});

test("toJUnit escapes special chars in XML attributes", () => {
  const { toJUnit } = loadRunner("/does/not/exist");
  const results = [
    {
      name: "escape<test>",
      passed: 0,
      failed: 1,
      total: 1,
      failures: [{ id: 'id&<>"\'', expected: "allow", got: "block", note: 'note<>&"\'' }],
      error: null,
    },
  ];
  const xml = toJUnit(results);
  assert.ok(!xml.includes("escape<test>"), "raw < must be escaped in output");
  assert.ok(xml.includes("&lt;"), "expected &lt;");
  assert.ok(xml.includes("&amp;"), "expected &amp;");
});

// Async tests via an IIFE to avoid top-level await (which conflicts with require)
(async function runAsyncTests() {
  async function testA(name, fn) {
    try {
      await fn();
      passed += 1;
      process.stdout.write(`  ok  ${name}\n`);
    } catch (err) {
      failed += 1;
      process.stderr.write(`  FAIL ${name}: ${err && (err.stack || err.message) || err}\n`);
    }
  }

  await testA("runAll returns pass summary for a passing eval", async () => {
    const dir = makeEvalDir({
      "passing.eval.js": `module.exports = { name: "passing", description: "always passes", run: async (corpus) => ({ passed: corpus.length, failed: 0, total: corpus.length, failures: [] }) };`,
    });
    const runner = loadRunner(dir);
    const corpus = [{ id: "t1" }, { id: "t2" }];
    const { results, summary } = await runner.runAll({ corpus });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].passed, 2);
    assert.strictEqual(results[0].failed, 0);
    assert.strictEqual(summary.totalPassed, 2);
    assert.strictEqual(summary.totalFailed, 0);
  });

  await testA("runAll captures load errors gracefully", async () => {
    const dir = makeEvalDir({
      "broken.eval.js": `throw new Error("broken module");`,
    });
    const runner = loadRunner(dir);
    const { results } = await runner.runAll({ corpus: [] });
    assert.strictEqual(results.length, 1);
    assert.ok(results[0].error, "expected error field to be set");
    assert.ok(results[0].error.includes("broken module"), `unexpected error: ${results[0].error}`);
  });

  await testA("runAll captures run() errors gracefully", async () => {
    const dir = makeEvalDir({
      "throws.eval.js": `module.exports = { name: "throws", description: "throws", run: async () => { throw new Error("run error"); } };`,
    });
    const runner = loadRunner(dir);
    const { results } = await runner.runAll({ corpus: [] });
    assert.strictEqual(results.length, 1);
    assert.ok(results[0].error, "expected error field");
    assert.ok(results[0].error.includes("run error"));
  });

  // ────────────────────────────────────────────────────────────────────────────

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort */ }

  if (failed > 0) {
    process.stderr.write(`\neval-runner.test.js: ${failed} test(s) FAILED\n`);
    process.exit(1);
  }
  process.stdout.write(`\neval-runner.test.js: ${passed} test(s) passed\n`);
})();
