#!/usr/bin/env node
"use strict";

// cross-agent-lock.test.js — Zero-dep node:assert tests for F17 PR-A
// (cross-agent-lock floor wired into runtime/decision-engine.decide()).
//
// Covers (matches the PR brief acceptance list):
//   1. Different owner + same path + unexpired lock → block, F17 fields.
//   2. Same owner/session → no F17 fire.
//   3. Expired lock → ignored.
//   4. Read-only action against locked path → no F17 fire.
//   5. Malformed lock file with a write target → fail-closed block.
//   6. No lock present → no F17 fire (sanity).
//   7. Project-scope lock (no paths[], same projectRoot) → block.
//   8. Direct module unit tests for runtime/cross-agent-lock helpers.
//
// Run:  node tests/runtime/cross-agent-lock.test.js

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

function writeLock(stateDir, name, rec) {
  const dir = path.join(stateDir, "cross-agent-locks");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(rec, null, 2), { mode: 0o600 });
}

function writeRaw(stateDir, name, body) {
  const dir = path.join(stateDir, "cross-agent-locks");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, name), body, { mode: 0o600 });
}

function withSandbox(setup, body) {
  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f17t-st-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f17t-pr-"));
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
    process.env.HORUS_STATE_DIR        = stateDir;
    process.env.HORUS_CONTRACT_ENABLED = "0";
    process.env.HORUS_DECISION_JOURNAL = "1";
    process.env.HORUS_RATE_LIMIT       = "0";
    delete process.env.HORUS_KILL_SWITCH;
    delete process.env.HORUS_CONTRACT_REQUIRED;
    delete process.env.HORUS_F4_DEMOTE_TOKEN;
    delete process.env.HORUS_IR_JOURNAL;

    if (typeof setup === "function") setup({ stateDir, projectDir });

    // Reset runtime/* module cache so engine is pristine.
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(ROOT, "runtime") + path.sep)) {
        delete require.cache[key];
      }
    }
    const { decide } = require(path.join(ROOT, "runtime", "decision-engine"));
    body({ stateDir, projectDir, decide });
  } finally {
    restoreEnv();
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// 1. Different owner + same path + unexpired lock → block, F17 fields present
// ---------------------------------------------------------------------------
test("F17 fires on conflicting lock (different owner, same path, unexpired)", () => {
  withSandbox(({ stateDir, projectDir }) => {
    const target = path.join(projectDir, "src", "shared.ts");
    writeLock(stateDir, "lockA.json", {
      lockId: "lock-A",
      owner: "agent-A:session-1",
      projectRoot: projectDir,
      paths: [target],
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now() - 5_000,
    });
    // Pre-write expected target so discover() finds the project.
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "// shared\n");
  }, ({ projectDir, decide }) => {
    const target = path.join(projectDir, "src", "shared.ts");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
      owner: "agent-B:session-2",
    });
    assert.strictEqual(r.action, "block", `expected block; got ${r.action}`);
    assert.strictEqual(r.floorFired, "cross-agent-lock");
    assert.strictEqual(r.decisionSource, "cross-agent-lock-denied");
    assert.strictEqual(r.lockOwner, "agent-A:session-1");
    assert.strictEqual(typeof r.lockPath, "string");
    assert.ok(r.reasonCodes.indexOf("cross-agent-lock-denied") !== -1);
  });
});

// ---------------------------------------------------------------------------
// 2. Same owner/session → no F17 fire
// ---------------------------------------------------------------------------
test("F17 does NOT fire when owner matches the lock's owner", () => {
  withSandbox(({ stateDir, projectDir }) => {
    const target = path.join(projectDir, "src", "shared.ts");
    writeLock(stateDir, "lockA.json", {
      lockId: "lock-A",
      owner: "agent-A:session-1",
      projectRoot: projectDir,
      paths: [target],
      expiresAt: Date.now() + 60_000,
    });
  }, ({ projectDir, decide }) => {
    const target = path.join(projectDir, "src", "shared.ts");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
      owner: "agent-A:session-1",
    });
    assert.notStrictEqual(r.floorFired, "cross-agent-lock");
    assert.notStrictEqual(r.decisionSource, "cross-agent-lock-denied");
  });
});

// ---------------------------------------------------------------------------
// 3. Expired lock → ignored
// ---------------------------------------------------------------------------
test("F17 ignores an expired lock", () => {
  withSandbox(({ stateDir, projectDir }) => {
    const target = path.join(projectDir, "src", "shared.ts");
    writeLock(stateDir, "lockExpired.json", {
      lockId: "lock-expired",
      owner: "agent-A:session-1",
      projectRoot: projectDir,
      paths: [target],
      expiresAt: Date.now() - 60_000, // expired 1 minute ago
    });
  }, ({ projectDir, decide }) => {
    const target = path.join(projectDir, "src", "shared.ts");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
      owner: "agent-B:session-2",
    });
    assert.notStrictEqual(r.floorFired, "cross-agent-lock");
  });
});

// ---------------------------------------------------------------------------
// 4. Read-only action against locked path → no F17 fire
// ---------------------------------------------------------------------------
test("F17 does NOT fire on a Read tool call against a locked path", () => {
  withSandbox(({ stateDir, projectDir }) => {
    const target = path.join(projectDir, "src", "shared.ts");
    writeLock(stateDir, "lockA.json", {
      lockId: "lock-A",
      owner: "agent-A:session-1",
      projectRoot: projectDir,
      paths: [target],
      expiresAt: Date.now() + 60_000,
    });
  }, ({ projectDir, decide }) => {
    const target = path.join(projectDir, "src", "shared.ts");
    const r = decide({
      tool: "Read",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
      owner: "agent-B:session-2",
    });
    assert.notStrictEqual(r.floorFired, "cross-agent-lock");
    assert.notStrictEqual(r.decisionSource, "cross-agent-lock-denied");
  });
});

// ---------------------------------------------------------------------------
// 5. Malformed lock file with a write target → fail-closed block
// ---------------------------------------------------------------------------
test("F17 fails CLOSED on a malformed lock file for a write-like call", () => {
  withSandbox(({ stateDir }) => {
    writeRaw(stateDir, "broken.json", "{not valid json");
  }, ({ projectDir, decide }) => {
    const target = path.join(projectDir, "src", "shared.ts");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
      owner: "agent-B:session-2",
    });
    assert.strictEqual(r.action, "block");
    assert.strictEqual(r.floorFired, "cross-agent-lock");
    assert.strictEqual(r.decisionSource, "cross-agent-lock-denied");
    assert.ok(r.explanation.includes("malformed"), `expected malformed in explanation; got ${r.explanation}`);
  });
});

test("F17 stays OPEN for non-write tool calls even with a malformed lock", () => {
  withSandbox(({ stateDir }) => {
    writeRaw(stateDir, "broken.json", "{not valid json");
  }, ({ projectDir, decide }) => {
    const r = decide({
      tool: "Read",
      harness: "claude",
      targetPath: path.join(projectDir, "src", "shared.ts"),
      projectRoot: projectDir,
      branch: "feature/test",
      owner: "agent-B:session-2",
    });
    assert.notStrictEqual(r.floorFired, "cross-agent-lock");
  });
});

// ---------------------------------------------------------------------------
// 6. No lock present → no F17 fire (sanity)
// ---------------------------------------------------------------------------
test("F17 does NOT fire when no lock dir exists", () => {
  withSandbox(() => { /* no setup — fresh empty stateDir */ }, ({ projectDir, decide }) => {
    const target = path.join(projectDir, "src", "shared.ts");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
      owner: "agent-B:session-2",
    });
    assert.notStrictEqual(r.floorFired, "cross-agent-lock");
  });
});

// ---------------------------------------------------------------------------
// 7. Project-scope lock (no paths[], same projectRoot) → block
// ---------------------------------------------------------------------------
test("F17 fires on a project-scope lock when projectRoot matches", () => {
  withSandbox(({ stateDir, projectDir }) => {
    writeLock(stateDir, "projLock.json", {
      lockId: "lock-proj",
      owner: "agent-A:session-1",
      projectRoot: projectDir,
      // No paths — project-scope lock.
      expiresAt: Date.now() + 60_000,
    });
  }, ({ projectDir, decide }) => {
    const target = path.join(projectDir, "src", "anything.ts");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
      owner: "agent-B:session-2",
    });
    assert.strictEqual(r.action, "block");
    assert.strictEqual(r.floorFired, "cross-agent-lock");
    assert.strictEqual(r.lockProject, projectDir);
  });
});

// ---------------------------------------------------------------------------
// 8. Direct module unit tests for runtime/cross-agent-lock
// ---------------------------------------------------------------------------
test("readLockState returns ok:true with empty arrays when no dir exists", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f17u-"));
  try {
    const { readLockState } = require(path.join(ROOT, "runtime", "cross-agent-lock"));
    const r = readLockState(tmp);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.locks.length, 0);
    assert.strictEqual(r.malformed.length, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("readLockState flags malformed JSON via state.ok=false", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f17u-"));
  try {
    writeRaw(tmp, "broken.json", "{not valid json");
    const { readLockState } = require(path.join(ROOT, "runtime", "cross-agent-lock"));
    const r = readLockState(tmp);
    assert.strictEqual(r.ok, false);
    assert.ok(r.malformed.length >= 1);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("findConflict returns null when owner matches every lock", () => {
  const { findConflict } = require(path.join(ROOT, "runtime", "cross-agent-lock"));
  const r = findConflict({
    owner: "me",
    projectRoot: "/proj",
    paths: ["/proj/a"],
    locks: [{ owner: "me", projectRoot: "/proj", paths: ["/proj/a"], expiresAt: Date.now() + 60_000 }],
  });
  assert.strictEqual(r, null);
});

test("findConflict honors expiresAt window", () => {
  const { findConflict } = require(path.join(ROOT, "runtime", "cross-agent-lock"));
  const r = findConflict({
    owner: "me",
    projectRoot: "/proj",
    paths: ["/proj/a"],
    locks: [{ owner: "other", projectRoot: "/proj", paths: ["/proj/a"], expiresAt: Date.now() - 1_000 }],
  });
  assert.strictEqual(r, null);
});

test("findConflict matches bidirectional path overlap (lock inside write)", () => {
  const { findConflict } = require(path.join(ROOT, "runtime", "cross-agent-lock"));
  // Write covers a directory; lock is on a specific file under that dir.
  const r = findConflict({
    owner: "me",
    projectRoot: "/proj",
    paths: ["/proj/src"],
    locks: [{ owner: "other", projectRoot: "/proj", paths: ["/proj/src/shared.ts"], expiresAt: Date.now() + 60_000 }],
  });
  assert.ok(r);
  assert.strictEqual(r.owner, "other");
});

test("findConflict skips records that are missing owner or scope", () => {
  const { findConflict } = require(path.join(ROOT, "runtime", "cross-agent-lock"));
  const r = findConflict({
    owner: "me",
    projectRoot: "/proj",
    paths: ["/proj/a"],
    locks: [
      { owner: "", projectRoot: "/proj", paths: ["/proj/a"], expiresAt: Date.now() + 60_000 },
      { owner: "other", expiresAt: Date.now() + 60_000 }, // no projectRoot, no paths
    ],
  });
  assert.strictEqual(r, null);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
