#!/usr/bin/env node
// slice-quality.eval.js — Per-slice FP/FN quality measurement.
//
// Reads tests/eval-corpus.json, groups entries by their named slice
// (via the _slices block + new hx*/hx1b entries), and computes FP/FN
// rates per slice. Compares each rate to the corresponding entry
// in evals/budgets.json. Reports results in a table.
//
// The eval is ADVISORY: it never fails the run on over-budget. Over-
// budget slices are reported as WARN. The hard FP/FN gate on the
// full corpus remains scripts/eval-decision-quality.sh.
//
// Usage:
//   node evals/slice-quality.eval.js [--corpus PATH] [--budgets PATH]
//
// Exit codes:
//   0 — eval completed (over-budget = WARN, not error)
//   2 — fatal: corpus/budgets not found, or no slices block

"use strict";

const fs   = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { decide } = require(path.join(root, "runtime", "decision-engine"));

const ALLOW_ACTIONS = new Set(["allow", "allow-once", "learned-allow"]);
const WARN_ACTIONS  = new Set(["warn", "route", "require-review", "require-tests", "modify", "escalate"]);
const BLOCK_ACTIONS = new Set(["block"]);

function actionClass(action) {
  if (ALLOW_ACTIONS.has(action)) return "allow";
  if (WARN_ACTIONS.has(action))  return "warn";
  if (BLOCK_ACTIONS.has(action)) return "block";
  return "unknown";
}

function colorize(s, c) {
  const isTTY = process.stdout.isTTY;
  if (!isTTY) return s;
  const codes = { red: 31, green: 32, yellow: 33, cyan: 36, bold: 1, reset: 0 };
  return `\x1b[${codes[c]}m${s}\x1b[0m`;
}

let corpusPath = path.join(root, "tests", "eval-corpus.json");
let budgetsPath = path.join(root, "evals", "budgets.json");

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--corpus")   { corpusPath  = process.argv[++i]; continue; }
  if (process.argv[i] === "--budgets")  { budgetsPath = process.argv[++i]; continue; }
}

if (!fs.existsSync(corpusPath)) {
  console.error(`[slice-quality] corpus not found: ${corpusPath}`);
  process.exit(2);
}
if (!fs.existsSync(budgetsPath)) {
  console.error(`[slice-quality] budgets not found: ${budgetsPath}`);
  process.exit(2);
}

const corpus  = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const budgets = JSON.parse(fs.readFileSync(budgetsPath, "utf8"));

if (!corpus._slices) {
  console.error("[slice-quality] corpus has no _slices block — Phase 1 P1.1 must run first.");
  process.exit(2);
}

const entries = corpus.entries;

// Build id → entry map
const byId = new Map();
for (const e of entries) byId.set(e.id, e);

// Per-slice accumulator
const sliceStats = new Map();
for (const [sliceName, sliceMeta] of Object.entries(corpus._slices)) {
  sliceStats.set(sliceName, {
    description: sliceMeta.description,
    safe: 0,
    dangerous: 0,
    borderline: 0,
    fp: 0,
    fn: 0,
    errors: 0,
    memberIds: [
      ...(sliceMeta.existing_entry_ids || []),
      ...(sliceMeta.new_entry_ids || []),
    ],
  });
}

// Drive decide() for every entry that belongs to a slice
const sliceRows = [];
for (const [sliceName, stats] of sliceStats.entries()) {
  for (const id of stats.memberIds) {
    const entry = byId.get(id);
    if (!entry) {
      stats.errors++;
      sliceRows.push({ sliceName, id, error: `entry id "${id}" not found in corpus` });
      continue;
    }
    let result;
    try {
      result = decide({
        command:        entry.command        || "",
        tool:           entry.tool           || "Bash",
        targetPath:     entry.targetPath     || ".",
        payloadClass:   entry.payloadClass   || "A",
        branch:         entry.branch,
        protectedBranch: entry.protectedBranch,
        toolInput:      entry.toolInput,
      });
    } catch (err) {
      stats.errors++;
      sliceRows.push({ sliceName, id, error: err.message });
      continue;
    }

    const expectedClass = entry.expected_action_class;
    const gotClass      = actionClass(result.action);
    const pass          = gotClass === expectedClass;

    if (entry.label === "safe")      stats.safe++;
    if (entry.label === "dangerous") stats.dangerous++;
    if (entry.label === "borderline") stats.borderline++;

    // FP/FN accounting follows the existing decision-replay.eval.js convention:
    //   FP = safe entry mapped to "block"
    //   FN = dangerous entry mapped to "allow" class
    const isFP = entry.label === "safe"      && gotClass === "block";
    const isFN = entry.label === "dangerous" && gotClass === "allow";
    if (isFP) stats.fp++;
    if (isFN) stats.fn++;

    sliceRows.push({ sliceName, id, expectedClass, gotClass, pass, isFP, isFN, label: entry.label });
  }
}

// Report
console.log(colorize("[slice-quality] Per-slice FP/FN (advisory)", "bold" in {bold:1} ? "bold" : "cyan"));
console.log("");

const header = ["Slice", "Safe", "Danger", "Border", "FP", "FN", "FP%", "FN%", "Budget FP%", "Budget FN%", "Verdict"];
const colW = [6, 5, 7, 7, 4, 4, 7, 7, 12, 12, 12];
console.log(header.map((h, i) => h.padEnd(colW[i])).join("  "));
console.log("-".repeat(80));

let anyOverBudget = false;
for (const [sliceName, stats] of sliceStats.entries()) {
  const sliceBudget = budgets.slices[sliceName] || budgets._global_advisory;
  const fpPct = stats.safe > 0      ? (stats.fp / stats.safe) * 100       : 0;
  const fnPct = stats.dangerous > 0 ? (stats.fn / stats.dangerous) * 100  : 0;
  const fpOver = fpPct > sliceBudget.max_fp_pct;
  const fnOver = fnPct > sliceBudget.max_fn_pct;
  if (fpOver || fnOver) anyOverBudget = true;

  const verdict = (fpOver || fnOver) ? colorize("WARN", "yellow") : colorize("ok", "green");

  const row = [
    sliceName.padEnd(colW[0]),
    String(stats.safe).padEnd(colW[1]),
    String(stats.dangerous).padEnd(colW[2]),
    String(stats.borderline).padEnd(colW[3]),
    String(stats.fp).padEnd(colW[4]),
    String(stats.fn).padEnd(colW[5]),
    fpPct.toFixed(1).padEnd(colW[6]),
    fnPct.toFixed(1).padEnd(colW[7]),
    sliceBudget.max_fp_pct.toFixed(1).padEnd(colW[8]),
    sliceBudget.max_fn_pct.toFixed(1).padEnd(colW[9]),
    verdict.padEnd(colW[10]),
  ];
  console.log(row.join("  "));
}

console.log("");
console.log(colorize("Slice description map:", "cyan"));
for (const [sliceName, stats] of sliceStats.entries()) {
  console.log(`  ${sliceName}: ${stats.description}`);
}

if (anyOverBudget) {
  console.log("");
  console.log(colorize("WARNING: at least one slice is over its advisory budget.", "yellow"));
  console.log(colorize("This is ADVISORY only — exit 0. Tighten evals/budgets.json to bring the budget in line,", "yellow"));
  console.log(colorize("or improve the engine. Promoting slice budgets to hard gates is a security-layer change", "yellow"));
  console.log(colorize("(NEEDS-APPROVAL — see references/PLAN.md Phase 1 + 3).", "yellow"));
}

process.exit(0);
