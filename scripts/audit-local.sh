#!/usr/bin/env bash
set -eu

include_source=0
case "${1:-}" in
  --include-source) include_source=1 ;;
  -h|--help)
    printf '%s\n' "Usage: $0 [--include-source]"
    exit 0
    ;;
  "") ;;
  *)
    printf '%s\n' "Unknown option: $1" >&2
    exit 2
    ;;
esac

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

tmp="${TMPDIR:-/tmp}/lilara-audit.$$"
trap 'rm -f "$tmp"' EXIT

{
  find ./scripts -maxdepth 1 -type f \
    ! -name 'audit-local.sh' \
    ! -name 'audit-examples.sh' \
    ! -name 'bench-runtime-decision.sh' \
    ! -name 'bench-perf-regression.sh' \
    ! -name 'run-fixtures.sh' \
    ! -name 'check-*'
  find ./claude/hooks -maxdepth 1 -type f -name '*.js' \
    ! -name 'dangerous-command-gate.js'
  find ./.github/workflows -maxdepth 1 -type f 2>/dev/null || true
} | sort -u > "$tmp"

if [ "$include_source" -eq 0 ]; then
  grep -v '^\./source-' "$tmp" > "$tmp.filtered" || true
  mv "$tmp.filtered" "$tmp"
fi

status=0

scan() {
  label="$1"
  pattern="$2"
  results="$(xargs grep -nE "$pattern" < "$tmp" || true)"
  filtered="$(printf '%s\n' "$results" | grep -vE '^[^:]+:[0-9]+:.*(Do not use|style unreviewed|rejected|disabled|approval required|No `|No |never blocks|warns on|scans prompt|detects|patterns?:|Known Limitations|\$[a-z_]*tmp[_a-z]*\b|\$[a-z_]*_state\b)' || true)"
  if [ -n "$filtered" ]; then
    printf '%s\n' "$filtered"
    printf '%s\n' "RISK: $label" >&2
    status=1
  fi
}

scan "download helpers" '\b(curl|wget)\b'
scan "package auto-download" '^[^#]*\bnpx[[:space:]]+-y\b'
scan "remote fetch/download" '(curl|wget|fetch|http\.get|axios\.get|requests\.get)[[:space:]]*\(?[[:space:]]*['\''"]?https?://'
scan "destructive recursive removal" '\brm[[:space:]]+-rf\b'
scan "macOS script automation" 'osascript'
scan "desktop notification helper" 'terminal-notifier'
scan "permission auto approval" 'auto-approve|auto approval|autoapproval'

if [ "$status" -eq 0 ]; then
  printf '%s\n' "Audit complete: no configured risky patterns found."
else
  printf '%s\n' "Audit complete: review risky patterns above."
fi

exit "$status"
