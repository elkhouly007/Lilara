#!/usr/bin/env node
"use strict";

// consent-floor.test.js — Tests for runtime/floor-consent.js
//
// The pure consent floor evaluator. Checks grant validity, expiry,
// project-scope binding, and scope matching — all without I/O beyond
// the already-blessed scopesMatch realpath (same as the contract-allow path).
//
// Run: node tests/runtime/consent-floor.test.js

const assert = require("node:assert");
const crypto = require("node:crypto");
const path   = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

// ── Pin a deterministic project scope so git probing is skipped ───────────
const _ORIG_PROJECT_ID = process.env.LILARA_PROJECT_ID;
process.env.LILARA_PROJECT_ID = "consent-floor-test";
// Mirrors project-scope.js: "x:" + sha256(override).slice(0, 12)
const _EXPECTED_PS = "x:" + crypto.createHash("sha256")
  .update("consent-floor-test").digest("hex").slice(0, 12);

// Require AFTER setting LILARA_PROJECT_ID so projectScope() sees the override.
const { evalConsentFloor } = require(path.join(ROOT, "runtime", "floor-consent"));

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`  FAIL ${name}: ${err && err.message || err}\n`);
    if (err && err.stack) process.stderr.write(err.stack + "\n");
  }
}

// ── Fixture helpers ───────────────────────────────────────────────────────
const _FUTURE = "2099-01-01T00:00:00.000Z";
const _PAST   = "2020-01-01T00:00:00.000Z";
const _NOW_MS = new Date("2026-06-04T12:00:00.000Z").getTime();

function makeGrant(overrides = {}) {
  return {
    id:          "test-grant-id",
    projectScope: _EXPECTED_PS,
    sessionId:   null,
    scopes:      {},
    grantedAt:   "2026-06-04T00:00:00.000Z",
    expiresAt:   _FUTURE,
    grantedVia:  "consent:interactive",
    floorCodes:  [],
    ...overrides,
  };
}

function makeInput(overrides = {}) {
  return {
    tool:        "Bash",
    command:     "echo hello",
    payloadClass: "A",
    projectRoot: "",
    now:         _NOW_MS,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("null grant → inScope:false, reason:no-grant", () => {
  const r = evalConsentFloor(makeInput(), null, null);
  assert.strictEqual(r.inScope, false);
  assert.strictEqual(r.reason, "no-grant");
});

test("undefined grant → inScope:false", () => {
  const r = evalConsentFloor(makeInput(), undefined, null);
  assert.strictEqual(r.inScope, false);
  assert.ok(r.reason, "should have a reason");
});

test("expired grant → inScope:false, reason:grant-expired", () => {
  const grant = makeGrant({ expiresAt: _PAST });
  const r = evalConsentFloor(makeInput({ now: _NOW_MS }), grant, null);
  assert.strictEqual(r.inScope, false);
  assert.strictEqual(r.reason, "grant-expired");
});

test("grant with future expiry is not expired", () => {
  const grant = makeGrant({ expiresAt: _FUTURE });
  const r = evalConsentFloor(makeInput(), grant, null);
  assert.notStrictEqual(r.reason, "grant-expired");
});

test("project scope mismatch → inScope:false, reason:grant-project-mismatch", () => {
  const grant = makeGrant({ projectScope: "r:different-project-abc123" });
  const r = evalConsentFloor(makeInput(), grant, null);
  assert.strictEqual(r.inScope, false);
  assert.strictEqual(r.reason, "grant-project-mismatch");
});

test("null project scope on grant skips the project-scope check", () => {
  const grant = makeGrant({ projectScope: null });
  const r = evalConsentFloor(makeInput({ command: "echo hello" }), grant, null);
  // With empty scopes and a non-gated command, scopesMatch returns allowed
  assert.strictEqual(r.inScope, true);
});

test("in-scope: non-gated command with empty grant scopes → inScope:true", () => {
  const grant = makeGrant({ scopes: {} });
  const r = evalConsentFloor(makeInput({ command: "echo hello" }), grant, null);
  assert.strictEqual(r.inScope, true);
});

test("class-C payload is never in-scope even with a permissive grant", () => {
  // scopesMatch hard-refuses class-C at line ~570 regardless of scopes.
  const grant = makeGrant({ scopes: {} });
  const r = evalConsentFloor(makeInput({ payloadClass: "C" }), grant, null);
  assert.strictEqual(r.inScope, false);
  // The reason should reference the class-C refusal
  assert.ok(
    typeof r.reason === "string" && r.reason.length > 0,
    "must have a non-empty reason"
  );
});

test("missing input.now → expiry not checked, no crash", () => {
  const grant = makeGrant({ expiresAt: _PAST });
  // Without injected now, expiry check is skipped (caller misconfiguration).
  // The function must not throw and must return a valid result object.
  const r = evalConsentFloor(makeInput({ now: undefined }), grant, null);
  assert.ok(typeof r.inScope === "boolean", "inScope must be boolean");
  assert.ok(typeof r.reason === "string",   "reason must be a string");
});

test("result shape always has inScope (boolean) and reason (string)", () => {
  const cases = [
    [makeInput(), null,                         null],
    [makeInput(), makeGrant({ expiresAt: _PAST }), null],
    [makeInput(), makeGrant({ projectScope: "r:other" }), null],
    [makeInput(), makeGrant(),                  null],
  ];
  for (const [input, grant, contract] of cases) {
    const r = evalConsentFloor(input, grant, contract);
    assert.ok(typeof r.inScope === "boolean", `inScope must be boolean (got ${typeof r.inScope})`);
    assert.ok(typeof r.reason  === "string",  `reason must be string (got ${typeof r.reason})`);
  }
});

test("pure: same inputs produce identical outputs (no side effects)", () => {
  const grant = makeGrant();
  const input = makeInput();
  const r1 = evalConsentFloor(input, grant, null);
  const r2 = evalConsentFloor(input, grant, null);
  assert.deepStrictEqual(r1, r2);
});

// ── Cleanup & summary ─────────────────────────────────────────────────────
if (_ORIG_PROJECT_ID !== undefined) process.env.LILARA_PROJECT_ID = _ORIG_PROJECT_ID;
else delete process.env.LILARA_PROJECT_ID;

process.stdout.write(`\nconsent-floor: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
