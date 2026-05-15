"use strict";

// concurrent-floods — 200 decide() calls (Promise.all) on shared HORUS_STATE_DIR
// with an F17 lock conflict. Assert: no crashes, 200 journal entries, chain
// clean, bounded wall-clock (no deadlock).

const fs   = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");

const N = 200;

module.exports = {
  id: "concurrent-floods",
  description: "200 decide() calls + lock contention → 200 entries, chain clean",
  setup(ctx) {
    const lockDir = path.join(ctx.stateDir, "cross-agent-locks");
    fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    const target = path.join(ctx.projectDir, "src", "hot.ts");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "// hot path\n");
    fs.writeFileSync(path.join(lockDir, "flood.json"), JSON.stringify({
      lockId: "flood-lock", owner: "ghost-agent:flood",
      projectRoot: ctx.projectDir, paths: [target],
      expiresAt: Date.now() + 3600_000,
    }), { mode: 0o600 });
    ctx.targetPath = target;
    return null;
  },
  async exercise(engine, ctx) {
    const start = Date.now();
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(Promise.resolve().then(() => engine.decide({
        tool: "Write", harness: "claude",
        targetPath: ctx.targetPath, file_path: ctx.targetPath,
        projectRoot: ctx.projectDir, branch: "feature/stress",
        owner: `stress-agent:s-${i}`, sessionRisk: 0,
      })));
    }
    const results = await Promise.all(promises);
    return { result: results[0], extra: { results, elapsed: Date.now() - start } };
  },
  assertGraceful(out, journal, ctx) {
    assert.ok(!out.threw, `concurrent-floods: engine threw: ${out.error && out.error.stack || out.error}`);
    assert.strictEqual(out.extra.results.length, N, `expected ${N} results`);
    let blocks = 0;
    for (const r of out.extra.results) {
      assert.ok(r && typeof r === "object", "null decision");
      if (r.floorFired === "cross-agent-lock") blocks += 1;
    }
    assert.strictEqual(blocks, N, `expected ${N} F17 blocks, got ${blocks}`);
    const entries = journal.filter((e) => e && e.kind === "runtime-decision");
    assert.strictEqual(entries.length, N, `expected ${N} runtime-decision journal entries, got ${entries.length}`);
    assert.ok(out.extra.elapsed < 60_000, `bounded wait: ${out.extra.elapsed}ms`);
  },
};
