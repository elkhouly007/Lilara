"use strict";

const assert = require("node:assert");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("  ok      " + name);
    passed++;
  } catch (e) {
    console.error("  FAIL    " + name);
    console.error("          " + e.message);
    failed++;
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sarif-test-"));
}

function writeJournal(dir, entries) {
  fs.mkdirSync(path.join(dir, ".lilara"), { recursive: true, mode: 0o700 });
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, ".lilara", "decision-journal.jsonl"), lines, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("entries without floorFired are excluded", () => {
  const d = tmpDir();
  process.env.LILARA_STATE_DIR = path.join(d, ".lilara");
  writeJournal(d, [
    { action: "allow", riskLevel: "low", notes: "ok" },
  ]);
  const { exportSarif } = require("../../runtime/sarif-export");
  const result = exportSarif();
  assert.strictEqual(result.resultCount, 0);
  delete process.env.LILARA_STATE_DIR;
  fs.rmSync(d, { recursive: true, force: true });
});

test("entries with floorFired are included", () => {
  const d = tmpDir();
  process.env.LILARA_STATE_DIR = path.join(d, ".lilara");
  writeJournal(d, [
    { action: "block", floorFired: "F8_PROTECTED_BRANCH", riskLevel: "high", notes: "branch protected", targetPath: "src/auth.ts", timestamp: new Date().toISOString() },
    { action: "allow", riskLevel: "low", notes: "normal" },
  ]);
  const { exportSarif } = require("../../runtime/sarif-export");
  const result = exportSarif();
  assert.strictEqual(result.resultCount, 1);
  assert.strictEqual(result.sarif.runs[0].results[0].ruleId, "F8_PROTECTED_BRANCH");
  delete process.env.LILARA_STATE_DIR;
  fs.rmSync(d, { recursive: true, force: true });
});

test("riskLevel high → SARIF level error", () => {
  const d = tmpDir();
  process.env.LILARA_STATE_DIR = path.join(d, ".lilara");
  writeJournal(d, [
    { action: "block", floorFired: "F3_CRITICAL_RISK", riskLevel: "critical", notes: "critical" },
  ]);
  const { exportSarif } = require("../../runtime/sarif-export");
  const result = exportSarif();
  assert.strictEqual(result.sarif.runs[0].results[0].level, "error");
  delete process.env.LILARA_STATE_DIR;
  fs.rmSync(d, { recursive: true, force: true });
});

test("riskLevel medium → SARIF level warning", () => {
  const d = tmpDir();
  process.env.LILARA_STATE_DIR = path.join(d, ".lilara");
  writeJournal(d, [
    { action: "block", floorFired: "F9_SESSION_RISK", riskLevel: "medium", notes: "medium risk" },
  ]);
  const { exportSarif } = require("../../runtime/sarif-export");
  const result = exportSarif();
  assert.strictEqual(result.sarif.runs[0].results[0].level, "warning");
  delete process.env.LILARA_STATE_DIR;
  fs.rmSync(d, { recursive: true, force: true });
});

test("SARIF schema shape: version + tool driver name", () => {
  const d = tmpDir();
  process.env.LILARA_STATE_DIR = path.join(d, ".lilara");
  writeJournal(d, [
    { action: "block", floorFired: "F1_KILL_SWITCH", riskLevel: "critical", notes: "ks" },
  ]);
  const { exportSarif } = require("../../runtime/sarif-export");
  const result = exportSarif();
  assert.strictEqual(result.sarif.version, "2.1.0");
  assert.strictEqual(result.sarif.runs[0].tool.driver.name, "Lilara");
  delete process.env.LILARA_STATE_DIR;
  fs.rmSync(d, { recursive: true, force: true });
});

test("--since filters out old entries", () => {
  const d = tmpDir();
  process.env.LILARA_STATE_DIR = path.join(d, ".lilara");
  const old  = new Date(Date.now() - 2 * 86400000).toISOString(); // 2 days ago
  const recent = new Date().toISOString();
  writeJournal(d, [
    { action: "block", floorFired: "F8_PROTECTED_BRANCH", riskLevel: "high", notes: "old", timestamp: old },
    { action: "block", floorFired: "F3_CRITICAL_RISK",    riskLevel: "critical", notes: "new", timestamp: recent },
  ]);
  const { exportSarif } = require("../../runtime/sarif-export");
  // since = yesterday
  const since = new Date(Date.now() - 86400000).toISOString();
  const result = exportSarif({ since });
  assert.strictEqual(result.resultCount, 1);
  assert.strictEqual(result.sarif.runs[0].results[0].ruleId, "F3_CRITICAL_RISK");
  delete process.env.LILARA_STATE_DIR;
  fs.rmSync(d, { recursive: true, force: true });
});

test("output written to file when outputPath given", () => {
  const d = tmpDir();
  process.env.LILARA_STATE_DIR = path.join(d, ".lilara");
  writeJournal(d, [
    { action: "block", floorFired: "F1_KILL_SWITCH", riskLevel: "critical", notes: "ks" },
  ]);
  const outFile = path.join(d, "out.sarif.json");
  const { exportSarif } = require("../../runtime/sarif-export");
  const result = exportSarif({ outputPath: outFile });
  assert.ok(fs.existsSync(outFile));
  const sarif = JSON.parse(fs.readFileSync(outFile, "utf8"));
  assert.strictEqual(sarif.version, "2.1.0");
  assert.strictEqual(result.outputPath, outFile);
  delete process.env.LILARA_STATE_DIR;
  fs.rmSync(d, { recursive: true, force: true });
});

console.log();
console.log("sarif-export: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
