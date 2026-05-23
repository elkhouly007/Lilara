#!/usr/bin/env bash
# bench-perf-regression.sh - Phase 0 task 0.12 p99 regression guard.
# Wraps tests/perf/bench.js, applies the same platform p99 ladder as
# scripts/bench-runtime-decision.sh (10ms Linux, 500ms Windows-slowfs,
# 200ms macOS), and exits non-zero on regression.
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

# Platform p99 ladder - mirrors bench-runtime-decision.sh.
if [ -n "${LILARA_PERF_P99_MS:-}" ]; then
  ceiling="$LILARA_PERF_P99_MS"
elif [ "${OS:-}" = "Windows_NT" ] || uname -s 2>/dev/null | grep -qiE 'mingw|msys|cygwin'; then
  ceiling=500
elif uname -r 2>/dev/null | grep -qi 'microsoft' && pwd | grep -q '^/mnt/'; then
  ceiling=500
elif uname -s 2>/dev/null | grep -qi 'darwin'; then
  ceiling=200
else
  ceiling=10
fi

LILARA_STATE_DIR="$workdir" \
LILARA_PERF_P99_MS="$ceiling" \
node "$root/tests/perf/bench.js"
