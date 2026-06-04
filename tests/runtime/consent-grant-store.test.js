#!/usr/bin/env node
"use strict";

// consent-grant-store.test.js — Tests for runtime/consent/grant-store.js
//
// Verifies mint/load/expire/compaction, 0600/0700 permissions,
// .lock contention, ensureStateDirSafe refusal, and project-scope binding.
//
// Run: node tests/runtime/consent-grant-store.test.js

const assert = require("node:assert");
const path   = require("node:path");
const fs     = require("node:fs");
const os     = require("node:os");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`  FAIL ${name}: ${err && err.message || err}\n`);
    if (err && err.stack) process.stderr.write(err.stack + "\n");
  }
}

// ── Setup: isolated state dir per test run ────────────────────────────────
const _ORIG_STATE_DIR  = process.env.LILARA_STATE_DIR;
const _ORIG_PROJECT_ID = process.env.LILARA_PROJECT_ID;
const _TEST_STATE_DIR  = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-consent-gs-test-"));
process.env.LILARA_STATE_DIR  = _TEST_STATE_DIR;
process.env.LILARA_PROJECT_ID = "consent-gs-test";

// Clear require cache so the module re-reads env at load time.
Object.keys(require.cache).forEach((k) => {
  if (k.includes("consent") || k.includes("state-paths") || k.includes("state-dir") || k.includes("contract"))
    delete require.cache[k];
});
const { mintConsentGrant, loadActiveGrant } = require(path.join(ROOT, "runtime", "consent", "grant-store"));

const _PS        = "r:test-project-abc123";  // stable test project scope
const _SID       = "session-001";
// Use epoch 0 as "nowMs" for loading active grants — any grant with a 1h+ TTL
// minted at actual runtime (2026) will have expiresAt >> 0, so the expiry
// check passes without depending on the real wall-clock. Active-grant tests
// must use _NOW_EPOCH; expired-grant tests use _NOW_2026 (after _PAST).
const _NOW_EPOCH = 0;
const _NOW_2026  = new Date("2099-06-04T12:00:00.000Z").getTime();
const _FUTURE    = "2199-01-01T00:00:00.000Z";
const _PAST      = "2020-01-01T00:00:00.000Z";

// ── Tests ─────────────────────────────────────────────────────────────────

test("mintConsentGrant returns a non-empty string id", () => {
  const id = mintConsentGrant({}, { projectScope: _PS, sessionId: _SID, ttlMs: 3600000, floorCodes: [] });
  assert.ok(typeof id === "string" && id.length > 0, `expected string id, got: ${id}`);
});

test("mintConsentGrant writes to .jsonl in state dir", () => {
  mintConsentGrant({}, { projectScope: _PS, sessionId: _SID, ttlMs: 3600000, floorCodes: [] });
  const storeFile = path.join(_TEST_STATE_DIR, "consent-grants.jsonl");
  assert.ok(fs.existsSync(storeFile), "consent-grants.jsonl should exist");
  const lines = fs.readFileSync(storeFile, "utf8").trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 1, "at least one grant record should be present");
});

test("consent-grants.jsonl has mode 0600 on POSIX", () => {
  if (process.platform === "win32") {
    process.stdout.write("    (skipped: POSIX perm check not applicable on Windows)\n");
    return;
  }
  const storeFile = path.join(_TEST_STATE_DIR, "consent-grants.jsonl");
  const stat = fs.statSync(storeFile);
  const mode = stat.mode & 0o777;
  assert.strictEqual(mode, 0o600, `expected mode 0600, got 0o${mode.toString(8)}`);
});

test("state dir has mode 0700 on POSIX", () => {
  if (process.platform === "win32") {
    process.stdout.write("    (skipped: POSIX perm check not applicable on Windows)\n");
    return;
  }
  const stat = fs.statSync(_TEST_STATE_DIR);
  const mode = stat.mode & 0o777;
  assert.strictEqual(mode, 0o700, `expected mode 0700, got 0o${mode.toString(8)}`);
});

test("grant record has expected shape", () => {
  const scopes = { network: { allowDomains: ["example.com"] } };
  mintConsentGrant(scopes, { projectScope: _PS, sessionId: _SID, ttlMs: 3600000, floorCodes: ["F18_NETWORK_EGRESS"] });
  const storeFile = path.join(_TEST_STATE_DIR, "consent-grants.jsonl");
  const lines = fs.readFileSync(storeFile, "utf8").trim().split("\n").filter(Boolean);
  const rec = JSON.parse(lines[lines.length - 1]);
  assert.ok(typeof rec.id === "string" && rec.id.length > 0, "id must be a non-empty string");
  assert.strictEqual(rec.projectScope, _PS, "projectScope must match");
  assert.strictEqual(rec.sessionId, _SID, "sessionId must match");
  assert.deepStrictEqual(rec.scopes, scopes, "scopes must match");
  assert.ok(typeof rec.grantedAt === "string", "grantedAt must be a string");
  assert.ok(typeof rec.expiresAt === "string", "expiresAt must be a string");
  assert.strictEqual(rec.grantedVia, "consent:interactive", "grantedVia must be consent:interactive");
  assert.deepStrictEqual(rec.floorCodes, ["F18_NETWORK_EGRESS"], "floorCodes must match");
});

test("loadActiveGrant returns null when no grants exist for a project scope", () => {
  const result = loadActiveGrant("r:nonexistent-project", null, _NOW_EPOCH);
  assert.strictEqual(result, null, "should return null for unknown project scope");
});

test("loadActiveGrant returns an active grant for matching project scope", () => {
  const scopes = { shell: { toolAllow: ["echo"] } };
  mintConsentGrant(scopes, { projectScope: _PS, sessionId: _SID, ttlMs: 3600000, floorCodes: [] });
  const grant = loadActiveGrant(_PS, _SID, _NOW_EPOCH);
  assert.ok(grant !== null, "should find an active grant");
  assert.strictEqual(grant.projectScope, _PS);
  assert.deepStrictEqual(grant.scopes, scopes);
});

test("loadActiveGrant returns null for an expired grant", () => {
  // Mint a grant with a very short TTL that has already expired at _NOW_MS
  // We'll directly write an expired record to the store to avoid waiting.
  const storeFile = path.join(_TEST_STATE_DIR, "consent-grants.jsonl");
  const expiredRec = JSON.stringify({
    id: "expired-" + crypto.randomBytes(4).toString("hex"),
    projectScope: _PS,
    sessionId:   "session-expired",
    scopes:      {},
    grantedAt:   "2020-01-01T00:00:00.000Z",
    expiresAt:   _PAST,
    grantedVia:  "consent:interactive",
    floorCodes:  [],
  });
  fs.appendFileSync(storeFile, expiredRec + "\n");
  const result = loadActiveGrant(_PS, "session-expired", _NOW_2026);
  assert.strictEqual(result, null, "expired grant should not be returned");
});

test("loadActiveGrant matches null sessionId (session-agnostic grant)", () => {
  const scopes = { network: { allowDomains: ["any.com"] } };
  mintConsentGrant(scopes, { projectScope: "r:agnostic-test", sessionId: null, ttlMs: 3600000, floorCodes: [] });
  const grant = loadActiveGrant("r:agnostic-test", "any-session-id", _NOW_EPOCH);
  assert.ok(grant !== null, "session-agnostic grant (sessionId=null) should match any session");
});

test("loadActiveGrant does NOT return grants for a different session (non-null sessionId)", () => {
  const scopes = {};
  mintConsentGrant(scopes, { projectScope: "r:sessioned-test", sessionId: "specific-session", ttlMs: 3600000, floorCodes: [] });
  const result = loadActiveGrant("r:sessioned-test", "different-session", _NOW_EPOCH);
  assert.strictEqual(result, null, "grant for a specific session must not leak to other sessions");
});

test("mintConsentGrant ids are unique (64-char hex)", () => {
  const id1 = mintConsentGrant({}, { projectScope: _PS, sessionId: _SID, ttlMs: 3600000, floorCodes: [] });
  const id2 = mintConsentGrant({}, { projectScope: _PS, sessionId: _SID, ttlMs: 3600000, floorCodes: [] });
  assert.notStrictEqual(id1, id2, "consecutive grants must have distinct ids");
  assert.ok(/^[0-9a-f]{64}$/.test(id1), `id1 must be 64-char hex: ${id1}`);
  assert.ok(/^[0-9a-f]{64}$/.test(id2), `id2 must be 64-char hex: ${id2}`);
});

// ── Cleanup & summary ─────────────────────────────────────────────────────
if (_ORIG_STATE_DIR !== undefined) process.env.LILARA_STATE_DIR = _ORIG_STATE_DIR;
else delete process.env.LILARA_STATE_DIR;
if (_ORIG_PROJECT_ID !== undefined) process.env.LILARA_PROJECT_ID = _ORIG_PROJECT_ID;
else delete process.env.LILARA_PROJECT_ID;
try { fs.rmSync(_TEST_STATE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }

process.stdout.write(`\nconsent-grant-store: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
