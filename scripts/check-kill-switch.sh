#!/usr/bin/env bash
# check-kill-switch.sh — Verify LILARA_KILL_SWITCH=1 behavior across all 13 hooks.
#
# Kill-switch semantics:
#   PreToolUse hooks  → exit 2 (block the tool call — no silent pass-through)
#   Informational hooks (PostToolUse / SessionStart / Stop) → exit 0 + echo stdin
#
# This distinction is intentional: PreToolUse hooks enforce; informational hooks
# are no-ops under kill-switch so they don't record state or emit guidance.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  if [ "${LILARA_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-kill-switch.sh (LILARA_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-kill-switch.sh requires Node.js\n' >&2
  exit 1
fi

pass()  { printf '  ok  %s\n' "$1"; }
fail()  { printf '  ERR %s\n' "$1" >&2; FAILED=1; }
FAILED=0

printf '[check-kill-switch]\n'

# Dangerous payload — should be blocked by dangerous-command-gate normally.
DANGEROUS='{"tool_name":"Bash","tool_input":{"command":"rm -rf /data"}}'
# Session payload (empty works for session hooks)
SESSION='{}'

# PreToolUse hooks: expect exit 2 (kill-switch blocks the tool call).
run_pretooluse_hook() {
  local hook="$1"
  local payload="$2"
  local label="$3"

  local actual_exit=0
  printf '%s' "$payload" | LILARA_KILL_SWITCH=1 LILARA_ENFORCE=1 \
    node "$hook" > /dev/null 2>/dev/null || actual_exit=$?

  if [ "$actual_exit" -eq 2 ]; then
    pass "$label: exit 2 (kill-switch blocks tool call)"
  else
    fail "$label: exit $actual_exit (expected 2 — PreToolUse kill-switch must block)"
  fi
}

# Informational hooks (PostToolUse / SessionStart / Stop): expect exit 0 + echo stdin.
run_passthrough_hook() {
  local hook="$1"
  local payload="$2"
  local label="$3"

  local actual_exit=0
  local actual_out
  actual_out=$(printf '%s' "$payload" | LILARA_KILL_SWITCH=1 LILARA_ENFORCE=1 \
    node "$hook" 2>/dev/null) || actual_exit=$?

  if [ "$actual_exit" -ne 0 ]; then
    fail "$label: exit $actual_exit (expected 0 — informational hook must no-op)"
    return
  fi
  if [ "$actual_out" != "$payload" ]; then
    fail "$label: stdout differs from input (informational hook must echo stdin)"
    return
  fi
  pass "$label: exit 0, stdout unchanged"
}

# PreToolUse hooks — must block (exit 2)
run_pretooluse_hook "claude/hooks/dangerous-command-gate.js" "$DANGEROUS" "kill-switch: dangerous-command-gate"
run_pretooluse_hook "claude/hooks/secret-warning.js"          "$DANGEROUS" "kill-switch: secret-warning"
run_pretooluse_hook "claude/hooks/git-push-reminder.js"       "$DANGEROUS" "kill-switch: git-push-reminder"
run_pretooluse_hook "claude/hooks/build-reminder.js"          "$DANGEROUS" "kill-switch: build-reminder"
run_pretooluse_hook "openclaw/hooks/adapter.js"               "$DANGEROUS" "kill-switch: openclaw-adapter"
run_pretooluse_hook "opencode/hooks/adapter.js"               "$DANGEROUS" "kill-switch: opencode-adapter"

# Informational hooks — must no-op (exit 0 + echo stdin)
run_passthrough_hook "claude/hooks/session-start.js"    "$SESSION"   "kill-switch: session-start"
run_passthrough_hook "claude/hooks/session-end.js"      "$SESSION"   "kill-switch: session-end"
run_passthrough_hook "claude/hooks/memory-load.js"      "$SESSION"   "kill-switch: memory-load"
run_passthrough_hook "claude/hooks/strategic-compact.js" "$SESSION"  "kill-switch: strategic-compact"
run_passthrough_hook "claude/hooks/pr-notifier.js"      "$SESSION"   "kill-switch: pr-notifier"
run_passthrough_hook "claude/hooks/quality-gate.js"     "$SESSION"   "kill-switch: quality-gate"
run_passthrough_hook "claude/hooks/output-sanitizer.js" "$SESSION"   "kill-switch: output-sanitizer"

if [ "$FAILED" -eq 0 ]; then
  printf '\ncheck-kill-switch: all 13 hooks pass with LILARA_KILL_SWITCH=1\n'
  exit 0
fi
printf '\ncheck-kill-switch: FAILED\n' >&2
exit 1
