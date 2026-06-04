#!/usr/bin/env node
"use strict";

// consent-early-review-fix.test.js — Tests for:
//   1. The D-CONSENT lattice entry (consent demotion source).
//   2. enforcementFor() — maps action + floorFired → "consent-required" | "block" | "warn".
//   3. buildEarlyReview latent bug fix: require-review early receipts must
//      now emit enforcementAction:"block" (not "require-review") for
//      non-consent-eligible floors, and "consent-required" for consent-eligible ones.
//   4. buildEarlyBlock correctly emits "consent-required" for F18/F19/F4/F20
//      and "block" for all other floors.
//
// Run: node tests/runtime/consent-early-review-fix.test.js

const assert = require("node:assert");
const path   = require("node:path");
const os     = require("node:os");
const fs     = require("node:fs");

const ROOT = path.join(__dirname, "..", "..");

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

// ── Lattice tests ─────────────────────────────────────────────────────────

const {
  getEntry, getEntryByName, canDemote, assertOrdered, LATTICE, enforcementFor,
} = require(path.join(ROOT, "runtime", "decision-lattice"));

test("D-CONSENT lattice entry exists at rung 18.25", () => {
  const e = getEntry("D-CONSENT");
  assert.ok(e, "D-CONSENT entry must exist");
  assert.strictEqual(e.rung, 18.25, "D-CONSENT must be at rung 18.25");
  assert.strictEqual(e.id, "D-CONSENT");
});

test("D-CONSENT is between D-CONTRACT-ALLOW (18) and F20 (18.5)", () => {
  const dc = getEntry("D-CONTRACT-ALLOW");
  const consent = getEntry("D-CONSENT");
  const f20 = getEntry("F20");
  assert.ok(dc && consent && f20, "all three entries must exist");
  assert.ok(dc.rung < consent.rung, "D-CONTRACT-ALLOW must come before D-CONSENT");
  assert.ok(consent.rung < f20.rung, "D-CONSENT must come before F20");
});

test("assertOrdered passes with D-CONSENT added", () => {
  assert.doesNotThrow(() => assertOrdered());
});

test("canDemote(F18, consent:interactive) → true", () => {
  const f18 = getEntry("F18");
  assert.ok(f18, "F18 must exist");
  assert.strictEqual(canDemote("F18", "consent:interactive"), true,
    "F18 must be demotable by consent:interactive");
});

test("canDemote(F19, consent:interactive) → true", () => {
  assert.strictEqual(canDemote("F19", "consent:interactive"), true,
    "F19 must be demotable by consent:interactive");
});

test("canDemote(F4, consent:interactive) → true", () => {
  assert.strictEqual(canDemote("F4", "consent:interactive"), true,
    "F4 must be demotable by consent:interactive");
});

test("canDemote(F20, consent:interactive) → true", () => {
  assert.strictEqual(canDemote("F20", "consent:interactive"), true,
    "F20 must be demotable by consent:interactive");
});

test("inviolable floors are NOT demotable by consent:interactive", () => {
  const inviolable = ["F1", "F2", "F3", "F5", "F8", "F11", "F12", "F13", "F14", "F17", "F23", "F24"];
  for (const id of inviolable) {
    assert.strictEqual(canDemote(id, "consent:interactive"), false,
      `${id} must NOT be demotable by consent:interactive`);
  }
});

test("existing operator-token demotion paths are preserved", () => {
  // F4 still demotable by its original operator-token path (additive only)
  assert.strictEqual(canDemote("F4", "operator-token:class-c-review-demote"), true,
    "F4 must still be demotable by operator-token");
  // F19 still demotable by suspicious-only token
  assert.strictEqual(canDemote("F19", "operator-token-suspicious-only"), true,
    "F19 must still be demotable by suspicious-only token");
  // F20 still demotable by medium-only token
  assert.strictEqual(canDemote("F20", "operator-token-medium-only"), true,
    "F20 must still be demotable by medium-only token");
});

// ── enforcementFor tests ──────────────────────────────────────────────────

test("enforcementFor is exported from decision-lattice", () => {
  assert.strictEqual(typeof enforcementFor, "function",
    "enforcementFor must be a function exported from decision-lattice");
});

test("enforcementFor(allow, null) → warn", () => {
  assert.strictEqual(enforcementFor("allow", null), "warn");
});

test("enforcementFor(warn, null) → warn", () => {
  assert.strictEqual(enforcementFor("warn", null), "warn");
});

test("enforcementFor(block, null) → block (no floor = inviolable)", () => {
  assert.strictEqual(enforcementFor("block", null), "block");
});

test("enforcementFor(block, 'network-egress') → consent-required (F18 is consent-eligible)", () => {
  // F18.name === "network-egress"
  const f18 = getEntry("F18");
  assert.strictEqual(enforcementFor("block", f18.name), "consent-required");
});

test("enforcementFor(block, 'secret-class-C') → consent-required (F4 is consent-eligible)", () => {
  const f4 = getEntry("F4");
  assert.strictEqual(enforcementFor("block", f4.name), "consent-required");
});

test("enforcementFor(block, 'output-channel-exfiltration') → consent-required (F19)", () => {
  const f19 = getEntry("F19");
  assert.strictEqual(enforcementFor("block", f19.name), "consent-required");
});

test("enforcementFor(block, 'change-intent-drift') → consent-required (F20)", () => {
  const f20 = getEntry("F20");
  assert.strictEqual(enforcementFor("block", f20.name), "consent-required");
});

test("enforcementFor(block, 'kill-switch') → block (F1 is non-demotable)", () => {
  const f1 = getEntry("F1");
  assert.strictEqual(enforcementFor("block", f1.name), "block");
});

test("enforcementFor(block, 'kill-switch-engaged') → block (unknown name → safe default)", () => {
  // An unrecognized floorFired string falls back to block (fail-safe).
  assert.strictEqual(enforcementFor("block", "some-unknown-floor"), "block");
});

test("enforcementFor(escalate, 'network-egress') → consent-required (F18 consent-eligible)", () => {
  const f18 = getEntry("F18");
  assert.strictEqual(enforcementFor("escalate", f18.name), "consent-required");
});

test("enforcementFor(escalate, 'data-flow-kill-chain') → block (F23 non-demotable)", () => {
  const f23 = getEntry("F23");
  assert.strictEqual(enforcementFor("escalate", f23.name), "block");
});

test("enforcementFor(require-review, null) → block (no floor = non-demotable)", () => {
  // This is the latent-bug fix: old code returned "require-review"; now "block".
  assert.strictEqual(enforcementFor("require-review", null), "block");
});

test("enforcementFor(require-tests, null) → block", () => {
  assert.strictEqual(enforcementFor("require-tests", null), "block");
});

// ── buildEarlyReview latent bug fix ───────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-erfix-test-"));
const origState = process.env.LILARA_STATE_DIR;
process.env.LILARA_STATE_DIR = tmpDir;
// Clear cache so journal uses the tmp dir
Object.keys(require.cache).forEach((k) => {
  if (k.includes("decision-engine") || k.includes("early-receipt") ||
      k.includes("decision-journal") || k.includes("session-context") ||
      k.includes("state-paths") || k.includes("state-dir"))
    delete require.cache[k];
});

const { buildEarlyReview, buildEarlyBlock } = require(
  path.join(ROOT, "runtime", "early-receipt-builder")
);

const _MOCK_INPUT   = { tool: "Bash", command: "curl https://evil.com", branch: "main", ir: null };
const _MOCK_ENRICH  = {};
const _MOCK_DISC    = {};

test("buildEarlyReview with null floorFired → enforcementAction:'block' (bug fix)", () => {
  // The latent bug: old code hardcoded enforcementAction:"require-review".
  // Post-fix: null floorFired → enforcementFor(require-review, null) → "block".
  const result = buildEarlyReview(
    "mcp-unscannable-payload",
    _MOCK_ENRICH,
    _MOCK_DISC,
    _MOCK_INPUT,
    "test explanation",
    { floorFired: null }
  );
  assert.strictEqual(result.action, "require-review");
  assert.strictEqual(result.enforcementAction, "block",
    "buildEarlyReview must emit enforcementAction:block for non-consent-eligible floors (latent bug fix)");
});

test("buildEarlyBlock with F18 floorFired → enforcementAction:'consent-required'", () => {
  const f18 = getEntry("F18");
  const result = buildEarlyBlock(
    "network-egress-denied",
    _MOCK_ENRICH,
    _MOCK_DISC,
    _MOCK_INPUT,
    "network egress blocked",
    { floorFired: f18.name }
  );
  assert.strictEqual(result.action, "block");
  assert.strictEqual(result.enforcementAction, "consent-required",
    "F18 early block must emit enforcementAction:consent-required (consent-eligible)");
});

test("buildEarlyBlock with F1 floorFired → enforcementAction:'block' (kill-switch non-demotable)", () => {
  const f1 = getEntry("F1");
  const result = buildEarlyBlock(
    "kill-switch",
    _MOCK_ENRICH,
    _MOCK_DISC,
    _MOCK_INPUT,
    "kill-switch engaged",
    { floorFired: f1.name }
  );
  assert.strictEqual(result.enforcementAction, "block");
});

test("buildEarlyBlock with null floorFired → enforcementAction:'block'", () => {
  const result = buildEarlyBlock(
    "contract-floor",
    _MOCK_ENRICH,
    _MOCK_DISC,
    _MOCK_INPUT,
    "contract violation",
    { floorFired: null }
  );
  assert.strictEqual(result.enforcementAction, "block");
});

// ── Cleanup & summary ─────────────────────────────────────────────────────
if (origState !== undefined) process.env.LILARA_STATE_DIR = origState;
else delete process.env.LILARA_STATE_DIR;
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }

process.stdout.write(`\nconsent-early-review-fix: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
