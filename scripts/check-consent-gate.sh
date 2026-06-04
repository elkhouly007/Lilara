#!/usr/bin/env bash
# check-consent-gate.sh — CI gate for the 0.2.0 scope-based consent gate.
#
# Runs the 6 consent test files and checks two structural invariants:
#   1. runtime/floor-consent.js makes no FS writes (pure evaluator).
#   2. runtime/consent/transport.js has no reference to the stdin file descriptor.
#
# Exit: 0 = all pass; 1 = any failure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

run_test() {
  local label="$1"
  local file="$2"
  if node "$file" > /dev/null 2>&1; then
    echo "  ok  $label"
    ((PASS++)) || true
  else
    echo "  FAIL $label"
    node "$file" 2>&1 | head -40
    ((FAIL++)) || true
  fi
}

echo "=== consent-gate tests ==="

run_test "consent-floor"           tests/runtime/consent-floor.test.js
run_test "consent-grant-store"     tests/runtime/consent-grant-store.test.js
run_test "consent-early-review-fix" tests/runtime/consent-early-review-fix.test.js
run_test "consent-enforce-compat"  tests/runtime/consent-enforce-compat.test.js
run_test "consent-transport"       tests/runtime/consent-transport.test.js
run_test "consent-adversarial"     tests/runtime/consent-adversarial.test.js

echo ""
echo "=== structural invariants ==="

# Invariant 1: floor-consent.js must make no FS writes (it's a pure evaluator).
# Grep for fs.write*, fs.append*, fs.mkdir* in the floor-consent module.
CONSENT_FLOOR_WRITES=$(grep -E 'fs\.(write|append|mkdir|rename|unlink)' runtime/floor-consent.js 2>/dev/null || true)
if [ -n "$CONSENT_FLOOR_WRITES" ]; then
  echo "  FAIL floor-consent.js must not make FS writes (pure evaluator)"
  echo "$CONSENT_FLOOR_WRITES"
  ((FAIL++)) || true
else
  echo "  ok  floor-consent.js has no FS writes (pure)"
  ((PASS++)) || true
fi

# Invariant 2: transport.js must not reference stdin (fd 0) — it reads the TTY.
TRANSPORT_STDIN=$(grep 'process\.stdin' runtime/consent/transport.js 2>/dev/null || true)
if [ -n "$TRANSPORT_STDIN" ]; then
  echo "  FAIL transport.js must not reference process.stdin"
  echo "$TRANSPORT_STDIN"
  ((FAIL++)) || true
else
  echo "  ok  transport.js has no process.stdin reference"
  ((PASS++)) || true
fi

# Invariant 3: the D-CONSENT lattice entry exists and ordering passes.
LATTICE_OK=$(node -e "
const {assertOrdered, getEntry} = require('./runtime/decision-lattice');
try {
  assertOrdered();
  const e = getEntry('D-CONSENT');
  if (!e) throw new Error('D-CONSENT entry missing');
  if (e.rung !== 18.25) throw new Error('D-CONSENT rung must be 18.25, got ' + e.rung);
  console.log('ok');
} catch(err) { console.error(err.message); process.exit(1); }
" 2>&1)
if [ "$LATTICE_OK" = "ok" ]; then
  echo "  ok  D-CONSENT lattice entry present at rung 18.25, assertOrdered passes"
  ((PASS++)) || true
else
  echo "  FAIL D-CONSENT lattice check: $LATTICE_OK"
  ((FAIL++)) || true
fi

echo ""
echo "consent-gate: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
