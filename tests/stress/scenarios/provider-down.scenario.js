"use strict";

// provider-down — adapter capability manifest reports `network: false`
// mid-decision. Engine must fall back without throwing.

const path = require("node:path");
const { assertGraceful } = require(path.join(__dirname, "..", "lib", "assert-graceful"));

module.exports = {
  id: "provider-down",
  description: "adapter capability degrades to network:false mid-decision",
  setup() { return null; },
  exercise(engine, ctx) {
    const result = engine.decide({
      tool: "Bash", harness: "claude", command: "curl https://api.example.com/healthz",
      targetPath: path.join(ctx.projectDir, "noop.txt"), projectRoot: ctx.projectDir,
      branch: "feature/stress", sessionRisk: 0,
      adapterManifest: { harness: "claude", capabilities: { network: false, fs: true } },
    });
    return { result };
  },
  assertGraceful(out, journal, ctx) {
    assertGraceful(out.result, journal, { scenarioId: ctx.id, threw: out.threw, error: out.error });
  },
};
