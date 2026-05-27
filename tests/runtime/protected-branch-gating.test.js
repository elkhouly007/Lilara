#!/usr/bin/env node
"use strict";

// protected-branch-gating.test.js — regression tests for the hasExplicitProtectedBranches
// + branchExplicit gating fix.
//
// Root cause: risk-score.js used to add +3 "protected-branch" whenever the ambient
// git branch matched the default fallback list ["main","master"], even when the operator
// never wrote a lilara.config.json. This caused safe read-only commands to be promoted
// from allow → route on any repo checked out on master.
//
// Fix: protected-branch scoring only fires when at least one explicit opt-in signal is
// present:
//   • hasExplicitProtectedBranches — operator set runtime.protected_branches in config
//   • branchExplicit              — caller passed a non-empty branch to decide()
//   • protectedBranch: true       — legacy direct-override flag (unchanged)
//
// Run: node tests/runtime/protected-branch-gating.test.js

const assert = require("node:assert");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

// Isolate from live state.
const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-pb-gate-"));
process.env.LILARA_STATE_DIR = tmpState;
process.env.LILARA_CONTRACT_ENABLED = "0";
process.env.LILARA_RATE_LIMIT = "0";
// Pin a non-protected sentinel so discover() doesn't inherit the real git branch.
process.env.LILARA_BRANCH_OVERRIDE = "replay/isolated-context";
delete process.env.LILARA_KILL_SWITCH;

const { defaultPolicy, normalizeRuntimeConfig } = require(path.join(root, "runtime/project-policy"));
const { score } = require(path.join(root, "runtime/risk-score"));
const { decide } = require(path.join(root, "runtime/decision-engine"));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`  FAIL  ${name}: ${err && err.stack || err}\n`);
  }
}

// ── Policy normalization tests ───────────────────────────────────────────────

test("defaultPolicy has hasExplicitProtectedBranches=false", () => {
  const p = defaultPolicy();
  assert.strictEqual(p.hasExplicitProtectedBranches, false);
  assert.deepStrictEqual(p.protectedBranches, ["main", "master"]);
});

test("normalizeRuntimeConfig({}) => hasExplicitProtectedBranches=false with fallback list", () => {
  const n = normalizeRuntimeConfig({});
  assert.strictEqual(n.hasExplicitProtectedBranches, false);
  assert.deepStrictEqual(n.protectedBranches, ["main", "master"]);
});

test("normalizeRuntimeConfig with non-empty protected_branches => hasExplicitProtectedBranches=true", () => {
  const n = normalizeRuntimeConfig({ protected_branches: ["release"] });
  assert.strictEqual(n.hasExplicitProtectedBranches, true);
  assert.deepStrictEqual(n.protectedBranches, ["release"]);
});

test("normalizeRuntimeConfig with empty protected_branches => hasExplicitProtectedBranches=false", () => {
  const n = normalizeRuntimeConfig({ protected_branches: [] });
  assert.strictEqual(n.hasExplicitProtectedBranches, false);
  assert.deepStrictEqual(n.protectedBranches, ["main", "master"]);
});

// ── Risk-score gating tests ──────────────────────────────────────────────────

test("score: ambient master branch (no explicit flags) does NOT fire protected-branch", () => {
  const r = score({
    command: "git status",
    branch: "master",
    protectedBranches: ["main", "master"],
    hasExplicitProtectedBranches: false,
    branchExplicit: false,
  });
  assert.ok(!r.reasons.includes("protected-branch"),
    `expected no protected-branch reason, got: ${JSON.stringify(r.reasons)}`);
  assert.strictEqual(r.level, "low", `expected low risk, got ${r.level} (score=${r.score})`);
});

test("score: caller-supplied branch=master fires protected-branch via branchExplicit", () => {
  const r = score({
    command: "git status",
    branch: "master",
    protectedBranches: ["main", "master"],
    hasExplicitProtectedBranches: false,
    branchExplicit: true,
  });
  assert.ok(r.reasons.includes("protected-branch"),
    `expected protected-branch reason, got: ${JSON.stringify(r.reasons)}`);
});

test("score: operator-configured branches fires protected-branch via hasExplicitProtectedBranches", () => {
  const r = score({
    command: "git status",
    branch: "master",
    protectedBranches: ["main", "master"],
    hasExplicitProtectedBranches: true,
    branchExplicit: false,
  });
  assert.ok(r.reasons.includes("protected-branch"),
    `expected protected-branch reason, got: ${JSON.stringify(r.reasons)}`);
});

test("score: legacy protectedBranch=true fires even without new flags", () => {
  const r = score({
    command: "git status",
    branch: "master",
    protectedBranches: ["main", "master"],
    protectedBranch: true,
  });
  assert.ok(r.reasons.includes("protected-branch"),
    `expected protected-branch reason, got: ${JSON.stringify(r.reasons)}`);
});

test("score: non-matching branch with both flags does NOT fire protected-branch", () => {
  const r = score({
    command: "git status",
    branch: "feature/x",
    protectedBranches: ["main", "master"],
    hasExplicitProtectedBranches: true,
    branchExplicit: true,
  });
  assert.ok(!r.reasons.includes("protected-branch"),
    `expected no protected-branch reason for feature/x, got: ${JSON.stringify(r.reasons)}`);
});

// ── End-to-end F8 contract test ──────────────────────────────────────────────

test("decide: explicit branch=main triggers protected-branch floor (F8 contract)", () => {
  // Mirror the F8:edit-on-main corpus entry: caller supplies branch explicitly.
  // With the fix, branchExplicit=true, so protected-branch fires as expected.
  const r = decide({
    tool: "Edit",
    command: "modify src/app.ts",
    branch: "main",
    targetPath: "src/app.ts",
    pathSensitivity: "high",
  });
  assert.strictEqual(r.action, "require-review",
    `expected require-review, got ${r.action} (floor=${r.floorFired})`);
  assert.strictEqual(r.floorFired, "protected-branch",
    `expected protected-branch floor, got ${r.floorFired}`);
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

try { fs.rmSync(tmpState, { recursive: true, force: true }); } catch { /* best-effort */ }

process.stdout.write(`\n[protected-branch-gating.test] ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
