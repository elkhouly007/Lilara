#!/usr/bin/env node
"use strict";

// receipt-export.test.js — ADR-014 audit-grade receipt exporter.
//
// Coverage:
//   1. exportReceipts(jsonl) emits canonical-JSON, one entry per line.
//   2. JSONL round-trip is byte-identical (export → parse → re-export).
//   3. CSV columns are deterministic and match schema field order.
//   4. since/until filter is correct at millisecond boundaries.
//   5. sessionId / decisionAction / riskLevel filters compose.
//   6. End-to-end: produce 50 receipts via decide() replay → export jsonl →
//      re-import → assert each parsed entry deep-equals its source.
//   7. exportManifest contentSha256 and bundleHash are stable.

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..", "..");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); }
  catch (err) { failed++; process.stderr.write(`  FAIL ${name}: ${err && err.stack || err}\n`); }
}

function freshStateDir(label) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), "arg-rx-" + label + "-"));
  process.env.HORUS_STATE_DIR = p;
  // Reset the runtime cache so receipt-export rebinds to the new state dir.
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.join(root, "runtime") + path.sep)) delete require.cache[k];
  }
  return p;
}

function entry(overrides) {
  return Object.assign({
    ts: "2026-05-15T12:00:00.000Z",
    kind: "runtime-decision",
    action: "allow",
    riskLevel: "low",
    riskScore: 1,
    reasonCodes: ["test"],
    tool: "Bash",
    branch: "feature/test",
    targetPath: "/tmp/x",
    notes: "test",
  }, overrides || {});
}

function writeJournal(stateDir, entries) {
  const file = path.join(stateDir, "decision-journal.jsonl");
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(file, lines, { mode: 0o600 });
  return file;
}

test("jsonl export emits one canonical-JSON line per entry", () => {
  const sd = freshStateDir("jsonl-basic");
  writeJournal(sd, [entry({ riskScore: 1 }), entry({ riskScore: 2, action: "block", riskLevel: "critical" })]);
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const buf = exportReceipts({}, "jsonl");
  const lines = buf.toString("utf8").split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 2);
  // Canonical-JSON: keys sorted alphabetically. First key by alpha for our
  // entry is "action".
  for (const ln of lines) assert.ok(ln.startsWith('{"action":'), "expected canonical-key-sort starting at 'action'");
});

test("jsonl round-trip is byte-identical", () => {
  const sd = freshStateDir("jsonl-roundtrip");
  writeJournal(sd, [entry(), entry({ riskScore: 5, riskLevel: "high" }), entry({ snapshot: { attempted: true, status: "created", snapshotId: "snap-x" } })]);
  const { exportReceipts, roundTrip } = require(path.join(root, "runtime/receipt-export"));
  const buf = exportReceipts({}, "jsonl");
  const r = roundTrip(buf, "jsonl");
  assert.strictEqual(r.ok, true, "round-trip mismatch reason: " + r.reason);
  assert.strictEqual(r.parsedCount, 3);
});

test("csv columns are deterministic and match schema property order", () => {
  const sd = freshStateDir("csv");
  writeJournal(sd, [entry({ riskScore: 3, contractId: "policy/main" })]);
  const { exportReceipts, _csvColumns } = require(path.join(root, "runtime/receipt-export"));
  const buf = exportReceipts({}, "csv");
  const lines = buf.toString("utf8").split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 2); // header + 1 row
  const expectedHeader = _csvColumns().join(",");
  assert.strictEqual(lines[0], expectedHeader);
});

test("since/until filter is correct on millisecond boundaries", () => {
  const sd = freshStateDir("ms");
  const t1 = "2026-05-15T12:00:00.000Z";
  const t2 = "2026-05-15T12:00:00.500Z";
  const t3 = "2026-05-15T12:00:01.000Z";
  writeJournal(sd, [entry({ ts: t1, notes: "a" }), entry({ ts: t2, notes: "b" }), entry({ ts: t3, notes: "c" })]);
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const buf = exportReceipts({ since: t2, until: t2 }, "jsonl");
  const lines = buf.toString("utf8").split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].includes('"notes":"b"'));
});

test("filters compose: sessionId + decisionAction + riskLevel", () => {
  const sd = freshStateDir("compose");
  // sessionId isn't a top-level journal field today, so we filter by
  // (decisionAction, riskLevel) — both are first-class.
  writeJournal(sd, [
    entry({ action: "allow",          riskLevel: "low",    notes: "a" }),
    entry({ action: "block",          riskLevel: "critical", notes: "b" }),
    entry({ action: "require-review", riskLevel: "medium",  notes: "c" }),
    entry({ action: "block",          riskLevel: "high",    notes: "d" }),
  ]);
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const buf = exportReceipts({ decisionAction: "block", riskLevel: "critical" }, "jsonl");
  const lines = buf.toString("utf8").split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].includes('"notes":"b"'));
});

test("exportManifest is stable across re-export of identical content", () => {
  const sd = freshStateDir("manifest");
  writeJournal(sd, [entry({ riskScore: 1 }), entry({ riskScore: 2 })]);
  const { exportReceipts, buildExportManifest } = require(path.join(root, "runtime/receipt-export"));
  const buf1 = exportReceipts({}, "jsonl");
  const buf2 = exportReceipts({}, "jsonl");
  assert.ok(buf1.equals(buf2), "two exports of identical content must be byte-identical");
  const m1 = buildExportManifest(buf1, { format: "jsonl", entryCount: 2, createdAt: "2026-05-15T12:00:00.000Z" });
  const m2 = buildExportManifest(buf2, { format: "jsonl", entryCount: 2, createdAt: "2026-05-15T13:00:00.000Z" });
  assert.strictEqual(m1.contentSha256, m2.contentSha256);
  assert.strictEqual(m1.bundleHash, m2.bundleHash, "bundleHash must ignore createdAt drift");
});

test("end-to-end: 50 decide() receipts → export jsonl → re-import → byte-identical", () => {
  const sd = freshStateDir("e2e");
  process.env.HORUS_CONTRACT_ENABLED = "0";
  process.env.HORUS_DECISION_JOURNAL = "1";
  process.env.HORUS_RATE_LIMIT       = "0";
  delete process.env.HORUS_KILL_SWITCH;
  delete process.env.HORUS_VALIDATE_RECEIPTS;

  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.join(root, "runtime") + path.sep)) delete require.cache[k];
  }
  const { decide } = require(path.join(root, "runtime/decision-engine"));
  const { build: buildIr } = require(path.join(root, "runtime/action-ir"));

  for (let i = 0; i < 50; i++) {
    const input = {
      tool: "Bash", command: "git status",
      targetPath: path.join(sd, "x" + i), branch: "feature/test",
      projectRoot: sd,
    };
    input.ir = buildIr(input, { harness: "", tool: "Bash", command: "git status",
      cwd: input.targetPath, projectRoot: sd, branch: "feature/test" });
    decide(input);
  }

  const jFile = path.join(sd, "decision-journal.jsonl");
  const rawLines = fs.readFileSync(jFile, "utf8").split("\n").filter(Boolean);
  assert.ok(rawLines.length >= 50, "expected 50+ journal entries, got " + rawLines.length);

  const { exportReceipts, roundTrip } = require(path.join(root, "runtime/receipt-export"));
  const buf = exportReceipts({}, "jsonl");
  const rt  = roundTrip(buf, "jsonl");
  assert.strictEqual(rt.ok, true, "round-trip failed: " + rt.reason);

  // Parsed entries must deep-equal the source entries (canonical-form
  // independent — JSON.parse normalises key order). Compare via canonical-JSON.
  const { canonicalJson } = require(path.join(root, "runtime/canonical-json"));
  const source = rawLines.map((l) => JSON.parse(l));
  const exported = buf.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.strictEqual(exported.length, source.length);
  for (let i = 0; i < source.length; i++) {
    assert.strictEqual(canonicalJson(exported[i]), canonicalJson(source[i]),
      "entry " + i + " content differs");
  }
});

test("HORUS_VALIDATE_RECEIPTS=1 dev-mode throws on invalid append", () => {
  const sd = freshStateDir("validate-flag");
  process.env.HORUS_VALIDATE_RECEIPTS = "1";
  process.env.HORUS_DECISION_JOURNAL  = "1";
  delete require.cache[require.resolve(path.join(root, "runtime/decision-journal"))];
  const dj = require(path.join(root, "runtime/decision-journal"));
  let threw = false;
  try {
    // Force an invalid action enum to drive a schema failure.
    dj.append({ kind: "runtime-decision", action: "garbage-action", riskLevel: "low" });
  } catch (e) {
    threw = /receipt-validation-failed/.test(e.message);
  }
  delete process.env.HORUS_VALIDATE_RECEIPTS;
  assert.strictEqual(threw, true, "expected receipt-validation-failed throw");
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
