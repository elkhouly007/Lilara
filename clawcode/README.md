# Claw Code Harness — EXPERIMENTAL

> **EXPERIMENTAL — best-effort adapter, not promoted to production.** A `hooks/adapter.js` ships using the broadest input-shape fallback chain. The Claw Code hook API is not publicly documented and the adapter is unverified against real Claw Code hook payloads. Test your actual Claw Code hook payload against the adapter before relying on it. See [ROADMAP.md](../ROADMAP.md) under "Codex / ClawCode / Antegravity adapter verification" for promotion criteria.

## What This Is

`hooks/adapter.js` delegates to `claude/hooks/hook-utils.js → createAdapter()`, which calls `runtime/pretool-gate.js` — the same single enforcement spine used by the Claude Code, OpenCode, and OpenClaw adapters. The adapter handles the most common input shapes (object with `tool_name`/`tool_input`, flat string, array argv) via a fallback chain.

CI: `scripts/check-clawcode-adapter.sh` runs 13 checks across 6 input shapes and is wired into `.github/workflows/check.yml`.

## What Is Planned

When this integration is promoted, it would deliver:
- A `WIRING_PLAN.md` documenting how Agent Runtime Guard hooks map to Claw Code's hook event model
- A `CLAWCODE_POLICY_MAP.md` documenting which runtime policies apply and how
- A `CLAWCODE_APPLY_CHECKLIST.md` for verifying the integration is active
- Setup wizard support via `--tool clawcode`
- Per-tool apply-status rows showing actual wiring state
- Promotion from EXPERIMENTAL to Supported

## Promotion Criteria

This harness is promoted from EXPERIMENTAL to Supported when:
1. A contributor verifies the actual Claw Code hook payload format and confirms the adapter handles it correctly
2. `WIRING_PLAN.md` documents the confirmed wiring path
3. `scripts/check-clawcode-adapter.sh` passes against representative real payloads

## Known Unknowns

See `COMPATIBILITY_NOTES.md` for a full list of what is unresolved.

## How to Contribute

If you have verified knowledge of the Claw Code hook API or agent lifecycle, open a PR that fills in `COMPATIBILITY_NOTES.md` and proposes a `WIRING_PLAN.md`. Do not propose fake wiring — only document what you have actually tested.
