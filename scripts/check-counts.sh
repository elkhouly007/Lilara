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
EXPECTED_AGENTS=64
EXPECTED_RULES=107         # +commit-conventions +self-review-protocol +workflow-discipline +docker-security +kubernetes-hardening +ci-cd-safety +error-handling +naming-conventions +api-design +concurrency-safety
EXPECTED_SKILLS=57         # +supply-chain-audit +secrets-rotation-planner +threat-model-generator +prompt-engineering-reviewer +model-evaluation-harness +rag-pipeline-auditor +codemod-generator +ci-pipeline-generator +dockerfile-generator +architecture-decision-record +runbook-generator +diagram-generator
EXPECTED_HOOKS=17          # JS files in claude/hooks/
EXPECTED_FIXTURES=396      # fixture pairs; +11 for file-write-floor F24 fixtures; +3 for mcp-security (F25/F4-opt-out/benign); +2 for F26 raw-value fallback; +3 for hardening: 06-unicode-arg-danger, 07-multiedit-mcp-config, 08-dual-use-drop-table; +1 for 09-f25-ifs-arg-danger (${IFS} whitespace-evasion fold); +5 for ADR-020 narrow (10/11/12/13/14); +1 for ADR-018 fixture A (15-f25-trusted-dualuse-nodrift-allow)
EXPECTED_SCRIPTS=95        # sh + js files in scripts/; +check-file-write-floor.sh +dashboard-server.js +check-dashboard.sh +check-mcp-security.sh +check-project-scope.sh (L6)

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
if grep -q "64 agents" "$root/README.md"; then
  pass "README.md mentions 64 agents"
else
  fail "README.md does not mention '64 agents' — update README.md"
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\ncheck-counts FAILED — update EXPECTED_* values and README.md.\n' >&2
  exit 1
fi

printf '\ncheck-counts passed.\n'
