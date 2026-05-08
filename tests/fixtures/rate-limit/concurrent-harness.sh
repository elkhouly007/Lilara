#!/usr/bin/env bash
# Concurrent rate-limit harness.
# Usage: concurrent-harness.sh <N> <capacity> <tmpDir>
# Launches N concurrent worker.js processes against an isolated state dir
# pre-seeded with <capacity> tokens. Asserts passes <= capacity (no over-allowance).
set -euo pipefail

N="${1:-8}"
CAPACITY="${2:-3}"
TMPDIR_RL="${3}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER="${SCRIPT_DIR}/worker.js"

# Pre-seed the rate-limit state file with exactly CAPACITY tokens.
STATE_FILE="${TMPDIR_RL}/rate-test-hook.json"
NOW_S=$(node -e "process.stdout.write(String(Date.now()/1000))")
printf '{"tokens":%s,"lastRefill":%s}' "$CAPACITY" "$NOW_S" > "$STATE_FILE"
chmod 600 "$STATE_FILE"

# Launch N concurrent workers.
PIDS=()
for i in $(seq 1 "$N"); do
  node "$WORKER" "$TMPDIR_RL" &
  PIDS+=($!)
done

# Collect exit codes.
PASSES=0
for pid in "${PIDS[@]}"; do
  if wait "$pid" 2>/dev/null; then
    PASSES=$((PASSES + 1))
  fi
done

# Read final token count.
FINAL_TOKENS=$(node -e "
  const fs = require('fs');
  try {
    const s = JSON.parse(fs.readFileSync('${STATE_FILE}','utf8'));
    process.stdout.write(String(Math.round(s.tokens)));
  } catch { process.stdout.write('ERR'); }
")

if [ "$FINAL_TOKENS" = "ERR" ]; then
  echo "FAIL: rate-limit:concurrent — state file corrupted after concurrent access"
  exit 1
fi

if [ "$PASSES" -gt "$CAPACITY" ]; then
  echo "FAIL: rate-limit:concurrent — over-allowance: ${PASSES} passes, capacity=${CAPACITY}, final_tokens=${FINAL_TOKENS}"
  exit 1
fi

# Guard: final counter must be non-negative.
if [ "$FINAL_TOKENS" -lt 0 ] 2>/dev/null; then
  echo "FAIL: rate-limit:concurrent — negative token count: ${FINAL_TOKENS}"
  exit 1
fi

echo "PASS: rate-limit:concurrent — ${PASSES}/${N} processes passed, capacity=${CAPACITY}, final_tokens=${FINAL_TOKENS}"
