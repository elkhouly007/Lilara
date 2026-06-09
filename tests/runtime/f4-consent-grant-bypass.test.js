#!/usr/bin/env node
"use strict";

// Regression tests for ADR-047: F4 consent-grant payloadClass bypass.
//
// Root cause: when _scanSecrets() detects a class-C secret in the command text,
// it sets a block-scoped local `secretInCommand` but never mutates
// input.payloadClass. The consent gate's evalConsentFloor() → scopesMatch()
// then reads input.payloadClass="A" and the class-C hard refusal at
// contract.js:572 never fires → grant is considered in-scope → action="allow".
//
// Fix: when floorFired === _F4.name, pass { ...input, payloadClass: "C" } to
// evalConsentFloor so scopesMatch enforces the hard refusal.
//
// Tests 2, 3, 6 FAIL on master (return action="allow") and PASS after fix.
// Tests 1, 4, 5 pass on master and must continue to pass after fix.

const path   = require("path");
const assert = require("assert");
const os     = require("os");
const fs     = require("fs");

const root = path.resolve(__dirname, "..", "..");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); }
  catch (err) { failed++; process.stderr.write(`  FAIL ${name}: ${err.message}\n`); }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Run decide() in a fresh, isolated environment. Clears the module cache so
 *  each call picks up a clean engine state with the temp LILARA_STATE_DIR. */
function freshDecide(input) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-f4test-"));
  const envSnap  = Object.assign({}, process.env);
  try {
    process.env.LILARA_STATE_DIR        = stateDir;
    process.env.LILARA_CONTRACT_ENABLED = "0";
    process.env.LILARA_RATE_LIMIT       = "0";
    delete process.env.LILARA_F4_DEMOTE_TOKEN; // prevent operator-token path
    // Clear runtime module cache so engine re-initialises with the temp dir.
    for (const k of Object.keys(require.cache)) {
      if (k.includes(path.sep + "runtime" + path.sep)) delete require.cache[k];
    }
    const { decide } = require(path.join(root, "runtime", "decision-engine"));
    return decide(input);
  } finally {
    // Restore env
    for (const k of Object.keys(process.env)) { if (!(k in envSnap)) delete process.env[k]; }
    for (const [k, v] of Object.entries(envSnap)) process.env[k] = v;
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// Fixed epoch ms for grant expiry check (2026-06-09 12:00 UTC)
const NOW_MS = new Date("2026-06-09T12:00:00Z").getTime();

// A broad Bash consent grant that covers all Bash commands (no path/command
// restrictions) — the minimum grant needed to reproduce the bypass.
const BROAD_BASH_GRANT = {
  id:          "f4-bypass-regression-grant",
  projectScope: null,   // null skips project-scope check
  sessionId:   null,
  scopes:      { tools: { perToolAllow: [{ tool: "Bash" }] } },
  grantedAt:   "2026-01-01T00:00:00Z",
  expiresAt:   "2099-01-01T00:00:00Z",
  grantedVia:  "consent:interactive",
  floorCodes:  [],
};

// ── Test 1: baseline (no grant) — F4 must block ────────────────────────────
test("baseline: F4 blocks echo+GitHub-PAT without grant", () => {
  const r = freshDecide({
    tool: "Bash", branch: "test",
    command: "echo ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  });
  assert.strictEqual(r.action, "block",
    `Baseline must block; got action=${r.action}`);
  assert.strictEqual(r.floorFired, "secret-class-C",
    `Baseline must fire F4; got floorFired=${r.floorFired}`);
});

// ── Test 2: THE REGRESSION — broad grant must NOT bypass F4 ───────────────
test("REGRESSION: F4 stays block with broad Bash consent grant (echo+GitHub-PAT)", () => {
  const r = freshDecide({
    tool: "Bash", branch: "test",
    command: "echo ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    consentGrant: BROAD_BASH_GRANT,
    now: NOW_MS,
  });
  assert.strictEqual(r.action, "block",
    `REGRESSION: F4 block was bypassed by consent grant — action=${r.action} floorFired=${r.floorFired}. ` +
    `input.payloadClass must be propagated to evalConsentFloor when floorFired===F4.name`);
});

// ── Test 3: grant + secret-to-file still blocked ──────────────────────────
test("REGRESSION: F4 stays block with grant: echo secret > /tmp/leak.txt", () => {
  const r = freshDecide({
    tool: "Bash", branch: "test",
    command: "echo ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA > /tmp/leak.txt",
    consentGrant: BROAD_BASH_GRANT,
    now: NOW_MS,
  });
  assert.strictEqual(r.action, "block",
    `F4 must stay block for secret-to-file with grant; got action=${r.action}`);
});

// ── Test 4: explicit payloadClass="C" + grant still blocked ───────────────
test("sanity: explicit payloadClass=C + broad grant stays block", () => {
  const r = freshDecide({
    tool: "Bash", branch: "test",
    command: "export customer list",
    payloadClass: "C",
    consentGrant: BROAD_BASH_GRANT,
    now: NOW_MS,
  });
  assert.strictEqual(r.action, "block",
    `Explicit payloadClass=C + grant must block; got action=${r.action}`);
});

// ── Test 5: non-secret command + grant not over-blocked ───────────────────
test("non-secret low-risk command with grant is not blocked", () => {
  const r = freshDecide({
    tool: "Bash", branch: "test",
    command: "ls -la",
    consentGrant: BROAD_BASH_GRANT,
    now: NOW_MS,
  });
  assert.notStrictEqual(r.action, "block",
    `Non-secret+grant must not block; got action=${r.action} — fix must not break consent path for safe commands`);
});

// ── Test 6: cross-floor guard — protected branch + secret + grant ─────────
// Uses branch:"main" (protected) to exercise the case where the risk engine
// sets a non-block action (protected-branch risk → require-review) BEFORE F4
// fires. F4 then sets action="block" and floorFired="secret-class-C". The
// proxy (floorFired === _F4.name) must still hold here.
// FAILS on master (returns allow); PASSES after fix.
test("REGRESSION: F4 stays block on protected branch (branch=main) + broad grant", () => {
  const r = freshDecide({
    tool: "Bash", branch: "main",
    command: "echo ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    consentGrant: BROAD_BASH_GRANT,
    now: NOW_MS,
  });
  assert.strictEqual(r.action, "block",
    `F4 must stay block on protected branch with grant; got action=${r.action} floorFired=${r.floorFired}. ` +
    `Proxy floorFired===_F4.name must hold across protected-branch interaction`);
});

// ── Summary ────────────────────────────────────────────────────────────────
process.stdout.write(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
