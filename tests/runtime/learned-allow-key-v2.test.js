#!/usr/bin/env node
"use strict";

// learned-allow-key-v2.test.js — ADR-027: versioned v2| learned-allow key prefix.
//
// Tests prove the four security / compatibility properties:
//
//   1. Backward compat — a pre-v2 (legacy, unprefixed) learnedAllow entry
//      still matches its corresponding ASCII input after the migration.
//
//   2. New approval shape — setLearnedAllow() now records the key under the
//      v2| prefix using dual-path classification (fineKeyDual).
//
//   3. Bypass closed — seeding a legacy generic grant does NOT auto-allow a
//      Cyrillic рm (which classifyCommandDual returns as destructive-delete).
//
//   4. Anti-FP — a legit ASCII rm -rf dist learned-allow still matches its own
//      ASCII input (dual==raw for non-confusable ASCII, so no regressions).
//
// Run: node tests/runtime/learned-allow-key-v2.test.js

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");

let passed = 0;
let failed = 0;
function ok(name)      { console.log(`  ok  ${name}`); passed++; }
function fail(name, m) { console.error(`  FAIL ${name} — ${m}`); failed++; }

// ---------------------------------------------------------------------------
// Isolated test runner — fresh LILARA_STATE_DIR + pinned project scope per test
// so keys are deterministic and tests don't bleed state.
// ---------------------------------------------------------------------------
function withIsolation(fn) {
  const dir     = fs.mkdtempSync(path.join(os.tmpdir(), "adr027-test-"));
  const prevDir = process.env.LILARA_STATE_DIR;
  const prevPid = process.env.LILARA_PROJECT_ID;
  process.env.LILARA_STATE_DIR  = dir;
  process.env.LILARA_PROJECT_ID = "adr027-test-project";  // deterministic scope
  // Bust require.cache for stateful modules so each test starts fresh.
  for (const k of Object.keys(require.cache)) {
    if (/runtime[/\\](policy-store|project-scope|decision-key|state-paths)\.js/.test(k)) {
      delete require.cache[k];
    }
  }
  try {
    fn(dir);
  } finally {
    if (prevDir === undefined) delete process.env.LILARA_STATE_DIR;
    else process.env.LILARA_STATE_DIR = prevDir;
    if (prevPid === undefined) delete process.env.LILARA_PROJECT_ID;
    else process.env.LILARA_PROJECT_ID = prevPid;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// Helpers loaded inside each test via require after cache bust.
function loadModules() {
  const ps = require(path.join(root, "runtime", "policy-store.js"));
  const dk = require(path.join(root, "runtime", "decision-key.js"));
  return { ps, dk };
}

// ---------------------------------------------------------------------------
// Test 1 — Backward compat: legacy (pre-v2) entry still matches ASCII input
// ---------------------------------------------------------------------------
// Seeds a learnedAllow entry directly in the JSON using the OLD unprefixed
// key format (scope::body, no v2| prefix), then checks isLearnedAllowed.
withIsolation((dir) => {
  const { ps, dk } = loadModules();
  const { projectScope } = require(path.join(root, "runtime", "project-scope.js"));

  const input = {
    tool: "Bash", command: "rm -rf dist/old",
    targetPath: path.join(dir, "dist", "old"),
    projectRoot: dir,
    branch: "feature/build-cleanup",
    payloadClass: "A",
  };

  // Derive the live scope tag (LILARA_PROJECT_ID → "x:<hash>")
  const scope      = projectScope(input);
  // Construct the legacy key the way the old code would have: scope::fineKey (raw)
  const legacyBody = dk.fineKey(input);
  const legacyFullKey = scope + "::" + legacyBody;

  // Write it directly to learned-policy.json, bypassing policy-store writes
  const policyPath = path.join(dir, "learned-policy.json");
  const policy = { learnedAllows: {}, approvalCounts: {}, suggestions: {}, autoAllowOnce: {} };
  policy.learnedAllows[legacyFullKey] = true;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + "\n", "utf8");

  const result = ps.isLearnedAllowed(input);
  result === true
    ? ok("ADR-027 (backward compat): legacy unprefixed ASCII rm -rf grant still matches")
    : fail("ADR-027 (backward compat): legacy grant should still match", `isLearnedAllowed=${result} legacyKey=${legacyFullKey}`);
});

// ---------------------------------------------------------------------------
// Test 2 — New approval shape: setLearnedAllow records a v2| prefixed key
// ---------------------------------------------------------------------------
withIsolation((dir) => {
  const { ps } = loadModules();
  const policyPath = path.join(dir, "learned-policy.json");

  const input = {
    tool: "Bash", command: "rm -rf dist/old",
    targetPath: path.join(dir, "dist", "old"),
    projectRoot: dir,
    branch: "feature/build-cleanup",
    payloadClass: "A",
  };

  ps.setLearnedAllow(input, true);

  const raw = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  const keys = Object.keys(raw.learnedAllows || {});

  // Must have exactly one key; it must contain "::v2|"
  const hasV2Key = keys.some(k => k.includes("::v2|"));
  hasV2Key
    ? ok("ADR-027 (new approval): setLearnedAllow records key with ::v2| prefix")
    : fail("ADR-027 (new approval): expected key with ::v2| prefix", `keys=${JSON.stringify(keys)}`);

  // The key body after "v2|" must use the dual-path class (destructive-delete)
  const v2Key = keys.find(k => k.includes("::v2|")) || "";
  const body  = v2Key.replace(/.*::v2\|/, "");
  const parts = body.split("|");
  // parts[1] is commandClass
  parts[1] === "destructive-delete"
    ? ok("ADR-027 (new approval): v2 key body commandClass=destructive-delete (dual-path)")
    : fail("ADR-027 (new approval): expected commandClass=destructive-delete in v2 key body", `parts=${JSON.stringify(parts)}`);
});

// ---------------------------------------------------------------------------
// Test 3 — Bypass closed: legacy generic grant does NOT match Cyrillic рm
// ---------------------------------------------------------------------------
// Seeds a legacy generic learned-allow (the shape that would have been written
// before ADR-027), then verifies that a Cyrillic рm lookup does NOT match.
// The dual-path fallback classifies рm as destructive-delete, so the body
// differs from the stored generic body → no match.
withIsolation((dir) => {
  const { ps, dk } = loadModules();
  const { projectScope } = require(path.join(root, "runtime", "project-scope.js"));

  // Generic input (e.g. ls -la or anything that would produce commandClass=generic)
  const asciiGenericInput = {
    tool: "Bash", command: "ls -la",
    targetPath: path.join(dir, "src"),
    projectRoot: dir,
    branch: "feature/test",
    payloadClass: "A",
  };

  const scope      = projectScope(asciiGenericInput);   // live scope tag
  const legacyBody = dk.fineKey(asciiGenericInput);     // raw → "generic"
  const legacyFullKey = scope + "::" + legacyBody;

  const policyPath = path.join(dir, "learned-policy.json");
  const policy = { learnedAllows: {}, approvalCounts: {}, suggestions: {}, autoAllowOnce: {} };
  policy.learnedAllows[legacyFullKey] = true;
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + "\n", "utf8");

  // Cyrillic рm with the same structural shape (same path/branch/payload)
  const cyrillicInput = {
    tool: "Bash", command: "рm -rf /",  // Cyrillic U+0440 'р'
    targetPath: path.join(dir, "src"),
    projectRoot: dir,
    branch: "feature/test",
    payloadClass: "A",
  };

  const result = ps.isLearnedAllowed(cyrillicInput);
  result === false
    ? ok("ADR-027 (bypass closed): Cyrillic рm does NOT match a legacy generic grant")
    : fail("ADR-027 (bypass closed): Cyrillic рm must NOT inherit generic allow", `isLearnedAllowed=${result}`);
});

// ---------------------------------------------------------------------------
// Test 4 — Anti-FP: a legit ASCII rm -rf dist learned-allow still matches
// ---------------------------------------------------------------------------
// Verifies that an ASCII destructive command still gets its own learned-allow
// match — dual==raw for non-confusable ASCII, so recording and lookup are
// symmetric.
withIsolation((dir) => {
  const { ps } = loadModules();

  const input = {
    tool: "Bash", command: "rm -rf dist",
    targetPath: path.join(dir, "dist"),
    projectRoot: dir,
    branch: "feature/build-cleanup",
    payloadClass: "A",
  };

  // Record 3 approvals to mint a suggestion, accept it, then set the allow.
  ps.recordApproval(input);
  ps.recordApproval(input);
  ps.recordApproval(input);
  const suggestions = ps.listSuggestions();
  if (suggestions.length > 0) ps.acceptSuggestion(suggestions[0].key);
  ps.setLearnedAllow(input, true);

  const result = ps.isLearnedAllowed(input);
  result === true
    ? ok("ADR-027 (anti-FP): ASCII rm -rf dist v2 learned-allow still matches itself")
    : fail("ADR-027 (anti-FP): ASCII rm -rf dist must still match", `isLearnedAllowed=${result}`);
});

// ---------------------------------------------------------------------------
// Test 5 — Consistency: recordApproval accumulates under v2 key
// ---------------------------------------------------------------------------
withIsolation((dir) => {
  const { ps } = loadModules();
  const policyPath = path.join(dir, "learned-policy.json");

  const input = {
    tool: "Bash", command: "git push --force",
    targetPath: path.join(dir, "src"),
    projectRoot: dir,
    branch: "feature/push-test",
    payloadClass: "A",
  };

  ps.recordApproval(input);
  ps.recordApproval(input);

  const raw   = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  const count = ps.getApprovalCount(input);
  count === 2
    ? ok("ADR-027 (approval count): getApprovalCount returns 2 after 2 recordApprovals")
    : fail("ADR-027 (approval count): expected 2 approvals", `got ${count}`);

  // The stored key must have the v2| prefix
  const countKeys = Object.keys(raw.approvalCounts || {});
  const v2KeyPresent = countKeys.some(k => k.includes("::v2|"));
  v2KeyPresent
    ? ok("ADR-027 (approval count): approvalCounts stored under v2| key")
    : fail("ADR-027 (approval count): approvalCounts key missing ::v2|", `keys=${JSON.stringify(countKeys)}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nlearned-allow-key-v2.test.js: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
