#!/usr/bin/env node
"use strict";

// Adversarial harness driver (locked scope §5.1 + §8 success criteria:
// "0 bypasses across all patterns"). Loads the full G+Q pattern library and
// runs each entry through the current decision-engine in an isolated state
// directory. Records confirmed bypasses (block-expected → non-block) under
// artifacts/adversarial/bypass/<pattern-id>.json with a full receipt, and
// degraded entries (require-review-expected → allow) on the run summary.
//
// Observe-only: no runtime/*.js changes. A bypass surfaced here is a real
// engine bug — fix it in a scoped follow-up PR (scope §5.1 policy).
//
// Usage: node tests/adversarial/run-adversarial.js
//        ADVERSARIAL_OUT=path node tests/adversarial/run-adversarial.js

const fs            = require("node:fs");
const os            = require("node:os");
const path          = require("node:path");
const child_process = require("node:child_process");

const { loadPatterns } = require("./lib/load-patterns");

const ROOT      = path.resolve(__dirname, "..", "..");
const OUT       = process.env.ADVERSARIAL_OUT
  ? path.resolve(process.env.ADVERSARIAL_OUT)
  : path.join(ROOT, "artifacts", "adversarial");
const BYPASS    = path.join(OUT, "bypass");

// Match replay-decisions.js isolation: pin a non-protected branch sentinel so
// entries with empty/missing `branch` do not inherit the worktree's actual
// branch via context-discovery's `git symbolic-ref` fallback.
process.env.HORUS_CONTRACT_ENABLED      = "0";
process.env.HORUS_TRAJECTORY_WINDOW_MIN = "0";
process.env.HORUS_RATE_LIMIT            = "0";
delete process.env.HORUS_KILL_SWITCH;
delete process.env.HORUS_CONTRACT_REQUIRED;
delete process.env.HORUS_F4_DEMOTE_TOKEN;
process.env.HORUS_BRANCH_OVERRIDE = "adversarial/isolated-context";

const { decide }     = require(path.join(ROOT, "runtime", "decision-engine"));
const { resetCache } = require(path.join(ROOT, "runtime", "session-context"));

function baseCommit() {
  try {
    return child_process.execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch { return ""; }
}

function safeId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200);
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function runOne(pattern) {
  resetCache();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-adv-"));
  process.env.HORUS_STATE_DIR = stateDir;
  let actual = null, error = null;
  try {
    const r = decide(pattern.action);
    actual = {
      action:         (r && r.action)         || null,
      decisionSource: (r && r.decisionSource) || null,
      floorFired:     (r && r.floorFired)     || null,
    };
  } catch (err) {
    error = String(err && err.message || err);
  } finally {
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  return { actual, error };
}

function main() {
  const startedAt = Date.now();
  fs.mkdirSync(OUT,    { recursive: true });
  fs.mkdirSync(BYPASS, { recursive: true });

  const { patterns, warnings } = loadPatterns({});
  for (const w of warnings) process.stderr.write(`  WARN  ${w}\n`);
  if (patterns.length === 0) {
    process.stderr.write("ADVERSARIAL: no patterns loaded — nothing to do\n");
    process.exit(2);
  }

  const bypasses          = [];
  const degraded          = [];
  let   blockedExpected   = 0;
  let   blockedActual     = 0;
  let   stricterMismatch  = 0; // expected=allow but engine returned stricter; not a bypass

  for (const p of patterns) {
    const { actual, error } = runOne(p);
    if (p.expectedAction === "block") blockedExpected += 1;
    if (actual && actual.action === "block") blockedActual += 1;

    if (error) {
      // An engine throw on a block-expected entry is bypass-equivalent: no
      // veto was emitted. Other expectations swallow the throw on the harness
      // side and surface it via warnings only (the run summary records it).
      if (p.expectedAction === "block") {
        const receipt = { patternId: p.id, source: p.source, intent: p.intent, expected: p.expectedAction, actual: null, error, input: p.action };
        bypasses.push({ patternId: p.id, expected: p.expectedAction, actual: null, error });
        fs.writeFileSync(path.join(BYPASS, `${safeId(p.id)}.json`), JSON.stringify(receipt, null, 2));
      } else {
        process.stderr.write(`  WARN  ${p.id}: engine threw on non-block expected entry: ${error}\n`);
      }
      continue;
    }

    if (p.expectedAction === "block" && actual.action !== "block") {
      const receipt = { patternId: p.id, source: p.source, intent: p.intent, expected: p.expectedAction, actual, input: p.action };
      bypasses.push({ patternId: p.id, expected: p.expectedAction, actual });
      fs.writeFileSync(path.join(BYPASS, `${safeId(p.id)}.json`), JSON.stringify(receipt, null, 2));
    } else if (p.expectedAction === "require-review" && actual.action === "allow") {
      degraded.push({ patternId: p.id, expected: p.expectedAction, actual });
    } else if (p.expectedAction === "allow" && actual.action !== "allow") {
      stricterMismatch += 1;
    }
  }

  const stamp = isoStamp();
  const summary = {
    totalPatterns:    patterns.length,
    blockedExpected,
    blockedActual,
    bypasses,
    degraded,
    stricterMismatch,
    warnings:         warnings.length,
    runAtIso:         new Date().toISOString(),
    baseCommit:       baseCommit(),
    durationMs:       Date.now() - startedAt,
  };
  fs.writeFileSync(path.join(OUT, `run-${stamp}.json`), JSON.stringify(summary, null, 2));

  process.stdout.write(`ADVERSARIAL: ${patterns.length} patterns, ${bypasses.length} bypasses, ${degraded.length} degraded\n`);
  for (const b of bypasses) {
    const got = b.actual && b.actual.action || "<engine-error>";
    process.stderr.write(`  BYPASS  ${b.patternId}: expected=${b.expected} actual=${got}\n`);
  }
  process.exit(bypasses.length === 0 ? 0 : 1);
}

main();
