# Codex Compatibility Strategy

## Status

VERIFIED — 2026-05-24. Hook payload shape and decision protocol confirmed against openai/codex (codex-rs). See `WIRING_PLAN.md` for the full verification record.

## Core Rule

Use the hook registration mechanism (`<repo>/.codex/hooks.json` or `~/.codex/hooks.json`) and a project-local `codex/hooks/adapter.js`. Do not patch Codex internals.

## Avoid

- Assumptions about Codex hook payload stability beyond what is typed in `codex-rs/hooks/src/`
- Global Codex config mutation without operator consent
- Relying on MCP or Skill interception without checking openai/codex#20204 coverage status

## Prefer

- Project-local hook file registration via `.codex/hooks.json`
- The verified field path (`tool_input.command`, `cwd`) as the primary extraction path, with legacy fallbacks retained for defensive parsing
- Explicit shape testing via `scripts/check-codex-adapter.sh`

## Compatibility Checks After Codex Updates

Review after upstream codex-rs changes to:

- Hook payload struct fields in `codex-rs/hooks/src/events/`
- Hook event lifecycle changes (new event types, removed event types)
- Exit-code protocol changes
- Handler-coverage gaps (monitor openai/codex#20204 and related issues)

If upstream changes break the adapter, update `extractCommand`/`extractCwd` in `codex/hooks/adapter.js`, update `codex/manifest.json` `harnessVersion`, and re-run `scripts/check-codex-adapter.sh`.
