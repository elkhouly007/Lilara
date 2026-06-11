#!/usr/bin/env node
"use strict";

const path   = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..", "..");
const { scanSecrets, redact } = require(path.join(root, "runtime", "secret-scan.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); }
  catch (err) { failed++; process.stderr.write(`  FAIL ${name}: ${err.message}\n`); }
}

// Multi-occurrence same-class secret — the key fix
test("redact() removes ALL occurrences of same-class secret (not just first)", () => {
  const aws1 = "AKIA" + "A".repeat(16);
  const aws2 = "AKIA" + "B".repeat(16);
  const text = `aws_key=${aws1} and second_key=${aws2}`;
  const result = redact(text);
  assert.ok(!result.includes(aws1), "first secret should be redacted");
  assert.ok(!result.includes(aws2), "second secret should be redacted");
  assert.ok(result.includes("[REDACTED:"), "should contain redaction placeholder");
});

// Mixed classes — both redacted
test("redact() handles multiple different-class secrets", () => {
  const awsKey = "AKIA" + "C".repeat(16);
  const ghToken = "ghp_" + "X".repeat(20);
  const text = `aws=${awsKey} gh=${ghToken}`;
  const result = redact(text);
  assert.ok(!result.includes(awsKey), "aws key should be redacted");
  assert.ok(!result.includes(ghToken), "github token should be redacted");
});

// Single occurrence still works
test("redact() still redacts a single secret", () => {
  const aws = "AKIA" + "D".repeat(16);
  const result = redact(`prefix ${aws} suffix`);
  assert.ok(!result.includes(aws), "secret should be redacted");
  assert.ok(result.includes("[REDACTED:aws-access-key]") || result.includes("[REDACTED:"), "should have placeholder");
});

// Clean text unchanged
test("redact() leaves clean text unchanged", () => {
  const text = "no secrets here, just normal text with npm install";
  assert.strictEqual(redact(text), text);
});

// Idempotence: redacting already-redacted text returns same
test("redact() is idempotent on already-redacted text", () => {
  const text = "command with [REDACTED:aws-access-key] already done";
  assert.strictEqual(redact(text), text);
});

// scanSecrets() still works (non-global detection unaffected)
test("scanSecrets() still detects single secret", () => {
  const aws = "AKIA" + "E".repeat(16);
  const result = scanSecrets(`key is ${aws}`);
  assert.ok(result !== null, "should detect secret");
});

// scanSecrets() on clean text returns null
test("scanSecrets() returns null on clean text", () => {
  assert.strictEqual(scanSecrets("no secrets here"), null);
});

// ── AWS secret access key: bare (unquoted) form ───────────────────────────
// These three tests FAIL on master (pattern requires quotes) and PASS after
// the ADR-047-adjacent fix to secret-patterns.json (make quotes optional).
// The canonical 40-char AWS secret is used verbatim so the length is exact.
const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"; // 40 chars, valid base64-safe charset

test("scanSecrets() detects bare AWS_SECRET_ACCESS_KEY without quotes (regression)", () => {
  const result = scanSecrets(`AWS_SECRET_ACCESS_KEY=${AWS_SECRET}`);
  assert.ok(result !== null,
    "REGRESSION: scanSecrets() must detect bare AWS_SECRET_ACCESS_KEY (no quotes). " +
    "Pattern currently requires ['\"] around the value — make quotes optional.");
  assert.ok(
    typeof result.name === "string" && result.name.toLowerCase().includes("aws"),
    `Expected AWS pattern name; got ${result && result.name}`
  );
});

test("scanSecrets() detects export-style bare AWS_SECRET_ACCESS_KEY without quotes", () => {
  const result = scanSecrets(`export AWS_SECRET_ACCESS_KEY=${AWS_SECRET}`);
  assert.ok(result !== null,
    "REGRESSION: scanSecrets() must detect export-style bare AWS secret key.");
});

test("scanSecrets() still detects quoted AWS_SECRET_ACCESS_KEY (no regression)", () => {
  const result = scanSecrets(`AWS_SECRET_ACCESS_KEY="${AWS_SECRET}"`);
  assert.ok(result !== null,
    "Quoted AWS secret key must still be detected after the pattern change.");
});

process.stdout.write(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
