#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

pass() { printf '  ok      %s\n' "$1"; }
fail() { printf '  ERROR   %s\n' "$1" >&2; exit 1; }

run_case() {
  local name="$1"
  shift
  local out="$workdir/$name.txt"
  bash "$root/scripts/setup-wizard.sh" --non-interactive "$@" > "$out"
  printf '%s\n' "$out"
}

printf '[check-setup-wizard]\n'

out="$(run_case claude --target ./demo --tool claude --languages auto --profile rules --wire-hooks yes)"
grep -Fq 'install-local.sh "./demo" --profile rules --auto' "$out" || fail 'claude auto install command'
grep -Fq 'wire-hooks.sh "./demo/claude/hooks"' "$out" || fail 'claude hooks path'
pass 'claude wizard output'

out="$(run_case opencode --target ./demo --tool opencode --languages python,typescript --profile full --wire-hooks yes)"
grep -Fq 'install-local.sh "./demo" --profile full' "$out" || fail 'opencode install command'
if grep -Fq -- '--languages' "$out"; then
  fail 'wizard should not emit unsupported --languages flag'
fi
grep -Fq 'copy the generated config before running install' "$out" || fail 'wizard explains config-driven languages'
if grep -Fq 'claude/hooks' "$out"; then
  fail 'opencode flow should not print claude hook path'
fi
pass 'opencode wizard output'

out="$(run_case both --target ./demo --tool both --languages auto --profile minimal --wire-hooks no)"
grep -Fq '"tool": "both"' "$out" || fail 'wizard keeps tool=both in config'
pass 'both-tool wizard output'

out="$(run_case openclaw --target ./demo --tool openclaw --languages auto --profile rules --wire-hooks yes)"
grep -Fq 'install-local.sh "./demo" --profile rules --auto' "$out" || fail 'openclaw install command'
grep -Fq 'openclaw/WIRING_PLAN.md' "$out" || fail 'openclaw wiring guidance'
grep -Fq 'OPENCLAW_APPLY_CHECKLIST.md' "$out" || fail 'openclaw checklist guidance'
if grep -Fq 'claude/hooks' "$out"; then
  fail 'openclaw flow should not print claude hook path'
fi
pass 'openclaw wizard output'

# Planned harnesses should exit non-zero with a clear message, not silently fall back
for planned_tool in antegravity; do
  err_out="$workdir/planned-${planned_tool}.txt"
  if bash "$root/scripts/setup-wizard.sh" --non-interactive --tool "$planned_tool" --target ./demo >"$err_out" 2>&1; then
    fail "wizard should exit non-zero for planned tool: $planned_tool"
  fi
  grep -qiE 'not yet supported' "$err_out" || fail "wizard missing not-yet-supported message for: $planned_tool"
  grep -qE 'Harness Support Matrix|Supported tools:' "$err_out" || fail "wizard missing matrix/supported-tools pointer for: $planned_tool"
done
pass 'wizard exits non-zero with clear message for planned tools'

# Unknown tool names should also exit non-zero
if bash "$root/scripts/setup-wizard.sh" --non-interactive --tool unknowntool --target ./demo >"$workdir/unknown-tool.txt" 2>&1; then
  fail 'wizard should exit non-zero for completely unknown tool'
fi
pass 'wizard exits non-zero for unknown tool'

printf '\nSetup wizard checks passed.\n'
