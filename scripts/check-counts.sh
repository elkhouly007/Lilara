#!/usr/bin/env bash
# check-counts.sh — Assert agent/rule/skill/hook/fixture/script counts match
# the documented values in README.md and related docs.
#
# When a count changes (new agent, rule, etc.) the developer must:
#   1. Update this script's EXPECTED_* values.
#   2. Update README.md and CHANGELOG.md to match.
# CI fails until both are in sync.
#
# Usage: bash scripts/check-counts.sh

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

pass()  { printf '  ok      %s\n' "$1"; }
fail()  { printf '  ERROR   %s\n' "$1" >&2; FAILED=1; }
FAILED=0

printf '[check-counts]\n'

# ---------------------------------------------------------------------------
# Expected values — update these when adding files, then update README too.
# ---------------------------------------------------------------------------
EXPECTED_AGENTS=49
EXPECTED_RULES=82
EXPECTED_SKILLS=22         # excludes agents/README.md style files
EXPECTED_HOOKS=13          # JS files in claude/hooks/
EXPECTED_FIXTURES=249      # fixture pairs (count of *.input files)
EXPECTED_SCRIPTS=72        # sh + js files in scripts/ (top-level only)

# ---------------------------------------------------------------------------
# Count from filesystem
# ---------------------------------------------------------------------------
actual_agents=$(find agents -maxdepth 1 -name '*.md' \
  ! -name 'README.md' ! -name 'ROUTING.md' | wc -l | tr -d ' ')

actual_rules=$(find rules -name '*.md' | wc -l | tr -d ' ')

actual_skills=$(find skills -maxdepth 1 -name '*.md' \
  ! -name 'README.md' | wc -l | tr -d ' ')

actual_hooks=$(find claude/hooks -maxdepth 1 -name '*.js' | wc -l | tr -d ' ')

actual_fixtures=$(find tests/fixtures -name '*.input' | wc -l | tr -d ' ')

actual_scripts=$(find scripts -maxdepth 1 \( -name '*.sh' -o -name '*.js' \) \
  | wc -l | tr -d ' ')

# ---------------------------------------------------------------------------
# Compare
# ---------------------------------------------------------------------------
check() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" -eq "$expected" ]; then
    pass "$label: $actual (expected $expected)"
  else
    fail "$label: got $actual but expected $expected — update this script and README.md"
  fi
}

check "agents"   "$actual_agents"   "$EXPECTED_AGENTS"
check "rules"    "$actual_rules"    "$EXPECTED_RULES"
check "skills"   "$actual_skills"   "$EXPECTED_SKILLS"
check "hooks"    "$actual_hooks"    "$EXPECTED_HOOKS"
check "fixtures" "$actual_fixtures" "$EXPECTED_FIXTURES"
check "scripts"  "$actual_scripts"  "$EXPECTED_SCRIPTS"

# ---------------------------------------------------------------------------
# Spot-check README.md for at least one correct count (agents).
# If README still says a known-wrong value, flag it.
# ---------------------------------------------------------------------------
if grep -q "49 agents" "$root/README.md"; then
  pass "README.md mentions 49 agents"
else
  fail "README.md does not mention '49 agents' — update README.md"
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\ncheck-counts FAILED — update EXPECTED_* values and README.md.\n' >&2
  exit 1
fi

printf '\ncheck-counts passed.\n'
