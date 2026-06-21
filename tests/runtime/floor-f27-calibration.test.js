"use strict";

// floor-f27-calibration.test.js — PR-B F27 consent-posture calibration evidence.
//
// Loads tests/fixtures/replay-corpus/secret-egress-consent-adversarial.jsonl
// (14 entries: 10 positive, 4 negative) and asserts byte-identical replay under
// LILARA_F27_CONSENT=1 + TTY=true. Also verifies the fail-closed no-TTY path.
//
// Suite structure:
//   A) Structural — corpus loads 14 entries, positive/negative split correct.
//   B) Positive probes — each fires F27 → escalate/consent-required (zero-FN).
//   C) irHash byte-stability — positive probes irHash unchanged from recorded.
//   D) Negative probes — zero FP: none fire F27 under consent posture.
//   E) No-TTY fail-closed — consent posture blocks when no controlling TTY.
//
// Run: node tests/runtime/floor-f27-calibration.test.js

const { test } = require("node:test");
const assert   = require("node:assert/strict");
const fs       = require("node:fs");
const os       = require("node:os");
const path     = require("node:path");

const ROOT        = path.join(__dirname, "..", "..");
const CORPUS_PATH = path.join(ROOT, "tests", "fixtures", "replay-corpus",
                               "secret-egress-consent-adversarial.jsonl");

const F27_FLOOR          = "secret-egress-external";
const F27_CONSENT_SOURCE = "secret-egress-consent-required";
const F27_NO_TTY_SOURCE  = "secret-egress-consent-no-tty";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadCorpus() {
  const lines = fs.readFileSync(CORPUS_PATH, "utf8").trim().split(/\r?\n/).filter(Boolean);
  return lines.map((line, idx) => {
    try { return JSON.parse(line); }
    catch (err) { throw new Error(`corpus line ${idx + 1}: ${err.message}`); }
  });
}

function withTTY(value, fn) {
  const outDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const errDesc = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value, configurable: true });
  try {
    return fn();
  } finally {
    if (outDesc) Object.defineProperty(process.stdout, "isTTY", outDesc);
    else try { delete process.stdout.isTTY; } catch { /* ignore */ }
    if (errDesc) Object.defineProperty(process.stderr, "isTTY", errDesc);
    else try { delete process.stderr.isTTY; } catch { /* ignore */ }
  }
}

// Isolation harness mirrors replay-decisions.js exactly so unit-test and
// replay-gate outputs are byte-identical.
function isolatedDecide(input, { tty = true } = {}) {
  const envSnap = Object.assign({}, process.env);
  const restoreEnv = () => {
    for (const k of Object.keys(process.env)) if (!(k in envSnap)) delete process.env[k];
    for (const [k, v] of Object.entries(envSnap)) process.env[k] = v;
  };

  process.env.LILARA_CONTRACT_ENABLED      = "0";
  process.env.LILARA_TRAJECTORY_WINDOW_MIN = "0";
  process.env.LILARA_RATE_LIMIT            = "0";
  process.env.LILARA_F27_CONSENT           = "1";
  process.env.LILARA_BRANCH_OVERRIDE       = "replay/isolated-context";
  delete process.env.LILARA_KILL_SWITCH;
  delete process.env.LILARA_CONTRACT_REQUIRED;
  delete process.env.LILARA_F4_DEMOTE_TOKEN;

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f27cal-test-"));
  process.env.LILARA_STATE_DIR = stateDir;

  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(ROOT, "runtime") + path.sep)) {
      delete require.cache[key];
    }
  }

  try {
    return withTTY(tty, () => {
      const { decide }         = require(path.join(ROOT, "runtime", "decision-engine"));
      const { build: buildIr } = require(path.join(ROOT, "runtime", "action-ir"));
      const { resetCache }     = require(path.join(ROOT, "runtime", "session-context"));
      resetCache();
      const ir     = buildIr(input, { harness: "claude", tool: input.tool });
      const result = decide(input);
      return { result, irHash: ir.irHash || null };
    });
  } finally {
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    restoreEnv();
  }
}

// ---------------------------------------------------------------------------
// Partition corpus
// ---------------------------------------------------------------------------

const CORPUS   = loadCorpus();
const POSITIVE = CORPUS.filter(e => e.expected.floorFired === F27_FLOOR);
const NEGATIVE = CORPUS.filter(e => e.expected.floorFired !== F27_FLOOR);

// ---------------------------------------------------------------------------
// A) Structural
// ---------------------------------------------------------------------------

test("PR-B — calibration corpus loads 14 entries", () => {
  assert.equal(CORPUS.length, 14, "corpus must have exactly 14 entries");
});

test("PR-B — corpus has 10 positive and 4 negative probes", () => {
  assert.equal(POSITIVE.length, 10, "expected 10 positive probes");
  assert.equal(NEGATIVE.length, 4,  "expected 4 negative probes");
});

test("PR-B — all positive entries record escalate/consent-required", () => {
  for (const entry of POSITIVE) {
    assert.equal(entry.expected.action, "escalate",           entry.tag);
    assert.equal(entry.expected.decisionSource, F27_CONSENT_SOURCE, entry.tag);
    assert.equal(entry.expected.floorFired,     F27_FLOOR,          entry.tag);
    assert.match(entry.expected.irHash, /^sha256:/,           entry.tag);
  }
});

test("PR-B — all negative entries record non-F27 outcome", () => {
  for (const entry of NEGATIVE) {
    assert.notEqual(entry.expected.floorFired, F27_FLOOR, entry.tag);
    assert.equal(entry.expected.floorFired, null,         entry.tag);
  }
});

// ---------------------------------------------------------------------------
// B) Positive probes — must fire F27 → escalate under consent+TTY
// ---------------------------------------------------------------------------

test("PR-B — positive probes escalate under consent+TTY (zero-FN)", () => {
  for (const entry of POSITIVE) {
    const { result } = isolatedDecide(entry.input, { tty: true });
    assert.equal(result.action,         "escalate",         entry.tag);
    assert.equal(result.decisionSource, F27_CONSENT_SOURCE, entry.tag);
    assert.equal(result.floorFired,     F27_FLOOR,          entry.tag);
  }
});

// ---------------------------------------------------------------------------
// C) irHash byte-stability under consent posture
// ---------------------------------------------------------------------------

test("PR-B — positive probes irHash byte-stable under consent posture", () => {
  for (const entry of POSITIVE) {
    const { irHash } = isolatedDecide(entry.input, { tty: true });
    assert.equal(irHash, entry.expected.irHash,
      `${entry.tag}: irHash drifted from recorded corpus value`);
  }
});

// ---------------------------------------------------------------------------
// D) Negative probes — zero FP: F27 must NOT fire
// ---------------------------------------------------------------------------

test("PR-B — negative probes: zero false positives under consent posture", () => {
  for (const entry of NEGATIVE) {
    const { result } = isolatedDecide(entry.input, { tty: true });
    assert.notEqual(
      result.floorFired, F27_FLOOR,
      `${entry.tag}: false positive — F27 fired unexpectedly`
    );
    assert.equal(result.action,         entry.expected.action,         entry.tag);
    assert.equal(result.decisionSource, entry.expected.decisionSource, entry.tag);
    assert.equal(result.floorFired,     entry.expected.floorFired,     entry.tag);
  }
});

// ---------------------------------------------------------------------------
// E) No-TTY fail-closed
// ---------------------------------------------------------------------------

test("PR-B — consent posture fails closed to block when no TTY", () => {
  const probe = POSITIVE[0];
  const { result } = isolatedDecide(probe.input, { tty: false });
  assert.equal(result.action,         "block",           `${probe.tag}: expected block without TTY`);
  assert.equal(result.decisionSource, F27_NO_TTY_SOURCE, `${probe.tag}: expected no-tty source`);
  assert.equal(result.floorFired,     F27_FLOOR,         `${probe.tag}: expected floor still named`);
});

test("PR-B — no-TTY decisionSource is distinct from consent-required", () => {
  const probe = POSITIVE[0];
  const { result: noTTY } = isolatedDecide(probe.input, { tty: false });
  const { result: tty }   = isolatedDecide(probe.input, { tty: true });
  assert.notEqual(noTTY.decisionSource, tty.decisionSource,
    "no-TTY and TTY paths must produce distinct decisionSource values");
  assert.equal(noTTY.decisionSource, F27_NO_TTY_SOURCE);
  assert.equal(tty.decisionSource,   F27_CONSENT_SOURCE);
});
