#!/usr/bin/env node
"use strict";

// sandbox-dry-run.test.js — ADR-016 Feature 4: lilara sandbox dry-run CLI.
//
// Verifies:
//   - `lilara sandbox <safe-cmd>` prints action: allow.
//   - `lilara sandbox 'rm -rf /'` prints action: block and a typed code.
//   - `lilara sandbox --json <cmd>` produces valid JSON with action + code.
//   - sandbox does NOT write to the decision journal (dryRun invariant).
//   - sandbox --tool and --harness flags pass through to the engine.
//   - `lilara sandbox` with no command exits 2.
//
// Run: node tests/runtime/sandbox-dry-run.test.js

const assert      = require("node:assert");
const path        = require("node:path");
const fs          = require("node:fs");
const os          = require("node:os");
const { spawnSync } = require("node:child_process");

const ROOT    = path.join(__dirname, "..", "..");
const CLI     = path.join(ROOT, "scripts", "lilara-cli.sh");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stderr.write(`  FAIL ${name}: ${err && err.message || err}\n`);
    if (err && err.stack) process.stderr.write(err.stack + "\n");
  }
}

function runSandbox(args, stateDir) {
  const env = { ...process.env, LILARA_STATE_DIR: stateDir, LILARA_KILL_SWITCH: "" };
  return spawnSync("bash", [CLI, "sandbox", ...args], {
    encoding: "utf8",
    env,
    cwd: ROOT,
  });
}

function journalLineCount(stateDir) {
  const jf = path.join(stateDir, "decision-journal.jsonl");
  if (!fs.existsSync(jf)) return 0;
  const lines = fs.readFileSync(jf, "utf8").trim().split("\n").filter(Boolean);
  return lines.length;
}

// --- tests ---

test("safe command: echo hello → action: allow", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-t1-"));
  const r = runSandbox(["echo", "hello"], stateDir);
  assert.strictEqual(r.status, 0, `exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("action:         allow"), `expected allow\nstdout: ${r.stdout}`);
});

test("destructive command: rm -rf / → action: block with typed code", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-t2-"));
  const r = runSandbox(["rm -rf /"], stateDir);
  assert.strictEqual(r.status, 0, `exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("action:         block"), `expected block\nstdout: ${r.stdout}`);
  assert.ok(/code:\s+F\d+/.test(r.stdout), `expected F-code in output\nstdout: ${r.stdout}`);
});

test("journal is NOT written by sandbox (dryRun invariant)", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-t3-"));
  const before = journalLineCount(stateDir);
  runSandbox(["rm -rf /"], stateDir);
  const after = journalLineCount(stateDir);
  assert.strictEqual(before, after, `Journal grew from ${before} to ${after} — dryRun violated`);
});

test("--json flag produces valid JSON with action and code fields", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-t4-"));
  const r = runSandbox(["--json", "rm -rf /"], stateDir);
  assert.strictEqual(r.status, 0, `exit ${r.status}\nstderr: ${r.stderr}`);
  let obj;
  try { obj = JSON.parse(r.stdout); } catch (e) {
    assert.fail(`stdout is not valid JSON: ${r.stdout}`);
  }
  assert.ok(typeof obj.action === "string", "JSON should have action");
  assert.ok(typeof obj.code === "string", `JSON should have code; got: ${JSON.stringify(obj)}`);
  assert.ok(obj.code.startsWith("F"), `code should start with F: ${obj.code}`);
});

test("no command → exit 2", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-t5-"));
  const r = runSandbox([], stateDir);
  assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}`);
});

test("--tool Edit flag is respected (passes to engine)", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-t6-"));
  const r = runSandbox(["--tool", "Edit", "echo hello"], stateDir);
  assert.strictEqual(r.status, 0, `exit ${r.status}\nstderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("action:"), `should produce action line\nstdout: ${r.stdout}`);
});

test("--harness flag is respected (passes to engine)", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-t7-"));
  const r = runSandbox(["--harness", "claude", "echo hello"], stateDir);
  assert.strictEqual(r.status, 0, `exit ${r.status}\nstderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("action:"), `should produce action line\nstdout: ${r.stdout}`);
});

// --- summary ---
process.stdout.write(`\nsandbox-dry-run: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
