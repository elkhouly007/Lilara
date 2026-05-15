#!/usr/bin/env node
"use strict";

// output-exfil.test.js — ADR-010 PR-α tests for runtime/output-exfil.js +
// F19 wiring in runtime/decision-engine.js.
//
// Covers (per the PR brief):
//   - 6+ classifyOutput cases across each F19 pattern class (positive + negative)
//   - 3+ engine integration cases:
//       * PostToolUse observable channel → confirmed → block
//       * PreToolUse on a not-observed channel → compensating require-review
//       * PreToolUse on observable channel with suspicious match + operator
//         token → demoted to allow
//   - 1 idempotency case: identical content → identical decision hash
//   - The lattice-receipt fixture is shipped separately so the
//     check-lattice-receipts.sh harness picks it up.
//
// Per-test sandbox: HORUS_STATE_DIR is isolated, contract loader disabled,
// runtime/* require cache cleared before each engine call so lazy caches
// (contract, taint, session-context) start fresh — same pattern as
// ambient-floor.test.js.
//
// Run:  node tests/runtime/output-exfil.test.js

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");
const crypto = require("node:crypto");

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

function withSandbox(opts, body) {
  const o = opts || {};
  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f19t-st-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f19t-pr-"));
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
    process.env.HORUS_CONTRACT_ENABLED = "0";
    process.env.HORUS_DECISION_JOURNAL = "1";
    process.env.HORUS_RATE_LIMIT       = "0";
    delete process.env.HORUS_KILL_SWITCH;
    delete process.env.HORUS_CONTRACT_REQUIRED;
    delete process.env.HORUS_F4_DEMOTE_TOKEN;
    delete process.env.HORUS_F19_DEMOTE_TOKEN;
    delete process.env.HORUS_IR_JOURNAL;

    if (o.env) {
      for (const [k, v] of Object.entries(o.env)) process.env[k] = String(v);
    }

    // Reset runtime/* module cache so engine + classifier start pristine.
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(ROOT, "runtime") + path.sep)) {
        delete require.cache[key];
      }
    }
    const oe       = require(path.join(ROOT, "runtime", "output-exfil"));
    const engine   = require(path.join(ROOT, "runtime", "decision-engine"));
    const contract = require(path.join(ROOT, "runtime", "contract"));

    body({ projectDir, stateDir, oe, decide: engine.decide, contract });
  } finally {
    restoreEnv();
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// classifyOutput — pattern-class coverage (positive + negative)
// ---------------------------------------------------------------------------

test("classifyOutput: empty input → severity null", () => {
  withSandbox({}, ({ oe }) => {
    const r = oe.classifyOutput("");
    assert.strictEqual(r.severity, null);
    assert.deepStrictEqual(r.matches, []);
    assert.strictEqual(r.redactedSample, "");
  });
});

test("classifyOutput: SSH private key header → confirmed", () => {
  withSandbox({}, ({ oe }) => {
    const r = oe.classifyOutput("-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA");
    assert.strictEqual(r.severity, "confirmed");
    const cls = r.matches.map((m) => m.class);
    assert.ok(cls.indexOf("ssh-private-key") !== -1, `expected ssh-private-key in ${cls}`);
    assert.ok(r.redactedSample.indexOf("REDACTED") !== -1, "redactedSample must mask");
  });
});

test("classifyOutput: AWS access key id → confirmed", () => {
  withSandbox({}, ({ oe }) => {
    const r = oe.classifyOutput("aws-cred AKIAIOSFODNN7EXAMPLE foo");
    assert.strictEqual(r.severity, "confirmed");
    assert.ok(r.matches.some((m) => m.class === "aws-access-key-id"));
  });
});

test("classifyOutput: GitHub PAT → confirmed", () => {
  withSandbox({}, ({ oe }) => {
    const r = oe.classifyOutput("Token: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert.strictEqual(r.severity, "confirmed");
    assert.ok(r.matches.some((m) => m.class === "github-pat"));
  });
});

test("classifyOutput: OpenAI sk- key → confirmed", () => {
  withSandbox({}, ({ oe }) => {
    const r = oe.classifyOutput("API: sk-abc123def456ghi789jkl012mno");
    assert.strictEqual(r.severity, "confirmed");
    assert.ok(r.matches.some((m) => m.class === "openai-api-key"));
  });
});

test("classifyOutput: 32+ hex string → suspicious only", () => {
  withSandbox({}, ({ oe }) => {
    const r = oe.classifyOutput("build hash a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 done");
    assert.strictEqual(r.severity, "suspicious");
    assert.ok(r.matches.some((m) => m.class === "high-entropy-hex"));
    // Make sure nothing got upgraded to confirmed by accident.
    assert.ok(!r.matches.some((m) => m.severity === "confirmed"));
  });
});

test("classifyOutput: plain English log line → severity null (negative)", () => {
  withSandbox({}, ({ oe }) => {
    const r = oe.classifyOutput("npm run build completed successfully in 2.4s");
    assert.strictEqual(r.severity, null);
    assert.deepStrictEqual(r.matches, []);
  });
});

test("classifyOutput: short hex (<32) is NOT flagged (negative)", () => {
  withSandbox({}, ({ oe }) => {
    const r = oe.classifyOutput("color #deadbeef short hex 0123abcd");
    assert.strictEqual(r.severity, null);
  });
});

test("classifyOutput: redactedSample is bounded ≤32 chars and masked", () => {
  withSandbox({}, ({ oe }) => {
    const long = "X".repeat(60) + " sk-aaaaaaaaaaaaaaaaaaaaaaa " + "Y".repeat(60);
    const r = oe.classifyOutput(long);
    assert.ok(r.redactedSample.length <= 32, `len=${r.redactedSample.length}`);
    assert.ok(r.redactedSample.indexOf("sk-") === -1, "raw secret must not leak into sample");
  });
});

// ---------------------------------------------------------------------------
// Engine integration: F19 wired into decide()
// ---------------------------------------------------------------------------

test("engine: PostToolUse observable channel + confirmed → block + receipt fields", () => {
  withSandbox({}, ({ decide, projectDir }) => {
    const r = decide({
      tool: "Bash",
      harness: "claude",
      command: "echo done",
      projectRoot: projectDir,
      branch: "feature/f19",
      outputs: [{
        channel: "stdout",
        content: "leak: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa rest",
        sizeBytes: 50,
        truncated: false,
        observedBy: "post-adapter",
      }],
      outputChannelObservability: { stdout: "observed" },
    });
    assert.strictEqual(r.action, "block");
    assert.strictEqual(r.floorFired, "output-channel-exfiltration");
    assert.strictEqual(r.decisionSource, "output-exfil-denied");
    assert.strictEqual(r.outputChannel, "stdout");
    assert.ok(Array.isArray(r.matchClasses) && r.matchClasses.indexOf("github-pat") !== -1);
    assert.ok(typeof r.redactedSample === "string" && r.redactedSample.length > 0);
    assert.strictEqual(r.compensatingRestrictionApplied, false);
  });
});

test("engine: PreToolUse on not-observed channel + clean content → compensating require-review", () => {
  withSandbox({}, ({ decide, projectDir }) => {
    const r = decide({
      tool: "Bash",
      harness: "codex",
      command: "gh pr create",
      projectRoot: projectDir,
      branch: "feature/f19",
      declaredOutput: [{
        channel: "prText",
        content: "ship it: tests pass and docs updated",
        sizeBytes: 36,
      }],
      outputChannelObservability: { prText: "not-observed" },
      outputChannelCompensations: { prText: "Codex prText not verified" },
    });
    assert.strictEqual(r.action, "require-review");
    assert.strictEqual(r.floorFired, "output-channel-exfiltration");
    assert.strictEqual(r.decisionSource, "output-exfil-denied");
    assert.strictEqual(r.outputChannel, "prText");
    assert.strictEqual(r.compensatingRestrictionApplied, true);
  });
});

test("engine: PreToolUse observable channel + suspicious + operator-token → demoted to allow", () => {
  withSandbox({}, ({ decide, contract, projectDir }) => {
    const token = contract.mintOperatorToken("test-f19-suspicious", "output-exfil-review-demote");
    process.env.HORUS_F19_DEMOTE_TOKEN = token;
    const r = decide({
      tool: "Bash",
      harness: "claude",
      command: "echo build done",
      projectRoot: projectDir,
      branch: "feature/f19",
      declaredOutput: [{
        channel: "commitMessage",
        content: "release sha a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
        sizeBytes: 50,
      }],
      outputChannelObservability: { commitMessage: "observed" },
    });
    delete process.env.HORUS_F19_DEMOTE_TOKEN;
    assert.strictEqual(r.action, "allow");
    assert.strictEqual(r.decisionSource, "f19-demoted");
    assert.strictEqual(r.outputChannel, "commitMessage");
    // matchClasses should still surface for audit even after demotion.
    assert.ok(Array.isArray(r.matchClasses) && r.matchClasses.indexOf("high-entropy-hex") !== -1);
  });
});

test("engine: suspicious + NO token → require-review (token consumption gate)", () => {
  withSandbox({}, ({ decide, projectDir }) => {
    const r = decide({
      tool: "Bash",
      harness: "claude",
      command: "echo build done",
      projectRoot: projectDir,
      branch: "feature/f19",
      declaredOutput: [{
        channel: "commitMessage",
        content: "release sha a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
        sizeBytes: 50,
      }],
      outputChannelObservability: { commitMessage: "observed" },
    });
    assert.strictEqual(r.action, "require-review");
    assert.strictEqual(r.floorFired, "output-channel-exfiltration");
    assert.strictEqual(r.decisionSource, "output-exfil-denied");
  });
});

test("engine: confirmed match is NOT demotable even with operator token", () => {
  // F19 lattice entry's demotableBy lists `operator-token-suspicious-only` —
  // the engine gates token consumption on severity, so a confirmed match
  // ignores any token presented.
  withSandbox({}, ({ decide, contract, projectDir }) => {
    const token = contract.mintOperatorToken("test-f19-confirmed", "output-exfil-review-demote");
    process.env.HORUS_F19_DEMOTE_TOKEN = token;
    const r = decide({
      tool: "Bash",
      harness: "claude",
      command: "echo done",
      projectRoot: projectDir,
      branch: "feature/f19",
      outputs: [{
        channel: "stdout",
        content: "leak ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa end",
        sizeBytes: 50,
      }],
      outputChannelObservability: { stdout: "observed" },
    });
    delete process.env.HORUS_F19_DEMOTE_TOKEN;
    assert.strictEqual(r.action, "block",
      `confirmed-severity F19 must stay block with an operator token; got ${r.action}`);
    assert.strictEqual(r.floorFired, "output-channel-exfiltration");
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test("idempotency: identical content → identical decision hash", () => {
  withSandbox({}, ({ oe }) => {
    const payload = "leak ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa tail";
    const r1 = oe.classifyOutput(payload);
    const r2 = oe.classifyOutput(payload);
    const h1 = "sha256:" + crypto.createHash("sha256").update(canonicalJson(r1)).digest("hex");
    const h2 = "sha256:" + crypto.createHash("sha256").update(canonicalJson(r2)).digest("hex");
    assert.strictEqual(h1, h2, "classifyOutput must be byte-stable for identical input");
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
