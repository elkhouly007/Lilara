#!/usr/bin/env node
"use strict";

// build-adversarial.js — one-shot generator for the IR/replay-focused
// adversarial seed corpus (HAP ADR-007 PR-D).
//
// Scope: stress-test the IR builder + replay path against inputs that try to
// bend the gate via shapes the decision engine has historically missed. These
// are *replay-stability* and *IR-determinism* probes — not duplicates of the
// broader command-normalize / unicode adversarial corpora that landed in
// ADR-008. Coverage goals:
//
//   1. cosmetic insensitivity:    same logical action via different aliases /
//                                 whitespace must hit the same enforcement rung.
//   2. encoding/normalization:    NFKD + confusables fold must still trip F3.
//   3. nested-payload extraction: ADR-008 §4.2 alias chain must reach `command`.
//   4. type/shape resilience:     numeric, null, array-shaped inputs must not
//                                 throw and must default-deny gracefully.
//   5. boundary IR fields:        empty strings vs. missing keys must converge.
//
// Lives under tests/fixtures/ rather than scripts/ on purpose: CASES holds
// synthetic risky literals (rm --no-preserve-root, NFKD-folded rm, nested
// tool_input.command) used solely to drive the IR/replay probes;
// scripts/audit-local.sh treats those literals as gate-failing when they
// appear under top-level scripts/ but does not scan tests/fixtures/.
//
// Re-run when adversarial design changes. The replay gate
// (scripts/replay-decisions.js) asserts these decisions stay byte-identical.
//
// Usage: node tests/fixtures/replay-corpus/build-adversarial.js [--out path]

const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");

let outPath = path.join(__dirname, "adversarial.jsonl");
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--out") outPath = path.resolve(process.argv[++i]);
  else if (a.startsWith("--out=")) outPath = path.resolve(a.slice(6));
}

process.env.HORUS_CONTRACT_ENABLED = "0";
process.env.HORUS_TRAJECTORY_WINDOW_MIN = "0";
process.env.HORUS_RATE_LIMIT = "0";
delete process.env.HORUS_KILL_SWITCH;
delete process.env.HORUS_CONTRACT_REQUIRED;
delete process.env.HORUS_BRANCH_OVERRIDE;
delete process.env.HORUS_F4_DEMOTE_TOKEN;

const { decide } = require(path.join(root, "runtime", "decision-engine"));
const { build: buildIr } = require(path.join(root, "runtime", "action-ir"));
const { resetCache } = require(path.join(root, "runtime", "session-context"));

// Adversarial cases — each must replay byte-identically on every run.
// rationale stays in the tag for human review; no comment fields in JSONL.
const CASES = [
  // 1) cosmetic insensitivity: whitespace + arg-order variants of a critical action.
  { tag: "adv:critical-rm-no-preserve-canonical",
    tool: "Bash", command: "rm --no-preserve-root -rf /", branch: "feature/test" },
  { tag: "adv:critical-rm-no-preserve-extra-space",
    tool: "Bash", command: "rm   --no-preserve-root   -rf   /", branch: "feature/test" },

  // 2) encoding/normalization: Cyrillic 'р' + IPA small-cap fold must still
  //    surface destructive-delete on the normalized path (ADR-008 §2.2).
  { tag: "adv:critical-rm-cyrillic-er",
    tool: "Bash", command: "рm -rf /", branch: "feature/test" },
  { tag: "adv:critical-rm-fullwidth",
    tool: "Bash", command: "ｒｍ -rf /", branch: "feature/test" },

  // 3) nested-payload extraction via ADR-008 §4.2 alias chain.
  //    pretool-gate.js falls back to extractCommand(rawInput) when ctx.command
  //    is empty; the IR builder honours `cmd` and nested `tool_input.command`.
  { tag: "adv:nested-cmd-alias",
    tool: "Bash", cmd: "rm --no-preserve-root -rf /", branch: "feature/test" },
  { tag: "adv:nested-tool-input-command",
    tool: "Bash", tool_input: { command: "rm --no-preserve-root -rf /" }, branch: "feature/test" },
  { tag: "adv:nested-args-tool-input",
    tool: "Bash", args: { tool_input: { command: "rm --no-preserve-root -rf /" } }, branch: "feature/test" },

  // 4) type/shape resilience: builder + engine must not throw on odd inputs.
  //    All five default to a non-block action (no critical pattern in the
  //    extracted command) because pretool-gate / IR conservatively pick "".
  { tag: "adv:numeric-command-noop",
    tool: "Bash", command: 12345, branch: "feature/test" },
  { tag: "adv:null-command-noop",
    tool: "Bash", command: null, branch: "feature/test" },
  { tag: "adv:array-command-noop",
    tool: "Bash", command: ["rm", "-rf", "/"], branch: "feature/test" },

  // 5) boundary IR fields: empty branch + missing target must converge to the
  //    same canonical IR shape (no implicit null/"" branching).
  { tag: "adv:empty-strings",
    tool: "Bash", command: "git status", branch: "", targetPath: "" },
  { tag: "adv:missing-optional-fields",
    tool: "Bash", command: "git status" },

  // 6) secret-class-C path stability: pure command-string detection
  //    (no explicit payloadClass) still hits F4 via inline classifier.
  { tag: "adv:secret-pem-inline",
    tool: "Bash", command: "echo '-----BEGIN RSA PRIVATE KEY-----'", branch: "feature/test" },
];

function isolatedDecide(input) {
  resetCache();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-replay-adv-"));
  process.env.HORUS_STATE_DIR = stateDir;
  try {
    const ir = buildIr(input, { harness: "claude", cwd: "/test/cwd", tool: input.tool });
    const result = decide(input);
    return {
      action: result.action,
      decisionSource: result.decisionSource,
      floorFired: result.floorFired || null,
      irHash: ir.irHash || null,
    };
  } finally {
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const lines = [];
for (const c of CASES) {
  const { tag, ...input } = c;
  const expected = isolatedDecide(input);
  lines.push(JSON.stringify({ tag, input, expected }));
}

fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} adversarial entries to ${path.relative(root, outPath)}`);
