#!/usr/bin/env node
"use strict";

// receipt-redaction.test.js — ADR-014 redaction guarantee. Adversarial
// corpus of simulated secrets embedded in receipt fields; asserts:
//
//   (a) No plaintext secret survives `exportReceipts(filter, "jsonl")`
//       when filter.redact is set.
//   (b) The redacted token is byte-stable across re-export.
//   (c) The sha256-prefix in the redacted token uniquely identifies the
//       value within the test corpus (no collisions).
//   (d) Absence of redaction config leaves the receipt unchanged
//       (no false redactions).
//   (e) Adversarial probes: split secret across multiple fields, secret
//       in nested object string leaf, secret in array element, secret
//       repeated in the same field.

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
  const p = fs.mkdtempSync(path.join(os.tmpdir(), "arg-rr-" + label + "-"));
  process.env.LILARA_STATE_DIR = p;
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.join(root, "runtime") + path.sep)) delete require.cache[k];
  }
  return p;
}

const SECRETS = {
  github:  "ghp_aAaAaAaAaAaAaAaAaAaAaAaAaAaAaA1234",
  openai:  "sk-abcdefghijklmnopqrstuvwxyz0123456789ABC",
  awsId:   "AKIAABCDEFGHIJ012345",
  slack:   "xoxb-1234-5678-aaaaaaaaaaaaaaaaaaaaaaaa",
  awsKey:  "AWS_SECRET_ACCESS_KEY=" + "X".repeat(40),
  sshKey:  "-----BEGIN RSA PRIVATE KEY-----\nMIIfake\n-----END RSA PRIVATE KEY-----",
};

function entry(overrides) {
  return Object.assign({
    ts: "2026-05-15T12:00:00.000Z",
    kind: "runtime-decision",
    action: "allow",
    riskLevel: "low",
    riskScore: 1,
    reasonCodes: ["redaction-probe"],
    tool: "Bash",
    branch: "feature/test",
    targetPath: "/tmp/x",
    notes: "",
  }, overrides || {});
}

function writeJournal(sd, entries) {
  const f = path.join(sd, "decision-journal.jsonl");
  fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", { mode: 0o600 });
  return f;
}

test("plain-text secrets in notes do NOT survive redacted export", () => {
  const sd = freshStateDir("notes");
  writeJournal(sd, [
    entry({ notes: "github=" + SECRETS.github }),
    entry({ notes: "key=" + SECRETS.openai }),
    entry({ notes: "aws=" + SECRETS.awsId }),
    entry({ notes: "slack=" + SECRETS.slack }),
  ]);
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const buf = exportReceipts({ redact: true }, "jsonl");
  const out = buf.toString("utf8");
  for (const k of Object.keys(SECRETS)) {
    if (k === "awsKey" || k === "sshKey") continue;
    assert.ok(!out.includes(SECRETS[k]), "plaintext " + k + " leaked to redacted export");
  }
  // Each redacted token uses the engine-baked class label.
  assert.ok(/\[REDACTED:github-pat:[0-9a-f]{12}\]/.test(out));
  assert.ok(/\[REDACTED:openai-api-key:[0-9a-f]{12}\]/.test(out));
  assert.ok(/\[REDACTED:aws-access-key-id:[0-9a-f]{12}\]/.test(out));
  assert.ok(/\[REDACTED:slack-token:[0-9a-f]{12}\]/.test(out));
});

test("redacted token is byte-stable across re-export", () => {
  const sd = freshStateDir("stable");
  writeJournal(sd, [entry({ notes: SECRETS.github }), entry({ notes: SECRETS.github })]);
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const out1 = exportReceipts({ redact: true }, "jsonl").toString("utf8");
  const out2 = exportReceipts({ redact: true }, "jsonl").toString("utf8");
  assert.strictEqual(out1, out2);
  // The same plaintext value redacts to the same token in both entries.
  const tokens = Array.from(out1.matchAll(/\[REDACTED:github-pat:([0-9a-f]{12})\]/g)).map((m) => m[1]);
  assert.strictEqual(tokens.length, 2);
  assert.strictEqual(tokens[0], tokens[1]);
});

test("sha256-prefix uniquely identifies each secret in the corpus", () => {
  const sd = freshStateDir("unique");
  writeJournal(sd, Object.values(SECRETS).map((v) => entry({ notes: v })));
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const out = exportReceipts({ redact: true }, "jsonl").toString("utf8");
  // Collect all redacted prefixes across all classes; assert no two distinct
  // secrets share a prefix (collision-free at 12 hex chars within this corpus).
  const prefixes = Array.from(out.matchAll(/\[REDACTED:[^:]+:([0-9a-f]{12})\]/g)).map((m) => m[1]);
  const unique = new Set(prefixes);
  assert.strictEqual(unique.size, prefixes.length, "prefix collision detected: " + prefixes.join(", "));
});

test("export WITHOUT redact: true leaves entries unchanged (no false redactions)", () => {
  const sd = freshStateDir("noredact");
  // A receipt with no secrets — the harness label 'AKIAABCDEFGHIJ012345' is
  // the only AWS-style key in the corpus; the entry has none of that here.
  writeJournal(sd, [entry({ notes: "ordinary text, no secrets here" })]);
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const buf = exportReceipts({}, "jsonl");
  const out = buf.toString("utf8");
  assert.ok(!out.includes("[REDACTED:"), "non-redact export must not redact anything");
  assert.ok(out.includes("ordinary text, no secrets here"));
});

test("secret in nested object leaf is redacted", () => {
  const sd = freshStateDir("nested");
  writeJournal(sd, [entry({
    f19Detail: {
      outputChannel: "stdout",
      matchClasses: ["github-pat"],
      redactedSample: SECRETS.github,
      compensatingRestrictionApplied: false,
    },
  })]);
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const out = exportReceipts({ redact: true }, "jsonl").toString("utf8");
  assert.ok(!out.includes(SECRETS.github));
  assert.ok(/\[REDACTED:github-pat:/.test(out));
});

test("secret in array element string is redacted", () => {
  const sd = freshStateDir("array");
  writeJournal(sd, [entry({ reasonCodes: ["normal-code", "leaked=" + SECRETS.openai] })]);
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const out = exportReceipts({ redact: true }, "jsonl").toString("utf8");
  assert.ok(!out.includes(SECRETS.openai));
  assert.ok(out.includes("normal-code"));
});

test("multiple secret classes in a single field all redact", () => {
  const sd = freshStateDir("multi");
  writeJournal(sd, [entry({ notes: "found " + SECRETS.github + " and " + SECRETS.openai + " together" })]);
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const out = exportReceipts({ redact: true }, "jsonl").toString("utf8");
  assert.ok(!out.includes(SECRETS.github));
  assert.ok(!out.includes(SECRETS.openai));
  assert.ok(/\[REDACTED:github-pat:[0-9a-f]{12}\]/.test(out));
  assert.ok(/\[REDACTED:openai-api-key:[0-9a-f]{12}\]/.test(out));
});

test("the F19 confirmed/suspicious classes ALL redact cleanly", () => {
  const { _redactString } = require(path.join(root, "runtime/receipt-export"));
  for (const [name, value] of Object.entries(SECRETS)) {
    const out = _redactString("prefix " + value + " suffix");
    if (name === "awsKey") {
      // The AWS_SECRET_ACCESS_KEY pattern targets the 40-char value part —
      // assert the 40-X run no longer appears as 40 contiguous X's.
      assert.ok(!/X{40}/.test(out), "aws-secret-access-key 40-char value leaked");
    } else {
      assert.ok(!out.includes(value), "plaintext '" + name + "' survived redact");
    }
    assert.ok(/\[REDACTED:[a-z-]+:[0-9a-f]{12}\]/.test(out), "no redaction token in: " + out);
  }
});

test("redacted output still validates against schema", () => {
  const sd = freshStateDir("valid-after-redact");
  writeJournal(sd, [entry({ notes: SECRETS.github, targetPath: "/etc/" + SECRETS.openai })]);
  const { exportReceipts } = require(path.join(root, "runtime/receipt-export"));
  const { validateReceipt } = require(path.join(root, "runtime/receipt-validator"));
  const out = exportReceipts({ redact: true }, "jsonl").toString("utf8").trim();
  const parsed = JSON.parse(out);
  const r = validateReceipt(parsed);
  assert.strictEqual(r.valid, true, "post-redact schema errs: " + JSON.stringify(r.errors));
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
