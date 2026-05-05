# Codex Harness — EXPERIMENTAL

> **EXPERIMENTAL — best-effort adapter, not promoted to production.** A `hooks/adapter.js` ships using the broadest input-shape fallback chain. The Codex hook API is not publicly documented and the adapter is unverified against real Codex hook payloads. Test your actual Codex hook payload against the adapter before relying on it. See [ROADMAP.md](../ROADMAP.md) under "Codex / ClawCode / Antegravity adapter verification" for promotion criteria.

## What This Is

`hooks/adapter.js` delegates to `claude/hooks/hook-utils.js → createAdapter()`, which calls `runtime/pretool-gate.js` — the same single enforcement spine used by the Claude Code, OpenCode, and OpenClaw adapters. The adapter handles the most common input shapes (object with `tool_name`/`tool_input`, flat string, array argv) via a fallback chain.

CI: `scripts/check-clawcode-adapter.sh` (sister harness) verifies the shared adapter factory. A dedicated `scripts/check-codex-adapter.sh` is planned (Batch B2).

## What Is Planned

When this integration is promoted, it would deliver:
- A `WIRING_PLAN.md` documenting how Agent Runtime Guard hooks map to Codex's hook event model
- A `CODEX_POLICY_MAP.md` documenting which runtime policies apply and how
- A `CODEX_APPLY_CHECKLIST.md` for verifying the integration is active
- Setup wizard support via `--tool codex`
- Per-tool apply-status rows showing actual wiring state
- Promotion from EXPERIMENTAL to Supported

## Promotion Criteria

This harness is promoted from EXPERIMENTAL to Supported when:
1. A contributor verifies the actual Codex hook payload format and confirms the adapter handles it correctly
2. `WIRING_PLAN.md` documents the confirmed wiring path
3. `scripts/check-codex-adapter.sh` passes against representative real payloads

## Known Unknowns

See `COMPATIBILITY_NOTES.md` for a full list of what is unresolved.

## How to Contribute

If you have verified knowledge of the Codex hook API or agent lifecycle, open a PR that fills in `COMPATIBILITY_NOTES.md` and proposes a `WIRING_PLAN.md`. Do not propose fake wiring — only document what you have actually tested.
