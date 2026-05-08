#!/usr/bin/env node
"use strict";
// Single-invocation worker for the concurrent rate-limit harness.
// Called with: node worker.js <hookStateDir>
// Exits 0 if rateLimitCheck returns true (pass), 1 if false (deny).
const tmpDir    = process.argv[2];
const capacity  = parseInt(process.argv[3] || "60",  10);
const refillRate = parseInt(process.argv[4] || "30", 10);
if (!tmpDir) { process.stderr.write("usage: worker.js <hookStateDir> [capacity] [refillRate]\n"); process.exit(2); }
process.env.HORUS_HOOK_STATE_DIR = tmpDir;
const { rateLimitCheck } = require(require("path").join(__dirname, "../../../claude/hooks/hook-utils"));
process.exit(rateLimitCheck("test-hook", capacity, refillRate) ? 0 : 1);
