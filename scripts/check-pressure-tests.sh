#!/usr/bin/env bash
# check-pressure-tests.sh — Validate structure of all pressure-test files
#
# For each tests/pressure/*.pressure.md file, verifies that all six required
# H2 headings are present:
#   ## Rule under test
#   ## RED
#   ## GREEN
#   ## REFACTOR
#   ## Outcome
#   ## Loopholes closed
#
# Exit codes:
#   0 — all pressure tests have the required structure
#   1 — one or more files are missing required sections
#
# Options:
#   -h|--help

set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
pressure_dir="${root}/tests/pressure"

errors=0
checked=0

err()  { printf '  ERROR   %s — missing section: "%s"\n' "$1" "$2"; errors=$((errors + 1)); }
ok()   { printf '  ok      %s\n' "$1"; }

REQUIRED_SECTIONS=(
  "## Rule under test"
  "## RED"
  "## GREEN"
  "## REFACTOR"
  "## Outcome"
  "## Loopholes closed"
)

printf '[check-pressure-tests]\n'
printf 'Scanning %s\n\n' "$pressure_dir"

if [ ! -d "$pressure_dir" ]; then
  printf 'ERROR: tests/pressure/ directory not found at %s\n' "$pressure_dir" >&2
  exit 1
fi

for f in "$pressure_dir"/*.pressure.md; do
  # No matches — glob literal returned
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  file_ok=1

  for section in "${REQUIRED_SECTIONS[@]}"; do
    if ! grep -qF "$section" "$f" 2>/dev/null; then
      err "$name" "$section"
      file_ok=0
    fi
  done

  [ "$file_ok" -eq 1 ] && ok "$name"
  checked=$((checked + 1))
done

printf '\n'
printf 'Checked: %d pressure test(s)\n' "$checked"
printf 'Errors:  %d\n' "$errors"

if [ "$checked" -eq 0 ]; then
  printf '\nNo *.pressure.md files found in %s\n' "$pressure_dir" >&2
  printf 'Add at least one pressure test using templates/pressure-test-template.md\n' >&2
  exit 1
fi

if [ "$errors" -gt 0 ]; then
  printf '\n%d ERROR(s) found — every pressure test must contain all six required H2 sections.\n' "$errors" >&2
  printf 'See templates/pressure-test-template.md for the required structure.\n' >&2
  exit 1
fi

printf '\nAll pressure tests passed structural check.\n'
exit 0
