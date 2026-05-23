#!/usr/bin/env bash
# scripts/check-no-horus.sh — CI gate: assert no stale Horus/HAP brand references
# remain after the Lilara rebrand (PR #59).
#
# Usage: bash scripts/check-no-horus.sh
#
# Allowlist (paths/files that legitimately retain old brand tokens):
#   CHANGELOG.md              — historical [3.x.x] entries preserve old names verbatim
#   references/archive/       — frozen pre-rebrand planning docs
#   scripts/lilara-rebrand-history.sh  — the old ECC→Horus rename script, kept as docs
#   scripts/lilara-rebrand.sh — uses concatenated tokens as search targets
#   scripts/check-no-horus.sh — this file (references old tokens to search for them)
#
# Old brand tokens are stored via string concatenation below so this script
# does not itself violate the gate it enforces.

set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

FAILED=0
pass() { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*" >&2; FAILED=1; }

printf '[check-no-horus]\n'

# Old brand tokens — split via concatenation, never appearing literally here.
T_ENV="HOR""US_"
T_DOT=".horu""s"
T_PRE="ha""p-"
T_PROD="Horu""s Agenti""c Power"

# Common grep flags for all token searches.
_INCS=(
  --include="*.js"   --include="*.sh"     --include="*.json"
  --include="*.md"   --include="*.jsonc"  --include="*.yaml"
  --include="*.yml"  --include="*.txt"    --include="*.example"
  --include="*.jsonl"
)
_EXCL_DIRS=(
  --exclude-dir=".git"
  --exclude-dir="node_modules"
  --exclude-dir=".claude"
  --exclude-dir="archive"
)
_EXCL_FILES=(
  --exclude="CHANGELOG.md"
  --exclude="check-no-horus.sh"
  --exclude="lilara-rebrand.sh"
  --exclude="lilara-rebrand-history.sh"
)

check_token() {
  local token="$1" label="$2"
  local count
  count=$(grep -r "${_INCS[@]}" "${_EXCL_DIRS[@]}" "${_EXCL_FILES[@]}" \
    -- "$token" . 2>/dev/null | wc -l || echo 0)
  if [ "${count:-0}" -eq 0 ]; then
    pass "$label: clean"
  else
    fail "$label: ${count} occurrence(s) remain"
    grep -r "${_INCS[@]}" "${_EXCL_DIRS[@]}" "${_EXCL_FILES[@]}" \
      -l -- "$token" . 2>/dev/null | head -15 >&2 || true
  fi
}

check_token "$T_ENV"  "HORUS_* env prefix"
check_token "$T_DOT"  ".horus state-dir"
check_token "$T_PRE"  "hap- contract prefix"
check_token "$T_PROD" "Horus Agentic Power brand string"

# HAP acronym — word-boundary match to avoid false positives (HAPPY, HAPPEN, etc.)
if command -v grep >/dev/null 2>&1 && echo "" | grep -qP "" 2>/dev/null; then
  # Perl regex available
  hap_count=$(grep -rP "${_INCS[@]}" "${_EXCL_DIRS[@]}" "${_EXCL_FILES[@]}" \
    '\bHAP\b' . 2>/dev/null | wc -l || echo 0)
else
  # Fallback: extended regex with explicit word-boundary approximation
  hap_count=$(grep -rE "${_INCS[@]}" "${_EXCL_DIRS[@]}" "${_EXCL_FILES[@]}" \
    '(^|[^A-Za-z])HAP([^A-Za-z]|$)' . 2>/dev/null | wc -l || echo 0)
fi
if [ "${hap_count:-0}" -eq 0 ]; then
  pass "HAP acronym: clean"
else
  fail "HAP acronym: ${hap_count} occurrence(s) remain"
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\ncheck-no-horus FAILED\n' >&2
  printf 'Run: bash scripts/lilara-rebrand.sh --verify\n' >&2
  printf 'Then: bash scripts/lilara-rebrand.sh --apply (on a clean tree)\n' >&2
  exit 1
fi

printf '\ncheck-no-horus passed.\n'
