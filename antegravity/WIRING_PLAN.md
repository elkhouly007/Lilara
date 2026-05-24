# antegravity Wiring Plan (SPECULATIVE)

> **Status: EXPERIMENTAL.** This document describes the intended wiring once the antegravity hook API is confirmed by a contributor. Do not follow these instructions as production guidance until the actual antegravity hook payload format is verified.

## Goal

Wire Agent Runtime Guard into antegravity as a project-local enforcement layer using the same `pretool-gate.js` spine used by Claude Code, OpenCode, and OpenClaw.

## Scope Of This Wiring

This wiring covers:

- runtime hook adapter (`antegravity/hooks/adapter.js`);
- target file map;
- policy mapping for antegravity tool usage;
- contributor verification steps for payload format;
- compatibility guidance pending upstream confirmation.

It does not overwrite existing antegravity user config or global files. All changes are project-local.

## Runtime Hook Adapter

`antegravity/hooks/adapter.js` is a PreToolUse adapter that delegates to `claude/hooks/hook-utils.js → createAdapter()` → `runtime/pretool-gate.js`.

**Likely antegravity input shapes (unverified — contributor must confirm):**

```json
{ "command": "...", "cwd": "..." }
{ "cmd": "...", "cwd": "..." }
{ "tool_input": { "command": "..." } }
```

Also accepted via fallback chain: `input.command`, `args.command`, `params.command`.

**Wire into antegravity config** as a `PreToolUse` hook on shell/bash tool calls. Point the hook command at the absolute path of `antegravity/hooks/adapter.js`.

**Modes:**

- Warn mode (default): warns to stderr, exits 0 (tool call proceeds). Set no env var.
- Block mode: `export LILARA_ENFORCE=1` — exits 2 on high/critical risk (tool call aborted).

**Fixtures:** `tests/fixtures/antegravity/` — 10 fixtures covering dangerous commands (curl|sh, force-push, rm -rf), enforce mode (dd-device, force-push, hard-reset, npx -y, rm -rf), and safe pass-through (git log, ls). Run with `scripts/run-fixtures.sh`.

## PostToolUse Parity

Current wiring includes both PreToolUse and PostToolUse. `antegravity/hooks/post-adapter.js` was added by Wave 1 A3 (merged in `3787b09`) and scans output for secrets and records external reads for the taint/provenance system.

antegravity PostToolUse event model is unverified. Until a contributor confirms event model support and documents the wiring path, the PostToolUse extension remains deferred for production use. See `references/owasp-agentic-coverage.md` (ASI05) for current coverage status.

## Target Paths

Recommended project-local targets:

- `tools/horus/antegravity/WIRING_PLAN.md`
- `tools/horus/antegravity/ANTEGRAVITY_POLICY_MAP.md`
- `tools/horus/antegravity/ANTEGRAVITY_APPLY_CHECKLIST.md`
- `tools/horus/antegravity/COMPATIBILITY_STRATEGY.md`
- `tools/horus/antegravity/examples/`

Potential future integration targets, only after explicit review:

- per-project antegravity config references;
- project-local role presets;
- optional module enablement snippets.

## Wiring Steps (Contributor Must Confirm)

1. Determine where antegravity reads PreToolUse hook configuration.
2. Set hook entry point to the absolute path of `antegravity/hooks/adapter.js`.
3. Verify the actual hook payload by logging stdin to a temp file before the adapter runs.
4. If the payload shape differs from the shapes above, update `extractCommand`/`extractCwd` in `antegravity/hooks/adapter.js`.
5. Confirm that `scripts/check-antegravity-adapter.sh` passes against real payloads.
6. File a PR updating this document and promoting the harness from EXPERIMENTAL to Supported.

## Wiring Model

Use Agent Runtime Guard as an external policy and config-template source.

antegravity should consume:

- the hook adapter via PreToolUse event;
- `ANTEGRAVITY_POLICY_MAP.md` as a policy reference;
- `ANTEGRAVITY_APPLY_CHECKLIST.md` as an operator guide.

Prefer project-local references and adapter glue over direct core patching. Do not change global antegravity defaults automatically in this step.

## Approval Mapping

### Auto-allowed

- reading local project files;
- writing new local documentation;
- adding project-local policy notes;
- using trusted external agents only after payload review.

### Approval-required

- overwriting existing important antegravity config files;
- enabling external-write or system-write plugins;
- enabling external data flow with personal or confidential data;
- global user-level antegravity config mutation.

## Rollback Strategy

If integration causes instability:

1. remove the hook registration from your antegravity config;
2. delete the local `tools/horus/antegravity/` directory;
3. revert any manual changes to antegravity project config if applicable.

The adapter makes no global writes. Rollback is non-destructive.

## Definition Of Done

- Contributor confirms actual antegravity hook payload format.
- `WIRING_PLAN.md` updated with verified wiring steps (remove SPECULATIVE banner).
- `scripts/check-antegravity-adapter.sh` passes against real payloads.
- Harness status promoted from EXPERIMENTAL to Supported in `antegravity/README.md`.
- PostToolUse wiring confirmed or documented as unsupported.
