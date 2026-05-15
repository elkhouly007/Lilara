"use strict";

// clock-skew — Date.now frozen at 2000-01-01. Engine + chain must stay
// stable. Chain has no monotonicity invariant (prevHash + checkpoint HMAC
// only), so the assertion is: verify() still reports clean.

const path = require("node:path");
const assert = require("node:assert");
const { assertGraceful } = require(path.join(__dirname, "..", "lib", "assert-graceful"));
const { freezeClockAt }  = require(path.join(__dirname, "..", "lib", "inject-clock"));

const FIXED_PAST_MS = Date.UTC(2000, 0, 1, 0, 0, 0);

module.exports = {
  id: "clock-skew",
  description: "Date.now frozen at 2000-01-01; engine + chain stable",
  setup() { return freezeClockAt(FIXED_PAST_MS); },
  exercise(engine, ctx) {
    const result = engine.decide({
      tool: "Bash", harness: "claude", command: "echo clock-skew",
      targetPath: path.join(ctx.projectDir, "noop.txt"), projectRoot: ctx.projectDir,
      branch: "feature/stress", sessionRisk: 0,
    });
    return { result };
  },
  assertGraceful(out, journal, ctx) {
    assertGraceful(out.result, journal, { scenarioId: ctx.id, threw: out.threw, error: out.error });
    const chain = require(path.join(ctx.root, "runtime", "journal-chain"))
      .verify({ file: path.join(ctx.stateDir, "journal-chain.jsonl") });
    assert.strictEqual(chain.ok, true, `chain must remain intact: ${JSON.stringify(chain.errors)}`);
  },
};
