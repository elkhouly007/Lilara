#!/usr/bin/env bash
# check-eval-budgets.sh — ADVISORY slice-quality gate.
#
# This gate is INTENTIONAL NOT FAILING. It runs the slice-quality
# eval and reports over-budget slices as WARN. Exit code is always 0
# unless the eval itself fatals (corpus/budgets missing, etc.).
#
# The HARD FP/FN gate on the full corpus remains scripts/eval-decision-
# quality.sh (10% FP / 20% FN). This script is its slice-aware,
# advisory-only sibling. Promoting it to hard-fail is a security-layer
# change (NEEDS-APPROVAL per the standing workflow + references/PLAN.md
# Phase 1 + 3).
#
# Usage:
#   bash scripts/check-eval-budgets.sh
#
# Exit codes:
#   0 — always (advisory only; over-budget = WARN, not error)
#   2 — fatal: node not found, corpus/budgets missing, or no _slices block

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
corpus="${root}/tests/eval-corpus.json"
budgets="${root}/evals/budgets.json"

if ! command -v node >/dev/null 2>&1; then
  echo "[check-eval-budgets] FATAL: node not found" >&2
  exit 2
fi
if [ ! -f "$corpus" ]; then
  echo "[check-eval-budgets] FATAL: corpus not found: $corpus" >&2
  exit 2
fi
if [ ! -f "$budgets" ]; then
  echo "[check-eval-budgets] FATAL: budgets not found: $budgets" >&2
  exit 2
fi

# Run the slice-quality eval. The eval itself returns 0 unless it
# fatals; over-budget slices are reported as WARN, not as failure.
node "${root}/evals/slice-quality.eval.js" --corpus "$corpus" --budgets "$budgets"
rc=$?

if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then
  # rc 0 = clean, rc 1 = over-budget (still advisory OK in this script).
  # Any other rc = fatal in the eval.
  echo "[check-eval-budgets] FATAL: slice-quality.eval.js exited $rc" >&2
  exit 2
fi

# Always exit 0 — advisory only.
exit 0
