#!/usr/bin/env node
"use strict";

// replay-decisions.js — Lilara ADR-007 PR-D replay gate.
//
// Replays a corpus or journal of decisions against the current engine and
// asserts that `action`, `decisionSource`, `floorFired`, and `irHash` are
// byte-identical to the recorded values.
//
// Two input shapes are supported:
//
//   1) Replay-corpus JSONL (tests/fixtures/replay-corpus/*.jsonl):
//        { "tag": "...", "input": { ... }, "expected": { action, decisionSource, floorFired, irHash } }
//
//   2) Decision-journal JSONL (artifacts/journal/sample-journal.jsonl):
//        { "kind": "runtime-decision", "action": "...", "source": "...",
//          "tool": "...", "command": "...", "branch": "...", ... }
//      In journal mode `decisionSource` is read from `source`, `floorFired` /
//      `irHash` are optional and only checked when present.
//
// Determinism is enforced by isolating each call: fresh LILARA_STATE_DIR,
// session-context cache reset, contract disabled, and LILARA_BRANCH_OVERRIDE
// pinned to a synthetic non-protected sentinel so entries with empty/missing
// `branch` do not inherit the cwd's git branch via context-discovery's
// `git symbolic-ref` fallback (which would let a master-checkout CI drift
// adversarial boundary entries into the protected-branch lane).
//
// Usage:
//   node scripts/replay-decisions.js [--corpus path.jsonl] [--journal path.jsonl]
//                                    [--max N] [--quiet]
//
// Exit 0 = all entries match (or skipped). Exit 1 = drift detected.

const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");

let corpusPath = path.join(root, "tests", "fixtures", "replay-corpus", "corpus.jsonl");
let journalPath = null;
let maxEntries = Infinity;
let quiet = false;

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--corpus")        { corpusPath = path.resolve(process.argv[++i]); }
  else if (a.startsWith("--corpus="))  { corpusPath = path.resolve(a.slice("--corpus=".length)); }
  else if (a === "--journal")  { journalPath = path.resolve(process.argv[++i]); corpusPath = null; }
  else if (a.startsWith("--journal=")) { journalPath = path.resolve(a.slice("--journal=".length)); corpusPath = null; }
  else if (a === "--max")      { maxEntries = Number(process.argv[++i]) || Infinity; }
  else if (a.startsWith("--max=")) { maxEntries = Number(a.slice("--max=".length)) || Infinity; }
  else if (a === "--quiet")    { quiet = true; }
  else if (a === "--help" || a === "-h") {
    process.stdout.write(
      "Usage: replay-decisions.js [--corpus path | --journal path] [--max N] [--quiet]\n"
    );
    process.exit(0);
  } else {
    process.stderr.write(`replay-decisions: unknown flag '${a}'\n`);
    process.exit(2);
  }
}

const file = corpusPath || journalPath;
if (!file) {
  process.stderr.write("replay-decisions: no corpus or journal specified\n");
  process.exit(2);
}
if (!fs.existsSync(file)) {
  // Same convention as check-decision-replay.sh: missing journal is a skip.
  if (journalPath) {
    process.stdout.write(`No journal at ${journalPath} — skipping.\n`);
    process.exit(0);
  }
  process.stderr.write(`replay-decisions: file not found: ${file}\n`);
  process.exit(1);
}

process.env.LILARA_CONTRACT_ENABLED = "0";
process.env.LILARA_TRAJECTORY_WINDOW_MIN = "0";
process.env.LILARA_RATE_LIMIT = "0";
// SCOPE §19 #14 (LOCKED 2026-06-13) — pin the three posture flags explicitly so
// the replay harness is posture-deterministic regardless of the ambient CI env.
// decide() reads these as `=== "1"` to enable; pinning to "0" is the no-op
// (inert-when-off) default. The posture-matrix check (scripts/check-replay-
// posture-matrix.sh) sets LILARA_REPLAY_RESPECT_POSTURE=1 to opt out of this
// pin so it can verify that enabling each flag individually produces no
// drift in the shipped corpus — so a future default flip is caught before
// it can silently break byte-identical replay.
if (!process.env.LILARA_REPLAY_RESPECT_POSTURE) {
  process.env.LILARA_TAINT_EGRESS = "0";
  process.env.LILARA_DELETE_COORD = "0";
  process.env.LILARA_KILL_CHAIN_ENFORCE = "0";
  // PR-A (F27 inert gate): pin consent flag off so the shipped corpus stays
  // byte-identical under default posture. The posture-matrix gate (check-replay-
  // posture-matrix.sh) sets LILARA_REPLAY_RESPECT_POSTURE=1 to opt out of this
  // pin and verify the F27_CONSENT posture surface across all 16 combinations.
  process.env.LILARA_F27_CONSENT = "0";
}
delete process.env.LILARA_KILL_SWITCH;
delete process.env.LILARA_CONTRACT_REQUIRED;
delete process.env.LILARA_F4_DEMOTE_TOKEN;
// Pin a synthetic non-protected sentinel so entries with empty/missing
// `branch` do not pick up the CI checkout's actual branch via
// context-discovery's `git symbolic-ref` fallback. Explicit input.branch on
// any entry still wins inside discover(); only the empty/missing case is
// covered. Sentinel intentionally not in the default protectedBranches list
// ("main","master") so the engine does not auto-escalate to protected-branch
// review semantics. IR.branch comes from input only — sentinel does not enter
// the canonical IR, so irHash stays byte-stable.
process.env.LILARA_BRANCH_OVERRIDE = "replay/isolated-context";

// PR-B (F27 consent calibration): the consent-family corpora
// (secret-egress-consent*.jsonl) record the INTERACTIVE consent path
// (escalate / secret-egress-consent-required), which the engine only takes
// when a controlling TTY is present (decision-engine.js reads
// process.stdout.isTTY || process.stderr.isTTY). CI/replay is headless, so the
// engine would fail closed to a no-tty block and the recorded flag-on outputs
// could never be reproduced. LILARA_REPLAY_FORCE_TTY=1 opts into TTY emulation
// so the posture-matrix gate can replay the flag-on corpus byte-identically —
// mirroring the corpus generator
// (tests/fixtures/replay-corpus/build-secret-egress-consent-adversarial.js).
// Harness-only: the decision engine is UNCHANGED; this only sets the same
// isTTY booleans a real interactive terminal would present.
if (process.env.LILARA_REPLAY_FORCE_TTY === "1") {
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
}

const { decide } = require(path.join(root, "runtime", "decision-engine"));
const { build: buildIr } = require(path.join(root, "runtime", "action-ir"));
const { resetCache } = require(path.join(root, "runtime", "session-context"));

function parseLines(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push({ lineNo: i + 1, value: JSON.parse(line) });
    } catch (err) {
      process.stderr.write(`  WARN  line ${i + 1}: parse error (${err.message}) — skipping\n`);
    }
  }
  return out;
}

// Normalize a journal entry to corpus shape so the comparison path is shared.
function journalToCorpus(entry) {
  // Skip non-decision entries (e.g. taint-floor-disabled telemetry rows).
  if (entry.kind && entry.kind !== "runtime-decision") return null;

  const input = {
    tool:         entry.tool        || "Bash",
    command:      entry.command     || "",
    targetPath:   entry.targetPath  || "",
    branch:       entry.branch      || "",
    payloadClass: entry.payloadClass || "A",
  };
  // Empty strings would shadow projectPolicy defaults via the engine's
  // `Object.fromEntries(... filter v !== "" && v != null)` merge, so drop them.
  for (const k of Object.keys(input)) {
    if (input[k] === "" || input[k] == null) delete input[k];
  }
  const expected = {
    action: entry.action,
    decisionSource: entry.source || entry.decisionSource,
    floorFired: entry.floorFired || null,
    irHash: entry.irHash || null,
  };
  return { tag: entry.tag || `journal:${entry.command || "?"}`.slice(0, 80), input, expected };
}

const raw = fs.readFileSync(file, "utf8");
let entries = parseLines(raw).map((e) => e.value);

if (journalPath) {
  entries = entries.map(journalToCorpus).filter(Boolean);
}

if (entries.length > maxEntries) entries = entries.slice(-maxEntries);

if (entries.length === 0) {
  process.stdout.write(`No replay entries in ${path.relative(root, file)} — nothing to do.\n`);
  process.exit(0);
}

let drift = 0;
let replayed = 0;
const driftDetails = [];

for (const e of entries) {
  if (!e || !e.input || !e.expected) continue;
  replayed++;
  resetCache();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-replay-"));
  process.env.LILARA_STATE_DIR = stateDir;

  let actual;
  try {
    // Intentionally omit ctx.cwd: action-ir.js does path.resolve(cwd), which is
    // platform-specific (POSIX "/test/cwd" vs. Windows "C:\\test\\cwd"), so the
    // canonical IR hash would drift across OSes. With cwd unset, ir.cwd is null
    // and fileTargets[].path stays as the raw extracted token (no path.resolve),
    // which is byte-identical on Linux / macOS / Windows. Real production calls
    // still pass a real cwd; only the replay corpus path is cwd-less.
    const ir = buildIr(e.input, { harness: "claude", tool: e.input.tool });
    const result = decide(e.input);
    actual = {
      action: result.action,
      decisionSource: result.decisionSource,
      floorFired: result.floorFired || null,
      irHash: ir.irHash || null,
    };
  } catch (err) {
    drift++;
    driftDetails.push({ tag: e.tag, error: err.message });
    continue;
  } finally {
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  const diffs = [];
  if (actual.action !== e.expected.action) {
    diffs.push(`action: '${e.expected.action}' → '${actual.action}'`);
  }
  if (
    e.expected.decisionSource != null &&
    actual.decisionSource !== e.expected.decisionSource
  ) {
    diffs.push(`decisionSource: '${e.expected.decisionSource}' → '${actual.decisionSource}'`);
  }
  if (
    e.expected.floorFired != null &&
    actual.floorFired !== e.expected.floorFired
  ) {
    diffs.push(`floorFired: '${e.expected.floorFired}' → '${actual.floorFired}'`);
  }
  if (e.expected.irHash != null && actual.irHash !== e.expected.irHash) {
    diffs.push(`irHash: '${e.expected.irHash}' → '${actual.irHash}'`);
  }

  if (diffs.length > 0) {
    drift++;
    driftDetails.push({ tag: e.tag, diffs });
  }
}

if (drift === 0) {
  if (!quiet) {
    process.stdout.write(
      `replay-decisions: ${replayed} entries OK (no drift) — ${path.relative(root, file)}\n`
    );
  }
  process.exit(0);
}

process.stderr.write(
  `replay-decisions: DRIFT in ${drift}/${replayed} entries — ${path.relative(root, file)}\n`
);
for (const d of driftDetails) {
  process.stderr.write(`  ${d.tag}\n`);
  if (d.error) process.stderr.write(`    error: ${d.error}\n`);
  for (const diff of d.diffs || []) {
    process.stderr.write(`    ${diff}\n`);
  }
}
process.exit(1);
