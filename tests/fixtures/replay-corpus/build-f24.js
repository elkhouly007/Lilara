#!/usr/bin/env node
"use strict";

// build-f24.js — F24 credential-persistence-write replay fixture generator.
// Generates f24-credential-persistence.jsonl in the same directory.
//
// Usage: node tests/fixtures/replay-corpus/build-f24.js [--out path]
//
// All paths are in-project (under PR) so F16 (ambient-authority, rung 17.5)
// does not preempt. F16 blocks out-of-project ambient paths; F24's unique
// coverage is in-project credential/persistence targets F16 deliberately skips.

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");

let outPath = path.join(__dirname, "f24-credential-persistence.jsonl");
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--out") outPath = path.resolve(process.argv[++i]);
  else if (a.startsWith("--out=")) outPath = path.resolve(a.slice(6));
}

process.env.LILARA_CONTRACT_ENABLED    = "0";
process.env.LILARA_TRAJECTORY_WINDOW_MIN = "0";
process.env.LILARA_RATE_LIMIT          = "0";
delete process.env.LILARA_KILL_SWITCH;
delete process.env.LILARA_CONTRACT_REQUIRED;
delete process.env.LILARA_F4_DEMOTE_TOKEN;
process.env.LILARA_BRANCH_OVERRIDE = "replay/isolated-context";

const { decide } = require(path.join(root, "runtime", "decision-engine"));
const { build: buildIr } = require(path.join(root, "runtime", "action-ir"));
const { resetCache } = require(path.join(root, "runtime", "session-context"));

// Synthetic in-project root — stable string anchor for flat-path fallbacks.
const PR = "/tmp/horus-f24-replay-projectroot";

const CASES = [
  // 1) Execution-persistence: .git/hooks — not an ambient class, F16 skips.
  { tag: "f24:persistence:git-hooks-pre-commit",
    intent: "Write to in-project .git/hooks/pre-commit fires F24 (persistence) — .git/hooks is nonAmbient so F16 skips",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/.git/hooks/pre-commit",
             file_path:  PR + "/.git/hooks/pre-commit" } },

  // 2) High-sensitivity: private-key in deploy dir — nonAmbient, F24 fires.
  { tag: "f24:high-sensitivity:deploy-private-key-pem",
    intent: "Write to in-project deploy/private-key.pem fires F24 (high-sensitivity) — nonAmbient path, private[-_]?key regex",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/deploy/private-key.pem",
             file_path:  PR + "/deploy/private-key.pem" } },

  // 3) High-sensitivity: vault directory — nonAmbient, F24 fires.
  { tag: "f24:high-sensitivity:vault-secret-json",
    intent: "Write to in-project vault/secret.json fires F24 (high-sensitivity) — /vault/ segment match",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/vault/secret.json",
             file_path:  PR + "/vault/secret.json" } },

  // 4) High-sensitivity: payments — nonAmbient, F24 fires.
  { tag: "f24:high-sensitivity:payments-key-json",
    intent: "Write to in-project payments/key.json fires F24 (high-sensitivity) — /payments/ segment match",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/payments/key.json",
             file_path:  PR + "/payments/key.json" } },
];

function isolatedDecide(input, contractOverride) {
  resetCache();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f24-"));
  process.env.LILARA_STATE_DIR = stateDir;
  const origContractEnabled = process.env.LILARA_CONTRACT_ENABLED;
  if (contractOverride) {
    process.env.LILARA_CONTRACT_ENABLED = "1";
  }
  try {
    const ir = buildIr(input, { harness: "claude", tool: input.tool });
    const decideInput = contractOverride ? { ...input, contract: contractOverride } : input;
    const result = decide(decideInput);
    return {
      action: result.action,
      decisionSource: result.decisionSource,
      floorFired: result.floorFired || null,
      irHash: ir.irHash || null,
    };
  } finally {
    process.env.LILARA_CONTRACT_ENABLED = origContractEnabled;
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const lines = [];
for (const c of CASES) {
  const { tag, intent, input } = c;
  const expected = isolatedDecide(input);
  lines.push(JSON.stringify({ tag, intent, input, expected }));
}

fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} F24 entries to ${path.relative(root, outPath)}`);
