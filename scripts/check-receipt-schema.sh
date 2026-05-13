#!/usr/bin/env bash
# check-receipt-schema.sh — HAP ADR-007 PR-C: additive-only receipt schema gate.
#
# Runs the lattice-receipts fixture sweep, collects every journal entry +
# decide() return shape produced, and asserts:
#
#   1. No required field disappears compared to the pinned baseline.
#   2. Each field's type matches the baseline (e.g. `rung` stays a number,
#      `irHash` stays a string).
#   3. New fields are allowed (additive only) — but any field flagged as
#      `required` in the baseline must be present in every receipt that hits
#      a floor whose lattice rung is annotated.
#
# Replays the sample-journal (artifacts/journal/sample-journal.jsonl) through
# the engine and asserts the regenerated journal entries still parse against
# the additive schema — protects pre-PR-C journals from rejection.
#
# Usage: bash scripts/check-receipt-schema.sh

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  if [ "${HORUS_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-receipt-schema (HORUS_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-receipt-schema.sh requires Node.js\n' >&2
  exit 1
fi

printf '[check-receipt-schema]\n'

node - "$root" <<'NODE' || exit 1
"use strict";
const fs   = require("fs");
const os   = require("os");
const path = require("path");
const root = process.argv[2];

// Receipt schema (additive-only). PR-C locks in these fields and their
// types; future additions are fine, removals or type changes are not.
// `optional` fields are NOT required on every entry (e.g. taintSource only
// appears on F10 hits) — but if present, their type must match.
const RECEIPT_SCHEMA = {
  // Always-present journal fields
  required: {
    ts:          "string",
    kind:        "string",
    action:      "string",
    riskLevel:   "string",
    riskScore:   "number",
    reasonCodes: "array",
    tool:        "string",
    branch:      "string",
    targetPath:  "string",
    notes:       "string",
  },
  // Optional pass-through fields (present only when populated)
  optional: {
    contractId:       "string",
    contractRevision: "string",
    scopeHit:         "string",
    floorFired:       "string",
    taintSource:      "string",
    taintReason:      "string",
    intent:           "string",
    irHash:           "string",
    latticeVersion:   "string",
    rung:             "number",
    redactInJournal:  "boolean",
  },
};

function typeOf(v) {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v;
}

function validateEntry(entry, label) {
  const errs = [];
  for (const [k, want] of Object.entries(RECEIPT_SCHEMA.required)) {
    if (!(k in entry)) {
      errs.push(`${label}: missing required field '${k}'`);
      continue;
    }
    const got = typeOf(entry[k]);
    if (got !== want) errs.push(`${label}: field '${k}' type ${got} (expected ${want})`);
  }
  for (const [k, want] of Object.entries(RECEIPT_SCHEMA.optional)) {
    if (!(k in entry)) continue;
    const got = typeOf(entry[k]);
    if (got !== want) errs.push(`${label}: optional field '${k}' type ${got} (expected ${want})`);
  }
  return errs;
}

let totalEntries = 0;
const allErrors = [];

// 1. Sample-journal replay (PR-B compatibility): the engine must reproduce
//    additive-schema-valid receipts from the canonical sample input set.
const replayInput = path.join(root, "artifacts/journal/sample-journal.jsonl");
if (!fs.existsSync(replayInput)) {
  console.error("  ERROR   sample-journal missing:", replayInput);
  process.exit(1);
}

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-receipt-schema-"));
process.env.HORUS_STATE_DIR        = stateDir;
process.env.HORUS_CONTRACT_ENABLED = "0";
process.env.HORUS_DECISION_JOURNAL = "1";
process.env.HORUS_TRAJECTORY_WINDOW_MIN = "0";
delete process.env.HORUS_IR_JOURNAL; // exercise PR-C default (= on)

const { decide } = require(path.join(root, "runtime/decision-engine"));
const { build: buildIr } = require(path.join(root, "runtime/action-ir"));

const lines = fs.readFileSync(replayInput, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  let src;
  try { src = JSON.parse(line); } catch { continue; }
  if (src.kind !== "runtime-decision") continue;
  const input = {
    tool:        src.tool       || "Bash",
    command:     src.command    || "",
    targetPath:  src.targetPath || "",
    branch:      src.branch     || "",
    payloadClass: src.payloadClass || "A",
    notes:       "receipt-schema-replay",
  };
  input.ir = buildIr(input, {
    harness: "", tool: input.tool, command: input.command,
    cwd: input.targetPath, projectRoot: stateDir, branch: input.branch,
  });
  try { decide(input); } catch (e) {
    allErrors.push(`replay error: ${e.message}`);
  }
}

const journalFile = path.join(stateDir, "decision-journal.jsonl");
if (!fs.existsSync(journalFile)) {
  console.error("  ERROR   no journal produced");
  process.exit(1);
}
for (const ln of fs.readFileSync(journalFile, "utf8").split("\n").filter(Boolean)) {
  let entry;
  try { entry = JSON.parse(ln); } catch { allErrors.push("malformed journal line"); continue; }
  if (entry.kind !== "runtime-decision") continue;
  totalEntries++;
  for (const e of validateEntry(entry, `replay#${totalEntries}`)) allErrors.push(e);
}
try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }

// 2. Lattice-receipts: invoke each fixture and validate the most-recent
//    journal entry it produces. Reuses the lattice-receipts runner so a
//    schema bug is caught alongside the labelling check.
const fxRoot = path.join(root, "tests/fixtures/lattice-receipts");
for (const f of fs.readdirSync(fxRoot).filter(x => x.endsWith(".input")).sort()) {
  // Re-run by re-requiring the runner — but that's heavyweight. Simpler:
  // run the fixture inline.
  const fxStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-rs-fx-"));
  const fxProject  = fs.mkdtempSync(path.join(os.tmpdir(), "arg-rs-pr-"));
  const fx = JSON.parse(fs.readFileSync(path.join(fxRoot, f), "utf8"));

  const envSnapshot = Object.assign({}, process.env);
  process.env.HORUS_STATE_DIR        = fxStateDir;
  process.env.HORUS_CONTRACT_ENABLED = fx.contract ? "1" : "0";
  process.env.HORUS_DECISION_JOURNAL = "1";
  process.env.HORUS_RATE_LIMIT       = "0";
  delete process.env.HORUS_KILL_SWITCH;
  delete process.env.HORUS_CONTRACT_REQUIRED;
  delete process.env.HORUS_F4_DEMOTE_TOKEN;
  delete process.env.HORUS_IR_JOURNAL;
  if (fx.env) for (const [k, v] of Object.entries(fx.env)) process.env[k] = String(v);

  // Reset runtime caches
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.join(root, "runtime") + path.sep)) delete require.cache[k];
  }

  // Write contract if any
  if (fx.contract && typeof fx.contract === "object") {
    const { canonicalJson } = require(path.join(root, "runtime/canonical-json"));
    const crypto = require("crypto");
    let doc = JSON.parse(JSON.stringify(fx.contract));
    // Dynamic out-of-window helper
    if (doc.validity && doc.validity.computeOutOfWindow === true) {
      const now = new Date();
      const target = new Date(now.getTime() + 12 * 3600 * 1000);
      const sh = String(target.getUTCHours()).padStart(2, "0");
      const sm = String(target.getUTCMinutes()).padStart(2, "0");
      const em = String((target.getUTCMinutes() + 1) % 60).padStart(2, "0");
      const eh = (target.getUTCMinutes() + 1 >= 60)
        ? String((target.getUTCHours() + 1) % 24).padStart(2, "0")
        : sh;
      doc.validity = { activeHoursUtc: { start: `${sh}:${sm}`, end: `${eh}:${em}` } };
    }
    if (!fx.badHash) {
      const { contractHash: _o, ...rest } = doc;
      doc.contractHash = "sha256:" + crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
    } else if (typeof doc.contractHash !== "string") {
      doc.contractHash = "sha256:" + "0".repeat(64);
    }
    fs.writeFileSync(path.join(fxProject, "horus.contract.json"), JSON.stringify(doc, null, 2));
    const shouldAccept = fx.acceptContract != null ? fx.acceptContract : !fx.badHash;
    if (shouldAccept) {
      const acceptedKey = path.resolve(fxProject);
      fs.writeFileSync(path.join(fxStateDir, "accepted-contracts.json"), JSON.stringify({
        [acceptedKey]: {
          contractHash: doc.contractHash,
          acceptedAt: doc.acceptedAt || "2026-01-01T00:00:00Z",
          revision: doc.revision || 1,
          contractId: doc.contractId,
        },
      }, null, 2));
    }
  }
  // Session counters
  if (fx.session) {
    const sid = String(fx.session.sessionId || "fixture-session");
    const ageMin = Number(fx.session.startTimeAgoMin || 0);
    const dir = path.join(fxStateDir, "session-budget");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify({
      destructiveOps: Number(fx.session.destructiveOps || 0),
      externalBytes:  Number(fx.session.externalBytes || 0),
      startTime: Date.now() - ageMin * 60_000,
    }, null, 2), { mode: 0o600 });
  }
  if (fx.preDecide && fx.preDecide.recordExternalRead) {
    require(path.join(root, "runtime/taint")).recordExternalRead(String(fx.preDecide.recordExternalRead), "fixture-setup");
  }
  if (fx.preDecide && fx.preDecide.mintF4DemoteToken) {
    const { mintOperatorToken } = require(path.join(root, "runtime/contract"));
    process.env.HORUS_F4_DEMOTE_TOKEN = mintOperatorToken("receipt-schema-fx", "class-c-review-demote");
  }

  const input = Object.assign({ projectRoot: fxProject }, fx.input || {});
  if (fx.session && fx.session.sessionId) input.sessionId = String(fx.session.sessionId);
  const buildIr2 = require(path.join(root, "runtime/action-ir")).build;
  input.ir = buildIr2(input, {
    harness: String(input.harness || ""), tool: String(input.tool || "Bash"),
    command: String(input.command || ""), cwd: input.targetPath || fxProject,
    projectRoot: fxProject, branch: input.branch || "",
  });
  const { decide: decide2 } = require(path.join(root, "runtime/decision-engine"));
  try { decide2(input); } catch (e) { allErrors.push(`${f}: decide threw ${e.message}`); }

  const jf = path.join(fxStateDir, "decision-journal.jsonl");
  if (fs.existsSync(jf)) {
    for (const ln of fs.readFileSync(jf, "utf8").split("\n").filter(Boolean)) {
      let entry;
      try { entry = JSON.parse(ln); } catch { continue; }
      if (entry.kind !== "runtime-decision") continue;
      totalEntries++;
      for (const e of validateEntry(entry, `${f}#last`)) allErrors.push(e);
    }
  }

  // Restore env + cleanup
  for (const k of Object.keys(process.env)) if (!(k in envSnapshot)) delete process.env[k];
  for (const [k, v] of Object.entries(envSnapshot)) process.env[k] = v;
  try { fs.rmSync(fxStateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(fxProject,  { recursive: true, force: true }); } catch { /* ignore */ }
}

if (allErrors.length > 0) {
  console.error("  ERROR   receipt-schema violations:");
  for (const e of allErrors.slice(0, 30)) console.error("    " + e);
  if (allErrors.length > 30) console.error(`    ... and ${allErrors.length - 30} more`);
  process.exit(1);
}

console.log(`  ok      ${totalEntries} receipts validated against additive-only schema`);
console.log("\ncheck-receipt-schema passed.");
NODE
