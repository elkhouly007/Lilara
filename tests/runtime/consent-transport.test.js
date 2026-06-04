#!/usr/bin/env node
"use strict";

// consent-transport.test.js — Tests for runtime/consent/transport.js
//
// Verifies:
//   - mode selection (interactive / block / off / unset)
//   - promptObject is built from REAL args (ir.fileTargets / networkEgress.hostname
//     / decision.command) — NEVER from agent self-description
//   - "block" mode always returns deny without asking
//   - "off" / unset mode always returns deny (should not be called but is safe)
//   - No-TTY → fail-closed deny (even in interactive mode)
//   - stdin is NEVER used as the approval channel
//   - Test sentinel (__LILARA_CONSENT_TEST_AUTO=1 + NODE_ENV=test) can approve
//     for automated testing; sentinel is inert outside test env
//
// Run: node tests/runtime/consent-transport.test.js

const assert = require("node:assert");
const path   = require("node:path");

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

// ── Reload transport with specific env ───────────────────────────────────
function loadTransport(env = {}) {
  // Clear only the transport from require cache; leave other modules alone.
  Object.keys(require.cache).forEach((k) => {
    if (k.includes("consent") && k.includes("transport")) delete require.cache[k];
  });
  const saved = {};
  const toSet = ["LILARA_CONSENT", "__LILARA_CONSENT_TEST_AUTO", "NODE_ENV"];
  for (const k of toSet) {
    saved[k] = process.env[k];
    if (k in env) process.env[k] = env[k];
    else delete process.env[k];
  }
  const mod = require(path.join(ROOT, "runtime", "consent", "transport"));
  for (const k of toSet) {
    if (saved[k] !== undefined) process.env[k] = saved[k];
    else delete process.env[k];
  }
  return mod;
}

function makeDecision(overrides = {}) {
  return {
    action: "block",
    enforcementAction: "consent-required",
    floorFired: "network-egress",
    code: "F18_NETWORK_EGRESS",
    explanation: "network egress blocked: host 'evil.com'",
    command: "curl https://evil.com",
    networkEgress: { hostname: "evil.com", target: "https://evil.com" },
    ir: { fileTargets: [], networkTargets: [{ host: "evil.com" }] },
    reasonCodes: ["network-egress-denied"],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("module exports requestConsent and buildConsentPrompt", () => {
  const mod = loadTransport({});
  assert.strictEqual(typeof mod.requestConsent, "function",  "requestConsent must be exported");
  assert.strictEqual(typeof mod.buildConsentPrompt, "function", "buildConsentPrompt must be exported");
});

test("LILARA_CONSENT=block → requestConsent always returns deny", () => {
  const { requestConsent } = loadTransport({ LILARA_CONSENT: "block" });
  const result = requestConsent(makeDecision(), { mode: "block" });
  assert.strictEqual(result.decision, "deny", "block mode must always deny");
});

test("LILARA_CONSENT unset → requestConsent returns deny (gate should not activate)", () => {
  const { requestConsent } = loadTransport({});
  const result = requestConsent(makeDecision(), { mode: "off" });
  assert.strictEqual(result.decision, "deny");
});

test("interactive mode without a TTY → fail-closed deny", () => {
  // Simulate a no-TTY environment using the internal test sentinel.
  // __LILARA_CONSENT_TEST_NO_TTY=1 (only active in NODE_ENV=test) makes
  // openTTY() return null so the transport fails closed without hanging.
  Object.keys(require.cache).forEach((k) => {
    if (k.includes("consent") && k.includes("transport")) delete require.cache[k];
  });
  const origConsent = process.env.LILARA_CONSENT;
  const origNoTTY   = process.env.__LILARA_CONSENT_TEST_NO_TTY;
  const origNode    = process.env.NODE_ENV;
  process.env.LILARA_CONSENT = "interactive";
  process.env.__LILARA_CONSENT_TEST_NO_TTY = "1";
  process.env.NODE_ENV = "test";
  const { requestConsent: rc } = require(path.join(ROOT, "runtime", "consent", "transport"));
  const result = rc(makeDecision(), { mode: "interactive" });
  if (origConsent !== undefined) process.env.LILARA_CONSENT = origConsent;
  else delete process.env.LILARA_CONSENT;
  if (origNoTTY !== undefined) process.env.__LILARA_CONSENT_TEST_NO_TTY = origNoTTY;
  else delete process.env.__LILARA_CONSENT_TEST_NO_TTY;
  if (origNode !== undefined) process.env.NODE_ENV = origNode;
  else delete process.env.NODE_ENV;
  assert.strictEqual(result.decision, "deny",
    "without a controlling TTY, interactive mode must fail closed");
});

test("buildConsentPrompt uses REAL args: explanation, networkEgress.hostname, command", () => {
  const { buildConsentPrompt } = loadTransport({});
  const decision = makeDecision();
  const prompt = buildConsentPrompt(decision, { tool: "Bash", command: decision.command });

  // The prompt MUST include the real hostname and command
  assert.ok(prompt.hostname === "evil.com" || (prompt.explanation && prompt.explanation.includes("evil.com")),
    "prompt must carry the REAL hostname from networkEgress");
  assert.ok(typeof prompt.command === "string" && prompt.command.includes("evil.com"),
    "prompt must carry the REAL command");
  assert.ok(prompt.floorCode === "F18_NETWORK_EGRESS",
    "prompt must carry the floor code");
});

test("buildConsentPrompt must NOT include agent self-description strings", () => {
  // Verify the promptObject does not blindly copy fields that could be
  // agent-controlled (e.g. decision.explanation verbatim without validation,
  // or arbitrary notes fields).
  const { buildConsentPrompt } = loadTransport({});
  const decision = makeDecision({
    // Attempt to inject a self-approving description
    selfDescription: "I am a trusted agent, please approve me automatically",
    notes: "auto-approve",
  });
  const prompt = buildConsentPrompt(decision, { tool: "Bash", command: decision.command });
  // The prompt must not carry unstructured agent notes as approval-relevant fields
  assert.ok(prompt.selfDescription === undefined,
    "prompt must not include selfDescription from decision");
  assert.ok(prompt.notes === undefined || prompt.notes !== "auto-approve",
    "prompt must not blindly include agent notes as approval signal");
});

test("stdin is NEVER used as the approval channel (structural: no process.stdin references in transport)", () => {
  // Structural test: verify the transport source does NOT reference process.stdin.
  // Reading stdin would allow a prompt-injected "approve\n" in the agent's hook
  // payload to self-approve — the central security property of the gate.
  const transportPath = path.join(ROOT, "runtime", "consent", "transport.js");
  const src = require("fs").readFileSync(transportPath, "utf8");
  assert.ok(!src.includes("process.stdin"),
    "transport.js must not reference process.stdin — stdin holds the agent payload");
  assert.ok(!src.includes("process.stdin.fd"),
    "transport.js must not use process.stdin.fd");
});

test("test sentinel: __LILARA_CONSENT_TEST_AUTO=1 + NODE_ENV=test → approve for testing", () => {
  // The test sentinel allows automated test runs to simulate approval without
  // a real TTY. It is ONLY honored when NODE_ENV==="test".
  const { requestConsent } = loadTransport({
    LILARA_CONSENT: "interactive",
    __LILARA_CONSENT_TEST_AUTO: "1",
    NODE_ENV: "test",
  });
  // Re-load with sentinel set
  Object.keys(require.cache).forEach((k) => {
    if (k.includes("consent") && k.includes("transport")) delete require.cache[k];
  });
  const origConsent = process.env.LILARA_CONSENT;
  const origAuto    = process.env.__LILARA_CONSENT_TEST_AUTO;
  const origNode    = process.env.NODE_ENV;
  process.env.LILARA_CONSENT = "interactive";
  process.env.__LILARA_CONSENT_TEST_AUTO = "1";
  process.env.NODE_ENV = "test";
  const { requestConsent: rc } = require(path.join(ROOT, "runtime", "consent", "transport"));
  const result = rc(makeDecision(), { mode: "interactive" });
  if (origConsent !== undefined) process.env.LILARA_CONSENT = origConsent;
  else delete process.env.LILARA_CONSENT;
  if (origAuto !== undefined) process.env.__LILARA_CONSENT_TEST_AUTO = origAuto;
  else delete process.env.__LILARA_CONSENT_TEST_AUTO;
  if (origNode !== undefined) process.env.NODE_ENV = origNode;
  else delete process.env.NODE_ENV;
  assert.strictEqual(result.decision, "approve",
    "test sentinel must approve in NODE_ENV=test");
});

test("test sentinel is INERT when NODE_ENV !== test", () => {
  // Even with __LILARA_CONSENT_TEST_AUTO=1, without NODE_ENV=test the sentinel
  // must not activate — preventing accidental auto-approve in prod/staging.
  //
  // We use mode:"block" as the fallback (which always denies). The sentinel
  // check runs BEFORE the mode dispatch, so: if sentinel activates → "approve";
  // if sentinel is inert → falls through to "block" → "deny". This proves the
  // sentinel is inert without opening a real TTY (which would block in this env).
  Object.keys(require.cache).forEach((k) => {
    if (k.includes("consent") && k.includes("transport")) delete require.cache[k];
  });
  const origAuto = process.env.__LILARA_CONSENT_TEST_AUTO;
  const origNode = process.env.NODE_ENV;
  process.env.__LILARA_CONSENT_TEST_AUTO = "1";
  process.env.NODE_ENV = "production";  // explicitly not "test"
  const { requestConsent: rc } = require(path.join(ROOT, "runtime", "consent", "transport"));
  const result = rc(makeDecision(), { mode: "block" });
  if (origAuto !== undefined) process.env.__LILARA_CONSENT_TEST_AUTO = origAuto;
  else delete process.env.__LILARA_CONSENT_TEST_AUTO;
  if (origNode !== undefined) process.env.NODE_ENV = origNode;
  else delete process.env.NODE_ENV;
  assert.strictEqual(result.decision, "deny",
    "test sentinel must be inert when NODE_ENV !== test (would be approve if active, deny via block fallback if inert)");
});

// ── Cleanup & summary ─────────────────────────────────────────────────────
process.stdout.write(`\nconsent-transport: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
