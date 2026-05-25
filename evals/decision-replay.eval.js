#!/usr/bin/env node
"use strict";

// decision-replay.eval.js — Seed eval: action-class accuracy vs. labeled corpus.
//
// For each corpus entry, calls runtime/decision-engine.decide() with a synthetic
// IR derived from the entry's fields, then compares the resulting action against
// expected_action_class:
//   allow  → any of:  allow, allow-once, learned-allow
//   warn   → any of:  warn, route, require-review, require-tests, modify, escalate
//   block  → block
//
// Borderline entries are skipped in FP/FN accounting but still run.
// FP = safe entry mapped to block.
// FN = dangerous entry mapped to allow class.

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const { decide } = require(path.join(__dirname, "..", "runtime", "decision-engine"));

const ALLOW_ACTIONS = new Set(["allow", "allow-once", "learned-allow"]);
const WARN_ACTIONS  = new Set(["warn", "route", "require-review", "require-tests", "modify", "escalate"]);
const BLOCK_ACTIONS = new Set(["block"]);

function actionClass(action) {
  if (ALLOW_ACTIONS.has(action)) return "allow";
  if (WARN_ACTIONS.has(action))  return "warn";
  if (BLOCK_ACTIONS.has(action)) return "block";
  return "unknown";
}

module.exports = {
  name:        "decision-replay",
  description: "Action-class accuracy vs. eval-corpus.json (FP/FN rates)",

  async run(corpus) {
    const failures = [];
    let passed = 0;
    let failed = 0;
    let total  = 0;
    let fp     = 0;
    let fn_    = 0;

    // Isolate session state so accumulated risk from prior sessions doesn't
    // affect routing via trajectory-nudge or getSessionRisk().
    const prevStateDir = process.env.LILARA_STATE_DIR;
    const tmpStateDir  = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-eval-"));
    process.env.LILARA_STATE_DIR = tmpStateDir;

    // Suppress journal writes during eval
    const prevJournal = process.env.LILARA_DECISION_JOURNAL;
    process.env.LILARA_DECISION_JOURNAL = "0";

    try {
      for (const entry of corpus) {
        total += 1;
        const ir = {
          command:          entry.command || "",
          tool:             entry.tool    || "Bash",
          targetPath:       entry.targetPath || ".",
          branch:           entry.branch || "feature/eval",
          protectedBranch:  Boolean(entry.protectedBranch),
          payloadClass:     entry.payloadClass || "A",
          sessionRisk:      0,
          repeatedApprovals: 0,
        };

        let result;
        try {
          result = decide(ir);
        } catch (err) {
          failures.push({ id: entry.id, expected: entry.expected_action_class, got: "error", note: String(err.message || err) });
          failed += 1;
          continue;
        }

        const got      = actionClass(result.action);
        const expected = entry.expected_action_class || "allow";

        if (got === expected) {
          passed += 1;
        } else {
          failed += 1;
          failures.push({ id: entry.id, expected, got, note: entry.note || "" });
          // FP/FN only for non-borderline entries
          if (entry.label !== "borderline") {
            if (entry.label === "safe"      && got === "block") fp  += 1;
            if (entry.label === "dangerous" && got === "allow") fn_ += 1;
          }
        }
      }
    } finally {
      if (prevJournal === undefined) delete process.env.LILARA_DECISION_JOURNAL;
      else process.env.LILARA_DECISION_JOURNAL = prevJournal;

      // Restore state dir and clean up temp dir
      if (prevStateDir === undefined) delete process.env.LILARA_STATE_DIR;
      else process.env.LILARA_STATE_DIR = prevStateDir;
      try { fs.rmSync(tmpStateDir, { recursive: true, force: true }); } catch (_) {}
    }

    const summary = `FP=${fp} FN=${fn_} (${passed}/${total} correct)`;
    // Append FP/FN summary as a synthetic failure entry for visibility in JUnit
    if (fp > 0 || fn_ > 0) {
      failures.push({ id: "_summary", expected: "fp=0 fn=0", got: `fp=${fp} fn=${fn_}`, note: summary });
    }

    return { passed, failed, total, failures };
  },
};
