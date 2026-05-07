#!/usr/bin/env node
"use strict";
// Concurrent rate-limit harness.
// Usage: node concurrent-harness.js [N=8] [capacity=3]
// Spawns N child processes concurrently against an isolated state dir pre-seeded
// with <capacity> tokens. Asserts passes <= capacity (no over-allowance).
const { spawnSync, spawn } = require("child_process");
const fs   = require("fs");
const os   = require("os");
const path = require("path");

const N        = parseInt(process.argv[2] || "8",  10);
const capacity = parseInt(process.argv[3] || "3",  10);
const tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), "horus-rl-"));

function cleanup() { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });

const stateFile = path.join(tmpDir, "rate-test-hook.json");
fs.writeFileSync(stateFile, JSON.stringify({ tokens: capacity, lastRefill: Date.now() / 1000 }), { mode: 0o600 });

const workerPath = path.join(__dirname, "worker.js");

// Spawn N processes concurrently.
// refillRate=0 prevents token refill during process-startup delay, keeping the test deterministic.
const procs = Array.from({ length: N }, () =>
  spawn(process.execPath, [workerPath, tmpDir, String(capacity), "0"], {
    env: { ...process.env, HORUS_HOOK_STATE_DIR: tmpDir, HORUS_RATE_LIMIT: "1" },
    stdio: "pipe",
  })
);

// Collect results via Promise.all equivalent (sync-style with a counter).
let done = 0;
let passes = 0;
let failed = false;

function finish() {
  if (done < N) return;

  let finalTokens;
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    finalTokens = Math.round(raw.tokens);
  } catch (e) {
    process.stderr.write(`FAIL: rate-limit:concurrent — state file corrupted: ${e.message}\n`);
    process.exit(1);
  }

  if (passes > capacity) {
    process.stderr.write(`FAIL: rate-limit:concurrent — over-allowance: ${passes} passes, capacity=${capacity}, final_tokens=${finalTokens}\n`);
    process.exit(1);
  }
  if (finalTokens < 0) {
    process.stderr.write(`FAIL: rate-limit:concurrent — negative token count: ${finalTokens}\n`);
    process.exit(1);
  }

  process.stdout.write(`PASS: rate-limit:concurrent — ${passes}/${N} processes passed, capacity=${capacity}, final_tokens=${finalTokens}\n`);
  process.exit(0);
}

for (const proc of procs) {
  proc.on("close", (code) => {
    if (code === 0) passes++;
    done++;
    finish();
  });
  proc.on("error", () => {
    done++;
    finish();
  });
}
