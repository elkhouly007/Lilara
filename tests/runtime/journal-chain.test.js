#!/usr/bin/env node
"use strict";

// journal-chain.test.js — ADR-004 PR 37A.
//
// Zero-dep node:assert tests that prove the hash chain detects:
//   1. positive case: clean chain verifies
//   2. single-entry mutation: payload tampering breaks entryHash
//   3. entryHash mutation: forging entryHash alone breaks the link to next
//   4. deletion: removing a middle entry breaks seq + prevHash
//   5. reordering: swapping two entries breaks seq + prevHash
//   6. genesis HMAC: rewriting genesis payload breaks genesisSig
//
// Run: node tests/runtime/journal-chain.test.js

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "horus-journal-chain-"));
process.env.HORUS_STATE_DIR = tmp;
process.env.HOME            = tmp;

const journal = require(path.join(__dirname, "..", "..", "runtime", "journal-chain"));

let passed = 0;
let failed = 0;
function test(name, fn) {
  // Each test runs against a fresh chain + key file.
  const file = path.join(tmp, "chain-" + Math.random().toString(36).slice(2) + ".jsonl");
  try {
    fn(file);
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stderr.write(`  FAIL ${name}: ${err && err.stack || err}\n`);
  }
}

function seed(file, count) {
  for (let i = 0; i < count; i++) {
    journal.append("decision.allow", { i, note: "fixture-" + i }, { file });
  }
  return journal.readEntries(file);
}

function writeEntries(file, entries) {
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// positive
// ---------------------------------------------------------------------------
test("verify: clean chain passes (genesis + 4 entries)", (file) => {
  seed(file, 4);
  const r = journal.verify({ file });
  assert.strictEqual(r.ok, true, "expected ok");
  assert.strictEqual(r.entryCount, 5, "expected genesis + 4");
  assert.deepStrictEqual(r.errors, []);
});

test("verify: empty chain is ok (no entries yet)", (file) => {
  const r = journal.verify({ file });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.entryCount, 0);
});

test("install-key: stored at 0600 (POSIX), regenerated only once", () => {
  const key1 = journal.getOrCreateInstallKey();
  const key2 = journal.getOrCreateInstallKey();
  assert.ok(key1.equals(key2), "same key returned on second call");
  // Key material must never appear in toString of the id.
  const id = journal.installKeyId(key1);
  assert.match(id, /^k_[0-9a-f]{8}$/);
  // On POSIX, the file should be 0600.
  if (process.platform !== "win32") {
    const stat = fs.statSync(journal.installKeyPath());
    assert.strictEqual(stat.mode & 0o777, 0o600, "install.key not 0600");
  }
});

// ---------------------------------------------------------------------------
// tamper: single-entry mutation
// ---------------------------------------------------------------------------
test("mutation: changing payload after write breaks entryHash", (file) => {
  const entries = seed(file, 3);
  // Tamper with seq=2 payload only, leave entryHash as-is.
  entries[2].payload.note = "TAMPERED";
  writeEntries(file, entries);
  const r = journal.verify({ file });
  assert.strictEqual(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.seq === 2 && e.reason === "entryhash-mismatch"),
    "expected entryhash-mismatch at seq=2, got " + JSON.stringify(r.errors)
  );
});

test("mutation: rewriting entryHash alone breaks prevHash of next entry", (file) => {
  const entries = seed(file, 3);
  entries[1].entryHash = "sha256:" + "0".repeat(64);
  writeEntries(file, entries);
  const r = journal.verify({ file });
  assert.strictEqual(r.ok, false);
  // entryHash recomputation at seq=1 will mismatch the forged value AND the
  // chain link from seq=2 will fail because prevHash no longer matches.
  assert.ok(r.errors.some((e) => e.reason === "entryhash-mismatch"),  "expected entryhash-mismatch");
  assert.ok(r.errors.some((e) => e.reason === "prevhash-mismatch"),   "expected prevhash-mismatch");
});

// ---------------------------------------------------------------------------
// tamper: deletion
// ---------------------------------------------------------------------------
test("deletion: removing a middle entry breaks chain (seq + prevHash)", (file) => {
  const entries = seed(file, 4);
  // Drop seq=2.
  const trimmed = entries.filter((e) => e.seq !== 2);
  writeEntries(file, trimmed);
  const r = journal.verify({ file });
  assert.strictEqual(r.ok, false);
  assert.ok(
    r.errors.some((e) => /^seq-discontinuity/.test(e.reason)),
    "expected seq-discontinuity"
  );
  assert.ok(
    r.errors.some((e) => e.reason === "prevhash-mismatch"),
    "expected prevhash-mismatch"
  );
});

test("deletion: truncating tail leaves remaining chain valid (length only changes)", (file) => {
  const entries = seed(file, 4);
  writeEntries(file, entries.slice(0, 3));
  // A truncated tail is not detectable without an external anchor, so the
  // remaining prefix should still verify clean. This documents the limit.
  const r = journal.verify({ file });
  assert.strictEqual(r.ok, true, "prefix should verify");
  assert.strictEqual(r.entryCount, 3);
});

// ---------------------------------------------------------------------------
// tamper: reordering
// ---------------------------------------------------------------------------
test("reordering: swapping two non-genesis entries breaks chain", (file) => {
  const entries = seed(file, 4);
  const swapped = [entries[0], entries[2], entries[1], entries[3], entries[4]];
  writeEntries(file, swapped);
  const r = journal.verify({ file });
  assert.strictEqual(r.ok, false);
  assert.ok(
    r.errors.some((e) => /^seq-discontinuity/.test(e.reason)),
    "expected seq-discontinuity from reorder"
  );
  assert.ok(
    r.errors.some((e) => e.reason === "prevhash-mismatch"),
    "expected prevhash-mismatch from reorder"
  );
});

// ---------------------------------------------------------------------------
// genesis HMAC
// ---------------------------------------------------------------------------
test("genesis: tampering with payload invalidates HMAC and entryHash", (file) => {
  const entries = seed(file, 1);
  entries[0].payload.project = "ATTACKER";
  // Leave genesisSig intact: we are simulating a payload-only edit. entryHash
  // will mismatch and HMAC will mismatch.
  writeEntries(file, entries);
  const r = journal.verify({ file });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.reason === "genesis-hmac-mismatch"), "expected genesis-hmac-mismatch");
  assert.ok(r.errors.some((e) => e.reason === "entryhash-mismatch"),     "expected entryhash-mismatch");
});

test("genesis: forging genesisSig with unknown key fails HMAC check", (file) => {
  const entries = seed(file, 1);
  entries[0].genesisSig = "hmac-sha256:" + "0".repeat(64);
  // recompute entryHash so entryhash-mismatch does not mask the HMAC failure
  entries[0].entryHash = journal.computeEntryHash(entries[0]);
  writeEntries(file, entries);
  const r = journal.verify({ file });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.reason === "genesis-hmac-mismatch"), "expected genesis-hmac-mismatch");
});

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
process.stdout.write(`\njournal-chain.test: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
