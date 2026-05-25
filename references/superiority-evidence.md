# Superiority Evidence

Last updated: 2026-05-26
Reference baseline: `affaan-m/everything-claude-code` `v1.10.0`

This file records measured or directly verifiable ways Agent Runtime Guard now exceeds upstream, rather than only matching it.

## Quantified Metrics

| Metric | Value | Evidence |
|---|---:|---|
| ECC-only extensions beyond upstream | 187 | Derived from `references/parity-matrix.json` current-only totals across agents, rules, and skills |
| Verified tool wiring targets | 3 | `claude/WIRING_PLAN.md`, `opencode/WIRING_PLAN.md`, `openclaw/WIRING_PLAN.md` |
| Reviewed capability packs | 6 | `modules/*/registry.json` |
| Verification layers in `status-summary.sh` | 24 | Verification block in `scripts/status-summary.sh` |

## Categories

| Category | Claim | Evidence |
|---|---|---|
| Safety | Agent Runtime Guard enforces a narrower trust model than upstream by default. | `SECURITY_MODEL.md` explicitly disallows unreviewed remote code execution, silent permission auto-approval, hidden telemetry, and undocumented external modules. |
| Verification | Agent Runtime Guard has explicit executable verification layers beyond file-count parity. | Passing checks: `check-installation.sh`, `check-apply-status.sh`, `check-executables.sh`, `check-setup-wizard.sh`, `check-wiring-docs.sh`, `check-status-docs.sh`, `check-hook-edge-cases.sh`, plus audit/smoke/fixtures/integration checks. |
| Installability | Agent Runtime Guard supports profile-aware installation with runtime validation. | `install-local.sh` supports `minimal`, `rules`, `agents`, `skills`, `full`; `check-installation.sh` and `check-config-integration.sh` validate install behavior, config generation, list mode, and hook verification. |
| Observability | Agent Runtime Guard exposes status and parity evidence from the repo itself. | `status-summary.sh` reports parity snapshot and verification layers; `references/parity-matrix.json` and `references/parity-report.md` provide explicit coverage accounting. |
| Operator UX | Agent Runtime Guard provides guided onboarding and tool-aware post-install guidance. | `setup-wizard.sh` supports Claude, OpenCode, OpenClaw, and both-mode guidance; `check-setup-wizard.sh` verifies wizard output paths and edge cases. |

## Minimum Standard

A superiority claim belongs here only if it is backed by one of:
- a passing verification script,
- a concrete repo artifact,
- or a policy difference that is directly inspectable in-version.
