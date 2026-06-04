#!/usr/bin/env bash
# check-inviolable-tier.sh — Verify the ADR-036 inviolable tier.
#
# Checks:
#   1. Lattice projection hash matches artifacts/lattice-baseline.sha256.
#   2. floor-codes.js raw sha256 matches the baseline.
#   3. INVIOLABLE_FLOOR_IDS derived set matches tier:'inviolable' entries in LATTICE.
#   4. enforcementFor("block", name) === "block" for every inviolable floor.
#
# Usage:
#   bash scripts/check-inviolable-tier.sh             # verify against baseline
#   bash scripts/check-inviolable-tier.sh --update    # update baseline to current state
#
# The baseline file must be committed to git so diffs are visible in PRs.
# Run --update after intentional lattice or floor-codes changes, then commit.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

BASELINE="artifacts/lattice-baseline.sha256"

pass() { printf '  ok      %s\n' "$1"; }
fail() { printf '  ERROR   %s\n' "$1" >&2; FAILED=1; }
FAILED=0

if ! command -v node >/dev/null 2>&1; then
  if [ "${LILARA_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-inviolable-tier (LILARA_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-inviolable-tier.sh requires Node.js\n' >&2
  exit 1
fi

# ── --update mode ─────────────────────────────────────────────────────────────

if [ "${1:-}" = "--update" ]; then
  lattice_hash="$(node -e "
    const {computeLatticeHash}=require('./runtime/decision-lattice');
    process.stdout.write(computeLatticeHash());
  ")"
  fc_hash="$(node -e "
    const crypto=require('crypto'), fs=require('fs');
    process.stdout.write(
      'sha256:' + crypto.createHash('sha256').update(fs.readFileSync('./runtime/floor-codes.js')).digest('hex')
    );
  ")"
  # Write updated baseline (preserving comment header).
  {
    grep '^#' "$BASELINE" 2>/dev/null || printf '# Lilara inviolable-tier lattice baseline\n'
    printf 'lattice %s\n' "$lattice_hash"
    printf 'floor-codes %s\n' "$fc_hash"
  } > "${BASELINE}.tmp"
  mv "${BASELINE}.tmp" "$BASELINE"
  printf 'Baseline updated: %s\n' "$BASELINE"
  printf 'Commit the updated baseline file to make changes visible in git diff.\n'
  exit 0
fi

# ── verify mode ───────────────────────────────────────────────────────────────

printf '[check-inviolable-tier]\n'

if [ ! -f "$BASELINE" ]; then
  printf 'ERROR: baseline not found at %s\n' "$BASELINE" >&2
  printf 'Run: bash scripts/check-inviolable-tier.sh --update\n' >&2
  exit 1
fi

# Read expected hashes from baseline.
expected_lattice="$(grep '^lattice '    "$BASELINE" | awk '{print $2}')"
expected_fc="$(     grep '^floor-codes ' "$BASELINE" | awk '{print $2}')"

if [ -z "$expected_lattice" ] || [ -z "$expected_fc" ]; then
  printf 'ERROR: baseline is missing lattice or floor-codes line\n' >&2
  fail "malformed baseline"
fi

# 1. Lattice hash.
actual_lattice="$(node -e "
  const {computeLatticeHash}=require('./runtime/decision-lattice');
  process.stdout.write(computeLatticeHash());
")"
if [ "$actual_lattice" = "$expected_lattice" ]; then
  pass "lattice hash matches baseline"
else
  fail "lattice hash MISMATCH (expected=${expected_lattice} actual=${actual_lattice})"
  fail "  If intentional: bash scripts/check-inviolable-tier.sh --update && git add ${BASELINE}"
fi

# 2. floor-codes.js hash.
actual_fc="$(node -e "
  const crypto=require('crypto'), fs=require('fs');
  process.stdout.write(
    'sha256:' + crypto.createHash('sha256').update(fs.readFileSync('./runtime/floor-codes.js')).digest('hex')
  );
")"
if [ "$actual_fc" = "$expected_fc" ]; then
  pass "floor-codes.js hash matches baseline"
else
  fail "floor-codes.js hash MISMATCH (expected=${expected_fc} actual=${actual_fc})"
  fail "  If intentional: bash scripts/check-inviolable-tier.sh --update && git add ${BASELINE}"
fi

# 3. INVIOLABLE_FLOOR_IDS ↔ tier:'inviolable' consistency.
node -e "
  const {INVIOLABLE_FLOOR_IDS, LATTICE} = require('./runtime/decision-lattice');
  const tierSet = new Set(LATTICE.filter(e => e.tier === 'inviolable').map(e => e.id));
  const idSet   = new Set(INVIOLABLE_FLOOR_IDS);
  const errors  = [];
  for (const id of tierSet) {
    if (!idSet.has(id)) errors.push('tier:inviolable entry ' + id + ' not in INVIOLABLE_FLOOR_IDS');
  }
  for (const id of idSet) {
    if (!tierSet.has(id)) errors.push('INVIOLABLE_FLOOR_IDS entry ' + id + ' lacks tier:inviolable');
  }
  if (errors.length > 0) { process.stderr.write(errors.join('\n') + '\n'); process.exit(1); }
  process.stdout.write('  ok      INVIOLABLE_FLOOR_IDS matches tier:inviolable set (' + INVIOLABLE_FLOOR_IDS.length + ' floors)\n');
" || { fail "INVIOLABLE_FLOOR_IDS / tier mismatch"; }

# 4. enforcementFor("block", name) === "block" for all inviolable floors.
node -e "
  const {INVIOLABLE_FLOOR_IDS, enforcementFor, getEntry} = require('./runtime/decision-lattice');
  const errors = [];
  for (const id of INVIOLABLE_FLOOR_IDS) {
    const e = getEntry(id);
    if (!e) { errors.push(id + ': entry not found'); continue; }
    const ef = enforcementFor('block', e.name);
    if (ef !== 'block') errors.push(id + '/' + e.name + ': enforcementFor returned ' + ef + ' (expected block)');
  }
  if (errors.length > 0) { process.stderr.write(errors.join('\n') + '\n'); process.exit(1); }
  process.stdout.write('  ok      enforcementFor(block, inviolable-name) === block for all ' + INVIOLABLE_FLOOR_IDS.length + ' floors\n');
" || { fail "enforcementFor check failed"; }

# ── Final result ──────────────────────────────────────────────────────────────

if [ "$FAILED" -eq 0 ]; then
  printf '\ncheck-inviolable-tier: PASS\n'
  exit 0
else
  printf '\ncheck-inviolable-tier: FAILED\n' >&2
  exit 1
fi
