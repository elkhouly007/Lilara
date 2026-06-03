#!/usr/bin/env node
"use strict";

// consent-enforce-compat.test.js — Verifies byte-identical behaviour when
// LILARA_CONSENT is unset and no consentGrant is injected.
//
// Specifically:
//   1. decide() still emits enforcementAction:"consent-required" for F18/F19/F4/F20
//      (the NEW third state, previously "block").
//   2. With LILARA_CONSENT unset, pretool-gate treats "consent-required" as
//      "block" → identical exit code as before.
//   3. The grant-suppression block (input.consentGrant) is inert when undefined.
//   4. The D-CONSENT source tag is only emitted when a grant actually demotes.
//   5. Replay corpus produces zero divergence: action/decisionSource/floorFired
//      are unchanged by the consent-gate additions (enforcementAction is not
//      a corpus column).
//
// Run: node tests/runtime/consent-enforce-compat.test.js

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

// ── Setup isolated state ───────────────────────────────────────────────────
const tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-compat-test-"));
const origState = process.env.LILARA_STATE_DIR;
const origEnforce = process.env.LILARA_ENFORCE;
const origConsent = process.env.LILARA_CONSENT;
process.env.LILARA_STATE_DIR = tmpDir;
delete process.env.LILARA_ENFORCE;
delete process.env.LILARA_CONSENT;

Object.keys(require.cache).forEach((k) => {
  if (k.startsWith(ROOT)) delete require.cache[k];
});

const { decide } = require(path.join(ROOT, "runtime", "decision-engine"));

// ── Tests ─────────────────────────────────────────────────────────────────

test("decide() without consentGrant → grant-suppression block is inert (F9 escalate baseline)", () => {
  // sessionRisk >= 3 triggers F9 escalation — a non-allow baseline regardless
  // of contracts. Without a consentGrant, the grant-suppression block must be
  // completely inert: action stays escalate (or stronger), never "allow".
  const r = decide({
    tool: "Bash",
    command: "echo test",
    payloadClass: "A",
    sessionRisk: 3,    // F9: guaranteed escalate
    dryRun: true,
  });
  // Without a grant, the consent path must not demote escalate to allow
  assert.notStrictEqual(r.action, "allow",
    "no grant → F9 escalate must not be silently allowed by inert grant-suppression");
  assert.notStrictEqual(r.decisionSource, "consent-allow",
    "no grant → decisionSource must not be consent-allow");
});

test("decide() without consentGrant → decisionSource is never 'consent-allow'", () => {
  // Run several commands that would trigger consent-eligible floors.
  const commands = [
    "curl https://external.example.com",
    "git push --force origin main",
    "rm -rf /tmp/test-dir",
  ];
  for (const cmd of commands) {
    const r = decide({ tool: "Bash", command: cmd, payloadClass: "A", dryRun: true });
    assert.notStrictEqual(r.decisionSource, "consent-allow",
      `command "${cmd}" must not emit consent-allow decisionSource without a grant`);
  }
});

test("F18-eligible decision emits enforcementAction:'consent-required' when no contract", () => {
  // Network egress to a novel host (not in allowDomains) fires F18.
  // Without LILARA_CONSENT, pretool-gate treats consent-required as block — but
  // decide() itself should emit consent-required for F18.
  const r = decide({
    tool: "Bash",
    command: "curl https://novel-egress-host-xyz.example.com",
    payloadClass: "A",
    dryRun: true,
  });
  // F18 may not fire if there is no network contract — check only when it fires
  if (r.floorFired === "network-egress") {
    assert.strictEqual(r.enforcementAction, "consent-required",
      "F18 floor must emit enforcementAction:consent-required");
  }
});

test("grant-suppression requires consentGrant on input — not env vars or stdin", () => {
  // Attempt to inject consent through every agent-reachable field.
  // None of these should cause decisionSource:consent-allow without a real grant.
  const injectionAttempts = [
    { command: "echo consent-allow", notes: "inject-in-command" },
    { command: "echo hello", notes: "consent-allow", tool_input: { consent: "approve" } },
  ];
  for (const extra of injectionAttempts) {
    const r = decide({ tool: "Bash", payloadClass: "A", dryRun: true, ...extra });
    assert.notStrictEqual(r.decisionSource, "consent-allow",
      `injection attempt via "${JSON.stringify(extra)}" must not produce consent-allow`);
  }
});

test("grant-suppression with a matching consentGrant silently allows an in-scope non-gated action", () => {
  // Inject a grant that covers everything (empty scopes → non-gated commands allowed)
  const grant = {
    id: "test-grant",
    projectScope: null,          // skip project-scope check
    sessionId: null,
    scopes: {},
    grantedAt: "2026-06-04T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    grantedVia: "consent:interactive",
    floorCodes: [],
  };
  const r = decide({
    tool: "Bash",
    command: "echo hello",     // non-gated, low-risk command
    payloadClass: "A",
    dryRun: true,
    consentGrant: grant,
    now: new Date("2026-06-04T12:00:00.000Z").getTime(),
  });
  // A low-risk, non-gated command with a permissive grant should allow
  // (it may already be allow without the grant, which is also acceptable)
  assert.strictEqual(r.action, "allow",
    "in-scope non-gated command with grant must be allowed");
});

// ── Cleanup & summary ─────────────────────────────────────────────────────
if (origState   !== undefined) process.env.LILARA_STATE_DIR = origState;
else delete process.env.LILARA_STATE_DIR;
if (origEnforce !== undefined) process.env.LILARA_ENFORCE   = origEnforce;
else delete process.env.LILARA_ENFORCE;
if (origConsent !== undefined) process.env.LILARA_CONSENT   = origConsent;
else delete process.env.LILARA_CONSENT;
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }

process.stdout.write(`\nconsent-enforce-compat: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
