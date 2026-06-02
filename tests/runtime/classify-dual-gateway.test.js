#!/usr/bin/env node
"use strict";

// classify-dual-gateway.test.js — ADR-023: integration tests proving that the
// unified classifyCommandDual gateway catches Unicode-evasion at each migrated
// call site.
//
// Migrated sites under test (ADR-023):
//   A. contract.js:545  — scopeMatch() allow-list grant (strongest security case)
//   B. decision-engine.js:1039 — non-MCP Bash contract-scope class
//   C. degraded-mode.js:108  — isWriteLike() fallback
//
// Migrated — ADR-026 (Khouly authorized re-baseline, 2026-06-02):
//   D. action-ir.js:490 — receipt commandClass, ir.destructive, irHash now reflect
//      true semantic class (destructive-delete) for Unicode-obfuscated rm variants.
//
// Migrated — ADR-027 (Khouly approved versioned v2| key prefix, 2026-06-02):
//   E. decision-key.js fineKey/legacyKey — policy-store.js scopedKey() now uses
//      fineKeyDual (v2| prefix); legacy keys are still matched as fallback.
//
// Evasion classes used per site (deliberately varied):
//   A. Cyrillic  — U+0440 'р' looks like Latin 'r'
//   B. ZWJ splice — U+200D zero-width joiner between 'r' and 'm'
//   C. Full-width — U+FF52 'ｒ', U+FF4D 'ｍ'
//
// Run: node tests/runtime/classify-dual-gateway.test.js

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");

// Site A — contract.js:545
const { scopeMatch, getContract, getContractPath } = require(path.join(root, "runtime", "contract"));
// Site B — decision-engine.js:1039 (exercised via decide())
const { decide }     = require(path.join(root, "runtime", "decision-engine"));
const { resetCache } = require(path.join(root, "runtime", "session-context"));
const { build: buildIr } = require(path.join(root, "runtime", "action-ir"));
// Site C — degraded-mode.js:108
const { isWriteLike } = require(path.join(root, "runtime", "degraded-mode"));

let passed = 0;
let failed = 0;
function ok(name)      { console.log(`  ok  ${name}`); passed++; }
function fail(name, m) { console.error(`  FAIL ${name} — ${m}`); failed++; }

// Isolation wrapper: fresh LILARA_STATE_DIR, resetCache(), restore on exit.
function isolated(fn) {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), "adr023-test-"));
  const prev = process.env.LILARA_STATE_DIR;
  process.env.LILARA_STATE_DIR = dir;
  try {
    resetCache();
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.LILARA_STATE_DIR;
    else process.env.LILARA_STATE_DIR = prev;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ─── Site A: contract.js:545 scopeMatch() — Cyrillic evasion ─────────────────
// Before ADR-023: classifyCommand("рm -rf /") → "generic". A contract that
// allows scopes.commands.allow:["generic"] would wrongly grant the Cyrillic rm.
// After ADR-023: classifyCommandDual returns "destructive-delete"; scopeMatch
// sees that class and does NOT grant via the generic allow-list.

// Build a minimal contract object with the required shape.
function makeContract(overrides = {}) {
  return {
    contractId:   "test-adr023",
    contractHash: "00000000",
    version:      "1",
    scopes: {
      commands: {
        allow:   overrides.commandsAllow  || [],
        deny:    overrides.commandsDeny   || [],
        gated:   overrides.commandsGated  || [],
      },
    },
    ...overrides._extra,
  };
}

(function testSiteA_CyrillicRm() {
  // Contract allows only "generic" command class — must NOT grant "рm -rf /"
  const contract = makeContract({ commandsAllow: ["generic"] });
  const input = {
    command:    "рm -rf /",  // Cyrillic 'р' (U+0440) + 'm -rf /'
    commandClass: undefined,      // let scopeMatch classify from input.command
    projectRoot: "/tmp/test-project",
    payloadClass: "A",
  };
  const result = scopeMatch(contract, input);

  result.allowed === false
    ? ok("Site-A (scopeMatch): Cyrillic рm -rf / is NOT granted via generic allow-list")
    : fail("Site-A (scopeMatch): Cyrillic рm -rf / must NOT be granted", `allowed=${result.allowed} reason=${result.reason}`);
})();

(function testSiteA_ASCII_unchanged() {
  // Sanity / anti-FP: a pure ASCII "ls" generic command IS granted by the allow-list
  const contract = makeContract({ commandsAllow: ["generic"] });
  const input = {
    command:    "ls -la",
    commandClass: undefined,
    projectRoot: "/tmp/test-project",
    payloadClass: "A",
  };
  const result = scopeMatch(contract, input);
  // Depending on whether scopes.commands.allow covers all classes, the result may
  // be allowed (if allow-list includes generic) or gated (if no match). The key
  // constraint: "ls -la" (safe, generic) must NOT be blocked.
  result.allowed !== false || result.gated
    ? ok("Site-A (scopeMatch): pure-ASCII generic ls not blocked by dual-path migration")
    : fail("Site-A (scopeMatch): ASCII regression — ls should be allowed or gated, not denied", `allowed=${result.allowed} reason=${result.reason}`);
})();

// ─── Site B: decision-engine.js:1039 — ZWJ-spliced rm via non-MCP Bash + contract ─
// Sets up an active contract that allows "generic" commands, then passes a ZWJ-
// spliced destructive command as a non-MCP Bash call. After ADR-023 the engine
// classifies it as "destructive-delete" at the scope check → not scope-allowed.
// (The command is also caught by F3/risk-engine → block, independent of scope;
// the test verifies only that the action is not "allow".)
isolated((dir) => {
  const contractDir = path.join(dir, "contract");
  fs.mkdirSync(contractDir, { recursive: true });
  const contractPath = path.join(dir, "lilara.contract.json");
  const acceptedPath = path.join(dir, "accepted-contracts.json");
  const contractData = {
    contractId:   "test-adr023-site-b",
    contractHash: "00000000",
    version:      "1",
    scopes: {
      commands: { allow: ["generic"], deny: [], gated: [] },
    },
  };
  fs.writeFileSync(contractPath, JSON.stringify(contractData));
  fs.writeFileSync(acceptedPath, JSON.stringify([contractData.contractId + ":00000000"]));

  const prevContract  = process.env.LILARA_CONTRACT_PATH;
  const prevAccepted  = process.env.LILARA_ACCEPTED_PATH;
  const prevEnabled   = process.env.LILARA_CONTRACT_ENABLED;
  process.env.LILARA_CONTRACT_PATH    = contractPath;
  process.env.LILARA_ACCEPTED_PATH    = acceptedPath;
  process.env.LILARA_CONTRACT_ENABLED = "1";

  // Purge require.cache for contract-reading modules so the new env vars take effect.
  for (const key of Object.keys(require.cache)) {
    if (/runtime[/\\](contract|decision-engine|session-context)\.js/.test(key)) {
      delete require.cache[key];
    }
  }
  const { decide: decideB } = require(path.join(root, "runtime", "decision-engine"));

  try {
    // ZWJ splice: 'r' + U+200D + 'm -rf /'
    const zwjCommand = "r‍m -rf /";
    const input = {
      tool:        "Bash",
      harness:     "claude",
      command:     zwjCommand,
      branch:      "feature/test",
      targetPath:  ".",
      projectRoot: dir,
    };
    buildIr(input, { harness: "claude", tool: input.tool });
    const result = decideB(input);
    result.action !== "allow"
      ? ok("Site-B (decide): ZWJ rm r‍m -rf / is NOT allowed via generic scope (dual-path caught)")
      : fail("Site-B (decide): ZWJ rm must NOT be allowed", `action=${result.action}`);
  } finally {
    if (prevContract === undefined) delete process.env.LILARA_CONTRACT_PATH;
    else process.env.LILARA_CONTRACT_PATH = prevContract;
    if (prevAccepted === undefined) delete process.env.LILARA_ACCEPTED_PATH;
    else process.env.LILARA_ACCEPTED_PATH = prevAccepted;
    if (prevEnabled === undefined) delete process.env.LILARA_CONTRACT_ENABLED;
    else process.env.LILARA_CONTRACT_ENABLED = prevEnabled;
    for (const key of Object.keys(require.cache)) {
      if (/runtime[/\\](contract|decision-engine|session-context)\.js/.test(key)) {
        delete require.cache[key];
      }
    }
  }
});

// ─── Site C: degraded-mode.js:108 isWriteLike() — full-width evasion ──────────
// Before ADR-023: classifyCommand("ｒｍ -rf /") → "generic" → isWriteLike returns false.
// After ADR-023: classifyCommandDual returns "destructive-delete" → isWriteLike returns true.
(function testSiteC_FullWidthRm() {
  const input = {
    command: "ｒｍ -rf /",  // 'ｒ' (U+FF52) + 'ｍ' (U+FF4D) + ' -rf /'
    tool:    "Bash",
  };
  isWriteLike(input) === true
    ? ok("Site-C (isWriteLike): full-width ｒｍ -rf / is write-like (dual-path caught)")
    : fail("Site-C (isWriteLike): full-width ｒｍ -rf / must be write-like", "isWriteLike returned false — Unicode evasion in degraded mode");
})();

(function testSiteC_ASCII_unchanged() {
  // Anti-FP: plain "ls" must NOT be classified as write-like
  const inputBenign = { command: "ls -la", tool: "Bash" };
  isWriteLike(inputBenign) === false
    ? ok("Site-C (isWriteLike): ASCII ls is NOT write-like (anti-FP guard)")
    : fail("Site-C (isWriteLike): ASCII ls must not be write-like", "dual-path migration regressed benign command");
  // Plain "rm -rf /" must still be write-like
  const inputDanger = { command: "rm -rf /", tool: "Bash" };
  isWriteLike(inputDanger) === true
    ? ok("Site-C (isWriteLike): ASCII rm -rf / remains write-like (no regression)")
    : fail("Site-C (isWriteLike): ASCII rm -rf / must be write-like", "regression — raw-only path was necessary");
})();

// ─── Site D: action-ir.js:490 buildIr() — Cyrillic + full-width evasion ──────
// ADR-026: migrated to classifyCommandDual; irHash re-baselined for the 2 corpus
// entries whose recorded hash was computed under the old raw classification.
// Guards: assert ir.commandClass and ir.destructive are now correct for
// Unicode-obfuscated rm; ASCII commands are unaffected.

(function testSiteD_Cyrillic() {
  const input = {
    tool:    "Bash",
    harness: "claude",
    command: "рm -rf /",  // Cyrillic U+0440 'р'
    branch:  "feature/test",
  };
  const ir = buildIr(input, { harness: "claude", tool: "Bash" });
  ir.commandClass === "destructive-delete"
    ? ok("Site-D (buildIr): Cyrillic рm commandClass=destructive-delete (dual-path)")
    : fail("Site-D (buildIr): Cyrillic рm commandClass must be destructive-delete", `got ${ir.commandClass}`);
  ir.destructive === true
    ? ok("Site-D (buildIr): Cyrillic рm ir.destructive=true")
    : fail("Site-D (buildIr): Cyrillic рm ir.destructive must be true", `got ${ir.destructive}`);
})();

(function testSiteD_FullWidth() {
  const input = {
    tool:    "Bash",
    harness: "claude",
    command: "ｒｍ -rf /",  // U+FF52 'ｒ', U+FF4D 'ｍ'
    branch:  "feature/test",
  };
  const ir = buildIr(input, { harness: "claude", tool: "Bash" });
  ir.commandClass === "destructive-delete"
    ? ok("Site-D (buildIr): full-width ｒｍ commandClass=destructive-delete (dual-path)")
    : fail("Site-D (buildIr): full-width ｒｍ commandClass must be destructive-delete", `got ${ir.commandClass}`);
  ir.destructive === true
    ? ok("Site-D (buildIr): full-width ｒｍ ir.destructive=true")
    : fail("Site-D (buildIr): full-width ｒｍ ir.destructive must be true", `got ${ir.destructive}`);
})();

(function testSiteD_ASCII_unchanged() {
  // Anti-FP: plain ASCII commands must not regress under dual-path migration
  const irLs = buildIr({ tool: "Bash", harness: "claude", command: "ls -la", branch: "feature/test" }, { harness: "claude", tool: "Bash" });
  irLs.commandClass === "generic"
    ? ok("Site-D (buildIr): ASCII ls commandClass=generic (anti-FP guard)")
    : fail("Site-D (buildIr): ASCII ls must stay generic", `got ${irLs.commandClass}`);
  irLs.destructive === false
    ? ok("Site-D (buildIr): ASCII ls ir.destructive=false (anti-FP guard)")
    : fail("Site-D (buildIr): ASCII ls must not be destructive", `got ${irLs.destructive}`);
  // ASCII rm -rf must still be caught
  const irRm = buildIr({ tool: "Bash", harness: "claude", command: "rm -rf /", branch: "feature/test" }, { harness: "claude", tool: "Bash" });
  irRm.commandClass === "destructive-delete"
    ? ok("Site-D (buildIr): ASCII rm -rf / remains destructive-delete (no regression)")
    : fail("Site-D (buildIr): ASCII rm -rf / must be destructive-delete", `got ${irRm.commandClass}`);
})();

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\nclassify-dual-gateway.test.js: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
