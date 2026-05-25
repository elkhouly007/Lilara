#!/usr/bin/env bash
# check-evals.sh — Optional CI gate: run all evals/*.eval.js and assert exit 0.
#
# Skip this gate by setting LILARA_SKIP_EVAL=1.
# This keeps eval failures advisory rather than blocking for teams that
# haven't yet tuned the eval suite for their corpus.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if [ "${LILARA_SKIP_EVAL:-0}" = "1" ]; then
  printf '[check-evals] SKIPPED (LILARA_SKIP_EVAL=1)\n' >&2
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  if [ "${LILARA_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-evals.sh\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-evals.sh requires Node.js\n' >&2
  exit 1
fi

printf '[check-evals]\n'

LILARA_DECISION_JOURNAL=0 bash "${root}/scripts/lilara-cli.sh" eval run || {
  printf '\ncheck-evals: FAILED — one or more evals reported failures.\n' >&2
  printf 'Set LILARA_SKIP_EVAL=1 to skip this gate.\n' >&2
  exit 1
}

printf '\ncheck-evals: passed.\n'
