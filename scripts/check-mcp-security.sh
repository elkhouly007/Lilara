#!/usr/bin/env bash
# check-mcp-security.sh — Fixture sweep for MCP security floors:
#   F25 (mcp-arg-danger), F4 opt-out (policy:allow), rug-pull drift detection.
#
# Fixture shape (JSON):
#   {
#     "title": "...",
#     "contract": { ... } | null,         (optional)
#     "input": { ... },
#     "expected": {
#       "action": "...",
#       "floorFired": "..." | null,
#       "rung": N | null,                  (null = not checked)
#       "reasonCodesIncludes": ["..."] | null
#     }
#   }
#
# Also runs an inline rug-pull multi-call test (not a fixture file).
#
# Exit 0 = all green. Exit 1 = any divergence.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

fixture_dir="$root/tests/fixtures/mcp-security"

if ! command -v node >/dev/null 2>&1; then
  if [ "${LILARA_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-mcp-security (LILARA_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-mcp-security.sh requires Node.js\n' >&2
  exit 1
fi

if [ ! -d "$fixture_dir" ]; then
  printf 'Error: %s missing\n' "$fixture_dir" >&2
  exit 1
fi

printf '[check-mcp-security]\n'

node - "$root" "$fixture_dir" <<'NODE'
"use strict";
const fs   = require("fs");
const os   = require("os");
const path = require("path");
const crypto = require("crypto");

const root        = process.argv[2];
const fixtureDir  = process.argv[3];

const { canonicalJson } = require(path.join(root, "runtime/canonical-json"));

function hashContract(doc) {
  const { contractHash: _omit, ...rest } = doc;
  return "sha256:" + crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
}

function substitute(value, projectDir) {
  if (typeof value === "string") return value.replace(/\{\{projectRoot\}\}/g, projectDir);
  if (Array.isArray(value)) return value.map((v) => substitute(v, projectDir));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = substitute(value[k], projectDir);
    return out;
  }
  return value;
}

function runFixture(fixturePath) {
  const name = path.basename(fixturePath, ".input");
  const raw = fs.readFileSync(fixturePath, "utf8");
  let fxRaw;
  try { fxRaw = JSON.parse(raw); }
  catch (err) { return { name, ok: false, reason: `parse-error: ${err.message}` }; }

  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-sec-st-${name}-`));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-sec-pr-${name}-`));
  const fx = substitute(fxRaw, projectDir);
  const cleanup = () => {
    try { fs.rmSync(stateDir,   { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  const envSnapshot = Object.assign({}, process.env);
  const setEnv = (k, v) => {
    if (v == null) delete process.env[k];
    else process.env[k] = String(v);
  };

  try {
    setEnv("LILARA_STATE_DIR",       stateDir);
    setEnv("LILARA_CONTRACT_ENABLED", fx.contract ? "1" : "0");
    setEnv("LILARA_DECISION_JOURNAL", "1");
    setEnv("LILARA_RATE_LIMIT",       "0");
    setEnv("LILARA_TRAJECTORY_THRESHOLD", "9999");
    delete process.env.LILARA_KILL_SWITCH;
    delete process.env.LILARA_CONTRACT_REQUIRED;
    delete process.env.LILARA_F4_DEMOTE_TOKEN;
    delete process.env.LILARA_IR_JOURNAL;

    if (fx.contract && typeof fx.contract === "object") {
      const doc = JSON.parse(JSON.stringify(fx.contract));
      doc.contractHash = hashContract(doc);
      fs.writeFileSync(path.join(projectDir, "lilara.contract.json"), JSON.stringify(doc, null, 2));

      const acceptedPath = path.join(stateDir, "accepted-contracts.json");
      const acceptedKey  = path.resolve(projectDir);
      const record = {
        [acceptedKey]: {
          contractHash: doc.contractHash,
          acceptedAt:   doc.acceptedAt || "2026-01-01T00:00:00Z",
          revision:     doc.revision || 1,
          contractId:   doc.contractId,
        }
      };
      fs.writeFileSync(acceptedPath, JSON.stringify(record, null, 2));
    }

    // Drop runtime/* from require cache for per-fixture isolation.
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(root, "runtime") + path.sep)) {
        delete require.cache[key];
      }
    }

    const decideInput = Object.assign({
      projectRoot: projectDir,
    }, fx.input || {});

    const { decide } = require(path.join(root, "runtime/decision-engine"));
    const result = decide(decideInput);

    const journalFile = path.join(stateDir, "decision-journal.jsonl");
    let lastEntry = null;
    if (fs.existsSync(journalFile)) {
      const lines = fs.readFileSync(journalFile, "utf8").split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const e = JSON.parse(lines[i]);
          if (e.kind === "runtime-decision") { lastEntry = e; break; }
        } catch { /* skip malformed */ }
      }
    }

    const exp = fx.expected || {};
    const diffs = [];

    if (exp.action !== undefined && result.action !== exp.action) {
      diffs.push(`action: got=${result.action} want=${exp.action}`);
    }
    if (exp.floorFired !== undefined && (result.floorFired || null) !== exp.floorFired) {
      diffs.push(`floorFired: got=${result.floorFired} want=${exp.floorFired}`);
    }
    if (Array.isArray(exp.reasonCodesIncludes)) {
      for (const code of exp.reasonCodesIncludes) {
        if (!Array.isArray(result.reasonCodes) || result.reasonCodes.indexOf(code) === -1) {
          diffs.push(`reasonCode missing: ${code} (got=${JSON.stringify(result.reasonCodes)})`);
        }
      }
    }

    if (!lastEntry) {
      diffs.push("journal: no runtime-decision entry written");
    } else {
      if (exp.rung != null && lastEntry.rung !== exp.rung) {
        diffs.push(`journal.rung: got=${lastEntry.rung} want=${exp.rung}`);
      }
      if (exp.rung === null && lastEntry.rung != null) {
        diffs.push(`journal.rung: got=${lastEntry.rung} want=null`);
      }
    }

    if (diffs.length === 0) return { name, ok: true };
    return { name, ok: false, reason: diffs.join("; ") };
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in envSnapshot)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(envSnapshot)) {
      process.env[k] = v;
    }
    cleanup();
  }
}

const files = fs.readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".input"))
  .sort();

let pass = 0, fail = 0;
for (const f of files) {
  const r = runFixture(path.join(fixtureDir, f));
  if (r.ok) {
    process.stdout.write(`  ok      ${r.name}\n`);
    pass++;
  } else {
    process.stdout.write(`  FAIL    ${r.name} — ${r.reason}\n`);
    fail++;
  }
}

// ── Inline rug-pull multi-call test ────────────────────────────────────────
// Tests that checkArgShapeDrift pins on first call, passes on same shape,
// and flags type change (string→number) as drift.
process.stdout.write("\n[rug-pull inline test]\n");

{
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sec-rugpull-"));
  const prevStateDir = process.env.LILARA_STATE_DIR;
  process.env.LILARA_STATE_DIR = stateDir;

  // Drop mcp-pin from require cache so it picks up the new state dir
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(root, "runtime") + path.sep)) {
      delete require.cache[key];
    }
  }

  try {
    const { checkArgShapeDrift } = require(path.join(root, "runtime/mcp-pin"));

    // Call 1: first sight — should NOT drift
    const r1 = checkArgShapeDrift({ server: "github", tool: "search_repos", args: { query: "string-value" } });
    if (r1.drift === false) {
      process.stdout.write(`  ok      rug-pull: first-call-no-drift\n`);
      pass++;
    } else {
      process.stdout.write(`  FAIL    rug-pull: first-call-no-drift — expected drift=false, got drift=true\n`);
      fail++;
    }

    // Call 2: same shape — should NOT drift
    const r2 = checkArgShapeDrift({ server: "github", tool: "search_repos", args: { query: "string-value" } });
    if (r2.drift === false) {
      process.stdout.write(`  ok      rug-pull: second-call-same-shape-no-drift\n`);
      pass++;
    } else {
      process.stdout.write(`  FAIL    rug-pull: second-call-same-shape-no-drift — expected drift=false, got drift=true\n`);
      fail++;
    }

    // Call 3: type change string→number — SHOULD drift
    const r3 = checkArgShapeDrift({ server: "github", tool: "search_repos", args: { query: 42 } });
    if (r3.drift === true) {
      process.stdout.write(`  ok      rug-pull: third-call-type-change-drift\n`);
      pass++;
    } else {
      process.stdout.write(`  FAIL    rug-pull: third-call-type-change-drift — expected drift=true (type string→number), got drift=${r3.drift}\n`);
      fail++;
    }
  } finally {
    if (prevStateDir === undefined) delete process.env.LILARA_STATE_DIR;
    else process.env.LILARA_STATE_DIR = prevStateDir;
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ── ADR-018: trusted-server dual-use + drift inline test ──────────────────
// Tests that _evalMcpArgFloor escalates allow→require-review only when BOTH
// arg-shape drift AND a GATED_REVIEW dual-use class are present for a trusted
// server. Drift alone (fixture C) must NOT escalate. Uses decide() end-to-end
// (not just checkArgShapeDrift) to prove the full threading.
process.stdout.write("\n[ADR-018 trusted-dualuse-drift inline tests]\n");

function makeContract(server, projectDir, stateDir) {
  const doc = {
    version: 1,
    contractId: "lilara-20260101-000000000a18",
    revision: 1,
    acceptedAt: "2026-01-01T00:00:00Z",
    acceptedBy: "operator",
    harnessScope: ["claude"],
    trustPosture: "balanced",
    scopes: { mcp: { [server]: { policy: "allow" } } },
  };
  doc.contractHash = "sha256:" + require("crypto").createHash("sha256")
    .update(canonicalJson({ ...doc, contractHash: undefined }), "utf8").digest("hex");
  const { contractHash: _h, ...rest } = doc;
  doc.contractHash = "sha256:" + require("crypto").createHash("sha256")
    .update(canonicalJson(rest), "utf8").digest("hex");
  fs.writeFileSync(path.join(projectDir, "lilara.contract.json"), JSON.stringify(doc, null, 2));
  const acceptedKey = path.resolve(projectDir);
  fs.writeFileSync(path.join(stateDir, "accepted-contracts.json"), JSON.stringify({
    [acceptedKey]: { contractHash: doc.contractHash, acceptedAt: doc.acceptedAt, revision: 1, contractId: doc.contractId },
  }, null, 2));
}

// ── Fixture B: trusted server + GATED_REVIEW dual-use + drift → require-review ──
{
  const stateDir  = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sec-adr018b-"));
  const projDir   = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sec-adr018b-p-"));
  const prevEnv   = Object.assign({}, process.env);
  process.env.LILARA_STATE_DIR        = stateDir;
  process.env.LILARA_CONTRACT_ENABLED = "1";
  process.env.LILARA_DECISION_JOURNAL = "1";
  process.env.LILARA_RATE_LIMIT       = "0";
  process.env.LILARA_TRAJECTORY_THRESHOLD = "9999";
  delete process.env.LILARA_KILL_SWITCH;
  try {
    makeContract("db", projDir, stateDir);
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(root, "runtime") + path.sep)) delete require.cache[key];
    }
    const { decide } = require(path.join(root, "runtime/decision-engine"));

    // Call 1: benign arg shape X (seeds pin: {sql:string})
    const r1 = decide({ tool: "mcp__db__query", harness: "claude", command: "", branch: "main",
      tool_input: { sql: "SELECT 1" }, projectRoot: projDir });
    if (r1.action === "allow") {
      process.stdout.write(`  ok      adr018-B: first-call-seed-allow\n`); pass++;
    } else {
      process.stdout.write(`  FAIL    adr018-B: first-call-seed-allow — got action=${r1.action}\n`); fail++;
    }

    // Call 2: drift (new key) + dual-use (DROP DATABASE) → require-review
    const r2 = decide({ tool: "mcp__db__query", harness: "claude", command: "", branch: "main",
      tool_input: { sql: "DROP DATABASE prod", mode: "immediate" }, projectRoot: projDir });
    const b2ok = r2.action === "require-review" &&
      Array.isArray(r2.reasonCodes) &&
      r2.reasonCodes.some((c) => c === "mcp-arg-danger-review-required");
    if (b2ok) {
      process.stdout.write(`  ok      adr018-B: drift+dualuse-require-review\n`); pass++;
    } else {
      process.stdout.write(`  FAIL    adr018-B: drift+dualuse-require-review — action=${r2.action} codes=${JSON.stringify(r2.reasonCodes)}\n`); fail++;
    }
  } finally {
    for (const k of Object.keys(process.env)) { if (!(k in prevEnv)) delete process.env[k]; }
    for (const [k, v] of Object.entries(prevEnv)) { process.env[k] = v; }
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(projDir,  { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ── Fixture C: trusted server + drift only (no dual-use) → allow ──────────
{
  const stateDir  = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sec-adr018c-"));
  const projDir   = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sec-adr018c-p-"));
  const prevEnv   = Object.assign({}, process.env);
  process.env.LILARA_STATE_DIR        = stateDir;
  process.env.LILARA_CONTRACT_ENABLED = "1";
  process.env.LILARA_DECISION_JOURNAL = "1";
  process.env.LILARA_RATE_LIMIT       = "0";
  process.env.LILARA_TRAJECTORY_THRESHOLD = "9999";
  delete process.env.LILARA_KILL_SWITCH;
  try {
    makeContract("logs", projDir, stateDir);
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(root, "runtime") + path.sep)) delete require.cache[key];
    }
    const { decide } = require(path.join(root, "runtime/decision-engine"));

    // Call 1: seed pin with shape X ({query:string})
    const r1 = decide({ tool: "mcp__logs__search", harness: "claude", command: "", branch: "main",
      tool_input: { query: "error" }, projectRoot: projDir });
    if (r1.action === "allow") {
      process.stdout.write(`  ok      adr018-C: first-call-seed-allow\n`); pass++;
    } else {
      process.stdout.write(`  FAIL    adr018-C: first-call-seed-allow — got action=${r1.action}\n`); fail++;
    }

    // Call 2: drift (added key) but benign content → allow (drift alone MUST NOT escalate)
    const r2 = decide({ tool: "mcp__logs__search", harness: "claude", command: "", branch: "main",
      tool_input: { query: "error", limit: 10 }, projectRoot: projDir });
    if (r2.action === "allow") {
      process.stdout.write(`  ok      adr018-C: drift-only-still-allow\n`); pass++;
    } else {
      process.stdout.write(`  FAIL    adr018-C: drift-only-still-allow — got action=${r2.action} (drift alone must not escalate)\n`); fail++;
    }
  } finally {
    for (const k of Object.keys(process.env)) { if (!(k in prevEnv)) delete process.env[k]; }
    for (const [k, v] of Object.entries(prevEnv)) { process.env[k] = v; }
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(projDir,  { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

process.stdout.write(`\nResults: ${pass} passed, ${fail} failed (${files.length} fixtures + inline tests).\n`);
process.exit(fail === 0 ? 0 : 1);
NODE
