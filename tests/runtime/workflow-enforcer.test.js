"use strict";

const assert = require("node:assert");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("  ok      " + name);
    passed++;
  } catch (e) {
    console.error("  FAIL    " + name);
    console.error("          " + e.message);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "wf-test-"));
  return d;
}

function writeConfig(dir, workflow) {
  const cfg = { _comment: "test", profile: "rules" };
  if (workflow) cfg.workflow = workflow;
  fs.writeFileSync(path.join(dir, "lilara.config.json"), JSON.stringify(cfg), "utf8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("config absent → checkSteps returns disabled", () => {
  const stateD = tmpDir();
  const cwd    = tmpDir();
  // No lilara.config.json in cwd
  const result = require("../../runtime/workflow-enforcer").checkSteps({ stateDirOverride: stateD, cwdOverride: cwd });
  assert.strictEqual(result.satisfied, true);
  assert.strictEqual(result.mode, "disabled");
  assert.deepStrictEqual(result.missing, []);
  assert.strictEqual(result.blocked, false);
  fs.rmSync(stateD, { recursive: true, force: true });
  fs.rmSync(cwd,    { recursive: true, force: true });
});

test("all steps missing → satisfied=false, missing=[test,review]", () => {
  const stateD = tmpDir();
  const cwd    = tmpDir();
  writeConfig(cwd, { required_steps: ["test", "review"], step_order: "lenient" });
  const result = require("../../runtime/workflow-enforcer").checkSteps({ stateDirOverride: stateD, cwdOverride: cwd });
  assert.strictEqual(result.satisfied, false);
  assert.deepStrictEqual(result.missing, ["test", "review"]);
  assert.strictEqual(result.blocked, false);
  fs.rmSync(stateD, { recursive: true, force: true });
  fs.rmSync(cwd,    { recursive: true, force: true });
});

test("mark test → only review missing", () => {
  const stateD = tmpDir();
  const cwd    = tmpDir();
  const wfe    = require("../../runtime/workflow-enforcer");
  writeConfig(cwd, { required_steps: ["test", "review"], step_order: "lenient" });
  wfe.markStep("test", { stateDirOverride: stateD });
  const result = wfe.checkSteps({ stateDirOverride: stateD, cwdOverride: cwd });
  assert.deepStrictEqual(result.missing, ["review"]);
  assert.strictEqual(result.satisfied, false);
  fs.rmSync(stateD, { recursive: true, force: true });
  fs.rmSync(cwd,    { recursive: true, force: true });
});

test("all steps complete → satisfied=true, blocked=false", () => {
  const stateD = tmpDir();
  const cwd    = tmpDir();
  const wfe    = require("../../runtime/workflow-enforcer");
  writeConfig(cwd, { required_steps: ["test", "review"], step_order: "strict" });
  wfe.markStep("test",   { stateDirOverride: stateD });
  wfe.markStep("review", { stateDirOverride: stateD });
  const result = wfe.checkSteps({ stateDirOverride: stateD, cwdOverride: cwd });
  assert.strictEqual(result.satisfied, true);
  assert.deepStrictEqual(result.missing, []);
  assert.strictEqual(result.blocked, false);
  fs.rmSync(stateD, { recursive: true, force: true });
  fs.rmSync(cwd,    { recursive: true, force: true });
});

test("enforce mode + strict + missing steps → blocked=true", () => {
  const stateD = tmpDir();
  const cwd    = tmpDir();
  writeConfig(cwd, { required_steps: ["test", "review"], step_order: "strict" });
  const result = require("../../runtime/workflow-enforcer").checkSteps({ stateDirOverride: stateD, cwdOverride: cwd, enforce: true });
  assert.strictEqual(result.blocked, true);
  assert.strictEqual(result.satisfied, false);
  fs.rmSync(stateD, { recursive: true, force: true });
  fs.rmSync(cwd,    { recursive: true, force: true });
});

test("resetSteps clears completed steps", () => {
  const stateD = tmpDir();
  const cwd    = tmpDir();
  const wfe    = require("../../runtime/workflow-enforcer");
  writeConfig(cwd, { required_steps: ["test"], step_order: "lenient" });
  wfe.markStep("test", { stateDirOverride: stateD });
  wfe.resetSteps({ stateDirOverride: stateD });
  const result = wfe.checkSteps({ stateDirOverride: stateD, cwdOverride: cwd });
  assert.deepStrictEqual(result.missing, ["test"]);
  fs.rmSync(stateD, { recursive: true, force: true });
  fs.rmSync(cwd,    { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log();
console.log("workflow-enforcer: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
