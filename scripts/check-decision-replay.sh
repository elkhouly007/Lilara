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

printf '\ncheck-decision-replay passed.\n'
