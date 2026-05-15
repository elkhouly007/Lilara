#!/usr/bin/env bash
# generate-receipt-schema.sh — ADR-014 deterministic schema exhaustiveness
# gate. Replays every tests/fixtures/lattice-receipts/*.input through
# runtime/decision-engine.decide() and collects the union of top-level keys
# emitted across every resulting journal entry. Asserts:
#
#   1. Every key in the union is present as a property in
#      schemas/receipt.v1.json (no orphan code-path emits an unknown field).
#   2. The schema is byte-identical to itself after a no-op re-write (proves
#      it's well-formed JSON and not in flux).
#
# The script does NOT regenerate the schema from scratch — schemas/receipt.v1.json
# is hand-authored to express SOC2 expectations; this gate is the receipts of
# that authority. To accept a new field, hand-edit the schema and re-run.
#
# Exit 0 = schema is exhaustive. Exit 1 = at least one fixture emits a field
# the schema does not list.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

schema_file="$root/schemas/receipt.v1.json"
fixture_dir="$root/tests/fixtures/lattice-receipts"

if ! command -v node >/dev/null 2>&1; then
  printf 'Error: node not found on PATH — generate-receipt-schema.sh requires Node.js\n' >&2
  exit 1
fi

[ -f "$schema_file" ] || { printf 'Error: %s missing\n' "$schema_file" >&2; exit 1; }
[ -d "$fixture_dir" ] || { printf 'Error: %s missing\n' "$fixture_dir" >&2; exit 1; }

printf '[generate-receipt-schema]\n'

node - "$root" "$schema_file" "$fixture_dir" <<'NODE'
"use strict";
const fs   = require("fs");
const os   = require("os");
const path = require("path");
const crypto = require("crypto");

const root        = process.argv[2];
const schemaFile  = process.argv[3];
const fixtureDir  = process.argv[4];

const schema = JSON.parse(fs.readFileSync(schemaFile, "utf8"));
const allowedKeys = new Set(Object.keys(schema.properties || {}));

// Byte-stability: re-serialise the schema with the same tooling that a future
// drift edit would use; require an exact match so the on-disk schema is
// committed in the same canonical form a hand edit produces.
const reSerialized = JSON.stringify(schema, null, 2) + "\n";
const onDisk       = fs.readFileSync(schemaFile, "utf8");
if (reSerialized !== onDisk) {
  process.stderr.write("  ERROR   schema not in canonical 2-space pretty form\n");
  process.exit(1);
}

function freshRequireCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.join(root, "runtime") + path.sep)) delete require.cache[k];
  }
}

function runFixture(fixturePath) {
  const name = path.basename(fixturePath, ".input");
  const raw = fs.readFileSync(fixturePath, "utf8");
  let fx;
  try { fx = JSON.parse(raw); }
  catch (err) { return { name, ok: false, reason: "parse-error: " + err.message }; }

  const stateDir   = fs.mkdtempSync(path.join(os.tmpdir(), "arg-grs-st-" + name + "-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-grs-pr-" + name + "-"));
  const envSnapshot = Object.assign({}, process.env);

  try {
    process.env.HORUS_STATE_DIR        = stateDir;
    process.env.HORUS_CONTRACT_ENABLED = fx.contract ? "1" : "0";
    process.env.HORUS_DECISION_JOURNAL = "1";
    process.env.HORUS_RATE_LIMIT       = "0";
    delete process.env.HORUS_KILL_SWITCH;
    delete process.env.HORUS_CONTRACT_REQUIRED;
    delete process.env.HORUS_F4_DEMOTE_TOKEN;
    delete process.env.HORUS_IR_JOURNAL;
    if (fx.env) for (const [k, v] of Object.entries(fx.env)) process.env[k] = String(v);

    freshRequireCache();

    const { canonicalJson } = require(path.join(root, "runtime/canonical-json"));
    if (fx.contract && typeof fx.contract === "object") {
      let doc = JSON.parse(JSON.stringify(fx.contract));
      if (doc.validity && doc.validity.computeOutOfWindow === true) {
        const now = new Date();
        const target = new Date(now.getTime() + 12 * 3600 * 1000);
        const sh = String(target.getUTCHours()).padStart(2, "0");
        const sm = String(target.getUTCMinutes()).padStart(2, "0");
        const em = String((target.getUTCMinutes() + 1) % 60).padStart(2, "0");
        const eh = (target.getUTCMinutes() + 1 >= 60)
          ? String((target.getUTCHours() + 1) % 24).padStart(2, "0") : sh;
        doc.validity = { activeHoursUtc: { start: sh + ":" + sm, end: eh + ":" + em } };
      }
      if (!fx.badHash) {
        const { contractHash: _o, ...rest } = doc;
        doc.contractHash = "sha256:" + crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
      } else if (typeof doc.contractHash !== "string") {
        doc.contractHash = "sha256:" + "0".repeat(64);
      }
      fs.writeFileSync(path.join(projectDir, "horus.contract.json"), JSON.stringify(doc, null, 2));
      const shouldAccept = fx.acceptContract != null ? fx.acceptContract : !fx.badHash;
      if (shouldAccept) {
        const acceptedKey = path.resolve(projectDir);
        fs.writeFileSync(path.join(stateDir, "accepted-contracts.json"), JSON.stringify({
          [acceptedKey]: { contractHash: doc.contractHash, acceptedAt: doc.acceptedAt || "2026-01-01T00:00:00Z", revision: doc.revision || 1, contractId: doc.contractId },
        }, null, 2));
      }
    }
    if (fx.session) {
      const sid = String(fx.session.sessionId || "fixture-session");
      const dir = path.join(stateDir, "session-budget");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, sid + ".json"), JSON.stringify({
        destructiveOps: Number(fx.session.destructiveOps || 0),
        externalBytes:  Number(fx.session.externalBytes || 0),
        startTime: Date.now() - Number(fx.session.startTimeAgoMin || 0) * 60_000,
      }, null, 2), { mode: 0o600 });
    }
    if (fx.preDecide && fx.preDecide.recordExternalRead) {
      require(path.join(root, "runtime/taint")).recordExternalRead(String(fx.preDecide.recordExternalRead), "fixture-setup");
    }
    if (fx.preDecide && fx.preDecide.mintF4DemoteToken) {
      const { mintOperatorToken } = require(path.join(root, "runtime/contract"));
      process.env.HORUS_F4_DEMOTE_TOKEN = mintOperatorToken("schema-gen", "class-c-review-demote");
    }
    if (fx.preDecide && Array.isArray(fx.preDecide.seedCrossAgentLocks)) {
      const lockDir = path.join(stateDir, "cross-agent-locks");
      fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
      let idx = 0;
      for (const tmpl of fx.preDecide.seedCrossAgentLocks) {
        idx += 1;
        const rec = JSON.parse(JSON.stringify(tmpl));
        for (const k of Object.keys(rec)) {
          if (typeof rec[k] === "string") rec[k] = rec[k].replace(/\{\{projectRoot\}\}/g, projectDir);
          else if (Array.isArray(rec[k])) rec[k] = rec[k].map((v) => typeof v === "string" ? v.replace(/\{\{projectRoot\}\}/g, projectDir) : v);
        }
        if (rec.expiresAtRelMs != null) { rec.expiresAt = Date.now() + Number(rec.expiresAtRelMs); delete rec.expiresAtRelMs; }
        const nm = String(rec.lockId || ("lock-" + idx)).replace(/[^A-Za-z0-9_.-]/g, "_") + ".json";
        fs.writeFileSync(path.join(lockDir, nm), JSON.stringify(rec, null, 2), { mode: 0o600 });
      }
    }

    function substInput(v) {
      if (typeof v === "string") return v.replace(/\{\{projectRoot\}\}/g, projectDir);
      if (Array.isArray(v)) return v.map(substInput);
      if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = substInput(v[k]); return o; }
      return v;
    }
    const decideInput = Object.assign({ projectRoot: projectDir }, substInput(fx.input || {}));
    if (fx.session && fx.session.sessionId) decideInput.sessionId = String(fx.session.sessionId);

    const { build: buildIr } = require(path.join(root, "runtime/action-ir"));
    decideInput.ir = buildIr(decideInput, {
      harness: String(decideInput.harness || ""), tool: String(decideInput.tool || "Bash"),
      command: String(decideInput.command || ""), cwd: decideInput.targetPath || projectDir,
      projectRoot: projectDir, branch: decideInput.branch || "",
    });

    const { decide } = require(path.join(root, "runtime/decision-engine"));
    try { decide(decideInput); } catch { /* fixture may throw; we only care about journal output */ }

    const journalFile = path.join(stateDir, "decision-journal.jsonl");
    const entries = [];
    if (fs.existsSync(journalFile)) {
      for (const ln of fs.readFileSync(journalFile, "utf8").split("\n").filter(Boolean)) {
        try { entries.push(JSON.parse(ln)); } catch { /* skip */ }
      }
    }
    return { name, ok: true, entries };
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in envSnapshot)) delete process.env[k];
    for (const [k, v] of Object.entries(envSnapshot)) process.env[k] = v;
    try { fs.rmSync(stateDir,   { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

const seenKeys = new Set();
const files = fs.readdirSync(fixtureDir).filter((f) => f.endsWith(".input")).sort();
let totalEntries = 0;
for (const f of files) {
  const r = runFixture(path.join(fixtureDir, f));
  if (!r.ok) { process.stderr.write("  ERROR  " + r.name + " — " + r.reason + "\n"); process.exit(1); }
  for (const e of r.entries) {
    totalEntries++;
    for (const k of Object.keys(e)) seenKeys.add(k);
  }
}

const orphan = [];
for (const k of seenKeys) if (!allowedKeys.has(k)) orphan.push(k);
orphan.sort();
if (orphan.length > 0) {
  process.stderr.write("  ERROR   fields emitted by engine but not in schema:\n");
  for (const k of orphan) process.stderr.write("    + " + k + "\n");
  process.stderr.write("  Edit schemas/receipt.v1.json to accept these, then re-run.\n");
  process.exit(1);
}

process.stdout.write("  ok      schema exhaustive: " + seenKeys.size + " key(s) across " + totalEntries + " entries / " + files.length + " fixtures\n");
process.stdout.write("  ok      schema canonical: byte-stable on re-serialise\n");
process.stdout.write("\ngenerate-receipt-schema passed.\n");
NODE
