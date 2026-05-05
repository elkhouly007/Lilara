# antegravity Harness — EXPERIMENTAL

> **EXPERIMENTAL — best-effort adapter, not promoted to production.** A `hooks/adapter.js` ships using the broadest input-shape fallback chain. The antegravity hook API is not publicly documented and the adapter is unverified against real antegravity hook payloads. Test your actual antegravity hook payload against the adapter before relying on it. See [ROADMAP.md](../ROADMAP.md) under "Codex / ClawCode / Antegravity adapter verification" for promotion criteria.

## What This Is

`hooks/adapter.js` delegates to `claude/hooks/hook-utils.js → createAdapter()`, which calls `runtime/pretool-gate.js` — the same single enforcement spine used by the Claude Code, OpenCode, and OpenClaw adapters. The adapter handles the most common input shapes (object with `tool_name`/`tool_input`, flat string, array argv) via a fallback chain.

CI: A dedicated `scripts/check-antegravity-adapter.sh` is planned (Batch B2).

## What Is Planned

When this integration is promoted, it would deliver:
- A `WIRING_PLAN.md` documenting how Agent Runtime Guard hooks map to antegravity's hook event model
- An `ANTEGRAVITY_POLICY_MAP.md` documenting which runtime policies apply and how
- An `ANTEGRAVITY_APPLY_CHECKLIST.md` for verifying the integration is active
- Setup wizard support via `--tool antegravity`
- Per-tool apply-status rows showing actual wiring state
- Promotion from EXPERIMENTAL to Supported

## Promotion Criteria

This harness is promoted from EXPERIMENTAL to Supported when:
1. A contributor verifies the actual antegravity hook payload format and confirms the adapter handles it correctly
2. `WIRING_PLAN.md` documents the confirmed wiring path
3. `scripts/check-antegravity-adapter.sh` passes against representative real payloads

## Known Unknowns

See `COMPATIBILITY_NOTES.md` for a full list of what is unresolved.

## How to Contribute

If you have verified knowledge of the antegravity hook API or agent lifecycle, open a PR that fills in `COMPATIBILITY_NOTES.md` and proposes a `WIRING_PLAN.md`. Do not propose fake wiring — only document what you have actually tested.
