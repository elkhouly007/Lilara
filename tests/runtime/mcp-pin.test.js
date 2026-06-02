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

// checkArgShapeDrift: type change causes drift, then re-pins so same shape no longer drifts
withPins(() => {
  checkArgShapeDrift({ server: "github", tool: "search", args: { q: "hello" } });
  const r1 = checkArgShapeDrift({ server: "github", tool: "search", args: { q: 42 } }); // type change string→number
  r1.drift === true ? ok("drift: type change detected") : fail("drift: type change detected", JSON.stringify(r1));
  const r2 = checkArgShapeDrift({ server: "github", tool: "search", args: { q: 99 } }); // same shape (number) after re-pin
  r2.drift === false ? ok("drift: re-pins after first change — same shape no drift") : fail("drift: re-pins after first change — same shape no drift", JSON.stringify(r2));
  const r3 = checkArgShapeDrift({ server: "github", tool: "search", args: { q: true } }); // second change: number→boolean
  (r3.drift === true && r3.changeCount === 2) ? ok("drift: second change increments changeCount to 2") : fail("drift: second change increments changeCount to 2", JSON.stringify(r3));
});

// checkArgShapeDrift: fail-open on missing server/tool
const r0 = checkArgShapeDrift({ server: "", tool: "", args: {} });
r0.drift === false ? ok("drift: fail-open on empty server/tool") : fail("drift: fail-open on empty server/tool", JSON.stringify(r0));

// ─── ADR-024: state-dir permission validation ─────────────────────────────────
// These tests prove that checkArgShapeDrift fails-safe when LILARA_STATE_DIR
// is world-writable (POSIX only) and that normal safe dirs still work.

// ADR-024 T1: safe temp dir → normal drift detection still works (regression guard)
withPins((dir) => {
  const r = checkArgShapeDrift({ server: "svc", tool: "op", args: { x: 1 } });
  r.drift === false && !r.reason
    ? ok("ADR024-T1: safe state-dir → first-sight no drift (regression guard)")
    : fail("ADR024-T1: safe state-dir → no drift", JSON.stringify(r));
});

if (process.platform !== "win32") {
  // ADR-024 T2 (POSIX): world-writable state dir → fail-safe, no I/O
  // chmod 0777 makes the dir world-writable; ensureStateDirSafe must return false.
  // Expected result: { drift: false, reason: "state-dir-insecure" }
  // AND no pins.json written inside the poisoned dir.
  withPins((dir) => {
    fs.chmodSync(dir, 0o777); // make world-writable
    try {
      const r = checkArgShapeDrift({ server: "evil-svc", tool: "op", args: { x: 1 } });
      r.drift === false && r.reason === "state-dir-insecure"
        ? ok("ADR024-T2 (POSIX): world-writable state-dir → { drift:false, reason:'state-dir-insecure' }")
        : fail("ADR024-T2 (POSIX): world-writable state-dir", `result=${JSON.stringify(r)}`);
      // Confirm no pins.json was written under the poisoned location
      const pinsPath = path.join(dir, "mcp-pins", "pins.json");
      !fs.existsSync(pinsPath)
        ? ok("ADR024-T2 (POSIX): no pins.json written to poisoned location")
        : fail("ADR024-T2 (POSIX): no I/O to poisoned location", `pins.json exists at ${pinsPath}`);
    } finally {
      fs.chmodSync(dir, 0o700); // restore so withPins cleanup can rmSync
    }
  });

  // ADR-024 T3 (POSIX): safe dir after fix → drift detection resumes correctly
  withPins((dir) => {
    // dir is created by mkdtempSync (mode 0o700) — safe by default
    checkArgShapeDrift({ server: "db", tool: "query", args: { sql: "SELECT 1" } });
    const r = checkArgShapeDrift({ server: "db", tool: "query", args: { sql: 42 } }); // type change
    r.drift === true
      ? ok("ADR024-T3 (POSIX): safe dir → drift detection works as expected")
      : fail("ADR024-T3 (POSIX): safe dir → drift detection", JSON.stringify(r));
  });
} else {
  // Windows: world-writable check is skipped (POSIX mode bits are meaningless).
  // Verify that drift detection still works normally (no false-unsafe).
  withPins((dir) => {
    const r = checkArgShapeDrift({ server: "svc", tool: "op", args: { x: 1 } });
    r.drift === false && !r.reason
      ? ok("ADR024-T2 (Windows): state-dir check skipped, drift detection works normally")
      : fail("ADR024-T2 (Windows): drift detection", JSON.stringify(r));
  });
}

// ─── ADR-029: ENOENT vs parse-error split in _readPins() ────────────────────
// Confirms that a corrupt pin file suspends drift detection (with an explicit
// reason) rather than silently resetting to first-sight, and that the ENOENT
// path is unaffected (still legit first-sight with no reason field).

// ADR-029-T1: corrupt pin file → { drift:false, reason:"pin-store-corrupt" }
// Platform-independent: file-level corruption is not gated by POSIX mode bits.
withPins((dir) => {
  // Create the mcp-pins/ subdir and write invalid JSON, simulating corruption.
  const pinsDir  = path.join(dir, "mcp-pins");
  const pinsPath = path.join(pinsDir, "pins.json");
  fs.mkdirSync(pinsDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(pinsPath, "THIS IS NOT JSON {{{", { mode: 0o600 });

  const r = checkArgShapeDrift({ server: "trusted-db", tool: "query", args: { sql: "string" } });
  (r.drift === false && r.reason === "pin-store-corrupt")
    ? ok("ADR029-T1: corrupt pins.json → { drift:false, reason:'pin-store-corrupt' }")
    : fail("ADR029-T1: corrupt pins.json result", JSON.stringify(r));

  // The original corrupt file must remain in place (not renamed away).
  // Keeping it means detection stays visibly suspended on every call until repaired.
  const originalContent = (() => {
    try { return fs.readFileSync(pinsPath, "utf8"); } catch { return null; }
  })();
  (originalContent !== null && originalContent.includes("THIS IS NOT JSON"))
    ? ok("ADR029-T1: corrupt pins.json stays in place (detection remains visibly suspended)")
    : fail("ADR029-T1: corrupt pins.json should remain at original path", `content=${originalContent}`);

  // A forensic .corrupt.*.bak copy must exist alongside.
  const bakFiles = fs.readdirSync(pinsDir).filter((n) => n.includes(".corrupt.") && n.endsWith(".bak"));
  bakFiles.length >= 1
    ? ok("ADR029-T1: forensic .corrupt.*.bak copy created for operator inspection")
    : fail("ADR029-T1: forensic .corrupt.*.bak copy not found", `files in pinsDir: ${fs.readdirSync(pinsDir).join(", ")}`);
});

// ADR-029-T2: ENOENT regression — first-sight returns { drift:false } with NO reason field.
// Locks the ENOENT-vs-parse split: missing file must never be treated as corruption.
withPins(() => {
  const r = checkArgShapeDrift({ server: "trusted-db", tool: "query", args: { sql: "string" } });
  (r.drift === false && !r.reason)
    ? ok("ADR029-T2: ENOENT (no pin file) → { drift:false } with no reason (first-sight unchanged)")
    : fail("ADR029-T2: ENOENT should not set reason", JSON.stringify(r));
});

console.log(`\nmcp-pin.test.js: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
