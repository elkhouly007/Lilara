#!/usr/bin/env bash
# check-decision-replay.sh — CI gate: replay the shipped sample journal through the
# current decision engine and assert zero action divergence.
#
# Catches regressions in risk scoring, decision routing, or policy logic that would
# silently change what the engine decides for known inputs.
#
# Exit 0 = clean replay (zero divergences).
# Exit 1 = one or more divergences found.
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

JOURNAL="artifacts/journal/sample-journal.jsonl"

if ! command -v node >/dev/null 2>&1; then
  printf '[check-decision-replay] node not found — skipping\n' >&2
  exit 0
fi

if [ ! -f "$JOURNAL" ]; then
  printf '[check-decision-replay] sample journal not found: %s\n' "$JOURNAL" >&2
  exit 1
fi

printf '[check-decision-replay]\n'

tmp_state="$(mktemp -d)"
cleanup() { rm -rf "$tmp_state"; }
trap cleanup EXIT

LILARA_STATE_DIR="$tmp_state" \
LILARA_CONTRACT_ENABLED=0 \
LILARA_TRAJECTORY_WINDOW_MIN=0 \
  bash scripts/lilara-diff-decisions.sh --journal "$JOURNAL" 2>&1

# ADR-016 F21: verify compaction-survival scanner matches positive fixtures
# and rejects negative fixtures — ensures scanner stability across replays.
printf '\n[check-decision-replay] F21 compaction-survival fixture sweep\n'
f21_pass=0; f21_fail=0
FIXTURES_DIR="tests/fixtures/compaction-survival"
for f in "$FIXTURES_DIR"/positive-*.input; do
  result=$(node -e "
const { scanForInjection } = require('./runtime/compaction-survival');
const text = require('fs').readFileSync('$f', 'utf8');
const r = scanForInjection(text);
process.stdout.write(r.matched ? 'match' : 'no-match');
" 2>/dev/null)
  if [ "$result" = "match" ]; then
    f21_pass=$((f21_pass + 1))
  else
    printf '  FAIL (expected match): %s\n' "$f" >&2
    f21_fail=$((f21_fail + 1))
  fi
done
for f in "$FIXTURES_DIR"/negative-*.input; do
  result=$(node -e "
const { scanForInjection } = require('./runtime/compaction-survival');
const text = require('fs').readFileSync('$f', 'utf8');
const r = scanForInjection(text);
process.stdout.write(r.matched ? 'match' : 'no-match');
" 2>/dev/null)
  if [ "$result" = "no-match" ]; then
    f21_pass=$((f21_pass + 1))
  else
    printf '  FAIL (expected no-match): %s\n' "$f" >&2
    f21_fail=$((f21_fail + 1))
  fi
done
printf '[check-decision-replay] F21 fixture sweep: %d passed, %d failed\n' "$f21_pass" "$f21_fail"
if [ "$f21_fail" -gt 0 ]; then
  printf 'check-decision-replay FAILED (F21 fixture divergence).\n' >&2
  exit 1
fi

printf '\ncheck-decision-replay passed.\n'
