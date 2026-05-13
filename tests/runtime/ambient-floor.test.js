#!/usr/bin/env node
"use strict";

// ambient-floor.test.js — Zero-dep node:assert tests for F16 PR-B
// (ADR-009 PR-B): the ambient-authority floor wired into
// runtime/decision-engine.decide().
//
// Covers:
//   - F16 fires on each ambient class outside projectRoot.
//   - F16 does NOT fire on `nonAmbient` paths.
//   - Project-local exception (gitConfig/ideSettings inside projectRoot)
//     does NOT fire; ssh inside projectRoot still fires.
//   - `scopes.ambient.allow[]` opt-in semantics: class-only + pathPrefix.
//   - F16 fires AFTER F15 (envelope) when both would fire — that is, F15
//     wins the early-block race because rung 17 < rung 17.5.
//   - F16 receipt contains the `ambientClass` field on fire.
//
// The tests use a per-test isolated HORUS_STATE_DIR and a synthetic contract
// document written into a fresh tmpdir, so the engine's contract loader picks
// it up without polluting the host. Module cache is cleared between tests so
// the engine's lazy contract cache (_contractLoaded) doesn't leak between
// cases.
//
// Run:  node tests/runtime/ambient-floor.test.js

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

// Fresh per-test sandbox: a tmpdir for state + a tmpdir for the projectRoot,
// fresh env, fresh require cache for runtime/* so the engine's contract cache
// + ambient classifier are reloaded from scratch.
function withSandbox(opts, body) {
  const o = opts || {};
  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f16t-st-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f16t-pr-"));
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
    process.env.HORUS_STATE_DIR        = stateDir;
    process.env.HORUS_CONTRACT_ENABLED = o.contract ? "1" : "0";
    process.env.HORUS_DECISION_JOURNAL = "1";
    process.env.HORUS_RATE_LIMIT       = "0";
    delete process.env.HORUS_KILL_SWITCH;
    delete process.env.HORUS_CONTRACT_REQUIRED;
    delete process.env.HORUS_F4_DEMOTE_TOKEN;
    delete process.env.HORUS_IR_JOURNAL;

    if (o.contract) {
      const doc = JSON.parse(JSON.stringify(o.contract));
      doc.contractHash = hashContract(doc);
      fs.writeFileSync(path.join(projectDir, "horus.contract.json"), JSON.stringify(doc, null, 2));
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

    // Reset runtime/* module cache so engine + classifier are pristine.
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

// ---------------------------------------------------------------------------
// F16 fires on each ambient class outside projectRoot
// ---------------------------------------------------------------------------

test("F16 fires on ssh write outside projectRoot", () => {
  withSandbox({}, ({ projectDir, decide }) => {
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: "/home/user/.ssh/authorized_keys",
      file_path: "/home/user/.ssh/authorized_keys",
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.strictEqual(r.action, "block");
    assert.strictEqual(r.floorFired, "ambient-authority");
    assert.strictEqual(r.decisionSource, "ambient-authority-denied");
    assert.strictEqual(r.ambientClass, "ssh");
    assert.ok(r.reasonCodes && r.reasonCodes.indexOf("ambient-authority-denied") !== -1);
  });
});

test("F16 fires on each ambient class outside projectRoot", () => {
  const cases = [
    { p: "/home/user/.ssh/id_rsa",                                                              cls: "ssh" },
    { p: "/home/user/.gitconfig",                                                               cls: "gitConfig" },
    { p: "/home/user/.bashrc",                                                                  cls: "shellRc" },
    { p: "/home/user/.npmrc",                                                                   cls: "packageCache" },
    { p: "/home/user/.aws/credentials",                                                         cls: "credentialHelper" },
    { p: "/home/user/.config/Code/User/settings.json",                                          cls: "ideSettings" },
    { p: "/home/user/.claude.json",                                                             cls: "mcpConfig" },
    { p: "/home/user/.mozilla/firefox/abc.default/cookies.sqlite",                              cls: "browserProfile" },
    { p: "/home/user/.gnupg/secring.gpg",                                                       cls: "osKeychain" },
  ];
  for (const c of cases) {
    withSandbox({}, ({ projectDir, decide }) => {
      const r = decide({
        tool: "Write",
        harness: "claude",
        targetPath: c.p,
        file_path: c.p,
        projectRoot: projectDir,
        branch: "feature/test",
      });
      assert.strictEqual(r.action, "block", `expected block for ${c.p}, got ${r.action}`);
      assert.strictEqual(r.floorFired, "ambient-authority", `floorFired for ${c.p}`);
      assert.strictEqual(r.ambientClass, c.cls, `ambientClass for ${c.p}`);
    });
  }
});

// ---------------------------------------------------------------------------
// F16 does NOT fire on nonAmbient paths
// ---------------------------------------------------------------------------

test("F16 does NOT fire on nonAmbient writes (plain project file)", () => {
  withSandbox({}, ({ projectDir, decide }) => {
    const target = path.join(projectDir, "src", "app.ts");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.notStrictEqual(r.floorFired, "ambient-authority");
    assert.notStrictEqual(r.decisionSource, "ambient-authority-denied");
    assert.strictEqual(r.ambientClass, undefined);
  });
});

test("F16 does NOT fire on nonAmbient writes outside projectRoot either", () => {
  withSandbox({}, ({ projectDir, decide }) => {
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: "/tmp/build.log",
      file_path: "/tmp/build.log",
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.notStrictEqual(r.floorFired, "ambient-authority");
  });
});

// ---------------------------------------------------------------------------
// Project-local exception
// ---------------------------------------------------------------------------

test("project-local gitConfig (.git/config inside projectRoot) does NOT fire", () => {
  withSandbox({}, ({ projectDir, decide }) => {
    const target = path.join(projectDir, ".git", "config");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.notStrictEqual(r.floorFired, "ambient-authority", "F16 should not fire on project-local .git/config");
  });
});

test("project-local ideSettings (.vscode inside projectRoot) does NOT fire", () => {
  withSandbox({}, ({ projectDir, decide }) => {
    const target = path.join(projectDir, ".vscode", "settings.json");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.notStrictEqual(r.floorFired, "ambient-authority", "F16 should not fire on project-local .vscode/");
  });
});

test("project-local ssh (.ssh inside projectRoot) STILL fires — no legitimate in-project reason", () => {
  withSandbox({}, ({ projectDir, decide }) => {
    const target = path.join(projectDir, ".ssh", "id_rsa");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.strictEqual(r.floorFired, "ambient-authority");
    assert.strictEqual(r.ambientClass, "ssh");
  });
});

// ---------------------------------------------------------------------------
// scopes.ambient.allow[] opt-in semantics
// ---------------------------------------------------------------------------

test("class-only opt-in permits the floor (scopes.ambient.allow=[{class:gitConfig}])", () => {
  withSandbox({
    contract: {
      version: 3,
      contractId: "hap-20260101-00000000a001",
      revision: 1,
      acceptedAt: "2026-01-01T00:00:00Z",
      harnessScope: ["claude"],
      trustPosture: "balanced",
      scopes: {
        payloadClasses: { A: "allow", B: "warn", C: "block" },
        ambient: { allow: [ { class: "gitConfig", reason: "operator authorized" } ] }
      }
    }
  }, ({ projectDir, decide }) => {
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: "/home/user/.gitconfig",
      file_path: "/home/user/.gitconfig",
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.notStrictEqual(r.floorFired, "ambient-authority", "class-only opt-in must permit gitConfig");
  });
});

test("pathPrefix opt-in MATCH permits the floor", () => {
  withSandbox({
    contract: {
      version: 3,
      contractId: "hap-20260101-00000000a002",
      revision: 1,
      acceptedAt: "2026-01-01T00:00:00Z",
      harnessScope: ["claude"],
      trustPosture: "balanced",
      scopes: {
        payloadClasses: { A: "allow", B: "warn", C: "block" },
        ambient: { allow: [ { class: "credentialHelper", pathPrefix: "/home/user/.aws/" } ] }
      }
    }
  }, ({ projectDir, decide }) => {
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: "/home/user/.aws/credentials",
      file_path: "/home/user/.aws/credentials",
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.notStrictEqual(r.floorFired, "ambient-authority", "pathPrefix match must permit");
  });
});

test("pathPrefix opt-in MISMATCH still fires the floor", () => {
  withSandbox({
    contract: {
      version: 3,
      contractId: "hap-20260101-00000000a003",
      revision: 1,
      acceptedAt: "2026-01-01T00:00:00Z",
      harnessScope: ["claude"],
      trustPosture: "balanced",
      scopes: {
        payloadClasses: { A: "allow", B: "warn", C: "block" },
        ambient: { allow: [ { class: "credentialHelper", pathPrefix: "/home/user/.other/" } ] }
      }
    }
  }, ({ projectDir, decide }) => {
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: "/home/user/.aws/credentials",
      file_path: "/home/user/.aws/credentials",
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.strictEqual(r.floorFired, "ambient-authority");
    assert.strictEqual(r.ambientClass, "credentialHelper");
  });
});

test("pathPrefix opt-in does NOT cross class boundaries", () => {
  // class=credentialHelper opt-in must not allow a class=ssh hit, even with a
  // pathPrefix that would otherwise match.
  withSandbox({
    contract: {
      version: 3,
      contractId: "hap-20260101-00000000a004",
      revision: 1,
      acceptedAt: "2026-01-01T00:00:00Z",
      harnessScope: ["claude"],
      trustPosture: "balanced",
      scopes: {
        payloadClasses: { A: "allow", B: "warn", C: "block" },
        ambient: { allow: [ { class: "credentialHelper", pathPrefix: "/home/user/" } ] }
      }
    }
  }, ({ projectDir, decide }) => {
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: "/home/user/.ssh/authorized_keys",
      file_path: "/home/user/.ssh/authorized_keys",
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.strictEqual(r.floorFired, "ambient-authority");
    assert.strictEqual(r.ambientClass, "ssh");
  });
});

// ---------------------------------------------------------------------------
// Lattice ordering: F15 (rung 17) wins over F16 (rung 17.5)
// ---------------------------------------------------------------------------

test("F15 envelope divergence fires BEFORE F16 (lattice ordering integrity)", () => {
  withSandbox({}, ({ projectDir, decide }) => {
    const target = "/home/user/.ssh/authorized_keys"; // would otherwise fire F16
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
      envelope: {
        hash: "sha256:envelope-hash-A",
        command: "",
        tool: "Write",
        cwd: projectDir,
        harness: "claude",
        version: 1,
      },
      observedEnvelope: {
        hash: "sha256:envelope-hash-B",
        command: "",
        tool: "Write",
        cwd: projectDir,
        harness: "claude",
        version: 1,
      },
    });
    assert.strictEqual(r.action, "block");
    assert.strictEqual(r.floorFired, "execution-envelope",
      `when F15 and F16 would both fire, F15 (rung 17) wins over F16 (rung 17.5); got floorFired=${r.floorFired}`);
    assert.strictEqual(r.decisionSource, "execution-envelope-diverged");
  });
});

// ---------------------------------------------------------------------------
// Receipt enrichment: ambientClass field present on F16 fire only
// ---------------------------------------------------------------------------

test("F16 receipt contains ambientClass field on fire", () => {
  withSandbox({}, ({ projectDir, decide }) => {
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: "/home/user/.gitconfig",
      file_path: "/home/user/.gitconfig",
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.strictEqual(typeof r.ambientClass, "string", "ambientClass must be a string on F16 fire");
    assert.strictEqual(r.ambientClass, "gitConfig");
    assert.strictEqual(typeof r.ambientPath, "string", "ambientPath must be present on F16 fire");
  });
});

test("non-F16 decisions do NOT carry the ambientClass field", () => {
  // PR-B explicitly scopes ambientClass to F16-fire branches; PR-C will
  // generalize. Assert the field is absent on an allow.
  withSandbox({}, ({ projectDir, decide }) => {
    const target = path.join(projectDir, "README.md");
    const r = decide({
      tool: "Write",
      harness: "claude",
      targetPath: target,
      file_path: target,
      projectRoot: projectDir,
      branch: "feature/test",
    });
    assert.strictEqual(r.ambientClass, undefined,
      `ambientClass must be undefined on non-F16 decisions; got ${JSON.stringify(r.ambientClass)}`);
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
