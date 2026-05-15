"use strict";

// network-out — simulated DNS-fail / socket-error via F18 evaluateDns
// (ENOTFOUND). Engine must still return a deterministic decision without
// crashing; F18 FC#4 receipt path records the degradation.

const path = require("node:path");
const assert = require("node:assert");
const { assertGraceful } = require(path.join(__dirname, "..", "lib", "assert-graceful"));

module.exports = {
  id: "network-out",
  description: "F18 DNS lookup fails; engine does not crash",
  setup() { return null; },
  async exercise(engine, ctx) {
    const netEgress = require(path.join(ctx.root, "runtime", "network-egress"));
    const cmd = "curl https://api.example.com/healthz";
    const policy = { allowDomains: [{ pattern: "api.example.com", allowOnLookupFailure: false }] };
    const dns = await netEgress.resolveTargets(cmd, {
      lookup: async () => { const e = new Error("getaddrinfo ENOTFOUND"); e.code = "ENOTFOUND"; throw e; },
    });
    const dnsResult = netEgress.evaluateDns(cmd, policy, dns);
    assert.strictEqual(dnsResult.fired, true, "F18 FC#4 must fire on DNS failure");
    assert.strictEqual(dnsResult.reason, "dns_lookup_failed");
    const result = engine.decide({
      tool: "Bash", harness: "claude", command: cmd,
      targetPath: path.join(ctx.projectDir, "noop.txt"), projectRoot: ctx.projectDir,
      branch: "feature/stress", sessionRisk: 0,
    });
    return { result, extra: { dnsResult } };
  },
  assertGraceful(out, journal, ctx) {
    assertGraceful(out.result, journal, { scenarioId: ctx.id, threw: out.threw, error: out.error });
    assert.ok(out.extra && out.extra.dnsResult && out.extra.dnsResult.fired === true,
      "F18 FC#4 must fire on simulated DNS failure");
  },
};
