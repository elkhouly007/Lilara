"use strict";

// journal-corruption — tamper a chain entry; decide() must enter
// degraded-mode (ADR-004) and keep serving; verify() must report corruption.

const fs   = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");

module.exports = {
  id: "journal-corruption",
  description: "tampered chain entry → degraded mode + verify reports corruption",
  async setup(ctx) {
    const chainFile = path.join(ctx.stateDir, "journal-chain.jsonl");
    const journal = require(path.join(ctx.root, "runtime", "journal-chain"));
    journal.append("stress.seed", { note: "seed-1" }, { file: chainFile });
    journal.append("stress.seed", { note: "seed-2" }, { file: chainFile });
    journal.append("stress.seed", { note: "seed-3" }, { file: chainFile });
    const lines = fs.readFileSync(chainFile, "utf8").split("\n").filter(Boolean);
    const parsed = JSON.parse(lines[1]);
    parsed.payload = { note: "TAMPERED" };
    lines[1] = JSON.stringify(parsed);
    fs.writeFileSync(chainFile, lines.join("\n") + "\n", { mode: 0o600 });
    ctx.chainFile = chainFile;
    return null;
  },
  exercise(engine, ctx) {
    const result = engine.decide({
      tool: "Write", harness: "claude",
      targetPath: path.join(ctx.projectDir, "src", "x.ts"),
      file_path:  path.join(ctx.projectDir, "src", "x.ts"),
      projectRoot: ctx.projectDir, branch: "feature/stress", sessionRisk: 0,
    });
    return { result };
  },
  assertGraceful(out, journal, ctx) {
    assert.ok(!out.threw, `journal-corruption: engine threw: ${out.error && out.error.stack || out.error}`);
    assert.ok(out.result && typeof out.result.action === "string", "result missing action");
    const marker = out.result.degradedMode;
    assert.ok(marker && marker.active, `expected degradedMode marker, got ${JSON.stringify(marker)}`);
    const chain = require(path.join(ctx.root, "runtime", "journal-chain")).verify({ file: ctx.chainFile });
    assert.strictEqual(chain.ok, false, "verify must report corruption");
    assert.ok(chain.errors.length > 0, "verify must list errors");
  },
};
