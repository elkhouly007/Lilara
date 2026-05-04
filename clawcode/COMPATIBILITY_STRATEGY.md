# Claw Code Compatibility Strategy

## Status

EXPERIMENTAL. The Claw Code hook API is not publicly documented. This strategy is written for when the integration is confirmed.

## Core Rule

Do not rely on patching Claw Code internals. Use the hook registration mechanism (if one exists) and a project-local `clawcode/hooks/adapter.js`. If Claw Code does not support external hook registration, this integration cannot proceed without upstream changes.

## Avoid

- assumptions about Claw Code hook payload stability
- tight coupling to Claw Code version-specific behavior
- global Claw Code config mutation

## Prefer

- project-local hook file registration
- the same `pretool-gate.js` fallback chain that handles multiple payload shapes
- explicit shape testing via `scripts/check-clawcode-adapter.sh`

## Compatibility Checks After Claw Code Updates

Review:
- hook payload schema changes (command field name, nesting)
- hook lifecycle changes (PreToolUse → different event name)
- permission model changes

If Claw Code changes break the adapter, update `extractCommand`/`extractCwd` in `clawcode/hooks/adapter.js` and re-run `scripts/check-clawcode-adapter.sh`.
