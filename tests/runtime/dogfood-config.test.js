#!/usr/bin/env node
"use strict";

// dogfood-config.test.js — regression guard for the repo's own lilara.config.json.
// Locks the schema: runtime.* nesting, snake_case keys, master/main protected.
// If this test starts failing because the dogfood config moved to a different
// shape, update BOTH the file and this test; do not silence one without the other.
//
// Run: node tests/runtime/dogfood-config.test.js

const assert = require("node:assert");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-dogfood-cfg-"));
process.env.LILARA_STATE_DIR = tmpState;
process.env.LILARA_CONTRACT_ENABLED = "0";
process.env.LILARA_RATE_LIMIT = "0";
delete process.env.LILARA_KILL_SWITCH;

const { loadProjectPolicy } = require(path.join(root, "runtime/project-policy"));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); }
  catch (err) { failed++; process.stderr.write(`  FAIL  ${name}: ${err && err.stack || err}\n`); }
}

test("dogfood config loads with hasExplicitProtectedBranches=true", () => {
  const p = loadProjectPolicy({ projectRoot: root });
  assert.strictEqual(p.hasExplicitProtectedBranches, true,
    "dogfood config must set runtime.protected_branches so operator opt-in fires");
});

test("dogfood config protectedBranches is master+main (operator-asserted, not fallback)", () => {
  const p = loadProjectPolicy({ projectRoot: root });
  assert.deepStrictEqual(p.protectedBranches.slice().sort(), ["main", "master"]);
});

test("dogfood config trustPosture is balanced", () => {
  const p = loadProjectPolicy({ projectRoot: root });
  assert.strictEqual(p.trustPosture, "balanced");
});

test("dogfood config projectScope resolves to repo root", () => {
  const p = loadProjectPolicy({ projectRoot: root });
  assert.strictEqual(p.projectScope, root,
    "loadProjectPolicy should anchor projectScope to the directory of the loaded config");
});

try { fs.rmSync(tmpState, { recursive: true, force: true }); } catch { /* best-effort */ }

process.stdout.write(`\n[dogfood-config.test] ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
