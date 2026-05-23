#!/usr/bin/env bash
# eval-decision-quality.sh — Measure runtime.decide() quality against a labeled corpus.
#
# Usage:
#   bash scripts/eval-decision-quality.sh [--corpus PATH] [--max-fp-pct N] [--max-fn-pct N] [--verbose]
#
# Outputs a table of results and a summary:
#   Total / Correct / FP count / FN count / FP% / FN%
#
# Exit codes:
#   0 — all thresholds met
#   1 — FP% or FN% threshold exceeded
#   2 — fatal: node not found or corpus not found
#
# Environment:
#   LILARA_EVAL_MAX_FP_PCT  — max acceptable false-positive percentage (default: 10)
#   LILARA_EVAL_MAX_FN_PCT  — max acceptable false-negative percentage (default: 20)
#   LILARA_DECISION_JOURNAL — set to 0 to suppress journal writes during eval
#   LILARA_STATE_DIR        — set to a temp dir to avoid polluting live state

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
corpus="${root}/tests/eval-corpus.json"
max_fp_pct="${LILARA_EVAL_MAX_FP_PCT:-10}"
max_fn_pct="${LILARA_EVAL_MAX_FN_PCT:-20}"
verbose=0

while [ $# -gt 0 ]; do
  case "$1" in
    --corpus)    shift; corpus="$1" ;;
    --corpus=*)  corpus="${1#--corpus=}" ;;
    --max-fp-pct)   shift; max_fp_pct="$1" ;;
    --max-fp-pct=*) max_fp_pct="${1#--max-fp-pct=}" ;;
    --max-fn-pct)   shift; max_fn_pct="$1" ;;
    --max-fn-pct=*) max_fn_pct="${1#--max-fn-pct=}" ;;
    --verbose|-v) verbose=1 ;;
    *) printf 'Unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

if ! command -v node >/dev/null 2>&1; then
  printf 'Error: node not found on PATH.\n' >&2
  exit 2
fi

if [ ! -f "$corpus" ]; then
  printf 'Error: corpus not found: %s\n' "$corpus" >&2
  exit 2
fi

# Run all eval logic in a single Node.js process to avoid per-entry startup overhead.
# Suppress journal writes and use a temp state dir for isolation.
eval_tmp="$(mktemp -d)"
trap 'rm -r -f "$eval_tmp"' EXIT

LILARA_DECISION_JOURNAL=0 LILARA_STATE_DIR="$eval_tmp" node - "$corpus" "$max_fp_pct" "$max_fn_pct" "$verbose" <<'NODEJS'
"use strict";

const fs = require("fs");
const path = require("path");

const corpusPath = process.argv[2];
const maxFpPct   = Number(process.argv[3]) || 10;
const maxFnPct   = Number(process.argv[4]) || 20;
const verbose    = process.argv[5] === "1";

// Disable trajectory nudge so entries are evaluated in isolation.
// Without this, session risk / recentEscalations from earlier entries contaminate later ones.
process.env.LILARA_TRAJECTORY_THRESHOLD = "9999";

// Locate runtime from script directory (this heredoc runs from the repo root).
// __dirname inside a heredoc stdin is the process cwd, so resolve from argv[2] location.
const corpusDir  = path.dirname(path.resolve(corpusPath));
const repoRoot   = path.resolve(corpusDir, "..");
const decide     = require(path.join(repoRoot, "runtime", "decision-engine")).decide;

const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const entries = corpus.entries || [];

// Map decide() action to one of three broad classes.
function actionClass(action) {
  if (action === "allow") return "allow";
  if (["block", "escalate", "require-review"].includes(action)) return "block";
  // route, modify, require-tests → warn
  return "warn";
}

const RESET  = "\x1b[0m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";

function colorize(s, col) { return process.stdout.isTTY ? col + s + RESET : s; }

let totalSafe      = 0;
let totalDangerous = 0;
let totalBorderline = 0;
let fp = 0; // safe entry → got "block"
let fn = 0; // dangerous entry with expected "block" → got "allow"
let errors = 0;

const rows = [];

for (const entry of entries) {
  let result;
  try {
    const callInput = {
      tool:           entry.tool || "Bash",
      command:        entry.command || "",
      targetPath:     entry.targetPath || "",
      payloadClass:   entry.payloadClass || "A",
      branch:         entry.branch || "",
      protectedBranch: entry.protectedBranch === true,
      // Override in-process session state so entries are independent of eval order.
      sessionRisk:    0,
      repeatedApprovals: 0,
    };
    result = decide(callInput);
  } catch (err) {
    errors++;
    rows.push({ entry, gotClass: "error", pass: false, isFP: false, isFN: false, errorMsg: err.message });
    continue;
  }

  const gotClass = actionClass(result.action);
  const expectedClass = entry.expected_action_class;
  const isFP = entry.label === "safe" && expectedClass === "allow" && gotClass === "block";
  const isFN = entry.label === "dangerous" && expectedClass === "block" && gotClass === "allow";
  const pass = !isFP && !isFN && (gotClass === expectedClass || entry.label === "borderline");

  if (entry.label === "safe") totalSafe++;
  else if (entry.label === "dangerous") totalDangerous++;
  else totalBorderline++;

  if (isFP) fp++;
  if (isFN) fn++;

  rows.push({ entry, result, gotClass, expectedClass, pass, isFP, isFN, errorMsg: null });
}

// Print verbose table.
if (verbose) {
  console.log(colorize("\n[eval-decision-quality] Corpus results\n", BOLD + CYAN));
  const colW = [16, 12, 10, 10, 10, 8];
  const header = ["ID", "Label", "Expected", "Got", "Action", "Pass?"];
  console.log(header.map((h, i) => h.padEnd(colW[i])).join("  "));
  console.log("-".repeat(70));

  for (const row of rows) {
    const { entry, result, gotClass, expectedClass, pass, isFP, isFN, errorMsg } = row;
    const gotStr = errorMsg ? "error" : gotClass;
    const action = result ? result.action : "error";
    const passStr = isFP ? colorize("FP", RED) : isFN ? colorize("FN", RED) : pass ? colorize("ok", GREEN) : colorize("mismatch", YELLOW);
    const cols = [
      entry.id.padEnd(colW[0]),
      entry.label.padEnd(colW[1]),
      (expectedClass || "").padEnd(colW[2]),
      gotStr.padEnd(colW[3]),
      action.padEnd(colW[4]),
      passStr,
    ];
    console.log(cols.join("  "));
    if (verbose && result && (isFP || isFN || !pass)) {
      console.log("       reasons: " + (result.reasonCodes || []).join(", ") || "(none)");
      console.log("       explanation: " + result.explanation);
    }
  }
}

// Summary.
const fpPct = totalSafe > 0 ? (fp / totalSafe) * 100 : 0;
const fnPct = totalDangerous > 0 ? (fn / totalDangerous) * 100 : 0;
const fpOk  = fpPct <= maxFpPct;
const fnOk  = fnPct <= maxFnPct;
const allOk = fpOk && fnOk && errors === 0;

console.log(colorize("\n[eval-decision-quality] Summary", BOLD + CYAN));
console.log("  Corpus:        " + entries.length + " entries (" + totalSafe + " safe / " + totalDangerous + " dangerous / " + totalBorderline + " borderline)");
console.log("  Errors:        " + (errors > 0 ? colorize(String(errors), RED) : colorize("0", GREEN)));
console.log(
  "  False-positive rate: " +
  colorize(fpPct.toFixed(1) + "%", fpOk ? GREEN : RED) +
  " (" + fp + "/" + totalSafe + " safe entries blocked)" +
  "  [threshold ≤ " + maxFpPct + "%]"
);
console.log(
  "  False-negative rate: " +
  colorize(fnPct.toFixed(1) + "%", fnOk ? GREEN : RED) +
  " (" + fn + "/" + totalDangerous + " dangerous entries missed)" +
  "  [threshold ≤ " + maxFnPct + "%]"
);

if (fp > 0) {
  console.log(colorize("\n  False positives (safe commands blocked):", RED));
  for (const row of rows) {
    if (row.isFP) {
      console.log("    - " + row.entry.id + ": " + row.entry.command);
      if (row.result) console.log("      reasons: " + row.result.reasonCodes.join(", "));
    }
  }
}
if (fn > 0) {
  console.log(colorize("\n  False negatives (dangerous commands missed):", RED));
  for (const row of rows) {
    if (row.isFN) {
      console.log("    - " + row.entry.id + ": " + row.entry.command);
      if (row.result) console.log("      action=" + row.result.action + " reasons: " + row.result.reasonCodes.join(", "));
    }
  }
}

console.log(
  "\n  Result: " + (allOk
    ? colorize("PASS", BOLD + GREEN)
    : colorize("FAIL", BOLD + RED))
);

if (!allOk) {
  if (!fpOk) console.error("  FP rate " + fpPct.toFixed(1) + "% exceeds threshold " + maxFpPct + "% — engine is blocking too many safe commands.");
  if (!fnOk) console.error("  FN rate " + fnPct.toFixed(1) + "% exceeds threshold " + maxFnPct + "% — engine is missing dangerous commands.");
  if (errors > 0) console.error("  " + errors + " entries threw errors during decide().");
  process.exit(1);
}
NODEJS
