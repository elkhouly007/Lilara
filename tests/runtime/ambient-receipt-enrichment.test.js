#!/usr/bin/env node
"use strict";

// ambient-receipt-enrichment.test.js — Zero-dep node:assert tests for
// ADR-009 PR-C: receipt carries `ambientClass`/`ambientPath` on every
// decision that touches an ambient path (not just F16 fires).
//
// PR-B already enriched receipts on the F16-fire branch. PR-C generalises
// the enrichment so non-floor allows (allow-inside-projectRoot for
// gitConfig, allow via scopes.ambient.allow[] opt-in, etc.) also carry
// the classifier labels — closing the audit-completeness gap PR-B opened.
//
// Run: node tests/runtime/ambient-receipt-enrichment.test.js

const assert  = require("node:assert");
const fs      = require("node:fs");
const os      = require("node:os");
const path    = require("node:path");
const crypto  = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const { canonicalJson } = require(path.join(ROOT, "runtime", "canonical-json"));

let passed = 0;
let failed = 0;
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

function hashContract(doc) {
  const { contractHash: _omit, ...rest } = doc;
  return "sha256:" + crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
}

function withSandbox(opts, body) {
  const o = opts || {};
  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), "arg-recpt-st-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-recpt-pr-"));
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
    process.env.LILARA_DECISION_JOURNAL = "1";
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

    // Fresh runtime/* cache so engine state (contract cache, ambient classifier)
    // is pristine per test.
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(ROOT, "runtime") + path.sep)) {
        delete require.cache[key];
      }
    }
    const { decide } = require(path.join(ROOT, "runtime", "decision-engine"));
    body({ projectDir, stateDir, decide });
  } finally {
    restoreEnv();
    cleanup();
  }
}

function readJournalLastEntry(stateDir) {
  const jf = path.join(stateDir, "decision-journal.jsonl");
  if (!fs.existsSync(jf)) return null;
  const lines = fs.readFileSync(jf, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (e.kind === "runtime-decision") return e;
    } catch { /* skip */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// (1) allow-inside-projectRoot for gitConfig: receipt carries gitConfig.
// ---------------------------------------------------------------------------
test("allow inside projectRoot/.git/config — receipt carries ambientClass=gitConfig", () => {
  withSandbox({}, ({ projectDir, stateDir, decide }) => {
    const target = path.join(projectDir, ".git", "config");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.notStrictEqual(r.action, "block",
      `expected non-block (project-local exception), got action=${r.action} floor=${r.floorFired}`);
    assert.notStrictEqual(r.floorFired, "ambient-authority",
      "F16 must not fire on in-project .git/config");
    assert.strictEqual(r.ambientClass, "gitConfig",
      `receipt must carry ambientClass=gitConfig; got ${r.ambientClass}`);
    assert.strictEqual(r.ambientPath, target,
      `receipt must carry ambientPath equal to candidate; got ${r.ambientPath}`);
    // Journal mirror.
    const j = readJournalLastEntry(stateDir);
    assert.ok(j, "journal entry must be written");
    assert.strictEqual(j.ambientClass, "gitConfig", "journal ambientClass mismatch");
    assert.strictEqual(j.ambientPath, target,      "journal ambientPath mismatch");
  });
});

// ---------------------------------------------------------------------------
// (2) allow via scopes.ambient.allow[] for ssh: receipt carries ssh.
// ---------------------------------------------------------------------------
test("allow via scopes.ambient.allow[]=[{class:ssh}] — receipt carries ambientClass=ssh", () => {
  withSandbox({
    contract: {
      version: 3,
      contractId: "lilara-20260101-00000000c001",
      revision: 1,
      acceptedAt: "2026-01-01T00:00:00Z",
      harnessScope: ["claude"],
      trustPosture: "balanced",
      scopes: {
        payloadClasses: { A: "allow", B: "warn", C: "block" },
        ambient: { allow: [ { class: "ssh", reason: "operator authorized" } ] }
      }
    }
  }, ({ projectDir, stateDir, decide }) => {
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: "/home/user/.ssh/authorized_keys",
      file_path: "/home/user/.ssh/authorized_keys",
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.notStrictEqual(r.floorFired, "ambient-authority",
      "class-only ssh opt-in must permit; F16 must not fire");
    assert.strictEqual(r.ambientClass, "ssh",
      `receipt must carry ambientClass=ssh on opt-in allow; got ${r.ambientClass}`);
    assert.strictEqual(r.ambientPath, "/home/user/.ssh/authorized_keys",
      `receipt ambientPath mismatch; got ${r.ambientPath}`);
    const j = readJournalLastEntry(stateDir);
    assert.ok(j, "journal entry must be written");
    assert.strictEqual(j.ambientClass, "ssh", "journal ambientClass mismatch");
  });
});

// ---------------------------------------------------------------------------
// (3) F16 fire: receipt still carries ambientClass, exactly once.
// ---------------------------------------------------------------------------
test("F16 fire still carries ambientClass once (not duplicated)", () => {
  withSandbox({}, ({ projectDir, stateDir, decide }) => {
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: "/home/user/.gitconfig",
      file_path: "/home/user/.gitconfig",
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.strictEqual(r.action, "block");
    assert.strictEqual(r.floorFired, "ambient-authority");
    assert.strictEqual(r.ambientClass, "gitConfig");
    assert.strictEqual(r.ambientPath,  "/home/user/.gitconfig");
    // Idempotency: the result object must carry ambientClass exactly once.
    const keys = Object.keys(r).filter((k) => k === "ambientClass");
    assert.strictEqual(keys.length, 1, "ambientClass duplicated in receipt");
    const j = readJournalLastEntry(stateDir);
    assert.ok(j, "journal entry must be written");
    assert.strictEqual(j.ambientClass, "gitConfig");
    assert.strictEqual(j.ambientPath,  "/home/user/.gitconfig");
  });
});

// ---------------------------------------------------------------------------
// (4) non-ambient write: receipt has neither field.
// ---------------------------------------------------------------------------
test("non-ambient write (/tmp/foo.txt) — receipt omits ambientClass/ambientPath", () => {
  withSandbox({}, ({ projectDir, stateDir, decide }) => {
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: "/tmp/foo.txt",
      file_path: "/tmp/foo.txt",
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.strictEqual(r.ambientClass, undefined,
      `ambientClass must be absent on non-ambient; got ${JSON.stringify(r.ambientClass)}`);
    assert.strictEqual(r.ambientPath, undefined,
      `ambientPath must be absent on non-ambient; got ${JSON.stringify(r.ambientPath)}`);
    assert.ok(!("ambientClass" in r), "ambientClass key must not be present");
    assert.ok(!("ambientPath"  in r), "ambientPath key must not be present");
    const j = readJournalLastEntry(stateDir);
    assert.ok(j, "journal entry must be written");
    assert.ok(!("ambientClass" in j), "journal ambientClass key must not be present");
    assert.ok(!("ambientPath"  in j), "journal ambientPath key must not be present");
  });
});

// ---------------------------------------------------------------------------
// (5) nonAmbient-only candidate path: receipt has neither field.
// (Variant of (4): a plain project file under projectRoot.)
// ---------------------------------------------------------------------------
test("nonAmbient-only candidate (project file) — receipt omits both fields", () => {
  withSandbox({}, ({ projectDir, decide }) => {
    const target = path.join(projectDir, "src", "lib", "util.ts");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.ok(!("ambientClass" in r),
      `ambientClass must be omitted (not null) when no ambient candidate exists; got ${JSON.stringify(r.ambientClass)}`);
    assert.ok(!("ambientPath" in r),
      `ambientPath must be omitted (not null) when no ambient candidate exists; got ${JSON.stringify(r.ambientPath)}`);
  });
});

// ---------------------------------------------------------------------------
// (6) IR-fileTargets ambient candidate, flat targetPath non-ambient: classify
//     from IR. Verifies that _collectAmbientCandidatePaths picks up the IR
//     write-intent target even when input.targetPath itself is benign.
// ---------------------------------------------------------------------------
test("IR-fileTargets ambient candidate while flat targetPath is non-ambient — receipt classifies from IR", () => {
  withSandbox({}, ({ projectDir, decide }) => {
    const r = decide({
      tool: "Bash",
      harness: "claude",
      command: "true",
      targetPath: "/tmp/build.log",
      projectRoot: projectDir,
      branch: "feature/test",
      ir: {
        irHash: "sha256:test-ir-hash-prc",
        fileTargets: [
          { intent: "write", path: "/home/user/.bashrc" },
        ],
      },
    });
    assert.strictEqual(r.ambientClass, "shellRc",
      `receipt must classify from IR write target; got ${r.ambientClass}`);
    assert.strictEqual(r.ambientPath, "/home/user/.bashrc",
      `receipt ambientPath must come from the IR write target; got ${r.ambientPath}`);
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
