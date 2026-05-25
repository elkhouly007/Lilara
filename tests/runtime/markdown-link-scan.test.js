#!/usr/bin/env node
"use strict";

// markdown-link-scan.test.js — Unit tests for runtime/markdown-link-scan.js
//
// Payloads are inline (no separate fixture files) to keep fixture count stable.
//
// Run: node tests/runtime/markdown-link-scan.test.js

const assert = require("node:assert");
const path   = require("node:path");

// Invalidate any cached module so tests always load fresh.
function loadScanner() {
  const mod = path.join(__dirname, "..", "..", "runtime", "markdown-link-scan.js");
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

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

// --- positive cases ---

test("MD-LINK-JS-SCHEME: javascript: href detected", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[click here](javascript:alert(document.cookie))");
  assert.ok(findings.length >= 1, "expected at least one finding");
  assert.ok(findings.some(f => f.id === "MD-LINK-JS-SCHEME"), "expected MD-LINK-JS-SCHEME");
  assert.strictEqual(findings.find(f => f.id === "MD-LINK-JS-SCHEME").severity, "high");
});

test("MD-LINK-JS-SCHEME: case-insensitive match (JAVASCRIPT:)", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[x](JAVASCRIPT:void(0))");
  assert.ok(findings.some(f => f.id === "MD-LINK-JS-SCHEME"), "expected case-insensitive match");
});

test("MD-LINK-JS-SCHEME: leading whitespace inside parens", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[x](  javascript:evil())");
  assert.ok(findings.some(f => f.id === "MD-LINK-JS-SCHEME"), "expected whitespace-tolerant match");
});

test("MD-LINK-DATA-SCHEME: data: URI detected", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[click](data:text/html,<script>alert(1)</script>)");
  assert.ok(findings.some(f => f.id === "MD-LINK-DATA-SCHEME"), "expected MD-LINK-DATA-SCHEME");
  assert.strictEqual(findings.find(f => f.id === "MD-LINK-DATA-SCHEME").severity, "high");
});

test("MD-LINK-DATA-SCHEME: base64 variant", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[img](data:image/png;base64,iVBOR==)");
  assert.ok(findings.some(f => f.id === "MD-LINK-DATA-SCHEME"), "expected base64 data: match");
});

test("MD-LINK-USERINFO: user:pass@host detected", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[dashboard](https://admin:hunter2@evil.example.com/steal)");
  assert.ok(findings.some(f => f.id === "MD-LINK-USERINFO"), "expected MD-LINK-USERINFO");
  assert.strictEqual(findings.find(f => f.id === "MD-LINK-USERINFO").severity, "medium");
});

test("MD-LINK-TOKEN-IN-QUERY: api_key in query string", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[docs](https://api.example.com/v1/users?api_key=ghp_XXXX)");
  assert.ok(findings.some(f => f.id === "MD-LINK-TOKEN-IN-QUERY"), "expected MD-LINK-TOKEN-IN-QUERY");
  assert.strictEqual(findings.find(f => f.id === "MD-LINK-TOKEN-IN-QUERY").severity, "high");
});

test("MD-LINK-TOKEN-IN-QUERY: access_token variant", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[report](https://dash.internal/export?access_token=sk-proj-XXXXX&format=csv)");
  assert.ok(findings.some(f => f.id === "MD-LINK-TOKEN-IN-QUERY"), "expected access_token match");
});

test("MD-LINK-TOKEN-IN-QUERY: secret variant", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[report](https://dashboard.internal/export?secret=sk-proj-XXXXX&format=csv)");
  assert.ok(findings.some(f => f.id === "MD-LINK-TOKEN-IN-QUERY"), "expected secret match");
});

// --- negative cases ---

test("safe https link: no findings", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[Example](https://example.com/path?q=hello&page=2)");
  assert.strictEqual(findings.length, 0, `expected no findings, got ${JSON.stringify(findings)}`);
});

test("safe http link with anchor: no findings", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[Docs](http://docs.example.com/guide#section-3)");
  assert.strictEqual(findings.length, 0, `expected no findings, got ${JSON.stringify(findings)}`);
});

test("bare text with javascript word: no findings", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("We use javascript in our codebase");
  assert.strictEqual(findings.length, 0, "bare text should not match");
});

test("image syntax (not link): no findings for safe image", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("![logo](https://example.com/logo.png)");
  assert.strictEqual(findings.length, 0, "safe image link should not match");
});

// --- edge cases ---

test("empty string: returns empty array", () => {
  const { scanMarkdownLinks } = loadScanner();
  assert.deepStrictEqual(scanMarkdownLinks(""), []);
});

test("null/undefined: returns empty array", () => {
  const { scanMarkdownLinks } = loadScanner();
  assert.deepStrictEqual(scanMarkdownLinks(null), []);
  assert.deepStrictEqual(scanMarkdownLinks(undefined), []);
});

test("64 KB cap: oversized input scanned without error", () => {
  const { scanMarkdownLinks } = loadScanner();
  const huge = "safe text ".repeat(10000); // ~100 KB
  const findings = scanMarkdownLinks(huge);
  assert.ok(Array.isArray(findings), "should return array on oversized input");
  assert.strictEqual(findings.length, 0, "no findings in safe oversized input");
});

test("finding shape: includes id, severity, match, index", () => {
  const { scanMarkdownLinks } = loadScanner();
  const findings = scanMarkdownLinks("[x](javascript:evil())");
  assert.ok(findings.length > 0, "expected findings");
  const f = findings[0];
  assert.ok(typeof f.id === "string", "id should be string");
  assert.ok(typeof f.severity === "string", "severity should be string");
  assert.ok(typeof f.match === "string", "match should be string");
  assert.ok(typeof f.index === "number", "index should be number");
});

// --- finish ---

if (failed > 0) {
  process.stderr.write(`\n${passed} passed, ${failed} FAILED\n`);
  process.exit(1);
} else {
  process.stdout.write(`\n${passed} passed\n`);
}
