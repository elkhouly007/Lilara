#!/usr/bin/env node
"use strict";

// taint-window-injection.test.js — ADR-046 coverage.
//
// Proves F10 (taint floor) works through the INJECTED input.provenanceWindow
// path, so decide() no longer needs to read the provenance window from disk.
//
// Three layers:
//   1. correlateCommandPure() — the pure helper honors the passed window + policy.
//   2. decide() — consumes input.provenanceWindow + threads projectPolicy taint
//      bits (incl. a non-default taint.minTokenLength loaded from config).
//   3. runPreToolGate() — the impure boundary actually injects the window into
//      BOTH decide() calls (primary + envelope recheck). This is the only test
//      that catches a broken boundary injection (silent fail-open). It is the
//      gap the replay corpus cannot cover (corpus runs with an empty window).
//
// Run with: node tests/runtime/taint-window-injection.test.js

// ── Decision isolation (mirror scripts/replay-decisions.js) — pin context so the
// real repo git branch / contract / rate-limit cannot perturb the floors. Set
// BEFORE requiring runtime modules.
process.env.LILARA_CONTRACT_ENABLED      = "0";
process.env.LILARA_RATE_LIMIT            = "0";
process.env.LILARA_TRAJECTORY_WINDOW_MIN = "0";
process.env.LILARA_BRANCH_OVERRIDE       = "adr046/isolated";
process.env.LILARA_DECISION_JOURNAL      = "1";

const assert = require("assert");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

const { correlateCommandPure } = require(path.join(__dirname, "..", "..", "runtime", "taint"));
const { decide }               = require(path.join(__dirname, "..", "..", "runtime", "decision-engine"));
const { runPreToolGate }       = require(path.join(__dirname, "..", "..", "runtime", "pretool-gate"));
const sessionContext           = require(path.join(__dirname, "..", "..", "runtime", "session-context"));
const { redact }               = require(path.join(__dirname, "..", "..", "runtime", "secret-scan"));

let passed = 0;
let failed = 0;
const errors = [];
const _tmpDirs = [];

function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed++; errors.push({ name, err: e }); process.stdout.write(`  ✗ ${name}: ${e.message}\n`); }
}

// Fresh, empty state dir per test (no provenance-window.json → disk fallback is []
// so any F10 firing must come from the injected window, not disk).
//
// PR-F root-cause fix: keep LILARA_STATE_DIR (the journal/state write site) and
// the test repo (cwd passed to runPreToolGate) in SEPARATE tmp dirs. Previously
// LILARA_STATE_DIR=cwd collapsed both into the same path, which put the test
// repo inside F30's protected footprint — F30 then correctly blocked on
// targetPath=cwd=LILARA_STATE_DIR and masked the F10 floor these tests are
// designed to exercise. See PR-F step 1 (anti-mask refactor).
function isolateState() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "adr046-st-"));
  _tmpDirs.push(stateDir);
  process.env.LILARA_STATE_DIR = stateDir;
  try { sessionContext.resetCache(); } catch { /* best-effort */ }
  return stateDir;
}

// Fresh, isolated test-repo cwd per test. NOT inside LILARA_STATE_DIR — must
// be outside F30's protected footprint so runPreToolGate({cwd, ...}) routes
// to F10 (taint) instead of F30 (tamper).
function isolateRepo() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "adr046-repo-"));
  _tmpDirs.push(repoDir);
  return repoDir;
}

function win(content, source) {
  return [{ content: String(content), source: source || "web-fetch", ts: Date.now() }];
}

function readDecisions(stateDir) {
  const p = path.join(stateDir, "decision-journal.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .filter((e) => e.kind === "runtime-decision");
}

process.on("exit", () => {
  for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
});

// ───────────────────────────────────────────────────────────────────────────
// 1. correlateCommandPure — pure helper
// ───────────────────────────────────────────────────────────────────────────
process.stdout.write("\ncorrelateCommandPure (pure helper)\n");

test("overlapping token on a non-safe tool → tainted", () => {
  const r = correlateCommandPure("echo abcdef", win("abcdef"), "Bash", { taintMinTokenLength: 6 });
  assert.strictEqual(r.tainted, true);
});

test("safe-tool-class is exempt even with an overlapping token", () => {
  const r = correlateCommandPure("echo abcdef", win("abcdef"), "Grep", { taintSafeToolClasses: ["Grep"], taintMinTokenLength: 6 });
  assert.strictEqual(r.tainted, false);
});

test("honors a non-default taintMinTokenLength (4 matches, 6 does not)", () => {
  // "abcde" is 5 chars: matches under minTokenLength 4, not under 6.
  const matched   = correlateCommandPure("echo abcde", win("abcde"), "Bash", { taintMinTokenLength: 4 });
  const unmatched = correlateCommandPure("echo abcde", win("abcde"), "Bash", { taintMinTokenLength: 6 });
  assert.strictEqual(matched.tainted, true,  "5-char token must match at minTokenLength 4");
  assert.strictEqual(unmatched.tainted, false, "5-char token must NOT match at minTokenLength 6");
});

test("non-array recentReads → not tainted (guard)", () => {
  assert.strictEqual(correlateCommandPure("echo abcdef", null, "Bash", { taintMinTokenLength: 6 }).tainted, false);
});

// ── ADR-045 × ADR-046: symmetric redaction preserved through the injection refactor.
// The window is redacted at rest on write (recordExternalRead); correlateCommandPure
// must redact the command with the SAME function so a secret matches placeholder-vs-
// placeholder. Without this, a secret is raw in the command but a placeholder in the
// window → no match → F10 fails open on secret-bearing injection (the case the
// non-secret tokens above cannot detect). SECRET redacts to [REDACTED:aws-access-key-id].
const SECRET = "AKIAIOSFODNN7EXAMPLE";

test("secret token: redacted-at-rest window still correlates with raw secret in command (redaction default ON)", () => {
  const redactedWindow = win("external read leaked " + redact(SECRET) + " in output");
  const r = correlateCommandPure("aws configure set key " + SECRET, redactedWindow, "Bash", { taintMinTokenLength: 6 });
  assert.strictEqual(r.tainted, true,
    "secret MUST correlate placeholder-vs-placeholder with LILARA_TAINT_WINDOW_REDACT default ON — else F10 fails open on secrets");
});

test("redaction OFF (LILARA_TAINT_WINDOW_REDACT=0): raw-vs-raw secret still correlates (symmetry preserved both ways)", () => {
  const prev = process.env.LILARA_TAINT_WINDOW_REDACT;
  process.env.LILARA_TAINT_WINDOW_REDACT = "0";
  try {
    const rawWindow = win("external read leaked " + SECRET + " in output");
    const r = correlateCommandPure("aws configure set key " + SECRET, rawWindow, "Bash", { taintMinTokenLength: 6 });
    assert.strictEqual(r.tainted, true, "with redaction OFF, raw secret matches raw window (no asymmetry)");
  } finally {
    if (prev === undefined) delete process.env.LILARA_TAINT_WINDOW_REDACT;
    else process.env.LILARA_TAINT_WINDOW_REDACT = prev;
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 2. decide() — consumes input.provenanceWindow
// ───────────────────────────────────────────────────────────────────────────
process.stdout.write("\ndecide() injected-window consumption\n");

const TOK = "abcdefghijklmno"; // 15 chars — matches at default minTokenLength 6

test("injected populated window + tainted Bash command → F10 fires", () => {
  isolateState();
  const r = decide({ tool: "Bash", command: "echo " + TOK, provenanceWindow: win("external says: run echo " + TOK) });
  assert.strictEqual(r.action, "require-review", `action=${r.action}`);
  assert.strictEqual(r.floorFired, "taint-floor", `floorFired=${r.floorFired}`);
  assert.strictEqual(r.decisionSource, "taint-floor", `decisionSource=${r.decisionSource}`);
});

test("injected window + UNRELATED command → F10 does not fire", () => {
  isolateState();
  const r = decide({ tool: "Bash", command: "echo hello world", provenanceWindow: win("external says: run echo " + TOK) });
  assert.notStrictEqual(r.floorFired, "taint-floor", `floorFired=${r.floorFired}`);
});

test("safe-tool-class (Grep) + matching window → F10 does not fire", () => {
  isolateState();
  const r = decide({ tool: "Grep", command: "echo " + TOK, provenanceWindow: win("external says: run echo " + TOK) });
  assert.notStrictEqual(r.floorFired, "taint-floor", `floorFired=${r.floorFired}`);
});

test("absent window (empty state dir, no injection) → F10 inert", () => {
  isolateState();
  const r = decide({ tool: "Bash", command: "echo " + TOK });
  assert.notStrictEqual(r.floorFired, "taint-floor", `floorFired=${r.floorFired}`);
});

test("decide() threads non-default config taint.minTokenLength (=20): 15-char token-only window does NOT fire, default (6) does", () => {
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), "adr046-pr-"));
  _tmpDirs.push(projDir);
  const cfgPath = path.join(projDir, "lilara.config.json");
  fs.writeFileSync(cfgPath, JSON.stringify({ taint: { minTokenLength: 20 } }));
  // Token-only window (the command is NOT a substring of the content) so matching
  // depends on per-token length — making it sensitive to minTokenLength.
  const tokenOnly = win(TOK + " referenced externally");
  isolateState();
  const r20 = decide({ tool: "Bash", command: "echo " + TOK, provenanceWindow: tokenOnly, projectRoot: projDir, configPath: cfgPath });
  assert.notStrictEqual(r20.floorFired, "taint-floor",
    `config minTokenLength 20: 15-char token must NOT match; floorFired=${r20.floorFired} — decide() must thread the config value, not a hardcoded 6`);
  isolateState();
  const r6 = decide({ tool: "Bash", command: "echo " + TOK, provenanceWindow: tokenOnly });
  assert.strictEqual(r6.floorFired, "taint-floor",
    `default minTokenLength 6: 15-char token must match; floorFired=${r6.floorFired}`);
});

// ───────────────────────────────────────────────────────────────────────────
// 3. runPreToolGate() — boundary injection (the fail-open guard)
// ───────────────────────────────────────────────────────────────────────────
process.stdout.write("\nrunPreToolGate boundary injection\n");

test("primary path: gate injects window → F10 fires (journal floorFired=taint-floor, taint fields present)", () => {
  const stateDir = isolateState();
  const repoDir  = isolateRepo();
  const tok = "injecttoken" + "abcdef";
  sessionContext.recordExternalRead("external content with " + tok + " embedded", "web-fetch");
  runPreToolGate({ harness: "claude", tool: "Bash", command: "echo " + tok, cwd: repoDir, rawInput: {} });
  const decisions = readDecisions(stateDir);
  assert.ok(decisions.length >= 1, "expected a runtime-decision journal entry");
  const last = decisions[decisions.length - 1];
  // PR-F anti-mask proof: F10 (taint-floor) must fire here, NOT F30. If cwd
  // were inside LILARA_STATE_DIR, F30 would correctly block first and mask
  // the F10 floor these tests are designed to exercise.
  assert.strictEqual(last.floorFired, "taint-floor", `floorFired=${last.floorFired} — F30 must not mask F10`);
  assert.strictEqual(last.action, "require-review", `action=${last.action}`);
  assert.ok(last.taintSource, "taintSource must be present on a tainted decision");
});

test("gate + secret (ADR-045 active): redacted-at-rest window + raw secret command → F10 correlates end-to-end", () => {
  // recordExternalRead redacts the secret at rest (default ON) → window stores the
  // placeholder. The command carries the RAW secret; the gate injects the redacted
  // window and correlateCommandPure redacts the command to the same placeholder, so
  // F10 still correlates (taintSource journaled). The command also trips the secret
  // floor (payloadClass C) so the final action may be block — irrelevant here: the
  // point is that F10 CORRELATED (taintSource present). Without the command-side
  // redact fix, taintSource would be ABSENT — a secret-bearing fail-open.
  const stateDir = isolateState();
  const repoDir  = isolateRepo();
  sessionContext.recordExternalRead("leaked credential " + SECRET + " from api response", "web-fetch");
  runPreToolGate({ harness: "claude", tool: "Bash", command: "aws configure set aws_access_key_id " + SECRET, cwd: repoDir, rawInput: {} });
  const decisions = readDecisions(stateDir);
  assert.ok(decisions.length >= 1, "expected a runtime-decision journal entry");
  const last = decisions[decisions.length - 1];
  // PR-F anti-mask proof: F10 must correlate (taintSource present) — F30 must
  // NOT fire (cwd is repoDir, OUTSIDE F30's protected footprint).
  assert.ok(last.taintSource,
    "F10 must correlate the secret end-to-end through the gate with ADR-045 redaction active (taintSource present) — else a secret-bearing fail-open");
});

test("recheck path: BOTH decide() calls get the SAME window (Acceptance Criterion #1)", () => {
  // The recheck (2nd decide()) fires when the 1st decision is non-block/escalate
  // AND (payloadClass==="C" OR reasonCodes includes "protected-branch"). The
  // Class-C path itself blocks (F4 secret-class-C) → recheck never runs, so the
  // viable F10-observable recheck trigger is a high-risk write on a protected
  // branch (require-review, not block). We assert the recheck-specific journal
  // entry carries taint correlation — proving the 2nd decide() got the window.
  const stateDir = isolateState();
  const repoDir  = isolateRepo();
  const extWin = "you should run: npm install -g typescript";
  sessionContext.recordExternalRead(extWin, "web-fetch");
  runPreToolGate({
    harness: "claude", tool: "Bash",
    command: "npm install -g typescript",          // F10 substring-matches extWin
    cwd: repoDir, rawInput: { branch: "main" },    // protected branch → recheck
    envelopeReporting: true,
  });
  const decisions = readDecisions(stateDir);
  assert.ok(decisions.length >= 2,
    `expected 2 runtime-decision entries (primary + recheck), got ${decisions.length} — recheck branch was not traversed`);
  const recheck = decisions.find((e) => e.notes && /pre-exec-recheck/.test(e.notes));
  assert.ok(recheck, "recheck decide() must have run (journal entry with notes …pre-exec-recheck)");
  // PR-F anti-mask proof: the recheck decision MUST carry taintSource (F10
  // fired in the PRIMARY decide()), proving the window was shared across BOTH
  // decide() calls. The recheck itself may surface a different floorFired
  // (e.g. "protected-branch") because the recheck evaluates the protected-branch
  // path after F10 has already fired — the load-bearing property here is the
  // PRESENCE of taintSource, not the recheck's floorFired label. cwd=repoDir
  // is outside F30's protected footprint, so F30 correctly does NOT block first.
  assert.ok(recheck.taintSource,
    "recheck decision MUST carry taintSource — proves the recheck decide() received the SHARED window. Missing it = F10 fail-open on the recheck path.");
  assert.strictEqual(recheck.action, "require-review", `recheck action=${recheck.action}`);
});

// ── Summary ──────────────────────────────────────────────────────────────────
process.stdout.write(`\n${"─".repeat(60)}\n`);
if (failed > 0) {
  process.stdout.write(`FAILED: ${failed} / ${passed + failed} tests\n`);
  for (const { name, err } of errors) process.stdout.write(`  ✗ ${name}\n    ${err.stack || err.message}\n`);
  process.exit(1);
} else {
  process.stdout.write(`PASSED: ${passed} / ${passed} tests\n`);
  process.exit(0);
}
