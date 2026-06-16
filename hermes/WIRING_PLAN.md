# Hermes Adapter — Wiring Plan

> **Clean-room integration target.** Per `references/hermes-license-check.md`, this adapter is built from public docs
> only (`https://hermes-agent.nousresearch.com/docs/developer-guide/adding-platform-adapters` and adjacent public
> surfaces). **No Hermes source code has been read.** The MIT license is permissive and clean-room-compatible. Any
> future source contact requires owner escalation + dated amendment to the license-check artifact.

## Goal

Wire Agent Runtime Guard (Lilara) into Hermes Agent in a way that is apply-ready, reviewable, and aligned with the
standing approval policy. Lilara runs **behind** Hermes's tool dispatcher — gating every tool call Hermes dispatches
through `runtime.decide()` before the underlying handler executes.

## Integration model — fundamentally different from the other harnesses

The existing Lilara adapters (`claude/`, `opencode/`, `openclaw/`, `codex/`, `clawcode/`, `antegravity/`) are all
**PreToolUse hooks**: the harness invokes a hook script before each tool call, and the script exits 0 (warn), 1
(error), or 2 (block). Hermes is **not** a hook-based harness.

Per `https://hermes-agent.nousresearch.com/docs/developer-guide/tools-runtime` (public docs surface, paraphrased):

> Hermes tools are self-registering functions grouped into toolsets and executed through a central registry/dispatch
> system. Each tool module calls `registry.register(...)` at import time, providing a `handler` (the function that
> executes when the tool is called) and a `schema` (OpenAI function-calling schema).

**Therefore the Lilara adapter for Hermes wraps the `handler` function.** Before Hermes's dispatcher calls the
handler, Lilara's `runtime.decide()` runs and returns `allow` / `block` / `require-review`. On `allow`, the wrapped
handler executes and its result is returned to Hermes. On `block`, the handler is not called and a refusal is returned
to Hermes. On `require-review`, the call is held until the user approves (per the contract).

This is a **handler-wrap integration**, not a hook integration. The Lilara manifest captures this difference.

## Two integration paths (per public docs)

### Path A — Plugin path (recommended)

Per `https://hermes-agent.nousresearch.com/docs/developer-guide/adding-platform-adapters`:

> Plugin (recommended for community/third-party): Drop a plugin directory into `~/.hermes/plugins/` — zero core code
> changes needed. See Plugin Path below.

The plugin layout is:

```
~/.hermes/plugins/lilara/
  plugin.yaml         # plugin metadata, env-var declarations
  adapter.py          # Lilara guard entry point + register() function
  manifest.json       # Lilara manifest (copy of hermes/manifest.json from this repo)
```

This is the recommended path because it requires **zero Hermes core code changes** — Lilara can be installed and
uninstalled by dropping/ removing a directory, and Hermes discovers it via its plugin scanner.

### Path B — Built-in path

> Built-in: Modify 20+ files across code, config, and docs. Use the Built-in Checklist below.

Not recommended for third-party work. The Lilara adapter is third-party (NousResearch-owned), so Path A is the
canonical deployment model.

## Scope of this folder

This folder contains the **Path A plugin sources** (Node.js hooks) — the parts of Lilara that sit in front of
Hermes's tool dispatcher:

- `hooks/adapter.js` — PreToolUse-equivalent wrapper for Hermes's tool handlers. Delegates all enforcement to
  `runtime/pretool-gate.js`.
- `hooks/post-adapter.js` — PostToolUse-equivalent: scans tool output for secrets and records external reads for the
  taint/provenance system (F10, F28, ADR-045).
- `manifest.json` — Lilara's manifest for this harness, declaring the supported surface, envelope reporting status,
  and negative capabilities honestly.
- `README.md` — apply guidance.
- `HERMES_POLICY_MAP.md` — how Hermes events map to Lilara decision sources / floor sources.

Hermes itself is Python; the Lilara plugin adapter is Node.js because the Lilara runtime is Node.js and uses
zero-dep Node built-ins (per SCOPE §18). The boundary contract is the JSON payload Lilara emits as the
`handler`-wrap result.

## Wired modes

- **Warn mode (default):** `runtime.decide()` returns its decision; the wrapper does not raise. The tool call proceeds
  unless Lilara says block. Set no env var.
- **Block mode:** `export LILARA_ENFORCE=1` — Lilara's `require-review` and `block` decisions translate into the
  appropriate wrapper behavior (return refusal to Hermes).
- **Kill switch:** `export LILARA_KILL_SWITCH=1` — every tool call returns `block` immediately (emergency).

## Hook payload shape (Lilara-side)

The Lilara wrapper expects a Hermes-style payload on `stdin`:

```json
{
  "tool": "terminal",
  "cmd": "rm -rf /tmp/foo",
  "cwd": "/home/user/project",
  "args": [],
  "mcp_server": null,
  "skill_name": null,
  "session_id": "...",
  "tool_call_id": "..."
}
```

This is the **canonical Adapter IR shape** per `runtime/action-ir.js` (ADR-007), with harness-specific field names
normalized by `extractCommand` / `extractCwd` / `extractTool` in `hooks/adapter.js`.

## Fixtures

Hermes-fixture-equivalents live under `tests/fixtures/hermes/` — same shape as the other harnesses'
`tests/fixtures/{claude,opencode,openclaw,codex,clawcode,antegravity}/` (dangerous commands, enforce mode, safe
pass-through, borderline sudo). The CI parity gate (`scripts/check-post-adapter-parity.sh`) is extended in the
follow-up PR to cover the 7th harness.

## PostToolUse parity

`hermes/hooks/post-adapter.js` scans tool output for secrets via `runtime/secret-scan.js` and records external-source
outputs via `runtime/taint.js` (per `runtime/post-adapter-factory.js`). For Hermes, the "tool output" is the value
the handler returns; the Lilara wrapper captures this and passes it through the post-adapter.

## Out of scope for this PR

- The full Hermes `plugin.py` Python entry point (the bridging code that calls the Lilara Node wrapper from inside
  Hermes's plugin loader). That code belongs in the Hermes plugin directory at install time (`~/.hermes/plugins/lilara/`),
  is generated from this adapter's sources, and is the next PR's deliverable. It is **not** part of Lilara's source
  tree because it lives at the install site.
- Real-run measurement against an installed Hermes instance (Phase 2 step 4, after parity / install / smoke scripts
  cover the 7th harness).
- The F15 execution-envelope wiring for Hermes (the manifest honestly declares `envelopeReporting: false` until that
  wiring lands).

## Cross-references

- `references/hermes-license-check.md` — Phase 2 step 1 license check (MIT, NousResearch/hermes-agent, clean-room boundary).
- `references/PLAN.md` §"Phase 2" — full work items (3-4 PRs total).
- `references/SCOPE.md` §17 — reference integrations; §18 — engineering invariants; §10 #5 — DoD target (the Hermes
  integration closes this).
- `references/adr-035-consent-gate.md` — the four invariants the adapter must preserve.
- `references/adr-046-taint-window-injection.md` — `decide()` purity; the wrapper injects the taint window, never
  reads from disk.
- `HANDOVER-HERMES.md` §4 — license red line; §9 — Hermes operating instructions.
