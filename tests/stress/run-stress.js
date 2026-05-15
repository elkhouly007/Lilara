#!/usr/bin/env node
"use strict";

// Stress + graceful-degradation harness (locked scope §5.1). Discovers
// tests/stress/scenarios/*.scenario.js, runs each in an isolated state dir,
// asserts the engine degrades gracefully (ADR-004), writes per-scenario
// receipt + journal artifacts under artifacts/stress/<id>/.
//
// Observe-only — must not modify runtime/*.js. A scenario surfacing a real
// engine bug FAILs here; the fix is a separate, scoped follow-up PR.
//
// Run:  node tests/stress/run-stress.js   |   STRESS_SCENARIO=<id> node ...

const fs   = require("node:fs");
const os   = require("node:os");
const path = require("node:path");

const ROOT      = path.resolve(__dirname, "..", "..");
const SCENARIOS = path.join(__dirname, "scenarios");
const ARTIFACTS = path.join(ROOT, "artifacts", "stress");

function discover() {
  if (!fs.existsSync(SCENARIOS)) return [];
  const filter = process.env.STRESS_SCENARIO || "";
  return fs.readdirSync(SCENARIOS)
    .filter((f) => f.endsWith(".scenario.js") && (!filter || f.startsWith(filter)))
    .sort();
}

function clearRuntimeCache() {
  const prefix = path.join(ROOT, "runtime") + path.sep;
  for (const k of Object.keys(require.cache)) if (k.startsWith(prefix)) delete require.cache[k];
}

function readJournal(stateDir) {
  const p = path.join(stateDir, "decision-journal.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { _malformed: true, raw: line }; }
  });
}

function verifyChain(stateDir) {
  const file = path.join(stateDir, "journal-chain.jsonl");
  if (!fs.existsSync(file)) return { ok: true, entryCount: 0, errors: [] };
  clearRuntimeCache();
  return require(path.join(ROOT, "runtime", "journal-chain")).verify({ file });
}

function copyIfExists(src, dest) {
  try { if (fs.existsSync(src)) fs.copyFileSync(src, dest); } catch { /* best-effort */ }
}

const STRIPPED_ENV = ["HORUS_KILL_SWITCH", "HORUS_CONTRACT_REQUIRED", "HORUS_DEGRADED_MODE", "HORUS_F4_DEMOTE_TOKEN"];

async function runOne(file) {
  const scenario = require(path.join(SCENARIOS, file));
  const id       = String(scenario.id || file.replace(/\.scenario\.js$/, ""));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-stress-st-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-stress-pr-"));
  const outDir   = path.join(ARTIFACTS, id);
  fs.mkdirSync(outDir, { recursive: true });
  const snap = Object.assign({}, process.env);
  let teardown = null, out = { result: null, error: null, threw: false };
  let chain = { ok: true, entryCount: 0, errors: [] };
  let status = "passed", assertError = null;
  try {
    Object.assign(process.env, { HORUS_STATE_DIR: stateDir, HORUS_DECISION_JOURNAL: "1", HORUS_CONTRACT_ENABLED: "0", HORUS_RATE_LIMIT: "0" });
    for (const k of STRIPPED_ENV) delete process.env[k];
    clearRuntimeCache();
    const ctx = { id, stateDir, projectDir, outDir, root: ROOT };
    if (typeof scenario.setup === "function") teardown = await scenario.setup(ctx);
    clearRuntimeCache();
    const engine = require(path.join(ROOT, "runtime", "decision-engine"));
    try {
      const r = await scenario.exercise(engine, ctx);
      out = { result: (r && r.result) || null, error: null, threw: false, extra: (r && r.extra) || null };
    } catch (err) { out = { result: null, error: err, threw: true }; }
    const journal = readJournal(stateDir);
    chain = verifyChain(stateDir);
    try { await scenario.assertGraceful(out, journal, ctx); }
    catch (err) { status = "failed"; assertError = err; }
    fs.writeFileSync(path.join(outDir, "receipt.json"), JSON.stringify({
      scenarioId: id, status, threw: out.threw,
      error: out.error ? String(out.error.message || out.error) : null,
      assertError: assertError ? String(assertError.message || assertError) : null,
      result: out.result, extra: out.extra || null,
      journalEntries: journal.length,
      chain: { ok: chain.ok, entryCount: chain.entryCount, errors: chain.errors },
    }, null, 2));
    copyIfExists(path.join(stateDir, "decision-journal.jsonl"), path.join(outDir, "decision-journal.jsonl"));
    copyIfExists(path.join(stateDir, "journal-chain.jsonl"),    path.join(outDir, "journal-chain.jsonl"));
  } finally {
    if (typeof teardown === "function") {
      try { await teardown(); } catch (err) { process.stderr.write(`  WARN teardown ${id}: ${err && err.message || err}\n`); }
    }
    try { fs.rmSync(stateDir,   { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
    for (const k of Object.keys(process.env)) if (!(k in snap)) delete process.env[k];
    for (const [k, v] of Object.entries(snap)) process.env[k] = v;
  }
  return { id, status, assertError };
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const files = discover();
  if (files.length === 0) {
    process.stderr.write("STRESS: no scenarios under tests/stress/scenarios/\n");
    process.exit(2);
  }
  let passed = 0, failed = 0;
  const results = [];
  for (const file of files) {
    process.stdout.write(`  run  ${file}\n`);
    let res;
    try { res = await runOne(file); }
    catch (err) { res = { id: file, status: "failed", assertError: err }; }
    results.push(res);
    if (res.status === "passed") { passed += 1; process.stdout.write(`  ok   ${res.id}\n`); }
    else { failed += 1; process.stderr.write(`  FAIL ${res.id}: ${res.assertError && (res.assertError.stack || res.assertError.message) || res.assertError}\n`); }
  }
  fs.writeFileSync(path.join(ARTIFACTS, "summary.json"), JSON.stringify({
    passed, failed, total: results.length,
    scenarios: results.map((r) => ({ id: r.id, status: r.status })),
  }, null, 2));
  process.stdout.write(`\nSTRESS: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`STRESS: harness crashed: ${err && err.stack || err}\n`);
  process.exit(2);
});
