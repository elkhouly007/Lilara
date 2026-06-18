#!/usr/bin/env bash
# gate5-content-aware.sh — Reviewer gate wrapper: GATE 5 content-aware.
#
# The earlier GATE 5 reviewer criterion (literal `in` substring match
# against raw markdown) was brittle: a row like
#   | G5 | ... | Severity drop: **Med → Low** | ... |
# failed the check for the contiguous token "Severity drop: Med" because
# the ** bold markers around "Med → Low" split the text.
#
# This wrapper fixes that by stripping markdown presentation markers
# BEFORE the token match. The reviewer (and humans) care about semantic
# content — "is the expected value present?" — not about whether the
# author emphasized it with **bold**.
#
# USAGE
#   bash scripts/review-criteria/gate5-content-aware.sh <scope_md>
#
# The wrapper:
#   1. Reads <scope_md> (defaults to references/SCOPE.md).
#   2. Extracts the G5 row from the SCOPE.md decision-tag table.
#   3. Normalizes it (strips markdown: **bold**, *italic*, `code`,
#      arrows → ← ⇒, multiple whitespace, leading/trailing |).
#   4. Runs two token-presence checks: required (must be present)
#      and preserved (must be present in the normalized form).
#   5. Emits PASS or FAIL with the actual normalized row on stdout so
#      the reviewer (or human) can copy-paste it into their report.
#
# This script is the single source of truth for GATE 5 content checks.
# Future reviewer prompts MUST call this script (not inline the regex)
# so the criterion cannot drift between dispatches.
#
# ADDITIVITY: this is a tooling-only script under scripts/review-criteria/.
#   - No runtime/ change.
#   - No openclaw/hooks/adapter.js change.
#   - No hermes/hooks/adapter.js change.
#   - No [LOCKED]/[ADVISORY]/[OPEN]/[CC-PROPOSED] tag change.
#   - No /root/lilara-handover/ modification.
#   - scripts/check-counts.sh EXPECTED_SCRIPTS unchanged (this script
#     lives in scripts/review-criteria/, a subdirectory; check-counts
#     uses `find scripts -maxdepth 1` and does not count subdir files).
#
# EXIT CODES
#   0 — PASS (all required + preserved tokens found in normalized form)
#   1 — FAIL (one or more tokens missing; details on stderr)
#   2 — USAGE (file missing, G5 row not found)

set -euo pipefail

SCOPE_MD="${1:-references/SCOPE.md}"

if [ ! -f "$SCOPE_MD" ]; then
  printf 'gate5-content-aware: FAIL — SCOPE.md not found at %s\n' "$SCOPE_MD" >&2
  exit 2
fi

# Extract the G5 row from the decision-tag table.
# Use grep -F to avoid regex hazards (the row contains markdown).
G5_ROW=$(grep -F '| G5 |' "$SCOPE_MD" | head -1 || true)
if [ -z "$G5_ROW" ]; then
  printf 'gate5-content-aware: FAIL — G5 row not found in %s\n' "$SCOPE_MD" >&2
  exit 2
fi

# Normalize the row:
#   - Strip ** and * markers (bold + italic).
#   - Strip ` markers (inline code).
#   - Strip → ← ⇒ (decorative arrows; semantic content uses ASCII dash).
#   - Collapse multiple whitespace.
#   - Strip leading/trailing pipe + whitespace.
NORMALIZED=$(printf '%s\n' "$G5_ROW" \
  | sed -E 's/\*+//g; s/`+//g; s/→/-/g; s/←/-/g; s/⇒/=>/g' \
  | tr -s ' ' \
  | sed -E 's/^\s*\|[[:space:]]*//; s/[[:space:]]*\|[[:space:]]*$//')

# Tokens that MUST be present in the normalized G5 row (semantic content).
REQUIRED=(
  "P2.5"
  "21/21"
  "4/4"
  "Severity drop: Med"
  "Low (was Med)"
  "check-cross-harness-equivalence"
)

# Tokens that MUST be preserved literally (no markdown to strip).
PRESERVED=(
  "Hermes adapter BUILT 2026-06-17"
  "clean-room"
  "MIT"
  "handler-wrap"
)

# Tokens that MUST NOT be present in the G5 row (would indicate a tag
# promotion/demotion that needs separate gate handling).
FORBIDDEN_TAGS=(
  "[LOCKED]"
  "[ADVISORY]"
  "[OPEN]"
  "[CC-PROPOSED]"
)

fail_count=0

# Required token checks.
for tok in "${REQUIRED[@]}"; do
  if printf '%s' "$NORMALIZED" | grep -Fq -- "$tok"; then
    printf '  ok    required:  %s\n' "$tok"
  else
    printf '  MISS  required:  %s\n' "$tok" >&2
    fail_count=$((fail_count + 1))
  fi
done

# Preserved token checks.
for tok in "${PRESERVED[@]}"; do
  if printf '%s' "$NORMALIZED" | grep -Fq -- "$tok"; then
    printf '  ok    preserved: %s\n' "$tok"
  else
    printf '  MISS  preserved: %s\n' "$tok" >&2
    fail_count=$((fail_count + 1))
  fi
done

# Forbidden tag check (catches tag promotion/demotion).
for tag in "${FORBIDDEN_TAGS[@]}"; do
  if printf '%s' "$NORMALIZED" | grep -Fq -- "$tag"; then
    printf '  BAD   forbidden: %s — G5 must not introduce scope-tag markers\n' "$tag" >&2
    fail_count=$((fail_count + 1))
  else
    printf '  ok    forbidden: %s (absent)\n' "$tag"
  fi
done

if [ "$fail_count" -gt 0 ]; then
  printf 'gate5-content-aware: FAIL — %s missing/bad token(s) in G5 row\n' "$fail_count" >&2
  printf '  normalized G5 row:\n' >&2
  printf '    %s\n' "$NORMALIZED" >&2
  exit 1
fi

printf 'gate5-content-aware: PASS — G5 row content is correct (markdown-stripped)\n'
printf '  normalized G5 row:\n'
printf '    %s\n' "$NORMALIZED"
exit 0
