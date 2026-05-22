#!/usr/bin/env bash
# verify-hooks-integrity.sh — Verify that hook files have not been tampered with.
#
# How it works:
#   1. Computes the SHA-256 hash of each hook file.
#   2. Compares against a stored baseline in artifacts/hooks-baseline.sha256.
#   3. Reports NEW hooks (not in baseline), CHANGED hooks, and MISSING hooks.
#
# Usage:
#   bash scripts/verify-hooks-integrity.sh             # compare against baseline
#   bash scripts/verify-hooks-integrity.sh --update    # update baseline to current state
#
# The baseline file should be committed to git so diffs are visible in PRs.
# Run --update after intentional hook changes, then commit the updated baseline.

set -eu

HOOKS_DIR="claude/hooks"
BASELINE="artifacts/hooks-baseline.sha256"

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if [ ! -d "$HOOKS_DIR" ]; then
  printf 'ERROR: hooks directory not found: %s\n' "$HOOKS_DIR" >&2
  exit 1
fi

# ── Compute current hashes ────────────────────────────────────────────────────

compute_hashes() {
  find "$HOOKS_DIR" -type f \( -name '*.js' -o -name '*.json' \) | sort | while read -r f; do
    sha256sum "$f"
  done
}

# ── --update mode: regenerate baseline ───────────────────────────────────────

if [ "${1:-}" = "--update" ]; then
  compute_hashes > "$BASELINE"
  count="$(wc -l < "$BASELINE")"
  printf 'Baseline updated: %d hook files recorded in %s\n' "$count" "$BASELINE"
  printf 'Commit the updated baseline file to make changes visible in git diff.\n'
  exit 0
fi

# ── Compare mode ─────────────────────────────────────────────────────────────

if [ ! -f "$BASELINE" ]; then
  printf 'No baseline found at %s.\n' "$BASELINE"
  printf 'Run: bash scripts/verify-hooks-integrity.sh --update\n'
  printf 'Then commit the baseline file.\n'
  exit 1
fi

errors=0
new_files=""
changed_files=""
missing_files=""

# Check each file in baseline
while IFS= read -r line; do
  expected_hash="${line%% *}"
  filepath="${line##* }"
  filepath="${filepath#\*}"  # strip leading asterisk (sha256sum binary-mode prefix on some platforms)

  if [ ! -f "$filepath" ]; then
    missing_files="${missing_files}  MISSING: ${filepath}\n"
    errors=$((errors + 1))
    continue
  fi

  actual_hash="$(sha256sum "$filepath" | cut -d' ' -f1)"
  if [ "$actual_hash" != "$expected_hash" ]; then
    changed_files="${changed_files}  CHANGED: ${filepath}\n    expected: ${expected_hash}\n    actual:   ${actual_hash}\n"
    errors=$((errors + 1))
  fi
done < "$BASELINE"

# Check for new files not in baseline
while IFS= read -r line; do
  filepath="${line##* }"
  filepath="${filepath#\*}"  # strip leading asterisk (sha256sum binary-mode prefix)
  if ! grep -qF "$filepath" "$BASELINE" 2>/dev/null; then
    new_files="${new_files}  NEW (not in baseline): ${filepath}\n"
  fi
done < <(compute_hashes)

# ── Report ────────────────────────────────────────────────────────────────────

if [ -n "$new_files" ]; then
  printf 'NEW HOOK FILES (not in baseline — review before trusting):\n'
  printf '%b' "$new_files"
fi

if [ -n "$changed_files" ]; then
  printf 'CHANGED HOOK FILES (hashes differ from baseline):\n'
  printf '%b' "$changed_files"
fi

if [ -n "$missing_files" ]; then
  printf 'MISSING HOOK FILES (in baseline but not on disk):\n'
  printf '%b' "$missing_files"
fi

if [ "$errors" -eq 0 ] && [ -z "$new_files" ]; then
  printf 'verify-hooks-integrity: all %d hook files match baseline. OK.\n' \
    "$(wc -l < "$BASELINE")"
  exit 0
elif [ "$errors" -eq 0 ]; then
  printf 'verify-hooks-integrity: baseline matches but new files exist — run --update if intentional.\n'
  exit 0
else
  printf '\nverify-hooks-integrity: %d integrity issue(s) found.\n' "$errors"
  printf 'If changes are intentional: bash scripts/verify-hooks-integrity.sh --update && git add %s\n' "$BASELINE"
  exit 1
fi
