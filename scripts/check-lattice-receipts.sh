#!/usr/bin/env bash
# check-lattice-receipts.sh — HAP ADR-007 PR-C fixture sweep.
#
# Runs every `tests/fixtures/lattice-receipts/*.input` fixture through
# `runtime/decision-engine.decide()` (with a per-fixture pre-built IR) and
# asserts the decide() return + journal entry pin a stable receipt shape
# (irHash, floorFired, rung, latticeVersion, decisionSource, action) for the
# fixture's floor.
#
# Fixture shape (JSON):
#   {
#     "title": "...",
#     "env":     { "...": "..." },        # extra env vars (default: none)
#     "contract": { ... } | null,         # written to projectRoot/horus.contract.json
#     "acceptContract": true|false,       # also accept it via accepted-contracts.json
#     "session": {                        # session counter pre-state (F9/F14/F14b)
#       "sessionId": "test", "destructiveOps": N, "externalBytes": N, "startTimeAgoMin": N
#     } | null,
#     "preDecide": {                      # extra setup (F10 taint)
#       "recordExternalRead": "..." | null
#     } | null,
#     "input": { ... },                   # decide() arguments
#     "expected": {
#       "action": "...",
#       "decisionSource": "..." | null,
#       "floorFired": "..." | null,
#       "rung": N | null,
#       "latticeVersion": "1" | null,
#       "irHashPresent": true | false | null,
#       "reasonCodesIncludes": ["..."] | null,
#       "journalWritten": true | false   # default true
#     }
#   }
#
# Exit 0 = all green. Exit 1 = any divergence.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

fixture_dir="$root/tests/fixtures/lattice-receipts"

if ! command -v node >/dev/null 2>&1; then
  if [ "${HORUS_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-lattice-receipts (HORUS_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-lattice-receipts.sh requires Node.js\n' >&2
  exit 1
fi

if [ ! -d "$fixture_dir" ]; then
  printf 'Error: %s missing\n' "$fixture_dir" >&2
  exit 1
fi

printf '[check-lattice-receipts]\n'

node - "$root" "$fixture_dir" <<'NODE'
"use strict";
const fs   = require("fs");
const os   = require("os");
const path = require("path");
const crypto = require("crypto");

const root        = process.argv[2];
const fixtureDir  = process.argv[3];

function freshRequire(modPath) {
  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  return require(modPath);
}

const { canonicalJson } = require(path.join(root, "runtime/canonical-json"));

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object") {
    const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
    if (!deepEqual(ak, bk)) return false;
    for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function hashContract(doc) {
  const { contractHash: _omit, ...rest } = doc;
  return "sha256:" + crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
}

function runFixture(fixturePath) {
  const name = path.basename(fixturePath, ".input");
  const raw = fs.readFileSync(fixturePath, "utf8");
  let fx;
  try { fx = JSON.parse(raw); }
  catch (err) { return { name, ok: false, reason: `parse-error: ${err.message}` }; }

  // Isolated state dir + project root per fixture.
  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), `arg-lr-st-${name}-`));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `arg-lr-pr-${name}-`));
  const cleanup = () => {
    try { fs.rmSync(stateDir,   { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  // Snapshot + restore env so fixtures don't pollute each other.
  const envSnapshot = Object.assign({}, process.env);
  const setEnv = (k, v) => {
    if (v == null) delete process.env[k];
    else process.env[k] = String(v);
  };

  try {
    // Base env: isolated state, contract enabled by default for fixtures
    // that ship one, otherwise disabled so no real contract leaks in.
    setEnv("HORUS_STATE_DIR",       stateDir);
    setEnv("HORUS_CONTRACT_ENABLED", fx.contract ? "1" : "0");
    setEnv("HORUS_DECISION_JOURNAL", "1");
    setEnv("HORUS_RATE_LIMIT",       "0");
    delete process.env.HORUS_KILL_SWITCH;
    delete process.env.HORUS_CONTRACT_REQUIRED;
    delete process.env.HORUS_F4_DEMOTE_TOKEN;
    delete process.env.HORUS_IR_JOURNAL; // exercise the PR-C default (= "1")

    if (fx.env && typeof fx.env === "object") {
      for (const [k, v] of Object.entries(fx.env)) setEnv(k, v);
    }

    // Write contract if provided. Compute hash from the doc (after stripping
    // contractHash) so verify() can match when the fixture wants accept.
    if (fx.contract && typeof fx.contract === "object") {
      let doc = JSON.parse(JSON.stringify(fx.contract));
      // Dynamic validity window: F11 fixture asks the runner to compute an
      // activeHoursUtc range that is guaranteed outside the current time so
      // the test isn't flaky across the 24-h cycle. Resolves at fixture-load
      // time, producing a deterministic 1-minute window 12h offset.
      if (doc.validity && doc.validity.computeOutOfWindow === true) {
        const now = new Date();
        const offsetHours = 12;
        const target = new Date(now.getTime() + offsetHours * 3600 * 1000);
        const startH = String(target.getUTCHours()).padStart(2, "0");
        const startM = String(target.getUTCMinutes()).padStart(2, "0");
        const endM   = String((target.getUTCMinutes() + 1) % 60).padStart(2, "0");
        const endH   = (target.getUTCMinutes() + 1 >= 60)
          ? String((target.getUTCHours() + 1) % 24).padStart(2, "0")
          : startH;
        doc.validity = {
          activeHoursUtc: { start: `${startH}:${startM}`, end: `${endH}:${endM}` },
        };
      }
      // Use a deterministic hash so we can test F2 hash-mismatch via the
      // `badHash: true` flag — leaves the contractHash deliberately wrong.
      if (!fx.badHash) {
        doc.contractHash = hashContract(doc);
      } else if (typeof doc.contractHash !== "string") {
        doc.contractHash = "sha256:" + "0".repeat(64);
      }
      fs.writeFileSync(path.join(projectDir, "horus.contract.json"), JSON.stringify(doc, null, 2));

      // accept-record optional (default: accept unless badHash).
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

    // Session counters
    if (fx.session && typeof fx.session === "object") {
      const sb = require(path.join(root, "runtime/session-budget"));
      const sid = String(fx.session.sessionId || "fixture-session");
      const ageMin = Number(fx.session.startTimeAgoMin || 0);
      const startTime = Date.now() - ageMin * 60_000;
      const counters = {
        destructiveOps: Number(fx.session.destructiveOps || 0),
        externalBytes:  Number(fx.session.externalBytes  || 0),
        startTime,
      };
      // Direct write so the engine reads our pre-seeded state.
      const dir = path.join(stateDir, "session-budget");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify(counters, null, 2), { mode: 0o600 });
    }

    // Per-fixture isolation: drop runtime/* modules from require cache so the
    // decision-engine's lazy contract cache (_contractLoaded / _contract),
    // contract.js _cache, taint state, and session-context cache all start
    // fresh. Cheap (~20 modules) and bullet-proof against per-fixture
    // contamination. Done BEFORE pre-decide hooks so the modules pre-decide
    // touches (taint, contract) are the same instances decide() will load.
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(root, "runtime") + path.sep)) {
        delete require.cache[key];
      }
    }

    // Pre-decide hooks (F10 taint, F4 operator token).
    if (fx.preDecide && fx.preDecide.recordExternalRead) {
      const taint = require(path.join(root, "runtime/taint"));
      taint.recordExternalRead(String(fx.preDecide.recordExternalRead), "fixture-setup");
    }
    if (fx.preDecide && fx.preDecide.mintF4DemoteToken) {
      const { mintOperatorToken } = require(path.join(root, "runtime/contract"));
      const tok = mintOperatorToken("lattice-receipts-fx", "class-c-review-demote");
      setEnv("HORUS_F4_DEMOTE_TOKEN", tok);
    }

    // Build canonical IR from the same flat input we feed decide(). This
    // gives the engine an `ir.irHash` to journal.
    const decideInput = Object.assign({
      projectRoot: projectDir,
    }, fx.input || {});

    // sessionId routing: when a session fixture is present, pin sessionId so
    // decide() reads our pre-seeded counters.
    if (fx.session && fx.session.sessionId) {
      decideInput.sessionId = String(fx.session.sessionId);
    }

    const { build: buildIr } = require(path.join(root, "runtime/action-ir"));
    const ir = buildIr(decideInput, {
      harness:     String(decideInput.harness || ""),
      tool:        String(decideInput.tool || "Bash"),
      command:     String(decideInput.command || ""),
      cwd:         decideInput.targetPath || projectDir,
      projectRoot: projectDir,
      branch:      decideInput.branch || "",
    });
    decideInput.ir = ir;

    const { decide } = require(path.join(root, "runtime/decision-engine"));
    const result = decide(decideInput);

    // Locate the most-recent journal entry (if any).
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

    // Compare expected vs actual
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

    const journalWritten = exp.journalWritten !== undefined ? exp.journalWritten : true;
    if (journalWritten) {
      if (!lastEntry) {
        diffs.push("journal: no runtime-decision entry written");
      } else {
        if (exp.rung != null && lastEntry.rung !== exp.rung) {
          diffs.push(`journal.rung: got=${lastEntry.rung} want=${exp.rung}`);
        }
        if (exp.latticeVersion != null && lastEntry.latticeVersion !== exp.latticeVersion) {
          diffs.push(`journal.latticeVersion: got=${lastEntry.latticeVersion} want=${exp.latticeVersion}`);
        }
        if (exp.irHashPresent === true) {
          if (typeof lastEntry.irHash !== "string" || lastEntry.irHash.length === 0) {
            diffs.push(`journal.irHash: missing or empty (got=${JSON.stringify(lastEntry.irHash)})`);
          }
        }
        if (exp.journalFloorFired !== undefined && (lastEntry.floorFired || null) !== exp.journalFloorFired) {
          diffs.push(`journal.floorFired: got=${lastEntry.floorFired} want=${exp.journalFloorFired}`);
        }
      }
    } else if (lastEntry) {
      // Some fixtures (kill-switch) explicitly expect no journal entry.
      diffs.push("journal: entry written but expected=false");
    }

    if (diffs.length === 0) {
      return { name, ok: true };
    }
    return { name, ok: false, reason: diffs.join("; ") };
  } finally {
    // Restore env
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
const failures = [];

for (const f of files) {
  const r = runFixture(path.join(fixtureDir, f));
  if (r.ok) {
    process.stdout.write(`  ok      ${r.name}\n`);
    pass++;
  } else {
    process.stdout.write(`  FAIL    ${r.name} — ${r.reason}\n`);
    fail++;
    failures.push(r.name);
  }
}

process.stdout.write(`\nResults: ${pass} passed, ${fail} failed (${files.length} fixtures total).\n`);
process.exit(fail === 0 ? 0 : 1);
NODE
