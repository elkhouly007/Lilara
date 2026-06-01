#!/usr/bin/env node
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
    passed += 1;
    console.log("  ok  " + name);
  } catch (err) {
    failed += 1;
    console.error("  FAIL " + name);
    console.error("       " + err.message);
  }
}

function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-mem-test-"));
  return dir;
}

function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Dynamically load with a state-dir override
function mem(dir) {
  // Clear require cache to get a fresh module instance with no lingering state
  const modPath = require.resolve("../../runtime/session-memory");
  delete require.cache[modPath];
  return require("../../runtime/session-memory");
}

function search(dir) {
  const modPath = require.resolve("../../runtime/memory-search");
  delete require.cache[modPath];
  return require("../../runtime/memory-search");
}

// ---------------------------------------------------------------------------
test("addFact creates facts.jsonl with correct shape", () => {
  const tmp = makeTmp();
  try {
    const mod = mem(tmp);
    const { id } = mod.addFact({ fact: "Node.js version is 24", source: "test" }, { stateDirOverride: tmp });
    assert.ok(id, "id returned");
    const facts = mod.loadFacts({ stateDirOverride: tmp });
    assert.strictEqual(facts.length, 1);
    assert.strictEqual(facts[0].fact, "Node.js version is 24");
    assert.strictEqual(facts[0].source, "test");
    assert.strictEqual(typeof facts[0].decayScore, "number");
    assert.ok(facts[0].timestamp, "timestamp present");
  } finally { rm(tmp); }
});

test("listFacts returns most-recent first", () => {
  const tmp = makeTmp();
  try {
    const mod = mem(tmp);
    mod.addFact({ fact: "first fact" }, { stateDirOverride: tmp });
    mod.addFact({ fact: "second fact" }, { stateDirOverride: tmp });
    const list = mod.listFacts({ limit: 5, stateDirOverride: tmp });
    assert.strictEqual(list[0].fact, "second fact");
    assert.strictEqual(list[1].fact, "first fact");
  } finally { rm(tmp); }
});

test("pruneExpired removes decayScore ≤ 0 facts and rebuilds index", () => {
  const tmp = makeTmp();
  try {
    const mod = mem(tmp);
    const { id: id1 } = mod.addFact({ fact: "keep me" }, { stateDirOverride: tmp });
    mod.addFact({ fact: "prune me" }, { stateDirOverride: tmp });
    // Manually zero out the second fact's decay
    const file = mod.factsFile(tmp);
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const modified = lines.map((l) => {
      const o = JSON.parse(l);
      if (o.fact === "prune me") o.decayScore = 0;
      return JSON.stringify(o);
    });
    fs.writeFileSync(file, modified.join("\n") + "\n");
    const pruned = mod.pruneExpired({ stateDirOverride: tmp });
    assert.strictEqual(pruned, 1);
    const remaining = mod.loadFacts({ stateDirOverride: tmp });
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].fact, "keep me");
  } finally { rm(tmp); }
});

test("search returns top-k by keyword overlap", () => {
  const tmp = makeTmp();
  try {
    const mod = mem(tmp);
    mod.addFact({ fact: "project uses TypeScript and React" }, { stateDirOverride: tmp });
    mod.addFact({ fact: "database is PostgreSQL" }, { stateDirOverride: tmp });
    mod.addFact({ fact: "TypeScript strict mode enabled" }, { stateDirOverride: tmp });
    const s = search(tmp);
    const results = s.search("TypeScript", { topK: 3, stateDirOverride: tmp });
    assert.ok(results.length >= 1, "at least one result");
    assert.ok(results[0].fact.toLowerCase().includes("typescript"), "top result mentions typescript");
  } finally { rm(tmp); }
});

test("search with empty query returns top-k by recency", () => {
  const tmp = makeTmp();
  // addFact uses new Date().toISOString() internally (no timestamp param).
  // On fast hardware (Node v24) sequential synchronous writes land in the same
  // millisecond, making the recency sort non-deterministic.  Insert a guaranteed
  // sub-ms gap (2 ms) between each write so timestamps are strictly ordered.
  const sleep2ms = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
  try {
    const mod = mem(tmp);
    mod.addFact({ fact: "alpha" }, { stateDirOverride: tmp });
    sleep2ms();
    mod.addFact({ fact: "beta" }, { stateDirOverride: tmp });
    sleep2ms();
    mod.addFact({ fact: "gamma" }, { stateDirOverride: tmp });
    const s = search(tmp);
    const results = s.search("", { topK: 2, stateDirOverride: tmp });
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].fact, "gamma");
  } finally { rm(tmp); }
});

test("consolidate merges duplicate facts and is idempotent", () => {
  const tmp = makeTmp();
  try {
    const mod = mem(tmp);
    mod.addFact({ fact: "same fact" }, { stateDirOverride: tmp });
    mod.addFact({ fact: "Same Fact" }, { stateDirOverride: tmp });
    mod.addFact({ fact: "unique fact" }, { stateDirOverride: tmp });
    const s = search(tmp);
    const r1 = s.consolidate({ stateDirOverride: tmp });
    assert.strictEqual(r1.merged, 1, "one duplicate merged");
    assert.strictEqual(r1.survivors, 2, "two survivors remain");
    // Idempotent
    const r2 = s.consolidate({ stateDirOverride: tmp });
    assert.strictEqual(r2.merged, 0, "second run produces no merges");
  } finally { rm(tmp); }
});

test("consolidate dry-run does not modify files", () => {
  const tmp = makeTmp();
  try {
    const mod = mem(tmp);
    mod.addFact({ fact: "dup" }, { stateDirOverride: tmp });
    mod.addFact({ fact: "dup" }, { stateDirOverride: tmp });
    const before = fs.readFileSync(mod.factsFile(tmp), "utf8");
    const s = search(tmp);
    s.consolidate({ dryRun: true, stateDirOverride: tmp });
    const after = fs.readFileSync(mod.factsFile(tmp), "utf8");
    assert.strictEqual(before, after, "file unchanged in dry-run");
  } finally { rm(tmp); }
});

test("tokenise extracts lowercased 3+ char tokens", () => {
  const mod = mem(os.tmpdir());
  const tokens = mod.tokenise("Use Node.js with TypeScript!");
  assert.ok(tokens.includes("use"));
  assert.ok(tokens.includes("node"));
  assert.ok(tokens.includes("with"));
  assert.ok(tokens.includes("typescript"));
  assert.ok(!tokens.includes("js"), "'js' is only 2 chars, excluded");
});

// ---------------------------------------------------------------------------
console.log("\nsession-memory.test.js: " + (passed + failed) + " test(s)");
if (failed > 0) {
  console.error(failed + " FAILED");
  process.exit(1);
} else {
  console.log(passed + " passed");
}
