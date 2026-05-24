#!/usr/bin/env bash
# audit-examples.sh — Scan agents/, rules/, skills/ for risky patterns.
#
# Two-pass scan:
#   Pass 1 — Prose scan: flags risky patterns OUTSIDE code blocks (prose text).
#   Pass 2 — GOOD-block scan: flags risky patterns INSIDE code blocks that are
#             preceded by a "GOOD" label (e.g., "**GOOD**", "# GOOD").
#             A "GOOD" code block must never contain dangerous instructions.
#
# Uses awk for speed. Exit 0 = clean. Exit 1 = risks found.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

SCAN_DIRS="agents rules skills"

# ── Pass 1: prose scan ────────────────────────────────────────────────────────
# Skip fenced code blocks and inline code spans. Flag risky patterns in prose.

prose_result="$(
  find $SCAN_DIRS -type f -name '*.md' -not -name 'README.md' \
    -not -name '*.rationale.md' | sort | \
  xargs awk '
  FNR == 1 { in_code = 0; fence = "" }

  /^[[:space:]]*(```|~~~)/ {
    line = $0
    sub(/^[[:space:]]*/, "", line)
    marker = substr(line, 1, 3)
    if (!in_code) {
      in_code = 1; fence = marker
    } else if (marker == fence) {
      in_code = 0; fence = ""
    }
    next
  }

  in_code { next }

  {
    prose = $0
    while (match(prose, /`[^`]*`/)) {
      prose = substr(prose, 1, RSTART-1) substr(prose, RSTART+RLENGTH)
    }
    prose_lc = tolower(prose)
  }

  # Skip explanatory prose such as markdown tables, explicit negations,
  # and lines that clearly describe anti-patterns rather than instruct them.
  prose ~ /^[[:space:]]*\|/                    { next }
  prose_lc ~ /(do not|does not|never|fail example|unsafe|anti-pattern|blocked|rejected|liability|auto-approve dangerous)/ { next }

  prose ~ /npx[[:space:]]+-y/                   { print "[PROSE] " FILENAME ":" FNR ": " $0; next }
  prose ~ /rm[[:space:]]+-rf[[:space:]]/         { print "[PROSE] " FILENAME ":" FNR ": " $0; next }
  prose ~ /curl[[:space:]].*\|(sh|bash)/         { print "[PROSE] " FILENAME ":" FNR ": " $0; next }
  prose ~ /wget[[:space:]].*\|(sh|bash)/         { print "[PROSE] " FILENAME ":" FNR ": " $0; next }
  prose ~ /chmod[[:space:]]+777/                 { print "[PROSE] " FILENAME ":" FNR ": " $0; next }
  prose ~ /ignore previous instructions/        { print "[PROSE] " FILENAME ":" FNR ": " $0; next }
  prose ~ /override.*safety/                    { print "[PROSE] " FILENAME ":" FNR ": " $0; next }
  prose ~ /bypass.*approval/                    { print "[PROSE] " FILENAME ":" FNR ": " $0; next }
  prose ~ /auto-approve|autoapproval/           { print "[PROSE] " FILENAME ":" FNR ": " $0; next }
  ' 2>/dev/null
)"

# ── Pass 2: GOOD-block scan ───────────────────────────────────────────────────
# Detect code blocks preceded by a "GOOD" label in the previous non-empty line.
# A "GOOD" example should never contain genuinely dangerous commands.

good_result="$(
  find $SCAN_DIRS -type f -name '*.md' -not -name 'README.md' \
    -not -name '*.rationale.md' | sort | \
  xargs awk '
  FNR == 1 { in_code = 0; in_good_block = 0; fence = ""; last_prose = "" }

  # Track last non-empty line for GOOD detection
  /^[[:space:]]*(```|~~~)/ {
    line = $0
    sub(/^[[:space:]]*/, "", line)
    marker = substr(line, 1, 3)
    if (!in_code) {
      in_code = 1
      fence = marker
      # Check if the last non-empty prose line indicates this is a GOOD example
      in_good_block = (last_prose ~ /\bGOOD\b/)
    } else if (marker == fence) {
      in_code = 0
      in_good_block = 0
      fence = ""
    }
    next
  }

  # Inside a GOOD code block — flag dangerous patterns using if-else chain
  in_code && in_good_block {
    if      ($0 ~ /npx[[:space:]]+-y/)               print "[GOOD-BLOCK] " FILENAME ":" FNR ": " $0
    else if ($0 ~ /rm[[:space:]]+-rf[[:space:]]/)    print "[GOOD-BLOCK] " FILENAME ":" FNR ": " $0
    else if ($0 ~ /curl[[:space:]].*\|(sh|bash)/)    print "[GOOD-BLOCK] " FILENAME ":" FNR ": " $0
    else if ($0 ~ /wget[[:space:]].*\|(sh|bash)/)    print "[GOOD-BLOCK] " FILENAME ":" FNR ": " $0
    else if ($0 ~ /chmod[[:space:]]+777/)             print "[GOOD-BLOCK] " FILENAME ":" FNR ": " $0
    else if ($0 ~ /sudo[[:space:]]rm[[:space:]]/)    print "[GOOD-BLOCK] " FILENAME ":" FNR ": " $0
    else if ($0 ~ /DROP[[:space:]]+(DATABASE|TABLE)/) print "[GOOD-BLOCK] " FILENAME ":" FNR ": " $0
    next
  }

  # Outside code block — update last_prose for GOOD detection
  !in_code && /[^[:space:]]/ { last_prose = $0 }
  in_code { next }
  ' 2>/dev/null
)"

# ── Report ────────────────────────────────────────────────────────────────────

combined="${prose_result}${good_result}"

if [ -z "$combined" ]; then
  printf '%s\n' "audit-examples: no risky patterns found (prose or GOOD code blocks)."
  exit 0
else
  if [ -n "$prose_result" ]; then
    printf 'PROSE MATCHES (risky patterns outside code blocks):\n'
    printf '%s\n' "$prose_result"
    printf '\n'
  fi
  if [ -n "$good_result" ]; then
    printf 'GOOD-BLOCK MATCHES (dangerous patterns inside GOOD examples — likely copy-paste errors):\n'
    printf '%s\n' "$good_result"
    printf '\n'
  fi
  count="$(printf '%s\n' "$combined" | grep -c '.')"
  printf 'audit-examples: %d match(es) found. Review lines above.\n' "$count"
  exit 1
fi
