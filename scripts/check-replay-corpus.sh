#!/usr/bin/env bash
# check-replay-corpus.sh — Lilara ADR-007 PR-D replay corpus regression gate.
#
# Replays tests/fixtures/replay-corpus/*.jsonl through the current decision
# engine via scripts/replay-decisions.js. Each entry's recorded action,
# decisionSource, floorFired, and irHash must match what the engine produces
# today; any drift fails the check.
#
# Exit 0 = all corpora replay clean.
# Exit 1 = drift detected in at least one corpus.
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  if [ "${LILARA_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf '[check-replay-corpus] node not found — skipping (LILARA_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf '[check-replay-corpus] node not found on PATH\n' >&2
  exit 1
fi

CORPUS_DIR="tests/fixtures/replay-corpus"
if [ ! -d "$CORPUS_DIR" ]; then
  printf '[check-replay-corpus] corpus dir missing: %s\n' "$CORPUS_DIR" >&2
  exit 1
fi

printf '[check-replay-corpus]\n'

failed=0
for corpus in "$CORPUS_DIR"/*.jsonl; do
  [ -f "$corpus" ] || continue
  rel="${corpus#$root/}"
  # PR-A (F27 inert gate): the consent corpus records the FLAG-ON behavior
  # (escalate / secret-egress-consent-required under LILARA_F27_CONSENT=1).
  # This gate replays at the CANONICAL default posture, where replay-decisions.js
  # pins LILARA_F27_CONSENT=0 and the engine correctly produces the inviolable
  # block / secret-egress-external-denied. Replaying a flag-on corpus at flag-off
  # posture would be a guaranteed (and meaningless) drift, so scope it out here —
  # exactly as check-replay-posture-matrix.sh skips it for the F27=0 combinations.
  # The posture-matrix gate is what exercises this corpus under F27=1.
  case "$(basename -- "$corpus")" in
    secret-egress-consent.jsonl)
      printf '[check-replay-corpus] skip %s — consent corpus scoped to LILARA_F27_CONSENT=1 (see check-replay-posture-matrix.sh)\n' "$rel"
      continue
      ;;
  esac
  if node scripts/replay-decisions.js --corpus "$corpus"; then
    :
  else
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  printf '\ncheck-replay-corpus: FAIL\n' >&2
  exit 1
fi

printf '\ncheck-replay-corpus: PASS\n'
