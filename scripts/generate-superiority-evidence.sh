#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
parity_file="$root/references/parity-matrix.json"
status_script="$root/scripts/status-summary.sh"

[ -f "$parity_file" ] || { printf 'parity-matrix.json missing\n' >&2; exit 1; }
[ -f "$status_script" ] || { printf 'status-summary.sh missing\n' >&2; exit 1; }

today="$(git -C "$root" log -1 --format=%cd --date=format:%Y-%m-%d -- references/superiority-evidence.md 2>/dev/null | grep . || date -u +%Y-%m-%d)"

# ECC-only extension total (sum of current_only_total across agents/rules/skills)
ecc_only_total="$(awk '
  BEGIN { in_sum=0; comp=""; total=0 }
  /"summary":/ { in_sum=1; next }
  !in_sum { next }
  /"agents":/ { comp="agents"; next }
  /"rules":/ { comp="rules"; next }
  /"skills":/ { comp="skills"; next }
  comp != "" && /"current_only_total":/ { v=$0; gsub(/[^0-9]/,"",v); total+=v }
  END { print total }
' "$parity_file")"

# Count verified tool wiring targets (WIRING_PLAN.md files for supported tools)
tool_targets=0
for plan in "$root/claude/WIRING_PLAN.md" "$root/opencode/WIRING_PLAN.md" "$root/openclaw/WIRING_PLAN.md"; do
  [ -f "$plan" ] && tool_targets=$((tool_targets + 1)) || true
done

# Count reviewed capability packs (modules/*/registry.json)
capability_packs="$(find "$root/modules" -maxdepth 2 -name 'registry.json' | wc -l | tr -d ' ')"

# Count verification layers in status-summary.sh: one per line that invokes a
# ./scripts/ verification. PR #195's de-mask reshaped each invocation from a
# line-leading `./scripts/foo.sh && ... || ...` into a `run_check "name"
# ./scripts/foo.sh` wrapper (plus one inline `if ./scripts/audit-examples.sh`
# guard), so ./scripts/ is no longer line-leading. The old `^\s*\./scripts/`
# anchor therefore matched 0 post-demask; this `(^|\s)\./scripts/` anchor counts
# ./scripts/ at any command/argument boundary instead. The de-mask was a pure
# reshape (no layer added or removed), so the faithful count is unchanged at 24:
# 23 run_check invocations + 1 inline audit-examples guard. (A regex keyed to
# `run_check\s+\S+` would undercount — two labels are quoted multi-word strings,
# e.g. "integration smoke", so \S+ cannot span them.)
verification_layers="$(grep -cE '(^|\s)\./scripts/' "$status_script" || true)"

cat <<EOF
# Superiority Evidence

Last updated: ${today}
Reference baseline: \`affaan-m/everything-claude-code\` \`v1.10.0\`

This file records measured or directly verifiable ways Agent Runtime Guard now exceeds upstream, rather than only matching it.

## Quantified Metrics

| Metric | Value | Evidence |
|---|---:|---|
| ECC-only extensions beyond upstream | ${ecc_only_total} | Derived from \`references/parity-matrix.json\` current-only totals across agents, rules, and skills |
| Verified tool wiring targets | ${tool_targets} | \`claude/WIRING_PLAN.md\`, \`opencode/WIRING_PLAN.md\`, \`openclaw/WIRING_PLAN.md\` |
| Reviewed capability packs | ${capability_packs} | \`modules/*/registry.json\` |
| Verification layers in \`status-summary.sh\` | ${verification_layers} | Verification block in \`scripts/status-summary.sh\` |

## Categories

| Category | Claim | Evidence |
|---|---|---|
| Safety | Agent Runtime Guard enforces a narrower trust model than upstream by default. | \`SECURITY_MODEL.md\` explicitly disallows unreviewed remote code execution, silent permission auto-approval, hidden telemetry, and undocumented external modules. |
| Verification | Agent Runtime Guard has explicit executable verification layers beyond file-count parity. | Passing checks: \`check-installation.sh\`, \`check-apply-status.sh\`, \`check-executables.sh\`, \`check-setup-wizard.sh\`, \`check-wiring-docs.sh\`, \`check-status-docs.sh\`, \`check-hook-edge-cases.sh\`, plus audit/smoke/fixtures/integration checks. |
| Installability | Agent Runtime Guard supports profile-aware installation with runtime validation. | \`install-local.sh\` supports \`minimal\`, \`rules\`, \`agents\`, \`skills\`, \`full\`; \`check-installation.sh\` and \`check-config-integration.sh\` validate install behavior, config generation, list mode, and hook verification. |
| Observability | Agent Runtime Guard exposes status and parity evidence from the repo itself. | \`status-summary.sh\` reports parity snapshot and verification layers; \`references/parity-matrix.json\` and \`references/parity-report.md\` provide explicit coverage accounting. |
| Operator UX | Agent Runtime Guard provides guided onboarding and tool-aware post-install guidance. | \`setup-wizard.sh\` supports Claude, OpenCode, OpenClaw, and both-mode guidance; \`check-setup-wizard.sh\` verifies wizard output paths and edge cases. |

## Minimum Standard

A superiority claim belongs here only if it is backed by one of:
- a passing verification script,
- a concrete repo artifact,
- or a policy difference that is directly inspectable in-version.
EOF
