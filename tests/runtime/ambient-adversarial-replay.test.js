#!/usr/bin/env node
"use strict";

// ambient-adversarial-replay.test.js — ADR-009 PR-D F16 corpus replay +
// scopes.ambient.allow[] opt-in abuse. Two suites:
//   A) JSONL replay of tests/fixtures/replay-corpus/f16-adversarial.jsonl —
//      pins action / decisionSource / floorFired / irHash + receipt
//      ambientClass/ambientPath presence/absence (homoglyph invariant).
//   B) Inline contract-aware opt-in abuse cases (kept here rather than in
//      the JSONL because scripts/replay-decisions.js cannot stand up an
//      on-disk contract per-entry).
//
// Cases tagged `_knownBypass` lock current behavior pre-PR-E (see ADR §9.4).
// Run: node tests/runtime/ambient-adversarial-replay.test.js

const assert  = require("node:assert");
const fs      = require("node:fs");
const os      = require("node:os");
const path    = require("node:path");
const crypto  = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const CORPUS_PATH = path.join(ROOT, "tests", "fixtures", "replay-corpus", "f16-adversarial.jsonl");
const { canonicalJson } = require(path.join(ROOT, "runtime", "canonical-json"));

let passed = 0;
let failed = 0;
const bypassesObserved = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stderr.write(`  FAIL ${name}: ${err && err.message || err}\n`);
    if (err && err.stack) process.stderr.write(err.stack + "\n");
  }
}

// (A) JSONL replay — mirrors scripts/replay-decisions.js isolation harness
// so unit-test and replay-gate outputs match exactly.

function isolatedDecide(input) {
  const envSnap = Object.assign({}, process.env);
  const restoreEnv = () => {
    for (const k of Object.keys(process.env)) if (!(k in envSnap)) delete process.env[k];
    for (const [k, v] of Object.entries(envSnap)) process.env[k] = v;
  };
  process.env.LILARA_CONTRACT_ENABLED      = "0";
  process.env.LILARA_TRAJECTORY_WINDOW_MIN = "0";
  process.env.LILARA_RATE_LIMIT            = "0";
  process.env.LILARA_BRANCH_OVERRIDE       = "replay/isolated-context";
  delete process.env.LILARA_KILL_SWITCH;
  delete process.env.LILARA_CONTRACT_REQUIRED;
  delete process.env.LILARA_F4_DEMOTE_TOKEN;

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f16-adv-test-"));
  process.env.LILARA_STATE_DIR = stateDir;

  // Fresh runtime/* cache so each decide sees pristine module state.
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(ROOT, "runtime") + path.sep)) {
      delete require.cache[key];
    }
  }

  try {
    const { decide } = require(path.join(ROOT, "runtime", "decision-engine"));
    const { build: buildIr } = require(path.join(ROOT, "runtime", "action-ir"));
    const { resetCache } = require(path.join(ROOT, "runtime", "session-context"));
    resetCache();
    const ir = buildIr(input, { harness: "claude", tool: input.tool });
    const result = decide(input);
    return { result, irHash: ir.irHash || null };
  } finally {
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    restoreEnv();
  }
}

assert.ok(fs.existsSync(CORPUS_PATH), `corpus missing: ${CORPUS_PATH}`);

const corpusLines = fs.readFileSync(CORPUS_PATH, "utf8").split("\n").filter(Boolean);
assert.ok(corpusLines.length >= 20, `corpus must have >=20 entries; got ${corpusLines.length}`);

for (const line of corpusLines) {
  const entry = JSON.parse(line);
  const { tag, input, expected, _knownBypass } = entry;

  test(`replay ${tag}`, () => {
    const { result, irHash } = isolatedDecide(input);

    assert.strictEqual(result.action, expected.action,
      `action drift: expected '${expected.action}' got '${result.action}'`);
    assert.strictEqual(result.decisionSource, expected.decisionSource,
      `decisionSource drift: expected '${expected.decisionSource}' got '${result.decisionSource}'`);
    assert.strictEqual(result.floorFired || null, expected.floorFired || null,
      `floorFired drift: expected '${expected.floorFired}' got '${result.floorFired}'`);
    assert.strictEqual(irHash, expected.irHash,
      `irHash drift: expected '${expected.irHash}' got '${irHash}'`);

    // Receipt-enrichment pins. The JSONL records `ambientClass`/`ambientPath`
    // only when the engine emitted them; absence in the JSONL must mean
    // absence in the receipt (invariant for homoglyph + non-string-path +
    // nonAmbient cases).
    if (Object.prototype.hasOwnProperty.call(expected, "ambientClass")) {
      assert.strictEqual(result.ambientClass, expected.ambientClass,
        `ambientClass drift: expected '${expected.ambientClass}' got '${result.ambientClass}'`);
    } else {
      assert.strictEqual(result.ambientClass, undefined,
        `ambientClass must be absent for tag=${tag}; got '${result.ambientClass}'`);
      assert.ok(!("ambientClass" in result),
        `ambientClass key must not be present for tag=${tag}`);
    }
    if (Object.prototype.hasOwnProperty.call(expected, "ambientPath")) {
      assert.strictEqual(result.ambientPath, expected.ambientPath,
        `ambientPath drift: expected '${expected.ambientPath}' got '${result.ambientPath}'`);
    } else {
      assert.strictEqual(result.ambientPath, undefined,
        `ambientPath must be absent for tag=${tag}; got '${result.ambientPath}'`);
    }

    // Homoglyph invariant: floorFired must NOT be ambient-authority on
    // shape-only-ASCII non-matches.
    if (tag.startsWith("f16:homoglyph:")) {
      assert.notStrictEqual(result.floorFired, "ambient-authority",
        "homoglyph candidate must NOT trigger F16");
      assert.strictEqual(result.ambientClass, undefined,
        "homoglyph receipt must omit ambientClass");
    }

    if (_knownBypass) {
      bypassesObserved.push({ tag, id: _knownBypass.id, followUp: _knownBypass.followUp });
    }
  });
}

// (B) scopes.ambient.allow[] opt-in abuse — contract-aware cases. Sandbox
// shape mirrors tests/runtime/ambient-receipt-enrichment.test.js.

function hashContract(doc) {
  const { contractHash: _omit, ...rest } = doc;
  return "sha256:" + crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
}

function withSandbox(opts, body) {
  const o = opts || {};
  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f16-adv-opt-st-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f16-adv-opt-pr-"));
  const envSnap = Object.assign({}, process.env);
  const restoreEnv = () => {
    for (const k of Object.keys(process.env)) if (!(k in envSnap)) delete process.env[k];
    for (const [k, v] of Object.entries(envSnap)) process.env[k] = v;
  };
  const cleanup = () => {
    try { fs.rmSync(stateDir,   { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  try {
    process.env.LILARA_STATE_DIR        = stateDir;
    process.env.LILARA_CONTRACT_ENABLED = o.contract ? "1" : "0";
    process.env.LILARA_RATE_LIMIT       = "0";
    delete process.env.LILARA_KILL_SWITCH;
    delete process.env.LILARA_CONTRACT_REQUIRED;
    delete process.env.LILARA_F4_DEMOTE_TOKEN;
    delete process.env.LILARA_IR_JOURNAL;

    if (o.contract) {
      const doc = JSON.parse(JSON.stringify(o.contract));
      doc.contractHash = hashContract(doc);
      fs.writeFileSync(path.join(projectDir, "lilara.contract.json"), JSON.stringify(doc, null, 2));
      const acceptedPath = path.join(stateDir, "accepted-contracts.json");
      const acceptedKey  = path.resolve(projectDir);
      fs.writeFileSync(acceptedPath, JSON.stringify({
        [acceptedKey]: {
          contractHash: doc.contractHash,
          acceptedAt: doc.acceptedAt || "2026-01-01T00:00:00Z",
          revision: doc.revision || 1,
          contractId: doc.contractId,
        }
      }, null, 2));
    }

    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(ROOT, "runtime") + path.sep)) {
        delete require.cache[key];
      }
    }
    const { decide } = require(path.join(ROOT, "runtime", "decision-engine"));
    body({ projectDir, decide });
  } finally {
    restoreEnv();
    cleanup();
  }
}

function classOnlyAllow(cls, reason) {
  return {
    version: 3, contractId: "lilara-20260101-0000000fad0d", revision: 1,
    acceptedAt: "2026-01-01T00:00:00Z", harnessScope: ["claude"],
    trustPosture: "balanced",
    scopes: {
      payloadClasses: { A: "allow", B: "warn", C: "block" },
      ambient: { allow: [ { class: cls, reason: reason || "test opt-in" } ] }
    }
  };
}

function pathPrefixAllow(cls, prefix, reason) {
  return {
    version: 3, contractId: "lilara-20260101-0000000fad0e", revision: 1,
    acceptedAt: "2026-01-01T00:00:00Z", harnessScope: ["claude"],
    trustPosture: "balanced",
    scopes: {
      payloadClasses: { A: "allow", B: "warn", C: "block" },
      ambient: { allow: [ { class: cls, pathPrefix: prefix, reason: reason || "test opt-in" } ] }
    }
  };
}

// (B1) Class-only opt-in for ssh does NOT cover a gitConfig candidate:
// engine still fires F16 on gitConfig; receipt classifies the offending path.
test("opt-in abuse: class-only ssh opt-in does NOT permit a gitConfig candidate", () => {
  withSandbox({ contract: classOnlyAllow("ssh", "rotation script") }, ({ projectDir, decide }) => {
    const target = "/home/user/.gitconfig";
    const r = decide({
      tool: "Write", harness: "claude", branch: "feature/test",
      projectRoot: projectDir, targetPath: target, file_path: target,
    });
    assert.strictEqual(r.action, "block", "F16 must still fire — ssh opt-in does not cover gitConfig");
    assert.strictEqual(r.floorFired, "ambient-authority");
    assert.strictEqual(r.ambientClass, "gitConfig");
    assert.strictEqual(r.ambientPath, target);
  });
});

// (B2) pathPrefix opt-in with off-by-one segment does NOT permit candidate.
// `/home/user/.aw` is not a segment-aligned prefix of `/home/user/.aws/...`.
test("opt-in abuse: pathPrefix off-by-one segment ('.aw' vs '.aws/') does NOT permit", () => {
  withSandbox({ contract: pathPrefixAllow("credentialHelper", "/home/user/.aw") }, ({ projectDir, decide }) => {
    const target = "/home/user/.aws/credentials";
    const r = decide({
      tool: "Write", harness: "claude", branch: "feature/test",
      projectRoot: projectDir, targetPath: target, file_path: target,
    });
    assert.strictEqual(r.action, "block", "F16 must still fire — '.aw' prefix is not segment-aligned");
    assert.strictEqual(r.floorFired, "ambient-authority");
    assert.strictEqual(r.ambientClass, "credentialHelper");
  });
});

// (B3) pathPrefix trailing-slash variance MUST be tolerated: the engine
// normalizes trailing slashes (see _normAmbientPath). '.aws/' and '.aws'
// match the same candidate.
test("opt-in abuse: pathPrefix trailing-slash variance is tolerated (both forms permit)", () => {
  for (const prefix of ["/home/user/.aws/", "/home/user/.aws"]) {
    withSandbox({ contract: pathPrefixAllow("credentialHelper", prefix) }, ({ projectDir, decide }) => {
      const target = "/home/user/.aws/credentials";
      const r = decide({
        tool: "Write", harness: "claude", branch: "feature/test",
        projectRoot: projectDir, targetPath: target, file_path: target,
      });
      assert.notStrictEqual(r.floorFired, "ambient-authority",
        `prefix '${prefix}' must permit — trailing-slash variance tolerated`);
      assert.strictEqual(r.ambientClass, "credentialHelper",
        "receipt still carries ambientClass on opt-in allow");
    });
  }
});

// (B4) Opt-in for class X does NOT bleed into a different class Y on the
// SAME path-prefix string. credentialHelper opt-in for '/home/user/' must
// not permit a ssh candidate at '/home/user/.ssh/id_rsa'.
test("opt-in abuse: opt-in class does NOT bleed across classes on shared prefix", () => {
  withSandbox({ contract: pathPrefixAllow("credentialHelper", "/home/user/") }, ({ projectDir, decide }) => {
    const target = "/home/user/.ssh/id_rsa";
    const r = decide({
      tool: "Write", harness: "claude", branch: "feature/test",
      projectRoot: projectDir, targetPath: target, file_path: target,
    });
    assert.strictEqual(r.action, "block",
      "F16 must still fire — credentialHelper opt-in does not cover ssh candidate");
    assert.strictEqual(r.ambientClass, "ssh", "ssh wins at the first-match step");
  });
});

// (B5) Opt-in `pathPrefix` is segment-aligned — '/home/user/.aws' (no
// trailing /) does NOT permit '/home/user/.awsx/credentials' (sibling
// directory). Confirms _matchAmbientAllow's `normPath.startsWith(np + "/")`
// guard works.
test("opt-in abuse: pathPrefix is segment-aligned (no sibling-prefix bleed)", () => {
  withSandbox({ contract: pathPrefixAllow("credentialHelper", "/home/user/.aws") }, ({ projectDir, decide }) => {
    // Synthesize a candidate the classifier would route to credentialHelper
    // via the .netrc rule, but whose path-prefix would only bleed in if the
    // segment guard were absent.
    const target = "/home/user/.awsx-spoof/.netrc";
    const r = decide({
      tool: "Write", harness: "claude", branch: "feature/test",
      projectRoot: projectDir, targetPath: target, file_path: target,
    });
    assert.strictEqual(r.action, "block",
      "F16 must still fire — '/home/user/.aws' prefix must not bleed into '/home/user/.awsx-spoof/'");
    assert.strictEqual(r.floorFired, "ambient-authority");
    assert.strictEqual(r.ambientClass, "credentialHelper");
  });
});

if (bypassesObserved.length > 0) {
  process.stdout.write(`\nKnown bypasses captured in corpus (recorded as current engine behavior; replay-stable; flagged for PR-E follow-up):\n`);
  for (const b of bypassesObserved) {
    process.stdout.write(`  ${b.id}  ${b.tag}\n    follow-up: ${b.followUp}\n`);
  }
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
