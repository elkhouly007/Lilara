# antegravity Compatibility Strategy

## Status

EXPERIMENTAL. The antegravity hook API is not publicly documented. This strategy is written for when the integration is confirmed.

## Core Rule

Do not rely on patching antegravity internals. Use the hook registration mechanism (if one exists) and a project-local `antegravity/hooks/adapter.js`. If antegravity does not support external hook registration, this integration cannot proceed without upstream changes.

## Avoid

- assumptions about antegravity hook payload stability
- tight coupling to antegravity version-specific behavior
- global antegravity config mutation

## Prefer

- project-local hook file registration
- the same `pretool-gate.js` fallback chain that handles multiple payload shapes
- explicit shape testing via `scripts/check-antegravity-adapter.sh`

## Compatibility Checks After antegravity Updates

Review:
- hook payload schema changes (command field name, nesting)
- hook lifecycle changes (PreToolUse → different event name)
- permission model changes

If antegravity changes break the adapter, update `extractCommand`/`extractCwd` in `antegravity/hooks/adapter.js` and re-run `scripts/check-antegravity-adapter.sh`.
