#!/usr/bin/env bash
# check-file-write-floor.sh — Fixture sweep for F24 (credential-persistence-write)
# and universal file-write scoring. Scans `tests/fixtures/file-write-floor/*.input`
# and asserts decide() + journal pin the expected receipt shape.
#
# Fixture shape (JSON):
#   {
#     "title": "...",
#     "env":     { "...": "..." },        (optional)
#     "contract": { ... } | null,         (optional)
#     "acceptContract": true|false,        (optional)
#     "input": { ... },
#     "expected": {
#       "action": "...",
#       "decisionSource": "..." | null,    (omit to skip check)
#       "floorFired": "..." | null,
#       "rung": N | null,
#       "latticeVersion": "1" | null,      (omit to skip check)
#       "irHashPresent": true | false | null,
#       "reasonCodesIncludes": ["..."] | null
#     }
#   }
#
# Exit 0 = all green. Exit 1 = any divergence.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

fixture_dir="$root/tests/fixtures/file-write-floor"

if ! command -v node >/dev/null 2>&1; then
  if [ "${LILARA_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-file-write-floor (LILARA_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-file-write-floor.sh requires Node.js\n' >&2
  exit 1
fi

if [ ! -d "$fixture_dir" ]; then
  printf 'Error: %s missing\n' "$fixture_dir" >&2
  exit 1
fi

printf '[check-file-write-floor]\n'

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

  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), `arg-f24-st-${name}-`));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `arg-f24-pr-${name}-`));
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

    if (fx.env && typeof fx.env === "object") {
      for (const [k, v] of Object.entries(fx.env)) setEnv(k, v);
    }

    if (fx.contract && typeof fx.contract === "object") {
      const doc = JSON.parse(JSON.stringify(fx.contract));
      if (!fx.badHash) {
        doc.contractHash = hashContract(doc);
      } else if (typeof doc.contractHash !== "string") {
        doc.contractHash = "sha256:" + "0".repeat(64);
      }
      fs.writeFileSync(path.join(projectDir, "lilara.contract.json"), JSON.stringify(doc, null, 2));

      const shouldAccept = fx.acceptContract != null ? fx.acceptContract : !fx.badHash;
      if (shouldAccept) {
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

    const { build: buildIr } = require(path.join(root, "runtime/action-ir"));
    const ir = buildIr(decideInput, {
      harness:     String(decideInput.harness || ""),
      tool:        String(decideInput.tool || "Write"),
      command:     String(decideInput.command || ""),
      cwd:         decideInput.projectRoot || projectDir,
      projectRoot: decideInput.projectRoot || projectDir,
      branch:      decideInput.branch || "",
    });
    decideInput.ir = ir;

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
    if (exp.decisionSource !== undefined && result.decisionSource !== exp.decisionSource) {
      diffs.push(`decisionSource: got=${result.decisionSource} want=${exp.decisionSource}`);
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
      if (exp.latticeVersion != null && lastEntry.latticeVersion !== exp.latticeVersion) {
        diffs.push(`journal.latticeVersion: got=${lastEntry.latticeVersion} want=${exp.latticeVersion}`);
      }
      if (exp.irHashPresent === true) {
        if (typeof lastEntry.irHash !== "string" || lastEntry.irHash.length === 0) {
          diffs.push(`journal.irHash: missing or empty (got=${JSON.stringify(lastEntry.irHash)})`);
        }
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

process.stdout.write(`\nResults: ${pass} passed, ${fail} failed (${files.length} fixtures total).\n`);
process.exit(fail === 0 ? 0 : 1);
NODE
