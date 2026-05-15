"use strict";

// rate-limit — synthetic adapter throws 429 during decide(). Engine must
// stay decision-stable (NOT allow on uncertainty) and journal the call.

const path = require("node:path");
const assert = require("node:assert");
const { assertGraceful } = require(path.join(__dirname, "..", "lib", "assert-graceful"));
const { makeRateLimitedAdapter, RateLimitError } = require(path.join(__dirname, "..", "lib", "inject-rate-limit"));

module.exports = {
  id: "rate-limit",
  description: "adapter throws synthetic 429; engine stays conservative",
  setup() { return null; },
  exercise(engine, ctx) {
    const adapter = makeRateLimitedAdapter({ failOnCall: 1 });
    let adapterThrew = false;
    try { adapter.fetchInfo(); } catch (e) { adapterThrew = e instanceof RateLimitError; }
    const result = engine.decide({
      tool: "Write", harness: "claude", command: "",
      targetPath: path.join(ctx.projectDir, "src", "shared.ts"),
      file_path:  path.join(ctx.projectDir, "src", "shared.ts"),
      projectRoot: ctx.projectDir, branch: "feature/stress", sessionRisk: 0,
      adapterError: "rate-limit",
    });
    return { result, extra: { adapterThrew } };
  },
  assertGraceful(out, journal, ctx) {
    assertGraceful(out.result, journal, { scenarioId: ctx.id, threw: out.threw, error: out.error });
    assert.ok(out.extra && out.extra.adapterThrew, "rate-limit adapter should throw RateLimitError");
  },
};
