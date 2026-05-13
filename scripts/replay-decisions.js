#!/usr/bin/env node
"use strict";

// replay-decisions.js — HAP ADR-007 PR-D replay gate.
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
// Determinism is enforced by isolating each call: fresh HORUS_STATE_DIR,
// session-context cache reset, contract disabled, branch override stripped.
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
  process.env.HORUS_STATE_DIR = stateDir;

  let actual;
  try {
    const ir = buildIr(e.input, { harness: "claude", cwd: "/test/cwd", tool: e.input.tool });
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
