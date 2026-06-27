"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

const { evaluateFloor } = require("../../runtime/floor-tamper");

function withEnvOverride(key, value, fn) {
  const orig = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    if (orig === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = orig;
    }
  }
}

test("BLOCK: targetPath under default stateDir (~/.lilara)", () => {
  const targetPath = path.join(os.homedir(), ".lilara", "decision-journal.jsonl");
  const r = evaluateFloor({ targetPath });
  assert.equal(r.fired, true);
  assert.equal(r.action, "block");
  assert.match(r.reason, /installed guard footprint/);
});

test("BLOCK: targetPath ~/.lilara/operator-tokens.jsonl", () => {
  const targetPath = path.join(os.homedir(), ".lilara", "operator-tokens.jsonl");
  const r = evaluateFloor({ targetPath });
  assert.equal(r.fired, true);
  assert.equal(r.action, "block");
});

test("BLOCK: targetPath under instinctDir (~/.lilara/instincts/foo)", () => {
  const targetPath = path.join(os.homedir(), ".lilara", "instincts", "foo");
  const r = evaluateFloor({ targetPath });
  assert.equal(r.fired, true);
  assert.equal(r.action, "block");
});

test("BLOCK: LILARA_STATE_DIR override", () => {
  withEnvOverride("LILARA_STATE_DIR", "/tmp/lilara-iso-test", () => {
    const targetPath = "/tmp/lilara-iso-test/decision-journal.jsonl";
    const r = evaluateFloor({ targetPath });
    assert.equal(r.fired, true);
    assert.equal(r.action, "block");
  });
});

test("ALLOW: targetPath outside protected dirs", () => {
  const targetPath = "/home/user/dev/myapp/src/foo.ts";
  const r = evaluateFloor({ targetPath });
  assert.equal(r.fired, false);
});

test("ALLOW: targetPath is ./README.md (relative cwd)", () => {
  const r = evaluateFloor({ targetPath: "./README.md" });
  assert.equal(r.fired, false);
});

test("ALLOW: targetPath ~/.lilara-cache-tmp/x (different prefix)", () => {
  const targetPath = path.join(os.homedir(), ".lilara-cache-tmp", "x");
  const r = evaluateFloor({ targetPath });
  assert.equal(r.fired, false);
});

// ── ADR-050 compliance: floor decides on IR's resolved target ONLY ─────────
// ADR-050 §Implementation constraints: "the floor decides on the canonical
// Action-IR's file targets (pure inputs), like every other floor." Parsing
// input.command for path tokens would (a) bypass the IR contract, (b) defeat
// the "pure input" guarantee, and (c) produce false-positives on legitimate
// commands whose argv merely mentions a protected path (e.g. `cat README.md
// ~/.lilara/README.md`). The floor must NOT parse command — it must only
// inspect input.targetPath.

test("ADR-050: command-only input with no targetPath → does NOT fire", () => {
  // This is the load-bearing property: a command string that mentions a
  // protected path (e.g. `rm ~/.lilara/decision-journal.jsonl`) but does NOT
  // carry the resolved targetPath in the IR must NOT trip F30 — that would
  // be a false-positive on legitimate commands that merely reference the
  // state dir (e.g. in documentation, help text, log inspection).
  const cmd = "echo reviewing ~/.lilara/decision-journal.jsonl";
  const r = evaluateFloor({ command: cmd });
  assert.equal(r.fired, false);
});

test("ADR-050: targetPath absent + command mentions protected path → does NOT fire", () => {
  const r = evaluateFloor({ command: "cat ~/.lilara/instincts/foo" });
  assert.equal(r.fired, false);
});

test("ADR-050: targetPath outside protected dirs + command mentions them → does NOT fire", () => {
  // Operator runs a legitimate command that mentions the state dir in an
  // argument, while the IR's resolved targetPath is an unrelated path.
  // The floor MUST inspect targetPath only — not parse argv.
  const r = evaluateFloor({
    targetPath: "/home/user/dev/myapp/src/foo.ts",
    command: "cp /home/user/dev/myapp/src/foo.ts ~/.lilara/backup-foo.ts",
  });
  assert.equal(r.fired, false);
});

test("ADR-050: targetPath inside protected dirs + unrelated command → FIRES", () => {
  // The IR carries the resolved targetPath (the write site) under the
  // protected footprint. The command is irrelevant — F30 fires on the IR's
  // targetPath only.
  const targetPath = path.join(os.homedir(), ".lilara", "decision-journal.jsonl");
  const r = evaluateFloor({ targetPath, command: "echo writing journal" });
  assert.equal(r.fired, true);
  assert.equal(r.action, "block");
});

// ── Defense-in-depth: subdir of protected dir is still under protected dir ──

test("BLOCK: deep nested targetPath under protected dir still fires", () => {
  const targetPath = path.join(os.homedir(), ".lilara", "a", "b", "c", "d", "x.jsonl");
  const r = evaluateFloor({ targetPath });
  assert.equal(r.fired, true);
  assert.equal(r.action, "block");
});

test("ALLOW: empty input object", () => {
  const r = evaluateFloor({});
  assert.equal(r.fired, false);
});

test("ALLOW: null input", () => {
  const r = evaluateFloor(null);
  assert.equal(r.fired, false);
});
