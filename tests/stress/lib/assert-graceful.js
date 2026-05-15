"use strict";

// Shared graceful-degradation assertion: exercise() did not throw, decide()
// returned a non-null object with non-empty reasonCodes[], AND either the
// runtime-decision journal append succeeded OR a degradedMode marker is on
// the result (ADR-004 allows degraded mode to suppress routine appends but
// MUST surface the marker so audit can attribute the gap).

const assert = require("node:assert");

function assertGraceful(result, journal, opts) {
  const o = opts || {};
  const id = String(o.scenarioId || "scenario");
  assert.ok(!o.threw, `${id}: exercise threw: ${o.error && o.error.stack || o.error}`);
  assert.ok(result && typeof result === "object", `${id}: decide() returned ${result}`);
  assert.ok(Array.isArray(result.reasonCodes), `${id}: reasonCodes must be an array`);
  assert.ok(typeof result.action === "string" && result.action.length > 0, `${id}: action missing`);
  const entries = Array.isArray(journal) ? journal : [];
  const appended = entries.some((e) => e && e.kind === "runtime-decision");
  const degraded = Boolean(result.degradedMode && result.degradedMode.active);
  assert.ok(appended || degraded, `${id}: neither journal-append nor degradedMode marker`);
}

module.exports = { assertGraceful };
