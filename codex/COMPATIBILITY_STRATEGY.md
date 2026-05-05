# Codex Compatibility Strategy

## Status

EXPERIMENTAL. The Codex hook API is not publicly documented. This strategy is written for when the integration is confirmed.

## Core Rule

Do not rely on patching Codex internals. Use the hook registration mechanism (if one exists) and a project-local `codex/hooks/adapter.js`. If Codex does not support external hook registration, this integration cannot proceed without upstream changes.

## Avoid

- assumptions about Codex hook payload stability
- tight coupling to Codex version-specific behavior
- global Codex config mutation

## Prefer

- project-local hook file registration
- the same `pretool-gate.js` fallback chain that handles multiple payload shapes
- explicit shape testing via `scripts/check-codex-adapter.sh`

## Compatibility Checks After Codex Updates

Review:
- hook payload schema changes (command field name, nesting)
- hook lifecycle changes (PreToolUse → different event name)
- permission model changes

If Codex changes break the adapter, update `extractCommand`/`extractCwd` in `codex/hooks/adapter.js` and re-run `scripts/check-codex-adapter.sh`.
