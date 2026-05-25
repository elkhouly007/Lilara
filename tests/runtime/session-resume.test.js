#!/usr/bin/env node
"use strict";

// session-resume.test.js — unit tests for runtime/session-resume.js
//
// Coverage:
//   1. Empty state dir → sessionCount === 0 and text === ""
//   2. One prior session with 5 decisions → summary contains "Last session: 5"
//   3. Two prior sessions → summarizes the most recent, not the oldest
//   4. Summary text ≤500 chars even with 100 decisions and many reason codes
//   5. Kill-switch path: buildSummary returns empty when no prior session
//
// Run: node tests/runtime/session-resume.test.js

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-resume-"));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stderr.write(`  FAIL ${name}: ${err && (err.stack || err.message) || err}\n`);
  }
}

// Helper: write a synthetic session-context.json into a fresh state dir.
function makeStateDir(sessions) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, "state-"));
  const state = { sessions, recent: [], updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "session-context.json"), JSON.stringify(state));
  return dir;
}

// Helper: build a decision entry.
function decision(action = "allow", reasonCodes = [], ts) {
  return { ts: ts || new Date().toISOString(), action, riskLevel: "low", reasonCodes };
}

// Helper: invoke buildSummary with a specific stateDir and an active session ID.
function summarize(stateDir, activeSessionId) {
  // Write the active session ID to a file so currentSessionId() returns it.
  if (activeSessionId) {
    fs.writeFileSync(path.join(stateDir, "current-session-id"), activeSessionId + "\n");
  }
  process.env.LILARA_STATE_DIR = stateDir;
  // Clear module cache so state-paths / session-context re-read env var.
  Object.keys(require.cache).forEach((k) => { if (k.includes("session-resume") || k.includes("session-context") || k.includes("state-paths")) delete require.cache[k]; });
  const { buildSummary } = require(path.join(__dirname, "..", "..", "runtime", "session-resume"));
  return buildSummary({ stateDirOverride: stateDir });
}

// ────────────────────────────────────────────────────────────────────────────

test("empty state dir → sessionCount 0 and text empty", () => {
  const dir = fs.mkdtempSync(path.join(tmpRoot, "empty-"));
  const r = summarize(dir, "new-session-id");
  assert.strictEqual(r.sessionCount, 0);
  assert.strictEqual(r.text, "");
  assert.strictEqual(r.decisionsSummarized, 0);
});

test("one prior session with 5 decisions → summary mentions 5 decisions", () => {
  const sid = "session-abc";
  const dir = makeStateDir({
    [sid]: [decision(), decision(), decision(), decision(), decision()],
  });
  const r = summarize(dir, "new-sid");
  assert.ok(r.sessionCount >= 1);
  assert.ok(r.text.includes("5 decision"), `expected '5 decision' in: ${r.text}`);
});

test("two prior sessions → summarizes the most recent one", () => {
  const old  = "session-old";
  const recent = "session-recent";
  const oldTs = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
  const newTs = new Date().toISOString();

  const dir = makeStateDir({
    [old]:    [decision("allow", [], oldTs)],
    [recent]: [decision("block", ["protected-branch"], newTs), decision("allow", [], newTs)],
  });

  const r = summarize(dir, "active-new");
  // Should pick the most recent session (session-recent) which has 2 decisions
  assert.ok(r.decisionsSummarized === 2, `expected 2 decisions summarized, got ${r.decisionsSummarized}`);
  assert.ok(r.text.includes("2 decision"), `expected '2 decision' in: ${r.text}`);
});

test("summary text ≤500 chars with 100 decisions and many reason codes", () => {
  const sid = "big-session";
  const codes = Array.from({ length: 20 }, (_, i) => `code-${i}`);
  const entries = Array.from({ length: 100 }, (_, i) =>
    decision(i % 3 === 0 ? "block" : "allow", codes.slice(0, 5))
  );
  const dir = makeStateDir({ [sid]: entries });
  const r = summarize(dir, "new-sid");
  assert.ok(r.text.length <= 500, `text too long: ${r.text.length} chars`);
});

test("blocks and warns counted correctly", () => {
  const sid = "counts-session";
  const dir = makeStateDir({
    [sid]: [
      decision("block"),
      decision("block"),
      decision("escalate"),
      decision("require-review"),
      decision("allow"),
    ],
  });
  const r = summarize(dir, "new-sid");
  assert.ok(r.text.includes("2 block"), `expected '2 block' in: ${r.text}`);
  // warns = escalate + require-review = 2
  assert.ok(r.text.includes("2 warn"), `expected '2 warn' in: ${r.text}`);
});

test("active session is excluded from previous session list", () => {
  const active = "currently-active";
  const prior  = "prior-session";
  const dir = makeStateDir({
    [active]: [decision("allow"), decision("allow"), decision("allow")],
    [prior]:  [decision("block")],
  });
  // Should summarize prior (1 decision), not active (3 decisions)
  const r = summarize(dir, active);
  assert.ok(r.sessionCount >= 1);
  assert.strictEqual(r.decisionsSummarized, 1, `expected 1 decision, got ${r.decisionsSummarized}`);
});

// ────────────────────────────────────────────────────────────────────────────

// Cleanup
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort */ }

if (failed > 0) {
  process.stderr.write(`\nsession-resume.test.js: ${failed} test(s) FAILED\n`);
  process.exit(1);
}
process.stdout.write(`\nsession-resume.test.js: ${passed} test(s) passed\n`);
