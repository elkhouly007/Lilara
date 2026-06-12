#!/usr/bin/env bash
# scripts/check-scope-tags.sh — CI gate: protect the decision-tag semantics of
# references/SCOPE.md (the authoritative scope).
#
# Enforces three properties:
#   1. Tag vocabulary — every uppercase bracket-tag in SCOPE.md is one of the
#      legend tags ([LOCKED] [ADVISORY] [OPEN] [CC-PROPOSED]) or a known
#      non-decision heading token. Unknown tags (typos, invented tags) fail.
#   2. [LOCKED]-line integrity — the set of lines carrying [LOCKED] is hashed
#      against artifacts/scope-locked-baseline.sha256. Any edit, addition, or
#      removal of locked text fails unless the baseline is updated in the same
#      reviewed diff (run with --update-baseline after owner approval).
#   3. Locked-tag count — reported alongside the hash so a silent deletion is
#      visible in the failure message, not just a hash mismatch.
#
# Usage: bash scripts/check-scope-tags.sh [--update-baseline]
#
# The legend ([LOCKED] = owner-decided, changed only by owner decision) is a
# load-bearing contract; this gate replaces the previously manual discipline.

set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

SCOPE="references/SCOPE.md"
BASELINE="artifacts/scope-locked-baseline.sha256"

FAILED=0
pass() { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*" >&2; FAILED=1; }

printf '[check-scope-tags]\n'

if [ ! -f "$SCOPE" ]; then
  fail "missing $SCOPE"
  printf '\ncheck-scope-tags FAILED\n' >&2
  exit 1
fi

# ── sha256 helper (sha256sum on Linux/git-bash, shasum on macOS) ─────────────
sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

# ── 1. Tag vocabulary ────────────────────────────────────────────────────────
# Decision tags per the SCOPE.md legend. LAST is a §12 heading token (build
# order), not a decision tag, but is uppercase-bracketed; allow it explicitly.
ALLOWED='^(LOCKED|ADVISORY|OPEN|CC-PROPOSED|LAST|ADVISORY, strong|mostly ADVISORY / OPEN)$'

unknown=$(grep -o '\[[A-Z][A-Z][A-Z, /-]*\]' "$SCOPE" \
  | sed 's/^\[//; s/\]$//' \
  | grep -Ev "$ALLOWED" | sort -u || true)
if [ -z "$unknown" ]; then
  pass "tag vocabulary: only legend tags present"
else
  fail "unknown bracket-tag(s) in $SCOPE (not in legend): $(printf '%s ' $unknown)"
fi

# ── 2+3. [LOCKED]-line integrity vs committed baseline ───────────────────────
locked_lines=$(grep -n 'LOCKED' "$SCOPE" | grep '\[LOCKED' | tr -d '\r' || true)
locked_count=$(printf '%s\n' "$locked_lines" | grep -c . || true)
locked_hash=$(printf '%s\n' "$locked_lines" | sha256_stdin)

if [ "${1:-}" = "--update-baseline" ]; then
  mkdir -p "$(dirname "$BASELINE")"
  printf '%s %s\n' "$locked_hash" "$locked_count" > "$BASELINE"
  printf '  baseline updated: %s (locked lines: %s)\n' "$locked_hash" "$locked_count"
  printf '\ncheck-scope-tags baseline written — commit %s in the same PR.\n' "$BASELINE"
  exit 0
fi

if [ ! -f "$BASELINE" ]; then
  fail "baseline missing: $BASELINE (run: bash scripts/check-scope-tags.sh --update-baseline)"
else
  base_hash=$(awk '{print $1}' < "$BASELINE" | tr -d ' \r\n')
  base_count=$(awk '{print $2}' < "$BASELINE" | tr -d ' \r\n')
  if [ "$locked_hash" = "$base_hash" ]; then
    pass "[LOCKED] integrity: ${locked_count} locked line(s) match baseline"
  else
    fail "[LOCKED]-tagged lines changed (baseline ${base_count:-?} line(s), now ${locked_count})."
    printf '        Locked content moves only by owner decision. If this change IS owner-approved,\n' >&2
    printf '        regenerate: bash scripts/check-scope-tags.sh --update-baseline (commit in same PR).\n' >&2
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\ncheck-scope-tags FAILED\n' >&2
  exit 1
fi

printf '\ncheck-scope-tags passed.\n'
