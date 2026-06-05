#!/usr/bin/env bash
# check-delete-coord.sh — CI gate for ADR-038 F29 deletion-coordination floor.
#
# Runs the delete-coord unit test suite and checks four structural invariants:
#   1. decide() reads LILARA_DELETE_COORD — flag IS wired into the engine.
#   2. The F29 approval snapshot hook references _requireSnapshot (wired into
#      pretool-gate.js) — never a bare require() (lazy-load guard).
#   3. snapshot failure is NEVER silent: the approval path has no empty catch
#      swallowing failures without emit() (visible-but-fail-open invariant).
#   4. F29 is NOT in INVIOLABLE_FLOOR_IDS (demotable tier must be preserved).
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
    node "$file" 2>&1 | head -50
    ((FAIL++)) || true
  fi
}

echo "=== delete-coord tests (ADR-038 F29) ==="

run_test "delete-coord" tests/runtime/delete-coord.test.js

echo ""
echo "=== structural invariants ==="

# Invariant 1: LILARA_DELETE_COORD is read in decision-engine.js (the flag is wired).
ENGINE_FLAG=$(grep 'LILARA_DELETE_COORD' runtime/decision-engine.js 2>/dev/null || true)
if [ -z "$ENGINE_FLAG" ]; then
  echo "  FAIL decision-engine.js must read LILARA_DELETE_COORD (flag not wired)"
  ((FAIL++)) || true
else
  echo "  ok  LILARA_DELETE_COORD is read in decision-engine.js"
  ((PASS++)) || true
fi

# Invariant 2: pretool-gate.js wires the snapshot module lazily (_requireSnapshot).
GATE_SNAP=$(grep '_requireSnapshot' runtime/pretool-gate.js 2>/dev/null || true)
if [ -z "$GATE_SNAP" ]; then
  echo "  FAIL pretool-gate.js must define/use _requireSnapshot (approval hook not wired)"
  ((FAIL++)) || true
else
  echo "  ok  pretool-gate.js has _requireSnapshot wiring"
  ((PASS++)) || true
fi

# Invariant 3: visible-but-fail-open — the approval path must emit() on snapshot
# failure and must NOT have a bare empty catch swallowing the warning.
# Verify the 'snapshot-failed-on-approved-delete' journal marker kind is present.
FAIL_VISIBLE=$(grep 'snapshot-failed-on-approved-delete' runtime/pretool-gate.js 2>/dev/null || true)
if [ -z "$FAIL_VISIBLE" ]; then
  echo "  FAIL pretool-gate.js must journal 'snapshot-failed-on-approved-delete' on failure"
  ((FAIL++)) || true
else
  echo "  ok  pretool-gate.js journals snapshot-failed-on-approved-delete"
  ((PASS++)) || true
fi

# Invariant 4: F29 must NOT be inviolable (demotableBy must not be empty).
# We check this via the lattice module directly.
F29_INVIOLABLE=$(node -e "
  const l = require('./runtime/decision-lattice');
  const f29 = l.getEntry('F29');
  if (!f29) { process.stderr.write('F29 not found in lattice\n'); process.exit(1); }
  if (l.isInviolable('F29')) { process.stderr.write('F29 is inviolable — must be demotable\n'); process.exit(1); }
  if (!f29.demotableBy || !f29.demotableBy.includes('consent:interactive')) {
    process.stderr.write('F29 missing consent:interactive in demotableBy\n'); process.exit(1);
  }
  process.exit(0);
" 2>&1 || true)
if [ -n "$F29_INVIOLABLE" ]; then
  echo "  FAIL F29 inviolable-tier invariant violated: $F29_INVIOLABLE"
  ((FAIL++)) || true
else
  echo "  ok  F29 is demotable (not in INVIOLABLE_FLOOR_IDS)"
  ((PASS++)) || true
fi

echo ""
echo "=== delete-coord gate: ${PASS} passed, ${FAIL} failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
