"use strict";

// disk-full — state-dir chmod 0o500 + F17 early-block path. The engine's
// wrapped journal-append + recordDecision sites swallow EACCES and return
// a deterministic block. Snapshot rail (ADR-013) fail-open by construction.
// See references/stress-harness.md for the non-block-path follow-up note.

const fs   = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");
const { makeReadOnly } = require(path.join(__dirname, "..", "lib", "inject-fs-error"));

module.exports = {
  id: "disk-full",
  description: "state-dir chmod 0o500 + F17 early-block; engine returns block without crash",
  setup(ctx) {
    // Setup runs BEFORE chmod so the lock + journal files exist; the F17
    // path then reaches buildEarlyBlock (wrapped append) under read-only.
    const lockDir = path.join(ctx.stateDir, "cross-agent-locks");
    fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    const target = path.join(ctx.projectDir, "src", "shared.ts");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "// shared\n");
    fs.writeFileSync(path.join(lockDir, "diskfull.json"), JSON.stringify({
      lockId: "diskfull-lock", owner: "ghost-agent:diskfull",
      projectRoot: ctx.projectDir, paths: [target],
      expiresAt: Date.now() + 3600_000,
    }), { mode: 0o600 });
    try { fs.writeFileSync(path.join(ctx.stateDir, "decision-journal.jsonl"), "", { mode: 0o600 }); } catch { /* ignore */ }
    ctx.targetPath = target;
    return makeReadOnly(ctx.stateDir);
  },
  exercise(engine, ctx) {
    const result = engine.decide({
      tool: "Write", harness: "claude",
      targetPath: ctx.targetPath, file_path: ctx.targetPath,
      projectRoot: ctx.projectDir, branch: "feature/stress",
      owner: "stress-agent:session-1", sessionRisk: 0,
    });
    return { result };
  },
  assertGraceful(out, journal, ctx) {
    assert.ok(!out.threw, `disk-full: engine threw: ${out.error && out.error.stack || out.error}`);
    assert.ok(out.result && typeof out.result.action === "string", "disk-full: result missing action");
    assert.strictEqual(out.result.action, "block", `expected block from F17 early-block path, got ${out.result.action}`);
    assert.strictEqual(out.result.floorFired, "cross-agent-lock");
    assert.ok(Array.isArray(out.result.reasonCodes) && out.result.reasonCodes.length > 0,
      "disk-full: early-block path must set reasonCodes");
  },
};
