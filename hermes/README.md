# Hermes Adapter

This folder contains Lilara's adapter for **Hermes Agent** (https://hermes-agent.nousresearch.com) — the second
reference integration in `references/SCOPE.md` §17 (Phase 2 deliverable, target version 0.2.3, closes 0.2.0 DoD #5).

> **Clean-room integration target.** Per `../references/hermes-license-check.md`, this adapter is built from public
> docs only — no Hermes source code has been read. License is **MIT** (permissive, clean-room-compatible). Any future
> source contact requires owner escalation + a dated amendment to the license-check artifact.

## What is in this folder

| File | Purpose |
|---|---|
| `WIRING_PLAN.md` | Full wiring plan, integration model, paths, scope, and out-of-scope. |
| `HERMES_POLICY_MAP.md` | How Hermes events map to Lilara decision sources / floor sources. |
| `manifest.json` | Lilara's manifest for the Hermes harness. |
| `hooks/adapter.js` | PreToolUse-equivalent wrapper (handler-wrap). Delegates to `runtime/pretool-gate.js`. |
| `hooks/post-adapter.js` | PostToolUse-equivalent: scans output for secrets, records external reads for taint tracking. |

## Integration model — handler-wrap, NOT PreToolUse-hook

The existing Lilara adapters (`claude/`, `opencode/`, `openclaw/`, `codex/`, `clawcode/`, `antegravity/`) are all
**PreToolUse hooks**. Hermes is **not** a hook-based harness — Hermes tools are self-registering functions with a
handler. The Lilara adapter **wraps the handler**: before Hermes's dispatcher invokes the handler, the wrapper calls
`runtime.decide()` and either passes through (`allow`), refuses (`block`), or holds (`require-review`).

See `WIRING_PLAN.md` for the full integration-model rationale. See `manifest.json:integrationModel` for the field
name and `"handler-wrap"` literal.

## Deployment — the plugin path (recommended)

Per Hermes's public docs, the recommended installation is the **plugin path**:

```
~/.hermes/plugins/lilara/
  plugin.yaml         # plugin metadata, env-var declarations (generated from this adapter's sources)
  adapter.py          # Python bridge: imports the Lilara Node wrapper, wraps each handler
  manifest.json       # Lilara manifest (copy of hermes/manifest.json from this repo)
```

The Python bridge is **generated at install time** (not in this repo's source tree) and is the next PR's deliverable.
The Lilara wrapper at `hooks/adapter.js` is what the Python bridge calls.

## Wired modes

- **Warn mode (default):** `runtime.decide()` returns its decision; the wrapper does not raise. The tool call proceeds
  unless Lilara says block. Set no env var.
- **Block mode:** `export LILARA_ENFORCE=1` — `require-review` and `block` decisions translate into the appropriate
  wrapper behavior (return refusal to Hermes).
- **Kill switch:** `export LILARA_KILL_SWITCH=1` — every tool call returns `block` immediately (emergency override).

## Cross-references

- `../references/hermes-license-check.md` — license check (MIT) + clean-room boundary
- `../references/PLAN.md` §"Phase 2" — full work items
- `../references/SCOPE.md` §17 — reference integrations; §18 — engineering invariants
- `WIRING_PLAN.md` — full wiring plan
- `HERMES_POLICY_MAP.md` — event → decision source / floor source map
