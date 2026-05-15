"use strict";

// lockfile-stuck — F17 stale lock owned by a fictitious PID. Engine must
// respect F17 deterministically across 10 repeated calls without deadlock.

const fs   = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");

module.exports = {
  id: "lockfile-stuck",
  description: "stale conflicting lock; F17 fires deterministically across 10 calls",
  setup(ctx) {
    const lockDir = path.join(ctx.stateDir, "cross-agent-locks");
    fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    const target = path.join(ctx.projectDir, "src", "shared.ts");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "// shared\n");
    fs.writeFileSync(path.join(lockDir, "stuck.json"), JSON.stringify({
      lockId: "stuck-lock", owner: "ghost-agent:pid-2147483646",
      projectRoot: ctx.projectDir, paths: [target],
      expiresAt: Date.now() + 3600_000, createdAt: Date.now() - 3600_000,
    }), { mode: 0o600 });
    ctx.targetPath = target;
    return null;
  },
  exercise(engine, ctx) {
    const results = [];
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      results.push(engine.decide({
        tool: "Write", harness: "claude",
        targetPath: ctx.targetPath, file_path: ctx.targetPath,
        projectRoot: ctx.projectDir, branch: "feature/stress",
        owner: "stress-agent:session-1", sessionRisk: 0,
      }));
    }
    return { result: results[0], extra: { results, elapsed: Date.now() - start } };
  },
  assertGraceful(out, journal, ctx) {
    assert.ok(!out.threw, `lockfile-stuck: engine threw: ${out.error && out.error.stack || out.error}`);
    assert.strictEqual(out.extra.results.length, 10);
    for (const r of out.extra.results) {
      assert.strictEqual(r.action, "block", `expected block, got ${r.action}`);
      assert.strictEqual(r.floorFired, "cross-agent-lock");
      assert.strictEqual(r.lockOwner, "ghost-agent:pid-2147483646");
    }
    assert.ok(out.extra.elapsed < 30_000, `bounded wait: 10 calls took ${out.extra.elapsed}ms`);
  },
};
