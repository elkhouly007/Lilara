#!/usr/bin/env bash
# check-migrate-v1-v2.sh — Verify that migrateV1ToV2.js correctly upgrades a v1
# contract: version bumps, revision increments, hash recomputes, schema validates.
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  printf '[check-migrate-v1-v2] node not found — skipping\n' >&2
  exit 0
fi

printf '[check-migrate-v1-v2]\n'

pass() { printf '  ok  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1" >&2; exit 1; }

# ── Build a minimal v1 contract in a temp dir ──────────────────────────────
tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

# Generate a v1 contract via `lilara-cli contract init`, then accept the draft.
# We use LILARA_STATE_DIR + LILARA_CONTRACT_ENABLED=1 so the contract subsystem is live.
export LILARA_STATE_DIR="$tmp/state"
export LILARA_CONTRACT_ENABLED=1
mkdir -p "$LILARA_STATE_DIR"

# Use the Node contract module to write a minimal v1 fixture directly.
node - "$tmp" <<'NODE'
"use strict";
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");

const root    = path.join(__dirname, "..");
const tmpDir  = process.argv[2];

function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

function hashContract(doc) {
  const { contractHash: _omit, ...rest } = doc;
  return "sha256:" + crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
}

const v1 = {
  version:      1,
  contractId:   "lilara-20260425-abcdef012345",
  revision:     1,
  acceptedAt:   "2026-04-25T00:00:00.000Z",
  acceptedBy:   "test",
  harnessScope: ["claude"],
  trustPosture: "balanced",
  scopes: {
    filesystem: { readAllow: ["src/**"], writeAllow: ["src/**"] },
    network:    { outboundAllow: [], outboundDeny: [] }
  },
};
v1.contractHash = hashContract(v1);

fs.writeFileSync(path.join(tmpDir, "v1-contract.json"), JSON.stringify(v1, null, 2) + "\n");
console.log("v1 fixture written");
NODE

[ -f "$tmp/v1-contract.json" ] || fail "v1 fixture not created"
pass "v1 fixture created"

# ── Run migration in dry-run mode and capture output ──────────────────────
dry_output="$(node scripts/migrateV1ToV2.js --input "$tmp/v1-contract.json" --dry-run 2>&1)"
echo "$dry_output" | grep -q '"version": 2' || fail "dry-run: version not bumped to 2"
echo "$dry_output" | grep -q '"revision": 2' || fail "dry-run: revision not incremented"
pass "dry-run: version=2 and revision=2 present"

# ── Run migration in-place ─────────────────────────────────────────────────
node scripts/migrateV1ToV2.js --input "$tmp/v1-contract.json" --output "$tmp/v2-contract.json" 2>&1
[ -f "$tmp/v2-contract.json" ] || fail "migration output not created"
pass "migration produced output file"

# ── Validate the v2 output with Node ───────────────────────────────────────
node - "$tmp/v2-contract.json" "$root" <<'NODE'
"use strict";
const path = require("path");
const fs   = require("fs");
const root = process.argv[3];
const { validateContract } = require(path.join(root, "runtime/config-validator.js"));

const doc = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));


if (doc.version !== 2)   { console.error("FAIL: version is " + doc.version); process.exit(1); }
if (doc.revision !== 2)  { console.error("FAIL: revision is " + doc.revision); process.exit(1); }

const { valid, errors } = validateContract(doc);
if (!valid) {
  console.error("FAIL: schema validation errors:");
  errors.forEach(e => console.error("  " + e));
  process.exit(1);
}

// Verify hash integrity
const crypto = require("crypto");
function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}
const { contractHash: _omit, ...rest } = doc;
const expected = "sha256:" + crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
if (doc.contractHash !== expected) {
  console.error("FAIL: contractHash mismatch — migration did not recompute hash correctly");
  process.exit(1);
}
console.log("ok  v2 document valid (version=2, revision=2, hash verified)");
NODE

pass "v2 document passes schema validation and hash check"

# ── Idempotency: running migration on a v2 contract is a no-op ────────────
node scripts/migrateV1ToV2.js --input "$tmp/v2-contract.json" 2>&1 | grep -q 'already version 2' \
  || fail "migration on v2 contract did not report no-op"
pass "migration on v2 contract is idempotent (no-op)"

printf '\ncheck-migrate-v1-v2 passed.\n'
