#!/usr/bin/env bash
# check-migrate-v2-v3.sh — CI gate: end-to-end migration from v2 → v3.
# Tests: (a) draft validates against schema, (b) version=3, (c) all v2 fields preserved
# byte-for-byte, (d) hash recomputes correctly, (e) v3 input → exit 0, no draft written.
set -euo pipefail

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ── 1. Write a minimal well-formed v2 fixture ─────────────────────────────────
cat > "$tmp/lilara.contract.json" <<'JSON'
{
  "version": 2,
  "contractId": "lilara-20260508-aabbccddeeff",
  "revision": 1,
  "acceptedAt": "2026-05-08T00:00:00Z",
  "acceptedBy": "test-operator",
  "harnessScope": ["claude"],
  "trustPosture": "balanced",
  "scopes": {
    "payloadClasses": { "A": "allow", "B": "warn", "C": "block" }
  },
  "contractHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}
JSON

# Recompute hash so the fixture is internally consistent
node -e "
const fs = require('fs');
const { hashContract } = require('./runtime/contract');
const p = process.argv[1];
const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
delete doc.contractHash;
doc.contractHash = hashContract(doc);
fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
" -- "$tmp/lilara.contract.json"

# ── 2. Run migration ──────────────────────────────────────────────────────────
node scripts/migrateV2ToV3.js "$tmp/lilara.contract.json" "$tmp/lilara.contract.json.draft"

# ── 3. Validate draft ─────────────────────────────────────────────────────────
node -e "
const fs = require('fs');
const draft = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const orig  = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

if (draft.version !== 3) { console.error('FAIL: version not 3 (got ' + draft.version + ')'); process.exit(1); }

// All v2 fields except version and contractHash must be byte-equal
for (const k of Object.keys(orig)) {
  if (k === 'version' || k === 'contractHash') continue;
  if (JSON.stringify(orig[k]) !== JSON.stringify(draft[k])) {
    console.error('FAIL: field changed: ' + k + ' — orig=' + JSON.stringify(orig[k]) + ' draft=' + JSON.stringify(draft[k]));
    process.exit(1);
  }
}

const { validateContract } = require('./runtime/config-validator');
const v = validateContract(draft);
if (!v.valid) {
  console.error('FAIL: schema validation errors:');
  for (const e of v.errors) console.error('  ' + e);
  process.exit(1);
}

const { hashContract } = require('./runtime/contract');
const noHash = JSON.parse(JSON.stringify(draft));
delete noHash.contractHash;
const recomputed = hashContract(noHash);
if (recomputed !== draft.contractHash) {
  console.error('FAIL: hash mismatch — draft has ' + draft.contractHash + ' but recomputed ' + recomputed);
  process.exit(1);
}

console.log('check-migrate-v2-v3: draft OK (version=3, lossless, schema-valid, hash-correct)');
" -- "$tmp/lilara.contract.json.draft" "$tmp/lilara.contract.json"

# ── 4. Idempotency: v3 input → exit 0, stderr message, no second draft written ─
stderr_out="$(node scripts/migrateV2ToV3.js "$tmp/lilara.contract.json.draft" "$tmp/lilara.contract.json.draft2" 2>&1 1>/dev/null || true)"
exit_code=0
node scripts/migrateV2ToV3.js "$tmp/lilara.contract.json.draft" "$tmp/lilara.contract.json.draft2" 2>/dev/null || exit_code=$?
if [ "$exit_code" -ne 0 ]; then
  echo "FAIL: migrating a v3 file should exit 0 (idempotent), got exit=$exit_code"
  exit 1
fi
if ! echo "$stderr_out" | grep -qF "already version 3"; then
  echo "FAIL: expected 'already version 3' on stderr, got: $stderr_out"
  exit 1
fi
if [ -f "$tmp/lilara.contract.json.draft2" ]; then
  echo "FAIL: idempotent no-op should not write a second draft"
  exit 1
fi

echo "check-migrate-v2-v3: idempotency OK"
echo "check-migrate-v2-v3: ALL CHECKS PASSED"
