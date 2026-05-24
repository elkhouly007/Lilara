# antegravity Compatibility Strategy

## Status

VERIFIED — 2026-05-24. Hook protocol traced against `google-gemini/gemini-cli` (Apache-2.0). See `WIRING_PLAN.md` and `COMPATIBILITY_NOTES.md` for full details.

## Core Rule

Do not rely on patching antegravity internals. Use the verified `BeforeTool` / `AfterTool` hook events wired in `.gemini/settings.json` (or `~/.gemini/settings.json`). The hook registration mechanism is confirmed via the upstream source.

## Avoid

- assumptions about antegravity hook payload stability
- tight coupling to antegravity version-specific behavior
- global antegravity config mutation

## Prefer

- project-local hook file registration
- the same `pretool-gate.js` fallback chain that handles multiple payload shapes
- explicit shape testing via `scripts/check-antegravity-adapter.sh`

## Compatibility Checks After Antegravity Updates

Track releases of `google-gemini/gemini-cli` for changes to:
- `packages/core/src/hooks/types.ts` — `BeforeToolInput` / `AfterToolInput` field names or nesting
- `packages/core/src/hooks/hookRunner.ts` — exit-code semantics or output parsing order
- Event name renames in the `HookEventName` enum

If an upstream change breaks the adapter, update `extractCommand`/`extractCwd` in `antegravity/hooks/adapter.js`, update checks 13–16 in `scripts/check-antegravity-adapter.sh`, and update `antegravity/manifest.json`'s `harnessVersion` and `verifiedAt`.
