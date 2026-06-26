#!/usr/bin/env bash
# check-f30-tamper-floor.sh — ADR-050 F30 runtime tamper-floor structural gate.
#
# Verifies:
#   1. F30 lattice entry exists at rung 18.75, tier inviolable, demotableBy:[].
#   2. enforcementFor("block","tamper-floor") === "block".
#   3. canDemote("F30", ANY_SOURCE) === false for every demotion source.
#   4. floor-codes.js maps "tamper-floor" → "F30_TAMPER_FLOOR".
#   5. evaluateFloor() blocks on targetPath inside the protected footprint.
#   6. evaluateFloor() does NOT fire on:
#      - absent targetPath
#      - targetPath outside protected dirs
#      - command-only input (ADR-050: IR contract — no argv parsing)
#      - subdir of unrelated prefix (e.g. ~/.lilara-cache-tmp)
#   7. evaluateFloor() respects env-var overrides:
#      - LILARA_STATE_DIR
#      - LILARA_HOOK_STATE_DIR
#      - LILARA_INSTINCT_DIR
#   8. decision-engine.js wires F30 in the rung-18.75 band (between F28 and F16).
#   9. INVIOLABLE_FLOOR_IDS auto-derivation includes F30 (22 floors, was 21).
#  10. Unit test suite (tests/runtime/floor-tamper.test.js) passes.
#
# Exit 0 = all checks passed. Exit 1 = at least one check failed.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

pass() { printf '  ok      %s\n' "$1"; }
fail() { printf '  ERROR   %s\n' "$1" >&2; FAILED=1; }
FAILED=0

if ! command -v node >/dev/null 2>&1; then
  if [ "${LILARA_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-f30-tamper-floor (LILARA_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-f30-tamper-floor.sh requires Node.js\n' >&2
  exit 1
fi

printf '[check-f30-tamper-floor]\n'

# ── 1-3: Lattice + inviolability + canDemote for every source ─────────────────

node -e "
'use strict';
const { enforcementFor, canDemote, getEntry, INVIOLABLE_FLOOR_IDS } = require('./runtime/decision-lattice');
const errors = [];

const e = getEntry('F30');
if (!e) errors.push('F30 lattice entry missing');
else {
  if (e.rung !== 18.75)        errors.push('F30 rung must be 18.75, got ' + e.rung);
  if (e.tier !== 'inviolable') errors.push('F30 tier must be inviolable, got ' + e.tier);
  if (!Array.isArray(e.demotableBy) || e.demotableBy.length !== 0)
    errors.push('F30 demotableBy must be [] (ADR-050 inviolable), got ' + JSON.stringify(e.demotableBy));
  if (e.action !== 'block')    errors.push('F30 action must be block, got ' + e.action);
}
const ef = enforcementFor('block', 'tamper-floor');
if (ef !== 'block')
  errors.push('enforcementFor must return block, got ' + ef);

// canDemote must be false for EVERY possible demotion source (F30 is inviolable).
const DEMOTION_SOURCES = [
  'consent:interactive', 'contract:allow', 'learned:allow',
  'operator:token', 'auto:allow:once', 'manual:override',
  'f27-consent-demoted', 'f29-consent-demoted', 'f23-consent-demoted',
  'f6-strict', 'f4-demote-token', 'f19-demote-token',
];
for (const src of DEMOTION_SOURCES) {
  if (canDemote('F30', src))
    errors.push('canDemote(F30, ' + src + ') must be false (inviolable tier)');
}

// INVIOLABLE_FLOOR_IDS auto-derivation must include F30 (22 floors, was 21).
if (!INVIOLABLE_FLOOR_IDS.includes('F30'))
  errors.push('INVIOLABLE_FLOOR_IDS must include F30 (auto-derived from tier:inviolable)');

if (errors.length) { console.error('FAIL: ' + errors.join('; ')); process.exit(1); }
" && pass "lattice: F30 rung/tier/inviolable/enforcementFor/canDemote-all-sources/INVIOLABLE_FLOOR_IDS" \
 || { fail "lattice checks failed"; FAILED=1; }

# ── 4: floor-codes mapping ────────────────────────────────────────────────────

node -e "
'use strict';
const { floorCodeFor } = require('./runtime/floor-codes');
const c1 = floorCodeFor('tamper-floor');
const c2 = floorCodeFor('tamper-floor-eval-failed');
if (c1 !== 'F30_TAMPER_FLOOR') { console.error('FAIL: tamper-floor → expected F30_TAMPER_FLOOR, got ' + c1); process.exit(1); }
if (c2 !== 'F30_TAMPER_FLOOR') { console.error('FAIL: tamper-floor-eval-failed → expected F30_TAMPER_FLOOR, got ' + c2); process.exit(1); }
" && pass "floor-codes: tamper-floor + tamper-floor-eval-failed → F30_TAMPER_FLOOR" \
 || { fail "floor-codes mapping check failed"; FAILED=1; }

# ── 5-7: evaluateFloor behavior (BLOCK + ALLOW + ADR-050 compliance + env overrides) ──

node -e "
'use strict';
const path = require('path');
const os = require('os');
const { evaluateFloor } = require('./runtime/floor-tamper');
const { stateDir, hookStateDir, instinctDir } = require('./runtime/state-paths');

const errors = [];

// 5. BLOCK on targetPath inside default stateDir
const r1 = evaluateFloor({ targetPath: path.join(os.homedir(), '.lilara', 'decision-journal.jsonl') });
if (r1.fired !== true || r1.action !== 'block') errors.push('TEST 5: must block on ~/.lilara/* targetPath');

// 5b. BLOCK on instinctDir subdir
const r1b = evaluateFloor({ targetPath: path.join(os.homedir(), '.lilara', 'instincts', 'foo') });
if (r1b.fired !== true) errors.push('TEST 5b: must block on instinctDir subdir');

// 6a. ALLOW: absent targetPath
const r2 = evaluateFloor({});
if (r2.fired !== false) errors.push('TEST 6a: empty input must not fire');

// 6b. ALLOW: targetPath outside protected dirs
const r3 = evaluateFloor({ targetPath: '/home/user/dev/myapp/src/foo.ts' });
if (r3.fired !== false) errors.push('TEST 6b: /home/user/dev/myapp must not fire');

// 6c. ADR-050: command-only input does NOT fire (no argv parsing)
const r4 = evaluateFloor({ command: 'rm -rf ~/.lilara/decision-journal.jsonl' });
if (r4.fired !== false) errors.push('TEST 6c: ADR-050 — command-only input must not fire (no argv parsing)');

// 6d. ALLOW: subdir of unrelated prefix
const r5 = evaluateFloor({ targetPath: path.join(os.homedir(), '.lilara-cache-tmp', 'x') });
if (r5.fired !== false) errors.push('TEST 6d: ~/.lilara-cache-tmp must not fire (different prefix)');

// 7a. Env override: LILARA_STATE_DIR
const savedState = process.env.LILARA_STATE_DIR;
process.env.LILARA_STATE_DIR = '/tmp/lilara-iso-check-f30';
try {
  const r6 = evaluateFloor({ targetPath: '/tmp/lilara-iso-check-f30/x' });
  if (r6.fired !== true) errors.push('TEST 7a: LILARA_STATE_DIR override must be honored (block)');
  const r6b = evaluateFloor({ targetPath: path.join(os.homedir(), '.lilara', 'x') });
  if (r6b.fired !== false) errors.push('TEST 7a: with LILARA_STATE_DIR override, default ~/.lilara must NOT fire');
} finally {
  if (savedState === undefined) delete process.env.LILARA_STATE_DIR;
  else process.env.LILARA_STATE_DIR = savedState;
}

// 7b. Env override: LILARA_HOOK_STATE_DIR (default off LILARA_STATE_DIR)
const savedHook = process.env.LILARA_HOOK_STATE_DIR;
const savedState2 = process.env.LILARA_STATE_DIR;
delete process.env.LILARA_STATE_DIR;
process.env.LILARA_HOOK_STATE_DIR = '/tmp/lilara-hook-iso';
try {
  const r7 = evaluateFloor({ targetPath: '/tmp/lilara-hook-iso/x' });
  if (r7.fired !== true) errors.push('TEST 7b: LILARA_HOOK_STATE_DIR override must be honored (block)');
} finally {
  if (savedHook === undefined) delete process.env.LILARA_HOOK_STATE_DIR;
  else process.env.LILARA_HOOK_STATE_DIR = savedHook;
  if (savedState2 === undefined) delete process.env.LILARA_STATE_DIR;
  else process.env.LILARA_STATE_DIR = savedState2;
}

// 7c. Env override: LILARA_INSTINCT_DIR
const savedInst = process.env.LILARA_INSTINCT_DIR;
process.env.LILARA_INSTINCT_DIR = '/tmp/lilara-instinct-iso';
try {
  const r8 = evaluateFloor({ targetPath: '/tmp/lilara-instinct-iso/x' });
  if (r8.fired !== true) errors.push('TEST 7c: LILARA_INSTINCT_DIR override must be honored (block)');
} finally {
  if (savedInst === undefined) delete process.env.LILARA_INSTINCT_DIR;
  else process.env.LILARA_INSTINCT_DIR = savedInst;
}

if (errors.length) { console.error('FAIL: ' + errors.join('; ')); process.exit(1); }
" && pass "evaluateFloor: BLOCK (default+env-override), ALLOW (absent/outside/unrelated-prefix/command-only)" \
 || { fail "evaluateFloor behavior check failed"; FAILED=1; }

# ── 8: decision-engine wires F30 in the rung-18.75 band ──────────────────────

if grep -q "F30 (ADR-050): runtime tamper floor — rung 18.75" runtime/decision-engine.js && \
   grep -q '_F30.evaluateFloor(input)' runtime/decision-engine.js; then
  pass "decision-engine: F30 wired in rung-18.75 band (between F28 and F16) via _F30.evaluateFloor(input)"
else
  fail "decision-engine.js must wire F30 evaluateFloor at rung 18.75"
  FAILED=1
fi

# ── 9: 22 inviolable floors (was 21) ──────────────────────────────────────────

INV_COUNT=$(node -e "console.log(require('./runtime/decision-lattice').INVIOLABLE_FLOOR_IDS.length)")
if [ "$INV_COUNT" = "22" ]; then
  pass "INVIOLABLE_FLOOR_IDS count: 22 (was 21 before F30)"
else
  fail "INVIOLABLE_FLOOR_IDS count must be 22 (was 21 before F30), got $INV_COUNT"
  FAILED=1
fi

# ── 10: Unit test suite ───────────────────────────────────────────────────────

if node tests/runtime/floor-tamper.test.js > /dev/null 2>&1; then
  PASS_COUNT=$(node tests/runtime/floor-tamper.test.js 2>&1 | grep -oE 'tests [0-9]+' | head -1 | grep -oE '[0-9]+')
  pass "unit tests: tests/runtime/floor-tamper.test.js (${PASS_COUNT:-14}/14)"
else
  fail "unit tests failed — run: node tests/runtime/floor-tamper.test.js"
  node tests/runtime/floor-tamper.test.js >&2 || true
  FAILED=1
fi

# ── Summary ───────────────────────────────────────────────────────────────────

if [ "$FAILED" -eq 0 ]; then
  printf '[check-f30-tamper-floor] all checks passed\n'
  exit 0
else
  printf '[check-f30-tamper-floor] FAILED — see errors above\n' >&2
  exit 1
fi