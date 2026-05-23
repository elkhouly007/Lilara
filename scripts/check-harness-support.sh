#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

pass() { printf '  ok      %s\n' "$1"; }
fail() { printf '  ERROR   %s\n' "$1" >&2; exit 1; }

printf '[check-harness-support]\n'

readme="$root/README.md"
wizard="$root/scripts/setup-wizard.sh"
apply_status="$root/references/per-tool-apply-status.md"

[ -f "$readme" ] || fail 'README.md missing'
[ -f "$wizard" ] || fail 'setup-wizard.sh missing'
[ -f "$apply_status" ] || fail 'per-tool-apply-status.md missing'

# README must contain a Harness Support Matrix section
grep -Fq 'Harness Support Matrix' "$readme" || fail 'README.md missing Harness Support Matrix section'
pass 'README.md has Harness Support Matrix'

# Supported harnesses must appear in the matrix as Supported
for harness in 'Claude Code' 'OpenCode' 'OpenClaw'; do
  grep -Fq "$harness" "$readme" || fail "README Harness Support Matrix missing: $harness"
  grep -qE "\\| *${harness} *\\|[^|]*Supported" "$readme" || \
    fail "README Harness Support Matrix missing 'Supported' status for: $harness"
done
pass 'Supported harnesses present in matrix'

# Planned harnesses must appear in the matrix as Planned
for harness in 'Codex' 'antegravity'; do
  grep -Fq "$harness" "$readme" || fail "README Harness Support Matrix missing planned harness: $harness"
done
pass 'Planned harnesses present in matrix'

# Each planned harness must have a stub directory with README.md containing either
# NOT YET SUPPORTED (legacy wording) or EXPERIMENTAL (promoted wording).
for dir in codex antegravity; do
  stub_readme="$root/$dir/README.md"
  [ -f "$stub_readme" ] || fail "stub README missing: $dir/README.md"
  grep -qE 'NOT YET SUPPORTED|EXPERIMENTAL' "$stub_readme" || \
    fail "$dir/README.md missing NOT YET SUPPORTED or EXPERIMENTAL marker"
  [ -f "$root/$dir/COMPATIBILITY_NOTES.md" ] || fail "stub COMPATIBILITY_NOTES missing: $dir/COMPATIBILITY_NOTES.md"
done
pass 'planned harness stub directories and status markers present'

# ClawCode is now VERIFIED — it must NOT carry the planned-stub marker and
# MUST carry a WIRING_PLAN.md authored against verified source.
[ -f "$root/clawcode/README.md" ] || fail "clawcode/README.md missing"
grep -qE 'NOT YET SUPPORTED|EXPERIMENTAL' "$root/clawcode/README.md" \
  && fail "clawcode/README.md still carries planned-stub marker after verification (2026-05-23)"
grep -qE 'VERIFIED' "$root/clawcode/README.md" \
  || fail "clawcode/README.md missing VERIFIED marker"
[ -f "$root/clawcode/WIRING_PLAN.md" ] || fail "clawcode/WIRING_PLAN.md missing — required for verified harness"
[ -f "$root/clawcode/COMPATIBILITY_NOTES.md" ] || fail "clawcode/COMPATIBILITY_NOTES.md missing"
pass 'clawcode verified directory layout present (README + WIRING_PLAN + COMPATIBILITY_NOTES)'

# setup-wizard.sh must NOT silently fall back for unknown tools
# It should contain codex|clawcode|antegravity rejection case (or exit 1 path)
grep -q 'codex' "$wizard" || fail 'setup-wizard.sh does not handle codex tool name'
grep -q 'NOT YET SUPPORTED\|not yet supported\|Supported tools:' "$wizard" || fail 'setup-wizard.sh missing planned-harness rejection message'
pass 'setup-wizard.sh has planned-harness rejection path'

# per-tool-apply-status.md must contain a Planned Harnesses section
grep -Fq 'Planned Harnesses' "$apply_status" || fail 'per-tool-apply-status.md missing Planned Harnesses section'
grep -Fq 'codex' "$apply_status" || fail 'per-tool-apply-status.md missing codex planned entry'
grep -Fq 'clawcode' "$apply_status" || fail 'per-tool-apply-status.md missing clawcode entry'
grep -Fq 'antegravity' "$apply_status" || fail 'per-tool-apply-status.md missing antegravity planned entry'
pass 'per-tool-apply-status.md has Planned Harnesses section with all three entries'

printf '\nHarness support checks passed.\n'
