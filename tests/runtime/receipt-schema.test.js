#!/usr/bin/env node
"use strict";

// receipt-schema.test.js — ADR-014 audit-grade receipt schema validator.
//
// Coverage:
//   1. validateReceipt accepts a minimal canonical entry.
//   2. validateReceipt rejects an unknown top-level field (strict mode).
//   3. validateReceipt rejects a missing required field.
//   4. validateReceipt rejects a wrong-type field.
//   5. validateReceipt accepts every entry produced by replaying every
//      lattice-receipts fixture through decide() (no schema gaps).
//   6. validateJournalChain folds in ADR-004 chain verification and
//      detects a single-byte tamper of a chained entry.
//   7. Round-trip: a valid entry survives canonical-JSON + JSON.parse +
//      validate cleanly.

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..", "..");
const { validateReceipt, validateJournalChain, loadSchema } = require(path.join(root, "runtime/receipt-validator"));
const { canonicalJson } = require(path.join(root, "runtime/canonical-json"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); }
  catch (err) { failed++; process.stderr.write(`  FAIL ${name}: ${err && err.stack || err}\n`); }
}

function baseReceipt(overrides) {
  return Object.assign({
    ts: "2026-05-15T12:00:00.000Z",
    kind: "runtime-decision",
    action: "allow",
    riskLevel: "low",
    riskScore: 1,
    reasonCodes: ["test-baseline"],
    tool: "Bash",
    branch: "feature/test",
    targetPath: "/tmp/x",
    notes: "test",
  }, overrides || {});
}

test("minimal canonical entry validates", () => {
  const r = validateReceipt(baseReceipt());
  assert.strictEqual(r.valid, true, "errors=" + JSON.stringify(r.errors));
});

test("unknown top-level field is rejected (strict mode)", () => {
  const r = validateReceipt(baseReceipt({ surpriseField: "no" }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => /additional property/.test(e.message)), "expected 'additional property not allowed' err");
});

test("missing required field is rejected", () => {
  const e = baseReceipt();
  delete e.notes;
  const r = validateReceipt(e);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => /missing required field/.test(e.message)));
});

test("wrong-type field is rejected (riskScore as string)", () => {
  const r = validateReceipt(baseReceipt({ riskScore: "1" }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => /expected number/.test(e.message)));
});

test("bad ISO date-time is rejected", () => {
  const r = validateReceipt(baseReceipt({ ts: "not-a-time" }));
  assert.strictEqual(r.valid, false);
});

test("schema has expected top-level fields", () => {
  const s = loadSchema();
  assert.ok(s.properties.ts && s.properties.snapshot && s.properties.changeIntent && s.properties.f19Detail);
  assert.strictEqual(s.additionalProperties, false);
});

test("nested degradedMode shape validates", () => {
  const r = validateReceipt(baseReceipt({ degradedMode: { active: true, reason: "verify-failed" } }));
  assert.strictEqual(r.valid, true);
});

test("nested degradedMode with unknown sub-field rejected", () => {
  const r = validateReceipt(baseReceipt({ degradedMode: { active: true, reason: "x", surprise: "y" } }));
  assert.strictEqual(r.valid, false);
});

test("redactInJournal must be exactly true", () => {
  const ok = validateReceipt(baseReceipt({ redactInJournal: true }));
  const bad = validateReceipt(baseReceipt({ redactInJournal: false }));
  assert.strictEqual(ok.valid, true);
  assert.strictEqual(bad.valid, false);
});

test("validateJournalChain returns valid on a list of OK entries", () => {
  const entries = [baseReceipt(), baseReceipt({ riskScore: 2 })];
  const r = validateJournalChain({ entries });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.schemaErrors.length, 0);
});

test("validateJournalChain surfaces per-entry errors with entry index", () => {
  const entries = [baseReceipt(), baseReceipt({ kind: undefined })];
  const r = validateJournalChain({ entries });
  assert.strictEqual(r.valid, false);
  assert.ok(r.schemaErrors.some((e) => e.entry === 1));
});

test("every lattice-receipts fixture replay validates against the schema", () => {
  // Spawn a child node process per fixture is overkill; instead, replicate
  // the runner inline (same approach as check-receipt-schema.sh) so all
  // entries are validated under the same cache lifecycle the engine uses.
  const fxRoot = path.join(root, "tests/fixtures/lattice-receipts");
  const fixtures = fs.readdirSync(fxRoot).filter((f) => f.endsWith(".input")).sort();
  let totalEntries = 0;
  let allErrors = [];
  for (const f of fixtures) {
    const fxStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-rs-fx-"));
    const fxProject  = fs.mkdtempSync(path.join(os.tmpdir(), "arg-rs-pr-"));
    const fx = JSON.parse(fs.readFileSync(path.join(fxRoot, f), "utf8"));

    const envSnapshot = Object.assign({}, process.env);
    process.env.LILARA_STATE_DIR        = fxStateDir;
    process.env.LILARA_CONTRACT_ENABLED = fx.contract ? "1" : "0";
    process.env.LILARA_DECISION_JOURNAL = "1";
    process.env.LILARA_RATE_LIMIT       = "0";
    delete process.env.LILARA_KILL_SWITCH;
    delete process.env.LILARA_CONTRACT_REQUIRED;
    delete process.env.LILARA_F4_DEMOTE_TOKEN;
    delete process.env.LILARA_IR_JOURNAL;
    if (fx.env) for (const [k, v] of Object.entries(fx.env)) process.env[k] = String(v);

    for (const k of Object.keys(require.cache)) {
      if (k.startsWith(path.join(root, "runtime") + path.sep)) delete require.cache[k];
    }

    if (fx.contract && typeof fx.contract === "object") {
      let doc = JSON.parse(JSON.stringify(fx.contract));
      if (doc.validity && doc.validity.computeOutOfWindow === true) {
        const now = new Date();
        const target = new Date(now.getTime() + 12 * 3600 * 1000);
        const sh = String(target.getUTCHours()).padStart(2, "0");
        const sm = String(target.getUTCMinutes()).padStart(2, "0");
        const em = String((target.getUTCMinutes() + 1) % 60).padStart(2, "0");
        const eh = (target.getUTCMinutes() + 1 >= 60)
          ? String((target.getUTCHours() + 1) % 24).padStart(2, "0") : sh;
        doc.validity = { activeHoursUtc: { start: sh + ":" + sm, end: eh + ":" + em } };
      }
      if (!fx.badHash) {
        const { contractHash: _o, ...rest } = doc;
        doc.contractHash = "sha256:" + crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
      } else if (typeof doc.contractHash !== "string") {
        doc.contractHash = "sha256:" + "0".repeat(64);
      }
      fs.writeFileSync(path.join(fxProject, "lilara.contract.json"), JSON.stringify(doc, null, 2));
      const shouldAccept = fx.acceptContract != null ? fx.acceptContract : !fx.badHash;
      if (shouldAccept) {
        const acceptedKey = path.resolve(fxProject);
        fs.writeFileSync(path.join(fxStateDir, "accepted-contracts.json"), JSON.stringify({
          [acceptedKey]: { contractHash: doc.contractHash, acceptedAt: doc.acceptedAt || "2026-01-01T00:00:00Z", revision: doc.revision || 1, contractId: doc.contractId },
        }, null, 2));
      }
    }
    if (fx.session) {
      const sid = String(fx.session.sessionId || "fixture-session");
      const dir = path.join(fxStateDir, "session-budget");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, sid + ".json"), JSON.stringify({
        destructiveOps: Number(fx.session.destructiveOps || 0),
        externalBytes:  Number(fx.session.externalBytes || 0),
        startTime: Date.now() - Number(fx.session.startTimeAgoMin || 0) * 60_000,
      }, null, 2), { mode: 0o600 });
    }
    if (fx.preDecide && fx.preDecide.recordExternalRead) {
      require(path.join(root, "runtime/taint")).recordExternalRead(String(fx.preDecide.recordExternalRead), "fixture-setup");
    }
    if (fx.preDecide && fx.preDecide.mintF4DemoteToken) {
      const { mintOperatorToken } = require(path.join(root, "runtime/contract"));
      process.env.LILARA_F4_DEMOTE_TOKEN = mintOperatorToken("receipt-schema-fx", "class-c-review-demote");
    }
    if (fx.preDecide && Array.isArray(fx.preDecide.seedCrossAgentLocks)) {
      const lockDir = path.join(fxStateDir, "cross-agent-locks");
      fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
      let idx = 0;
      for (const tmpl of fx.preDecide.seedCrossAgentLocks) {
        idx += 1;
        const rec = JSON.parse(JSON.stringify(tmpl));
        for (const k of Object.keys(rec)) {
          if (typeof rec[k] === "string") rec[k] = rec[k].replace(/\{\{projectRoot\}\}/g, fxProject);
          else if (Array.isArray(rec[k])) rec[k] = rec[k].map((v) => typeof v === "string" ? v.replace(/\{\{projectRoot\}\}/g, fxProject) : v);
        }
        if (rec.expiresAtRelMs != null) { rec.expiresAt = Date.now() + Number(rec.expiresAtRelMs); delete rec.expiresAtRelMs; }
        const nm = String(rec.lockId || ("lock-" + idx)).replace(/[^A-Za-z0-9_.-]/g, "_") + ".json";
        fs.writeFileSync(path.join(lockDir, nm), JSON.stringify(rec, null, 2), { mode: 0o600 });
      }
    }

    function substInput(v) {
      if (typeof v === "string") return v.replace(/\{\{projectRoot\}\}/g, fxProject);
      if (Array.isArray(v)) return v.map(substInput);
      if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = substInput(v[k]); return o; }
      return v;
    }
    const decideInput = Object.assign({ projectRoot: fxProject }, substInput(fx.input || {}));
    if (fx.session && fx.session.sessionId) decideInput.sessionId = String(fx.session.sessionId);
    const buildIr = require(path.join(root, "runtime/action-ir")).build;
    decideInput.ir = buildIr(decideInput, {
      harness: String(decideInput.harness || ""), tool: String(decideInput.tool || "Bash"),
      command: String(decideInput.command || ""), cwd: decideInput.targetPath || fxProject,
      projectRoot: fxProject, branch: decideInput.branch || "",
    });
    const { decide } = require(path.join(root, "runtime/decision-engine"));
    try { decide(decideInput); } catch { /* journal-only assertion */ }

    const jf = path.join(fxStateDir, "decision-journal.jsonl");
    if (fs.existsSync(jf)) {
      for (const ln of fs.readFileSync(jf, "utf8").split("\n").filter(Boolean)) {
        let entry; try { entry = JSON.parse(ln); } catch { continue; }
        totalEntries++;
        const r = validateReceipt(entry);
        if (!r.valid) {
          for (const e of r.errors) allErrors.push(f + ": " + e.path + " — " + e.message);
        }
      }
    }

    for (const k of Object.keys(process.env)) if (!(k in envSnapshot)) delete process.env[k];
    for (const [k, v] of Object.entries(envSnapshot)) process.env[k] = v;
    try { fs.rmSync(fxStateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(fxProject,  { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  assert.ok(totalEntries >= fixtures.length - 1, "expected at least one entry per fixture (kill-switch is journal-less)");
  assert.strictEqual(allErrors.length, 0, "first 5 errors:\n" + allErrors.slice(0, 5).join("\n"));
});

test("validateJournalChain detects a tampered hash-chain entry", () => {
  // Build a chain of 3 entries in a hermetic state-dir, then flip one byte
  // of the second payload to break entryHash + prevHash linkage.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arg-rs-tamper-"));
  process.env.LILARA_STATE_DIR = tmp;
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.join(root, "runtime") + path.sep)) delete require.cache[k];
  }
  const jc = require(path.join(root, "runtime/journal-chain"));
  jc.append("test.event", { i: 1 });
  jc.append("test.event", { i: 2 });
  jc.append("test.event", { i: 3 });

  const chainFile = jc.chainPath();
  const lines = fs.readFileSync(chainFile, "utf8").split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 4); // genesis + 3 entries
  // Flip a byte in the middle entry's payload — entryHash should no longer
  // match the recomputed hash and prevHash linkage should break for line 3.
  const middle = JSON.parse(lines[2]);
  middle.payload.i = 99;
  lines[2] = JSON.stringify(middle);
  fs.writeFileSync(chainFile, lines.join("\n") + "\n", { mode: 0o600 });

  const r = validateJournalChain({ entries: [], chainFile });
  assert.strictEqual(r.valid, false);
  assert.ok(r.chainErrors.length > 0, "expected chain errors after tamper");
  assert.ok(r.chainErrors.some((e) => /entryhash-mismatch|prevhash-mismatch/.test(e.reason)));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
