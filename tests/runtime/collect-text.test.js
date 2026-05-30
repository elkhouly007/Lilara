#!/usr/bin/env node
"use strict";

// collect-text.test.js — Zero-dep node:assert tests for hook-utils.collectText.
//
// collectText flattens a JSON structure into newline-joined string values. It
// feeds the post-adapter secret-scan and F21 compaction-survival injection scan
// (post-adapter-factory.js). A regression where the depth cap was too shallow
// silently dropped strings nested inside deeply-wrapped MCP/API responses, so a
// secret or injection payload nested past the cap escaped BOTH scans.
//
// These tests pin: (1) strings are collected at realistic nesting depths
// (object + array + mixed), (2) the depth cap still bounds recursion (fail-safe
// truncation, never a throw), and (3) extreme nesting does not blow the stack.
//
// Run:  node tests/runtime/collect-text.test.js

const assert = require("node:assert");
const path   = require("node:path");
const { collectText } = require(path.join(
  __dirname, "..", "..", "claude", "hooks", "hook-utils"
));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stderr.write(`  FAIL ${name}: ${err && err.message || err}\n`);
  }
}

const SECRET = "sk-ABCDEFGHIJ1234567890wxyz"; // shape that secret-scan would flag

// Build a value nested `levels` deep around `leaf`, alternating object/array so
// the test exercises both descent branches.
function nest(leaf, levels) {
  let v = leaf;
  for (let i = 0; i < levels; i++) {
    v = i % 2 === 0 ? { wrap: v } : [v];
  }
  return v;
}

// ---------------------------------------------------------------------------
// Baseline shapes
// ---------------------------------------------------------------------------

test("collectText: flat string returns itself", () => {
  assert.strictEqual(collectText(SECRET), SECRET);
});

test("collectText: flat object value is collected", () => {
  assert.ok(collectText({ a: SECRET }).includes(SECRET));
});

test("collectText: flat array element is collected", () => {
  assert.ok(collectText([SECRET]).includes(SECRET));
});

test("collectText: null / undefined / number → ''", () => {
  assert.strictEqual(collectText(null), "");
  assert.strictEqual(collectText(undefined), "");
  assert.strictEqual(collectText(42), "");
});

// ---------------------------------------------------------------------------
// Depth coverage — the regression these tests guard
// ---------------------------------------------------------------------------

test("collectText: secret nested 6 deep is collected (was dropped at old cap=4)", () => {
  assert.ok(collectText(nest(SECRET, 6)).includes(SECRET));
});

test("collectText: secret nested 10 deep is collected", () => {
  assert.ok(collectText(nest(SECRET, 10)).includes(SECRET));
});

test("collectText: secret nested 14 deep is collected", () => {
  assert.ok(collectText(nest(SECRET, 14)).includes(SECRET));
});

test("collectText: realistic wrapped MCP/API response shape is collected", () => {
  const payload = { result: { data: [{ meta: { credentials: { token: SECRET } } }] } };
  assert.ok(collectText(payload).includes(SECRET));
});

// ---------------------------------------------------------------------------
// Bound + safety — depth cap and stack safety
// ---------------------------------------------------------------------------

test("collectText: depth cap bounds recursion (very deep nesting does not throw)", () => {
  // 5000-deep nesting must return safely (fail-safe truncation), never throw a
  // RangeError. Content past the cap is intentionally not collected.
  let out;
  assert.doesNotThrow(() => { out = collectText(nest(SECRET, 5000)); });
  assert.strictEqual(typeof out, "string");
});

test("collectText: wide-but-shallow structure collects all elements", () => {
  // A shallow array of many strings must be fully collected (no node-count
  // regression vs the pre-fix behaviour).
  const arr = Array.from({ length: 1000 }, (_, i) => `v${i}`);
  const out = collectText(arr);
  assert.ok(out.includes("v0") && out.includes("v999"));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.stdout.write(`\ncollect-text.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
