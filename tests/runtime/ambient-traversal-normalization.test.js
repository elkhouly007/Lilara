#!/usr/bin/env node
"use strict";

// ambient-traversal-normalization.test.js — ADR-009 PR-E (ARG-PRE-D-001 +
// ARG-PRE-D-002 closure).
//
// normAmbientPath / _isInsideProject live in runtime/floor-ambient-authority.js
// (extracted from decision-engine.js by the monolith-decomposition sprint M3,
// PR #127). They are imported directly — the earlier regex-extract + eval hack
// against decision-engine.js source is replaced with a real require() so the
// test survives future refactors without becoming a CI blocker.
//
//   (1) Unit-level: normAmbientPath + _isInsideProject imported from
//       floor-ambient-authority.js — pin the invariants for `..`/`%2e` collapse.
//   (2) End-to-end: decide() invoked through the isolated-sandbox pattern
//       (same as ambient-floor.test.js), asserting the four PR-D bypasses
//       fire F16 with the expected receipt enrichment.
//
// Run:  node tests/runtime/ambient-traversal-normalization.test.js

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

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

// --- (1) Helper import from floor-ambient-authority.js --------------------

const {
  normAmbientPath: _normAmbientPath,
  _isInsideProject,
} = require(path.join(ROOT, "runtime", "floor-ambient-authority.js"));

// --- normalization invariants ---------------------------------------------

test("_normAmbientPath collapses /proj/../.gitconfig to /.gitconfig", () => {
  assert.strictEqual(_normAmbientPath("/proj/../.gitconfig"), "/.gitconfig");
});

test("_normAmbientPath collapses /proj/.git/../../../etc/gitconfig to /etc/gitconfig", () => {
  assert.strictEqual(_normAmbientPath("/proj/.git/../../../etc/gitconfig"), "/etc/gitconfig");
});

test("_normAmbientPath URL-decodes %2e then collapses (/proj/%2e%2e/.gitconfig → /.gitconfig)", () => {
  assert.strictEqual(_normAmbientPath("/proj/%2e%2e/.gitconfig"), "/.gitconfig");
});

test("_normAmbientPath URL-decode is case-insensitive on %2E (/proj/%2E%2E/.gitconfig → /.gitconfig)", () => {
  assert.strictEqual(_normAmbientPath("/proj/%2E%2E/.gitconfig"), "/.gitconfig");
});

test("_normAmbientPath decodes %2f BEFORE segment split (/proj/sub%2f%2e%2e%2f.gitconfig → /proj/.gitconfig)", () => {
  assert.strictEqual(_normAmbientPath("/proj/sub%2f%2e%2e%2f.gitconfig"), "/proj/.gitconfig");
});

test("_normAmbientPath preserves invariants: empty/null → ''", () => {
  assert.strictEqual(_normAmbientPath(""), "");
  assert.strictEqual(_normAmbientPath(null), "");
});

test("_normAmbientPath leaves ordinary absolute paths untouched", () => {
  assert.strictEqual(_normAmbientPath("/home/user/.ssh/id_rsa"), "/home/user/.ssh/id_rsa");
});

// --- _isInsideProject ------------------------------------------------------

test("_isInsideProject(/proj/../.gitconfig, /proj) → false (traversal blocked)", () => {
  assert.strictEqual(_isInsideProject("/proj/../.gitconfig", "/proj"), false);
});

test("_isInsideProject(/proj/sub/file, /proj) → true (sanity)", () => {
  assert.strictEqual(_isInsideProject("/proj/sub/file", "/proj"), true);
});

test("_isInsideProject(/proj, /proj) → true (root equality)", () => {
  assert.strictEqual(_isInsideProject("/proj", "/proj"), true);
});

test("_isInsideProject(/proj/%2e%2e/.gitconfig, /proj) → false (URL-encoded traversal blocked)", () => {
  assert.strictEqual(_isInsideProject("/proj/%2e%2e/.gitconfig", "/proj"), false);
});

// --- (2) End-to-end via decide() ------------------------------------------

function withSandbox(body) {
  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f16e-st-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f16e-pr-"));
  const envSnap = Object.assign({}, process.env);
  const restoreEnv = () => {
    for (const k of Object.keys(process.env)) if (!(k in envSnap)) delete process.env[k];
    for (const [k, v] of Object.entries(envSnap)) process.env[k] = v;
  };
  const cleanup = () => {
    try { fs.rmSync(stateDir,   { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  try {
    process.env.LILARA_STATE_DIR        = stateDir;
    process.env.LILARA_CONTRACT_ENABLED = "0";
    process.env.LILARA_RATE_LIMIT       = "0";
    delete process.env.LILARA_KILL_SWITCH;
    delete process.env.LILARA_CONTRACT_REQUIRED;
    delete process.env.LILARA_F4_DEMOTE_TOKEN;
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(ROOT, "runtime") + path.sep)) {
        delete require.cache[key];
      }
    }
    const { decide } = require(path.join(ROOT, "runtime", "decision-engine"));
    body({ projectDir, decide });
  } finally {
    restoreEnv();
    cleanup();
  }
}

const E2E_CASES = [
  { name: "ARG-PRE-D-001 dotdot gitConfig",
    rel: "/../.gitconfig",                   cls: "gitConfig" },
  { name: "ARG-PRE-D-001 dotdot ideSettings",
    rel: "/../.vscode/settings.json",        cls: "ideSettings" },
  { name: "ARG-PRE-D-001 deep dotdot /etc/gitconfig",
    rel: "/.git/../../../etc/gitconfig",     cls: "gitConfig" },
  { name: "ARG-PRE-D-002 url-encoded dotdot gitConfig",
    rel: "/%2e%2e/.gitconfig",               cls: "gitConfig" },
];

for (const c of E2E_CASES) {
  test(`decide() blocks ${c.name} after PR-E fix`, () => {
    withSandbox(({ projectDir, decide }) => {
      const target = projectDir + c.rel;
      const r = decide({
        tool: "Write",
        harness: "claude",
        targetPath: target,
        file_path: target,
        projectRoot: projectDir,
        branch: "feature/test",
      });
      assert.strictEqual(r.action, "block",
        `expected action=block for ${target}; got ${r.action}`);
      assert.strictEqual(r.floorFired, "ambient-authority",
        `expected floorFired=ambient-authority for ${target}; got ${r.floorFired}`);
      assert.strictEqual(r.decisionSource, "ambient-authority-denied");
      assert.strictEqual(r.ambientClass, c.cls);
      assert.strictEqual(r.ambientPath, target,
        "ambientPath must echo the raw input (audit fidelity)");
    });
  });
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
