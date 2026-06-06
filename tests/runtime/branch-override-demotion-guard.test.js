#!/usr/bin/env node
"use strict";

// branch-override-demotion-guard.test.js — ADR-042 regression tests.
//
// Guards the two security-grant paths in decide() against env-supplied branches:
//
//   (a) contextTrust posture override — env-override branch matching a
//       contextTrust "branchPattern" must NOT relax the trust posture, which
//       would disable the F7 strict-posture floor (strict→relaxed).
//       Observable: guard ON → F7 fires → "require-review";
//                   guard OFF → contextTrust relaxes → F7 doesn't fire → "allow".
//
//   (b) forcePushAllow scope demotion — env-override branch matching a
//       forcePushAllow glob must NOT grant contractAllow for force-push scopes.
//       Tested at contract.scopeMatch() level (the guard passes null branch when
//       branchSource='env-override'), proving the isolation mechanism works.
//
//   (c) discover() branchSource provenance tracking — the source is correctly
//       reported for all four types: input, env-override, git, none.
//
//   (d) Invariant: explicit input.branch STILL demotes — guard is source-targeted.
//
//   (e) LILARA_BRANCH_DEMOTE_GUARD=0 restores legacy (spoofable) behavior.

const assert = require("assert");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

const root = path.join(__dirname, "..", "..");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); }
  catch (err) { failed++; process.stderr.write(`  FAIL ${name}: ${err && err.stack || err}\n`); }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function bustRuntimeCache() {
  const rdir = path.join(root, "runtime") + path.sep;
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(rdir)) delete require.cache[k];
  }
}

// Create an isolated env + fresh require-cache for engine-level tests.
// Returns { stateDir, projectDir, decide, restore }.
function freshContractEnv(label, envOverrides) {
  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), `arg-bodg-st-${label}-`));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `arg-bodg-pr-${label}-`));

  const saved = {};
  const KEYS = [
    "LILARA_STATE_DIR", "LILARA_CONTRACT_ENABLED", "LILARA_CONTRACT_REQUIRED",
    "LILARA_RATE_LIMIT", "LILARA_TRAJECTORY_WINDOW_MIN", "LILARA_KILL_SWITCH",
    "LILARA_BRANCH_OVERRIDE", "LILARA_BRANCH_DEMOTE_GUARD", "LILARA_TAINT_EGRESS",
    "LILARA_DELETE_COORD", "LILARA_DRY_RUN",
  ];
  for (const k of KEYS) saved[k] = process.env[k];

  process.env.LILARA_STATE_DIR             = stateDir;
  process.env.LILARA_CONTRACT_ENABLED      = "1";
  process.env.LILARA_CONTRACT_REQUIRED     = "0";
  process.env.LILARA_RATE_LIMIT            = "0";
  process.env.LILARA_TRAJECTORY_WINDOW_MIN = "0";
  process.env.LILARA_TAINT_EGRESS          = "0";
  process.env.LILARA_DELETE_COORD          = "0";
  process.env.LILARA_DRY_RUN               = "0";
  delete process.env.LILARA_KILL_SWITCH;
  delete process.env.LILARA_BRANCH_OVERRIDE;
  delete process.env.LILARA_BRANCH_DEMOTE_GUARD;

  for (const [k, v] of Object.entries(envOverrides || {})) {
    if (v === null || v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  bustRuntimeCache();
  const { decide } = require(path.join(root, "runtime/decision-engine"));

  function restore() {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    bustRuntimeCache();
  }

  return { stateDir, projectDir, decide, restore };
}

// Write a minimal valid lilara.contract.json.
// contractHash is schema-valid but fake — verify() is not called (LILARA_CONTRACT_REQUIRED=0).
function writeTestContract(projectDir, extras) {
  const base = {
    version:       3,
    contractId:    "lilara-20260101-abcdef012345",
    revision:      1,
    acceptedAt:    "2026-01-01T00:00:00.000Z",
    harnessScope:  ["claude"],
    trustPosture:  "balanced",
    scopes:        {},
    contractHash:  "sha256:" + "0".repeat(64),
  };
  const contract = Object.assign({}, base, extras || {});
  fs.writeFileSync(
    path.join(projectDir, "lilara.contract.json"),
    JSON.stringify(contract)
  );
  return contract;
}

// ── (c) discover() branchSource tracking (pure, no engine, no contract) ──────

test("branchSource='input' when input.branch is set", () => {
  bustRuntimeCache();
  const saved = process.env.LILARA_BRANCH_OVERRIDE;
  delete process.env.LILARA_BRANCH_OVERRIDE;
  const { discover } = require(path.join(root, "runtime/context-discovery"));
  const res = discover({ branch: "feature/explicit", targetPath: os.tmpdir() });
  assert.strictEqual(res.branch,       "feature/explicit", "branch value");
  assert.strictEqual(res.branchSource, "input",            "branchSource");
  if (saved !== undefined) process.env.LILARA_BRANCH_OVERRIDE = saved;
  bustRuntimeCache();
});

test("branchSource='env-override' when LILARA_BRANCH_OVERRIDE set and no input.branch", () => {
  bustRuntimeCache();
  const saved = process.env.LILARA_BRANCH_OVERRIDE;
  process.env.LILARA_BRANCH_OVERRIDE = "env-branch";
  const { discover } = require(path.join(root, "runtime/context-discovery"));
  const res = discover({ targetPath: os.tmpdir() });
  assert.strictEqual(res.branch,       "env-branch",   "branch value");
  assert.strictEqual(res.branchSource, "env-override", "branchSource");
  if (saved !== undefined) process.env.LILARA_BRANCH_OVERRIDE = saved;
  else delete process.env.LILARA_BRANCH_OVERRIDE;
  bustRuntimeCache();
});

test("branchSource='git' or 'none' in a git repo with no override and no input", () => {
  bustRuntimeCache();
  const saved = process.env.LILARA_BRANCH_OVERRIDE;
  delete process.env.LILARA_BRANCH_OVERRIDE;
  const { discover } = require(path.join(root, "runtime/context-discovery"));
  const res = discover({ targetPath: root });  // Lilara repo = a real git repo
  assert.ok(
    res.branchSource === "git" || res.branchSource === "none",
    `Expected 'git' or 'none' in repo dir, got '${res.branchSource}'`
  );
  if (saved !== undefined) process.env.LILARA_BRANCH_OVERRIDE = saved;
  bustRuntimeCache();
});

test("branchSource='none' in a non-git dir with no override and no input", () => {
  bustRuntimeCache();
  const saved = process.env.LILARA_BRANCH_OVERRIDE;
  delete process.env.LILARA_BRANCH_OVERRIDE;
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "arg-bodg-ng-"));
  const { discover } = require(path.join(root, "runtime/context-discovery"));
  const res = discover({ targetPath: isolated, projectRoot: isolated });
  // A temp dir outside any git repo → safeGit returns "" → branchSource = 'none'
  assert.ok(
    res.branchSource === "none" || res.branchSource === "git",
    `Expected 'none' (or possibly 'git' if under a git workdir), got '${res.branchSource}'`
  );
  if (saved !== undefined) process.env.LILARA_BRANCH_OVERRIDE = saved;
  bustRuntimeCache();
});

// ── (b) scopeMatch null-branch mechanism (guards the forcePushAllow path) ────
// The engine passes `branch: _branchFromEnv ? null : enriched.branch` to
// _contractScopeMatch when the guard is active. This validates that contract.scopeMatch
// correctly rejects force-push when branch is null, and allows it when it's explicit.
// Together with test (a) which proves the guard activates, this covers ADR-042 §b.

test("scopeMatch with null branch does NOT match forcePushAllow — guard mechanism", () => {
  bustRuntimeCache();
  const { scopeMatch } = require(path.join(root, "runtime/contract"));
  const contract = {
    version: 3, contractId: "lilara-20260101-abcdef012345", revision: 1,
    acceptedAt: "2026-01-01T00:00:00.000Z", harnessScope: ["claude"],
    trustPosture: "balanced",
    scopes: { branches: { forcePushAllow: ["feature/*"] } },
    contractHash: "sha256:" + "0".repeat(64),
  };
  // Guard passes null branch when branchSource='env-override'.
  const result = scopeMatch(contract, {
    command: "git push --force origin main",
    commandClass: "force-push",
    branch: null,           // what the guard injects
    payloadClass: "A",
  });
  assert.strictEqual(result.allowed, false,
    "null branch must not match forcePushAllow — guard correctly isolates env branch");
  bustRuntimeCache();
});

test("scopeMatch with explicit feature branch matches forcePushAllow — guard does not over-block", () => {
  bustRuntimeCache();
  const { scopeMatch } = require(path.join(root, "runtime/contract"));
  const contract = {
    version: 3, contractId: "lilara-20260101-abcdef012345", revision: 1,
    acceptedAt: "2026-01-01T00:00:00.000Z", harnessScope: ["claude"],
    trustPosture: "balanced",
    scopes: { branches: { forcePushAllow: ["feature/*"] } },
    contractHash: "sha256:" + "0".repeat(64),
  };
  // Explicit input.branch bypasses guard → real branch string passed to scopeMatch.
  const result = scopeMatch(contract, {
    command: "git push --force origin main",
    commandClass: "force-push",
    branch: "feature/dev",  // explicit branch (branchSource='input')
    payloadClass: "A",
  });
  assert.strictEqual(result.allowed, true,
    "explicit feature branch should match forcePushAllow");
  bustRuntimeCache();
});

// ── (a) contextTrust posture blocked for env-override branch ─────────────────
// The unknown-intent command (cmdClass='generic', intent='unknown') triggers
// F7 (intent-unknown-strict) only in strict posture. Contract has contextTrust
// that relaxes feature/* to 'relaxed', disabling F7.
// Guard ON → contextTrust skipped → strict maintained → F7 → "require-review".
// Guard OFF → contextTrust applied → relaxed → F7 skips → "allow".
// Input has trustPosture:'strict' so we don't depend on project config defaults.

test("(guard ON) env-override branch does NOT relax contextTrust — F7 fires, action=require-review", () => {
  const { projectDir, decide, restore } = freshContractEnv("ct-on", {
    LILARA_BRANCH_OVERRIDE: "feature/dev",
  });
  try {
    writeTestContract(projectDir, {
      contextTrust: [{ branchPattern: "feature/*", trustPosture: "relaxed" }],
    });
    // unknown-intent + strict = F7; relaxed = no F7
    const result = decide({
      tool: "Bash", command: "custom-tool --run", harness: "claude",
      targetPath: projectDir, projectRoot: projectDir,
      trustPosture: "strict",  // explicit strict so the test is posture-deterministic
    });
    assert.strictEqual(result.action, "require-review",
      `Guard ON: expected F7 to fire (require-review) since contextTrust is blocked. Got '${result.action}'`);
    assert.strictEqual(result.floorFired, "intent-unknown-strict",
      `Guard ON: expected F7 floor fired, got '${result.floorFired}'`);
  } finally { restore(); }
});

// ── (d) Explicit input.branch STILL demotes via contextTrust ─────────────────

test("(explicit branch) input.branch='feature/dev' relaxes contextTrust — F7 skips, action=allow", () => {
  const { projectDir, decide, restore } = freshContractEnv("ct-explicit", {
    LILARA_BRANCH_OVERRIDE: "feature/dev",  // env override present but input.branch wins
  });
  try {
    writeTestContract(projectDir, {
      contextTrust: [{ branchPattern: "feature/*", trustPosture: "relaxed" }],
    });
    // branchSource='input' → guard does not apply → contextTrust relaxes to 'relaxed' → F7 off
    const result = decide({
      tool: "Bash", command: "custom-tool --run", harness: "claude",
      targetPath: projectDir, projectRoot: projectDir,
      trustPosture: "strict",
      branch: "feature/dev",   // explicit: branchSource='input'
    });
    assert.notStrictEqual(result.action, "require-review",
      `Explicit branch: contextTrust should relax, F7 should NOT fire. Got '${result.action}'`);
    assert.strictEqual(result.action, "allow",
      `Explicit branch: expected 'allow' (contextTrust relaxed, non-gated command). Got '${result.action}'`);
  } finally { restore(); }
});

// ── (e) LILARA_BRANCH_DEMOTE_GUARD=0 restores legacy spoofable behavior ──────

test("(guard OFF via LILARA_BRANCH_DEMOTE_GUARD=0) env-override relaxes contextTrust", () => {
  const { projectDir, decide, restore } = freshContractEnv("ct-off", {
    LILARA_BRANCH_OVERRIDE:     "feature/dev",
    LILARA_BRANCH_DEMOTE_GUARD: "0",
  });
  try {
    writeTestContract(projectDir, {
      contextTrust: [{ branchPattern: "feature/*", trustPosture: "relaxed" }],
    });
    const result = decide({
      tool: "Bash", command: "custom-tool --run", harness: "claude",
      targetPath: projectDir, projectRoot: projectDir,
      trustPosture: "strict",
    });
    // Guard=0 → contextTrust applied → relaxed → F7 does NOT fire → "allow"
    assert.notStrictEqual(result.action, "require-review",
      `Guard=0: contextTrust should relax, F7 should not fire. Got '${result.action}'`);
  } finally { restore(); }
});

// ── Summary ────────────────────────────────────────────────────────────────────
process.stdout.write(`\nPASSED: ${passed} / ${passed + failed} tests\n`);
process.exit(failed ? 1 : 0);
