#!/usr/bin/env node
"use strict";

// notify-scrub.test.js — ADR-015 PII scrubber tests. Verifies that:
//   - tool args, IR outputs, file contents, env values, and $HOME-relative
//     paths never survive scrubForNotify();
//   - only the documented allowlist keys appear in scrubbed output;
//   - scrubbed payloads are byte-stable across re-scrub (idempotent).
//
// Run:  node tests/runtime/notify-scrub.test.js

const assert = require("node:assert");
const path   = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
process.env.HORUS_DECISION_JOURNAL = "0";
const { scrubForNotify, KEEP_KEYS, loadNotifyConfig } = require(path.join(ROOT, "runtime", "notify"));
const { canonicalJson } = require(path.join(ROOT, "runtime", "canonical-json"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  ok  ${name}\n`); }
  catch (err) {
    failed += 1;
    process.stderr.write(`  FAIL ${name}: ${err && err.message || err}\n`);
    if (err && err.stack) process.stderr.write(err.stack + "\n");
  }
}

// ── adversarial corpus ──────────────────────────────────────────────────────
// Each entry is assembled at runtime from inert fragments so source-side
// secret scanners (gitleaks, GitHub push-protection, trufflehog) don't flag
// the test file itself. The reconstructed strings DO match the F19 / dynamic
// patterns the runtime tests against — exactly the point.
const SECRETS = [
  "sk" + "-" + "a".repeat(28),                                       // openai-style
  "ghp" + "_" + "A".repeat(28),                                      // github pat shape
  "AKIA" + "0123456789ABCDEF",                                       // aws access key id shape
  "xo" + "xb" + "-" + "1234567890" + "-" + "AAAABBBBCCCCDDDDEEEEFFFF", // slack token shape
  "-----BEGIN OPENSSH " + "PRIVATE KEY-----abcdef-----END OPENSSH " + "PRIVATE KEY-----",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + "payload.signature",     // jwt-ish
  "Authorization: " + "Bearer top-secret-token-9999",                // bearer
];

const ADVERSARIAL_RECEIPT = {
  // ── allow-listed keys (these MUST appear) ───────────────────────────────
  action: "require-review",
  riskLevel: "high",
  reasonCodes: ["protected-branch", "F8"],
  floorFired: "protected-branch",
  decisionKey: "Bash|sudo|default-target|A",
  contractRevision: 7,
  timestamp: "2026-05-15T12:00:00.000Z",
  ambientClass: null,
  snapshot: { snapshotId: "20260515T120000Z-abc123def456", fileCount: 12 },
  // ── deny-listed fields (these MUST NOT survive) ─────────────────────────
  args: ["--token", SECRETS[0], "--key", SECRETS[1]],
  outputs: [{ channel: "stdout", content: SECRETS[3] + " " + SECRETS[2] }],
  cwd: "/home/khouly/.ssh/id_rsa",
  env: { AWS_SECRET_ACCESS_KEY: SECRETS[2], OPENAI_API_KEY: SECRETS[0] },
  ir: { outputs: [{ channel: "file", content: "from email: alice@example.com" }] },
  targetPath: "/home/khouly/.ssh/known_hosts",
  notes: "User pasted " + SECRETS[5] + " into the prompt",
  fileContent: "password = " + SECRETS[6],
  explanation: "free-text containing " + SECRETS[4],
  authorization: SECRETS[6],
  secretField: SECRETS[0],
};

test("allowlist: scrubbed output contains only KEEP_KEYS (+ snapshotId)", () => {
  const scrubbed = scrubForNotify(ADVERSARIAL_RECEIPT);
  const allowed = new Set([...KEEP_KEYS, "snapshotId"]);
  for (const k of Object.keys(scrubbed)) {
    assert.ok(allowed.has(k), `scrubbed payload leaked key "${k}" not in allowlist`);
  }
});

test("zero plaintext secret survives scrubForNotify (full adversarial corpus)", () => {
  const scrubbed = scrubForNotify(ADVERSARIAL_RECEIPT);
  const serialized = canonicalJson(scrubbed);
  for (const s of SECRETS) {
    assert.ok(!serialized.includes(s), `secret leaked into scrubbed payload: ${s.slice(0, 16)}…`);
  }
});

test("no outputs / args / file contents / cwd in scrubbed output", () => {
  const scrubbed = scrubForNotify(ADVERSARIAL_RECEIPT);
  const serialized = canonicalJson(scrubbed);
  assert.ok(!("outputs" in scrubbed), "outputs[] leaked");
  assert.ok(!("args" in scrubbed), "args[] leaked");
  assert.ok(!("fileContent" in scrubbed), "fileContent leaked");
  assert.ok(!("cwd" in scrubbed), "cwd leaked");
  assert.ok(!("env" in scrubbed), "env leaked");
  assert.ok(!("ir" in scrubbed), "ir leaked");
  assert.ok(!("targetPath" in scrubbed), "targetPath leaked");
  assert.ok(!("notes" in scrubbed), "notes leaked");
  assert.ok(!("authorization" in scrubbed), "authorization leaked");
  assert.ok(!serialized.includes("/home/"), "$HOME-relative path leaked");
  assert.ok(!serialized.includes("@example.com"), "email address leaked");
});

test("byte-stable / idempotent across re-scrub", () => {
  const a = canonicalJson(scrubForNotify(ADVERSARIAL_RECEIPT));
  const b = canonicalJson(scrubForNotify(ADVERSARIAL_RECEIPT));
  assert.strictEqual(a, b, "scrub output drifted between calls");
  const reScrub = canonicalJson(scrubForNotify(JSON.parse(a)));
  assert.strictEqual(reScrub, a, "re-scrub of an already-scrubbed receipt is not idempotent");
});

test("snapshotId is the only key promoted from receipt.snapshot", () => {
  const scrubbed = scrubForNotify(ADVERSARIAL_RECEIPT);
  assert.strictEqual(scrubbed.snapshotId, "20260515T120000Z-abc123def456");
  assert.ok(!("snapshot" in scrubbed), "full snapshot object leaked");
  assert.ok(!("fileCount" in scrubbed), "snapshot.fileCount leaked");
});

test("malformed input: returns {} when receipt is null / undefined / non-object", () => {
  assert.deepStrictEqual(scrubForNotify(null), {});
  assert.deepStrictEqual(scrubForNotify(undefined), {});
  assert.deepStrictEqual(scrubForNotify("hello"), {});
  assert.deepStrictEqual(scrubForNotify(42), {});
});

test("loadNotifyConfig: default is {enabled:false} when contract absent or notifications missing", () => {
  assert.deepStrictEqual(loadNotifyConfig(null), { enabled: false, channels: [], severityFloor: "info" });
  assert.deepStrictEqual(loadNotifyConfig({}), { enabled: false, channels: [], severityFloor: "info" });
  assert.deepStrictEqual(loadNotifyConfig({ notifications: { enabled: false } }),
    { enabled: false, channels: [], severityFloor: "info" });
});

test("loadNotifyConfig: explicit enabled=true returns channels + severityFloor", () => {
  const contract = { notifications: {
    enabled: true,
    severityFloor: "warning",
    channels: [
      { type: "discord", webhookUrl: "https://discord.com/api/webhooks/x/y", events: ["kill-switch-fire"] },
      { type: "bogus",   events: ["*"] }, // must be filtered out
    ],
  } };
  const cfg = loadNotifyConfig(contract);
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.severityFloor, "warning");
  assert.strictEqual(cfg.channels.length, 1);
  assert.strictEqual(cfg.channels[0].type, "discord");
});

test("string truncation: scrubbed string values are clipped to 256 chars", () => {
  const big = "x".repeat(1024);
  const scrubbed = scrubForNotify({ action: big, riskLevel: "low" });
  assert.ok(scrubbed.action.length <= 256, `action not clipped: length=${scrubbed.action.length}`);
});

process.stdout.write(`\nnotify-scrub: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
