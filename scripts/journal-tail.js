#!/usr/bin/env node
"use strict";
// journal-tail.js — Read-only pretty-printer for ~/.lilara/decision-journal.jsonl.
//
// Usage (via lilara-cli.sh):
//   lilara-cli journal tail [--tail N] [--notes]
//   lilara-cli journal show [--tail N] [--notes]
//
// Direct:
//   node scripts/journal-tail.js [--tail N] [--notes]
//
// Prints the last N decisions (default 20) from the decision journal in a
// human-readable one-line-per-decision format. Read-only: never calls append().
// Respects LILARA_STATE_DIR. Zero external dependencies (stdlib: fs/path/os).
//
// Journal is redacted at write time (decision-journal.js:116-117 runs targetPath/
// notes through clean() on redact=true entries). This reader prints fields verbatim
// — no re-derivation, no un-redaction. The schema contains no raw command/payload
// fields (see decision-journal.js:107-154), so there is nothing to leak.
//
// --follow / -f: reserved, not yet implemented. Deferred because fs.watch behavior
// on MINGW64/Windows is unreliable and the 5 MB rotation boundary introduces
// offset-reset complexity. The flag name is reserved for forward-compatibility.

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ---------------------------------------------------------------------------
// State dir — mirrors state-paths.js stateDir()
// ---------------------------------------------------------------------------
function stateDir() {
  return process.env.LILARA_STATE_DIR
    ? path.resolve(process.env.LILARA_STATE_DIR)
    : path.join(os.homedir(), ".lilara");
}

// ---------------------------------------------------------------------------
// Colors: TTY-only, NO_COLOR-aware (matches repo $RED/$RESET discipline)
// ---------------------------------------------------------------------------
const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const C = {
  reset:   USE_COLOR ? "\x1b[0m"  : "",
  dim:     USE_COLOR ? "\x1b[2m"  : "",
  red:     USE_COLOR ? "\x1b[31m" : "",
  green:   USE_COLOR ? "\x1b[32m" : "",
  yellow:  USE_COLOR ? "\x1b[33m" : "",
  cyan:    USE_COLOR ? "\x1b[36m" : "",
};

function colorAction(action) {
  switch (action) {
    case "block":          return C.red    + action + C.reset;
    case "require-review": return C.yellow + action + C.reset;
    case "observe":        return C.cyan   + action + C.reset;
    case "allow":          return C.green  + action + C.reset;
    default:               return C.dim    + action + C.reset;
  }
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
let tailN     = 20;
let showNotes = false;

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--tail" || a === "-n") {
    tailN = Math.max(1, Number(process.argv[++i]) || 20);
  } else if (a.startsWith("--tail=")) {
    tailN = Math.max(1, Number(a.slice(7)) || 20);
  } else if (a === "--notes") {
    showNotes = true;
  } else if (a === "-f" || a === "--follow") {
    process.stderr.write(
      "journal tail --follow: not yet implemented.\n" +
      "  To stream new entries manually: tail -f " + path.join(stateDir(), "decision-journal.jsonl") + "\n"
    );
    process.exit(2);
  } else if (a === "-h" || a === "--help") {
    process.stdout.write(
      "Usage: lilara-cli journal tail [--tail N] [--notes]\n\n" +
      "  --tail N, -n N   Show last N decisions (default 20)\n" +
      "  --notes          Also print the 'notes' field (omitted by default)\n" +
      "  -f, --follow     Reserved — not yet implemented\n\n" +
      "Reads: " + path.join(stateDir(), "decision-journal.jsonl") + "\n" +
      "(or LILARA_STATE_DIR/decision-journal.jsonl)\n\n" +
      "Read-only. Never modifies the journal.\n" +
      "See also: lilara-cli journal verify  (tamper-evident chain integrity check)\n" +
      "          lilara-cli dashboard       (HTTP observability dashboard)\n"
    );
    process.exit(0);
  }
  // Ignore unknown flags silently so future flags don't break old wrappers.
}

// ---------------------------------------------------------------------------
// Read journal
// ---------------------------------------------------------------------------
const journalPath = path.join(stateDir(), "decision-journal.jsonl");

let raw;
try {
  raw = fs.readFileSync(journalPath, "utf8");
} catch (err) {
  if (err.code === "ENOENT") {
    process.stdout.write("no journal yet at " + journalPath + "\n");
    process.exit(0);
  }
  process.stderr.write("error reading journal: " + err.message + "\n");
  process.exit(1);
}

// Parse: skip malformed lines silently (mirrors receipts validate behavior)
const entries = [];
for (const line of raw.split("\n")) {
  if (!line.trim()) continue;
  try {
    entries.push(JSON.parse(line));
  } catch { /* skip malformed — do not fail on partial write mid-rotation */ }
}

const slice = entries.slice(-tailN);

if (entries.length === 0) {
  process.stdout.write("journal is empty at " + journalPath + "\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Pretty-print
// ---------------------------------------------------------------------------
// Extract HH:MM:SS from ISO 8601 timestamp (e.g. "2026-06-03T14:22:01.000Z")
function hms(ts) {
  const m = String(ts || "").match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : "??:??:??";
}

// Right-pad to width with spaces (color codes do not affect padding since
// they are added after pad() — the raw string is padded first).
function pad(s, n) {
  return String(s || "").padEnd(n);
}

// Column widths (chosen to cover the longest realistic values):
//   action:   "require-review" = 14
//   floorFired: "credential-persistence-write" = 28, pad to 30
const W_ACTION = 14;
const W_FLOOR  = 30;
const W_TOOL   = 16; // "tool=" + 11 chars of tool name

process.stdout.write(
  C.dim +
  "# journal: " + journalPath + "\n" +
  "# showing last " + slice.length + " of " + entries.length + " entries\n" +
  C.reset
);

for (const e of slice) {
  const time    = hms(e.ts);
  const rawAct  = pad(e.action || "unknown", W_ACTION);
  const action  = colorAction(rawAct);
  const floor   = pad(e.floorFired || "-", W_FLOOR);
  const toolRaw = "tool=" + (e.tool || "-");
  const tool    = pad(toolRaw, W_TOOL);
  const lvl     = (e.riskLevel || "?").slice(0, 8);
  const scr     = Number.isFinite(e.riskScore) ? e.riskScore.toFixed(1) : "?";
  const risk    = "risk=" + lvl + "/" + scr;
  const codes   = "[" + (Array.isArray(e.reasonCodes) ? e.reasonCodes.join(",") : "") + "]";
  const target  = e.targetPath ? "-> " + e.targetPath : "-> (none)";

  let out = time + "  " + action + "  " + floor + "  " + tool + "  " + risk + "  " + codes + "  " + target;
  if (showNotes && e.notes) out += "  notes=" + e.notes;
  process.stdout.write(out + "\n");
}
