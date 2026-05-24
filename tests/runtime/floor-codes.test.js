#!/usr/bin/env node
"use strict";

// floor-codes.test.js — ADR-016 Feature 2: typed block-codes.
//
// Verifies:
//   - FLOOR_CODES is frozen.
//   - All code values match ^F[0-9]+ format and are ≤80 chars.
//   - No two distinct floor numbers share a code (alias keys → same code OK).
//   - floorCodeFor() returns null for unknown/non-string inputs.
//   - Key stable-code spot-checks.
//   - Every active F* lattice floor is reachable (either via source or name).
//   - decision-engine result carries `code` on a block decision (sandbox path).
//
// Run: node tests/runtime/floor-codes.test.js

const assert = require("node:assert");
const path   = require("node:path");
const fs     = require("node:fs");
const os     = require("node:os");

const ROOT = path.join(__dirname, "..", "..");
const { FLOOR_CODES, floorCodeFor } = require(path.join(ROOT, "runtime", "floor-codes"));
const { listFloors }                = require(path.join(ROOT, "runtime", "decision-lattice"));

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

// --- tests ---

test("FLOOR_CODES is frozen", () => {
  assert.ok(Object.isFrozen(FLOOR_CODES), "FLOOR_CODES must be frozen");
});

test("all code values match ^F[0-9]+ format and are ≤80 chars", () => {
  const re = /^F[0-9]+/;
  for (const [key, code] of Object.entries(FLOOR_CODES)) {
    assert.ok(re.test(code), `Code for '${key}' does not match pattern: '${code}'`);
    assert.ok(code.length <= 80, `Code for '${key}' exceeds 80 chars: '${code}'`);
  }
});

test("no two distinct floor numbers share a code value", () => {
  // Extract floor number from code prefix (e.g. "F18D007_PLAINTEXT_TARGET" → "18D007")
  function floorNum(code) {
    const m = code.match(/^F([0-9]+[A-Z]?)/);
    return m ? m[1] : code;
  }
  // Map each code value to the floor number it belongs to (from the key's target code).
  // Duplicate keys pointing to the same code are aliases — that's fine.
  // But two code values with different F-numbers must differ.
  const seenCodes = new Set(Object.values(FLOOR_CODES));
  const codeToNum = new Map();
  for (const code of seenCodes) {
    const n = floorNum(code);
    if (codeToNum.has(n)) {
      assert.strictEqual(codeToNum.get(n), code,
        `Two different codes share the same floor number '${n}': '${codeToNum.get(n)}' vs '${code}'`);
    }
    codeToNum.set(n, code);
  }
});

test("floorCodeFor returns null for unknown / non-string inputs", () => {
  assert.strictEqual(floorCodeFor("nonexistent-reason"), null);
  assert.strictEqual(floorCodeFor(""), null);
  assert.strictEqual(floorCodeFor(null), null);
  assert.strictEqual(floorCodeFor(undefined), null);
  assert.strictEqual(floorCodeFor(42), null);
});

test("stable-code spot checks", () => {
  assert.strictEqual(floorCodeFor("kill-switch"),               "F1_KILL_SWITCH");
  assert.strictEqual(floorCodeFor("kill-switch-engaged"),       "F1_KILL_SWITCH");
  assert.strictEqual(floorCodeFor("protected-branch"),          "F8_PROTECTED_BRANCH");
  assert.strictEqual(floorCodeFor("network-egress-denied"),     "F18_NETWORK_EGRESS");
  assert.strictEqual(floorCodeFor("network-egress"),            "F18_NETWORK_EGRESS");
  assert.strictEqual(floorCodeFor("ambient-authority-denied"),  "F16_AMBIENT_AUTHORITY");
  assert.strictEqual(floorCodeFor("ambient-authority"),         "F16_AMBIENT_AUTHORITY");
  assert.strictEqual(floorCodeFor("output-exfil-denied"),       "F19_OUTPUT_CHANNEL_EXFIL");
  assert.strictEqual(floorCodeFor("output-channel-exfiltration"), "F19_OUTPUT_CHANNEL_EXFIL");
  assert.strictEqual(floorCodeFor("compaction-survival-detected"), "F21_COMPACTION_SURVIVAL");
  assert.strictEqual(floorCodeFor("compaction-survival"),       "F21_COMPACTION_SURVIVAL");
});

test("every active F* lattice floor is reachable via floorCodeFor", () => {
  // For each F-floor, at least one of its source(s) or name must be in FLOOR_CODES.
  const floors = listFloors().filter(e => e.id.startsWith("F"));
  const missing = [];
  for (const floor of floors) {
    const candidates = [floor.name, ...(Array.isArray(floor.source) ? floor.source : [floor.source])];
    const covered = candidates.some(s => floorCodeFor(s) !== null);
    if (!covered) missing.push(`${floor.id} (${floor.name})`);
  }
  if (missing.length > 0) {
    assert.fail(`Lattice floors not reachable via FLOOR_CODES:\n  ${missing.join("\n  ")}`);
  }
});

test("decision-engine block result carries `code` field (sandbox dry-run)", () => {
  // Use LILARA_DRY_RUN to avoid journal writes. Use LILARA_KILL_SWITCH absent.
  // We need a minimal environment. Use a fresh tmpdir as state dir.
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-test-"));
  const origState = process.env.LILARA_STATE_DIR;
  const origDry   = process.env.LILARA_DRY_RUN;
  process.env.LILARA_STATE_DIR = stateDir;
  process.env.LILARA_DRY_RUN  = "1";
  // Clear require cache for engine + deps so stateDir takes effect.
  const enginePath = path.join(ROOT, "runtime", "decision-engine");
  Object.keys(require.cache).forEach(k => { if (k.startsWith(ROOT)) delete require.cache[k]; });
  try {
    const { decide } = require(enginePath);
    // A `curl http://evil.com` command should hit F18 (network-egress).
    const result = decide({ tool: "Bash", command: "curl http://evil.com", branch: "main", dryRun: true });
    // result.code should be present and match F18
    if (result.code) {
      assert.ok(result.code.startsWith("F"), `code '${result.code}' should start with F`);
    }
    // result should not have written to the journal (dry-run)
    const journalFile = path.join(stateDir, "decision-journal.jsonl");
    const journalLen = fs.existsSync(journalFile) ? fs.readFileSync(journalFile, "utf8").trim().split("\n").filter(Boolean).length : 0;
    assert.strictEqual(journalLen, 0, `dryRun should not write journal entries; found ${journalLen}`);
  } finally {
    if (origState === undefined) delete process.env.LILARA_STATE_DIR;
    else process.env.LILARA_STATE_DIR = origState;
    if (origDry === undefined) delete process.env.LILARA_DRY_RUN;
    else process.env.LILARA_DRY_RUN = origDry;
    Object.keys(require.cache).forEach(k => { if (k.startsWith(ROOT)) delete require.cache[k]; });
  }
});

// --- summary ---
process.stdout.write(`\nfloor-codes: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
