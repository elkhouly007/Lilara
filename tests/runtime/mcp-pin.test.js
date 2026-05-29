"use strict";
// mcp-pin.test.js — unit tests for runtime/mcp-pin.js
const fs   = require("fs");
const os   = require("os");
const path = require("path");

let passed = 0; let failed = 0;
function ok(name)     { console.log(`  ok  ${name}`); passed++; }
function fail(name,m) { console.error(`  FAIL ${name} — ${m}`); failed++; }

// Use a fresh state dir for each test
function withPins(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-pin-test-"));
  const prev = process.env.LILARA_STATE_DIR;
  process.env.LILARA_STATE_DIR = dir;
  try { fn(dir); }
  finally {
    if (prev === undefined) delete process.env.LILARA_STATE_DIR;
    else process.env.LILARA_STATE_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const { argShapeHash, checkArgShapeDrift } = require(path.join(__dirname, "..", "..", "runtime", "mcp-pin"));

// argShapeHash tests
const h1 = argShapeHash({ query: "hello", limit: 10 });
const h2 = argShapeHash({ query: "world", limit: 99 });
const h3 = argShapeHash({ query: "hello", limit: 10 });
h1 === h3 ? ok("argShapeHash: same shape same hash") : fail("argShapeHash: same shape same hash", `${h1} != ${h3}`);
// h1 === h2 because same key names + same types; values don't affect hash
h1 === h2 ? ok("argShapeHash: different values same hash (only shape matters)") : fail("argShapeHash: different values same hash", `${h1} != ${h2}`);

// Type change detection
const hA = argShapeHash({ a: "x" });
const hB = argShapeHash({ a: 42 });
const hC = argShapeHash({ b: "x" });
hA === hB ? fail("argShapeHash: type change not detected", "string vs number should differ") : ok("argShapeHash: type change produces different hash");
hA === hC ? fail("argShapeHash: key change not detected", "a vs b should differ") : ok("argShapeHash: key change produces different hash");
argShapeHash(null) === argShapeHash({}) ? ok("argShapeHash: null and {} both empty sentinel") : fail("argShapeHash: null and {} both empty sentinel", "should be equal");

// checkArgShapeDrift: first call records, no drift
withPins(() => {
  const r = checkArgShapeDrift({ server: "github", tool: "search", args: { q: "hello" } });
  r.drift === false ? ok("drift: first call no drift") : fail("drift: first call no drift", JSON.stringify(r));
});

// checkArgShapeDrift: same shape second call no drift
withPins(() => {
  checkArgShapeDrift({ server: "github", tool: "search", args: { q: "hello" } });
  const r = checkArgShapeDrift({ server: "github", tool: "search", args: { q: "world" } }); // same type
  r.drift === false ? ok("drift: same shape no drift") : fail("drift: same shape no drift", JSON.stringify(r));
});

// checkArgShapeDrift: type change causes drift
withPins(() => {
  checkArgShapeDrift({ server: "github", tool: "search", args: { q: "hello" } });
  const r = checkArgShapeDrift({ server: "github", tool: "search", args: { q: 42 } }); // type change string→number
  r.drift === true ? ok("drift: type change detected") : fail("drift: type change detected", JSON.stringify(r));
});

// checkArgShapeDrift: fail-open on missing server/tool
const r0 = checkArgShapeDrift({ server: "", tool: "", args: {} });
r0.drift === false ? ok("drift: fail-open on empty server/tool") : fail("drift: fail-open on empty server/tool", JSON.stringify(r0));

console.log(`\nmcp-pin.test.js: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
