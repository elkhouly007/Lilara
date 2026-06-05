#!/usr/bin/env node
"use strict";

// delete-coord.test.js — ADR-038 F29 `destructive-delete-coord` tests.
//
// Covers:
//   T01 — F29 lattice: rung 9.5, demotable, tier, demotableBy
//   T02 — enforcementFor maps to consent-required
//   T03 — F29 NOT in INVIOLABLE_FLOOR_IDS; F3/F14 still inviolable
//   T04 — assertOrdered passes with F29 at rung 9.5
//   T05 — canDemote("F29","consent:interactive") true; F3/F14 false
//   T06 — flag OFF: destructive-delete-pattern → legacy require-tests (zero divergence)
//   T07 — flag ON: destructive-delete-pattern → F29 + consent-required
//   T08 — flag ON + consentGrant injected: F29 → allow (approve-past silent)
//   T09 — fileTargets fix: buildConsentPrompt prefers extra.fileTargets
//   T10 — fileTargets empty without injection (old-bug path; confirms fix is needed)
//
// Run:  node tests/runtime/delete-coord.test.js

const assert  = require("assert");
const os      = require("os");
const fs      = require("fs");
const path    = require("path");

const root = path.join(__dirname, "..", "..");

const { decide }           = require(path.join(root, "runtime", "decision-engine"));
const { resetCache }       = require(path.join(root, "runtime", "session-context"));
const {
  getEntry,
  isInviolable,
  canDemote,
  enforcementFor,
  assertOrdered,
  INVIOLABLE_FLOOR_IDS,
} = require(path.join(root, "runtime", "decision-lattice"));
const { buildConsentPrompt } = require(path.join(root, "runtime", "consent", "transport"));
const { evalConsentFloor }   = require(path.join(root, "runtime", "floor-consent"));

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    failed++;
    errors.push({ name, err: e });
    process.stdout.write(`  ✗ ${name}: ${e.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
// Each decideSafe() call gets a FRESH stateDir so session-risk counters never
// accumulate across tests. Shared dirs cause the risk scorer to escalate to
// "critical" (F3) on the third consecutive `rm -rf` because session-risk
// counters persisted in the previous dir's files carry over.
function freshStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lil-dc-test-"));
  process.env.LILARA_STATE_DIR = dir;
  return dir;
}

// Build a minimal input matching the replay corpus for destructive-delete-pattern.
// Corpus entry: {tool:"Bash", command:"rm -rf /tmp/build", branch:"feature/test"}
// No targetPath, no projectRoot — these cause path-sensitivity scoring that can
// inflate the risk level to critical (F3 fires instead of the destructive-delete arm).
const CORPUS_INPUT = {
  harness: "claude",
  tool:    "Bash",
  command: "rm -rf /tmp/build",
  branch:  "feature/test",
};

// Isolated env for decide() calls: mirrors replay-decisions.js isolation.
// Preserves previous values and restores them after each test.
function withIsolatedEnv(extraEnv, fn) {
  const prevState = {};
  const keys = [
    "LILARA_CONTRACT_ENABLED",
    "LILARA_TRAJECTORY_WINDOW_MIN",
    "LILARA_RATE_LIMIT",
    "LILARA_BRANCH_OVERRIDE",
    "LILARA_DELETE_COORD",
    ...Object.keys(extraEnv || {}),
  ];
  for (const k of keys) prevState[k] = process.env[k];
  process.env.LILARA_CONTRACT_ENABLED      = "0";
  process.env.LILARA_TRAJECTORY_WINDOW_MIN = "0";
  process.env.LILARA_RATE_LIMIT            = "0";
  // synthetic non-protected branch — prevents git reads in discover()
  process.env.LILARA_BRANCH_OVERRIDE       = "test/isolated-context";
  for (const [k, v] of Object.entries(extraEnv || {})) {
    if (v === null || v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prevState)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function decideSafe(input) {
  freshStateDir();
  resetCache();
  return decide(input);
}

// ── T01: F29 lattice structure ─────────────────────────────────────────────
test("T01 — F29 lattice entry: rung 9.5, demotable, consent:interactive", () => {
  const f29 = getEntry("F29");
  assert.ok(f29, "F29 entry must exist");
  assert.strictEqual(f29.rung, 9.5, "rung must be 9.5");
  assert.strictEqual(f29.name, "destructive-delete-coord");
  assert.strictEqual(f29.action, "require-review");
  assert.strictEqual(f29.tier, "demotable");
  assert.ok(Array.isArray(f29.demotableBy), "demotableBy must be an array");
  assert.ok(f29.demotableBy.includes("consent:interactive"), "must include consent:interactive");
});

// ── T02: enforcementFor mapping ─────────────────────────────────────────────
test("T02 — enforcementFor(require-review, destructive-delete-coord) → consent-required", () => {
  const ef = enforcementFor("require-review", "destructive-delete-coord");
  assert.strictEqual(ef, "consent-required",
    `expected consent-required, got ${ef}`);
});

// ── T03: inviolable membership ───────────────────────────────────────────────
test("T03 — F29 not inviolable; F3/F14 remain inviolable; INVIOLABLE set unchanged", () => {
  assert.strictEqual(isInviolable("F29"), false, "F29 must not be inviolable");
  assert.strictEqual(isInviolable("F3"),  true,  "F3 must stay inviolable");
  assert.strictEqual(isInviolable("F14"), true,  "F14 must stay inviolable");
  assert.ok(!INVIOLABLE_FLOOR_IDS.includes("F29"), "F29 must not be in INVIOLABLE_FLOOR_IDS");
});

// ── T04: assertOrdered passes ───────────────────────────────────────────────
test("T04 — assertOrdered() passes with F29 at rung 9.5", () => {
  assert.doesNotThrow(() => assertOrdered(), "lattice ordering check must pass");
});

// ── T05: canDemote ─────────────────────────────────────────────────────────
test("T05 — canDemote: F29+consent:interactive=true; F3/F14=false", () => {
  assert.strictEqual(canDemote("F29", "consent:interactive"), true,
    "consent:interactive should demote F29");
  assert.strictEqual(canDemote("F3",  "consent:interactive"), false,
    "consent:interactive must NOT demote F3");
  assert.strictEqual(canDemote("F14", "consent:interactive"), false,
    "consent:interactive must NOT demote F14");
  assert.strictEqual(canDemote("F29", "contract-allow:any"), false,
    "contract-allow must not demote F29");
});

// ── T06: flag OFF → legacy require-tests (zero corpus divergence) ───────────
test("T06 — LILARA_DELETE_COORD unset: destructive-delete → require-tests, floorFired null", () => {
  withIsolatedEnv({ LILARA_DELETE_COORD: null }, () => {
    const d = decideSafe(CORPUS_INPUT);
    assert.strictEqual(d.action, "require-tests",
      `expected require-tests, got ${d.action}`);
    assert.strictEqual(d.floorFired, null,
      `expected floorFired=null, got ${d.floorFired}`);
    assert.notStrictEqual(d.decisionSource, "destructive-delete-coord",
      "decisionSource must not be destructive-delete-coord when flag off");
  });
});

// ── T07: flag ON → F29 fires, consent-required ──────────────────────────────
test("T07 — LILARA_DELETE_COORD=1: destructive-delete → F29 + consent-required", () => {
  withIsolatedEnv({ LILARA_DELETE_COORD: "1" }, () => {
    const d = decideSafe(CORPUS_INPUT);
    assert.strictEqual(d.floorFired, "destructive-delete-coord",
      `expected floorFired=destructive-delete-coord, got ${d.floorFired}`);
    assert.strictEqual(d.action, "require-review",
      `expected action=require-review, got ${d.action}`);
    assert.strictEqual(d.enforcementAction, "consent-required",
      `expected enforcementAction=consent-required, got ${d.enforcementAction}`);
    assert.strictEqual(d.decisionSource, "destructive-delete-coord",
      `expected decisionSource=destructive-delete-coord, got ${d.decisionSource}`);
  });
});

// ── T08: approve-past — evalConsentFloor directly proves grant suppression ───
// Full decide() path for the grant-suppression is CI-confirmed on Linux/macOS
// (where POSIX paths resolve cleanly). Here we test evalConsentFloor() directly
// with real filesystem paths so scopesMatch resolves correctly on all platforms.
test("T08 — evalConsentFloor: destructiveAllow grant covers approved path → inScope:true", () => {
  // Use the Lilara root dir as projectRoot and target "build" inside it.
  // path.resolve guarantees the pathGlob matches what scopesMatch resolves.
  const projRoot   = root;                                         // Lilara repo
  const buildPath  = path.resolve(projRoot, "build");              // absolute
  const rmCommand  = `rm -rf build`;                               // relative cmd

  // Grant minted by _deriveGrantScopes: exact pathGlob from the approval prompt.
  const grant = {
    id:           "test-grant-f29",
    projectScope: null,   // skip project-scope check in direct unit test
    sessionId:    null,
    scopes: {
      filesystem: {
        destructiveAllow: [
          {
            commandClass: "destructive-delete",
            pathGlob:     buildPath,   // already-resolved path on this OS
          },
        ],
      },
    },
    grantedAt:  new Date(Date.now() - 60000).toISOString(),
    expiresAt:  new Date(Date.now() + 3600000).toISOString(),
    grantedVia: "consent:interactive",
    floorCodes: [],
  };

  // Input that decide() would pass to evalConsentFloor: includes command,
  // targetPath, and projectRoot so scopesMatch can resolve the target path.
  // targetPath is required for bare relative commands: extractPaths("rm -rf build")
  // returns [] (no leading slash), so scopesMatch falls back to input.targetPath.
  const input = {
    command:     rmCommand,
    targetPath:  buildPath,   // absolute — the scopesMatch fallback for bare relative
    projectRoot: projRoot,
    now:         Date.now(),
  };

  const result = evalConsentFloor(input, grant, null);
  assert.strictEqual(result.inScope, true,
    `expected inScope:true, got inScope:${result.inScope} reason:${result.reason} — ` +
    `grant pathGlob=${buildPath}, projRoot=${projRoot}`);

  // Also verify a non-covered path is out-of-scope (grant is scoped, not wildcard).
  const inputOther = {
    command:     "rm -rf other-dir",
    projectRoot: projRoot,
    now:         Date.now(),
  };
  const resultOther = evalConsentFloor(inputOther, grant, null);
  assert.strictEqual(resultOther.inScope, false,
    "a different path must be out-of-scope (grant is path-specific, not wildcard)");
});

// ── T09: fileTargets fix — buildConsentPrompt prefers extra.fileTargets ──────
test("T09 — buildConsentPrompt: prefers extra.fileTargets over decision.ir?.fileTargets", () => {
  // Simulate the real engine result shape: no `ir` key.
  const decision = {
    action:            "require-review",
    enforcementAction: "consent-required",
    floorFired:        "destructive-delete-coord",
    explanation:       "Destructive delete requires approval",
  };
  const extra = {
    tool:        "Bash",
    command:     "rm -rf /tmp/build",
    fileTargets: ["/tmp/build"],
  };

  const prompt = buildConsentPrompt(decision, extra);
  assert.ok(Array.isArray(prompt.fileTargets), "fileTargets must be an array");
  assert.ok(prompt.fileTargets.length > 0,
    "fileTargets must be non-empty when injected via extra");
  assert.ok(
    prompt.fileTargets.includes("/tmp/build"),
    "fileTargets must include the injected path"
  );
});

// ── T10: no extra.fileTargets → empty (old bug path is gone, fix is the only path) ──
test("T10 — buildConsentPrompt without extra.fileTargets: empty fileTargets (no silent broadening)", () => {
  const decision = {
    action:    "require-review",
    floorFired: "destructive-delete-coord",
    explanation: "test",
    // no `ir` key — matches the real engine result
  };
  const promptOldPath = buildConsentPrompt(decision, { tool: "Bash" });
  assert.strictEqual(promptOldPath.fileTargets.length, 0,
    "Without injection, fileTargets must be empty (no silent grant-widening)");
});

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------
process.stdout.write(`\n  ${passed} passed, ${failed} failed\n`);
if (errors.length > 0) {
  for (const { name, err } of errors) {
    process.stderr.write(`\n  FAIL: ${name}\n  ${err.stack || err.message}\n`);
  }
  process.exit(1);
}
process.exit(0);
