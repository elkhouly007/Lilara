#!/usr/bin/env bash
# check-lattice-ordering.sh — Assert runtime/decision-lattice.js invariants.
#
# Invariants (HAP ADR-007 / scope §4.1 invariant 10):
#   1. LATTICE is a non-empty array of frozen entries.
#   2. Rungs are strictly increasing.
#   3. Every entry has a unique `id`.
#   4. Every entry has the required fields.
#   5. EMPTY_IR + actionIr.build()/validate() round-trip cleanly.
#
# Usage: bash scripts/check-lattice-ordering.sh

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

pass() { printf '  ok      %s\n' "$1"; }
fail() { printf '  ERROR   %s\n' "$1" >&2; exit 1; }

printf '[check-lattice-ordering]\n'

[ -f "$root/runtime/decision-lattice.js" ] || fail 'runtime/decision-lattice.js missing'
[ -f "$root/runtime/action-ir.js" ] || fail 'runtime/action-ir.js missing'

node - <<'NODE' "$root" || exit 1
const path = require('path');
const root = process.argv[2];
const { LATTICE, LATTICE_VERSION, getEntry, getRung, listFloors, assertOrdered } =
  require(path.join(root, 'runtime/decision-lattice.js'));
const { EMPTY_IR, IR_VERSION, build, validate, canonicalize, irHash } =
  require(path.join(root, 'runtime/action-ir.js'));

function step(name) { process.stderr.write('[step] ' + name + '\n'); }
function die(msg) { process.stderr.write('  ERROR   ' + msg + '\n'); process.exit(1); }

step('lattice-non-empty');
if (!Array.isArray(LATTICE) || LATTICE.length === 0) die('LATTICE empty');

step('lattice-version');
if (LATTICE_VERSION !== '1') die('LATTICE_VERSION expected "1", got ' + LATTICE_VERSION);

step('lattice-frozen');
if (!Object.isFrozen(LATTICE)) die('LATTICE not frozen');
for (const e of LATTICE) {
  if (!Object.isFrozen(e)) die('lattice entry not frozen: ' + (e && e.id));
}

step('lattice-assertOrdered');
try { assertOrdered(LATTICE); }
catch (err) { die('assertOrdered: ' + err.message); }

step('lattice-floors-have-ids');
const floors = listFloors();
if (floors.length === 0) die('listFloors() returned empty');
const expectedFloors = ['L1','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','F13','F14','F14b','F15','F16','F18'];
for (const id of expectedFloors) {
  if (!getEntry(id)) die('expected floor missing: ' + id);
}

step('lattice-rungs-strictly-increasing');
let prev = -Infinity;
for (const e of LATTICE) {
  if (!(e.rung > prev)) die('rung not increasing at ' + e.id + ' (' + e.rung + ' <= ' + prev + ')');
  prev = e.rung;
}

step('lattice-unique-ids');
const seen = Object.create(null);
for (const e of LATTICE) {
  if (seen[e.id]) die('duplicate id: ' + e.id);
  seen[e.id] = true;
}

step('lattice-getRung-helper');
if (getRung('F1') !== 1) die('getRung(F1) expected 1, got ' + getRung('F1'));
if (getRung('does-not-exist') !== null) die('getRung(unknown) should be null');

step('action-ir-version');
if (IR_VERSION !== '1') die('IR_VERSION expected "1", got ' + IR_VERSION);

step('action-ir-empty-frozen');
if (!Object.isFrozen(EMPTY_IR)) die('EMPTY_IR not frozen');

step('action-ir-build-empty');
const irEmpty = build(undefined, undefined);
if (!Object.isFrozen(irEmpty)) die('build({}) result not frozen');
const ve = validate(irEmpty);
if (!ve.ok) die('validate(build({})) failed: ' + ve.reason);
if (irEmpty.harness !== null) die('empty build harness should be null, got ' + irEmpty.harness);
if (irEmpty.command !== '') die('empty build command should be "", got ' + JSON.stringify(irEmpty.command));
if (irEmpty.toolKind !== 'unknown') die('empty build toolKind expected unknown, got ' + irEmpty.toolKind);
if (irEmpty.payloadClass !== 'A') die('empty build payloadClass expected A, got ' + irEmpty.payloadClass);

step('action-ir-build-flat-input');
const ir = build({
  harness: 'claude',
  tool: 'Bash',
  command: 'rm -rf /tmp/scratch',
  cwd: '/home/test',
  branch: 'feature/x',
  payloadClass: 'A',
});
if (ir.harness !== 'claude') die('harness wrong');
if (ir.command !== 'rm -rf /tmp/scratch') die('command wrong');
if (ir.toolKind !== 'shell') die('toolKind expected shell, got ' + ir.toolKind);
if (ir.argv0 !== 'rm') die('argv0 expected rm, got ' + ir.argv0);
const v2 = validate(ir);
if (!v2.ok) die('validate flat-input ir failed: ' + v2.reason);

step('action-ir-validate-empty-ir-shape');
const v3 = validate(EMPTY_IR);
if (!v3.ok) die('validate(EMPTY_IR) failed: ' + v3.reason);

step('action-ir-validate-rejects-bad-shape');
const bad = validate({ irVersion: '99', command: '' });
if (bad.ok) die('validate should reject mismatched irVersion');

step('action-ir-validate-rejects-bad-payload-class');
const bad2 = validate(Object.assign({}, EMPTY_IR, { payloadClass: 'Z' }));
if (bad2.ok) die('validate should reject payloadClass=Z');

step('action-ir-canonicalize-stable');
const h1 = irHash(ir);
const h2 = irHash(build({
  harness: 'claude',
  tool: 'Bash',
  command: 'rm -rf /tmp/scratch',
  cwd: '/home/test',
  branch: 'feature/x',
  payloadClass: 'A',
}));
if (h1 !== h2) die('irHash not stable: ' + h1 + ' != ' + h2);

step('action-ir-canonicalize-changes-with-command');
const h3 = irHash(build({
  harness: 'claude',
  tool: 'Bash',
  command: 'echo safe',
  cwd: '/home/test',
}));
if (h3 === h1) die('irHash should differ when command changes');

step('action-ir-tool-kinds');
const cases = [
  ['Read', 'file-read'],
  ['Edit', 'file-write'],
  ['WebFetch', 'network'],
  ['mcp__example__do', 'mcp'],
  ['Skill', 'skill'],
  ['Unknown', 'unknown'],
];
for (const [tool, expected] of cases) {
  const built = build({ harness: 'claude', tool });
  if (built.toolKind !== expected) {
    die('tool=' + tool + ' expected toolKind ' + expected + ', got ' + built.toolKind);
  }
}

step('action-ir-validate-rejects-non-object');
if (validate(null).ok) die('validate(null) should fail');
if (validate(42).ok) die('validate(42) should fail');

console.log('  ok      lattice + action-ir invariants hold (' + LATTICE.length + ' entries)');
NODE

pass 'lattice + action-ir invariants verified'
