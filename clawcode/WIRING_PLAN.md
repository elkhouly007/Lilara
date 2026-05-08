# Claw Code Wiring Plan (SPECULATIVE)

> **Status: EXPERIMENTAL.** This document describes the intended wiring once the Claw Code hook API is confirmed by a contributor. Do not follow these instructions as production guidance until the actual Claw Code hook payload format is verified.

## Goal

Wire Agent Runtime Guard into Claw Code as a project-local enforcement layer using the same `pretool-gate.js` spine used by Claude Code, OpenCode, and OpenClaw.

## Scope Of This Wiring

This wiring covers:

- runtime hook adapter (`clawcode/hooks/adapter.js`);
- target file map;
- policy mapping for Claw Code tool usage;
- contributor verification steps for payload format;
- compatibility guidance pending upstream confirmation.

It does not overwrite existing Claw Code user config or global files. All changes are project-local.

## Runtime Hook Adapter

`clawcode/hooks/adapter.js` is a PreToolUse adapter that delegates to `claude/hooks/hook-utils.js → createAdapter()` → `runtime/pretool-gate.js`.

**Likely Claw Code input shapes (unverified — contributor must confirm):**

```json
{ "command": "...", "cwd": "..." }
{ "cmd": "...", "cwd": "..." }
{ "tool_input": { "command": "..." } }
```

Also accepted via fallback chain: `input.command`, `args.command`, `params.command`.

**Wire into Claw Code config** as a `PreToolUse` hook on shell/bash tool calls. Point the hook command at the absolute path of `clawcode/hooks/adapter.js`.

**Modes:**

- Warn mode (default): warns to stderr, exits 0 (tool call proceeds). Set no env var.
- Block mode: `export HORUS_ENFORCE=1` — exits 2 on high/critical risk (tool call aborted).

**Fixtures:** `tests/fixtures/clawcode/` — 10 fixtures covering dangerous commands (curl|sh, force-push, rm -rf), enforce mode (dd-device, force-push, hard-reset, npx -y, rm -rf), and safe pass-through (git log, ls). This is the most tested of the three EXPERIMENTAL harnesses: `scripts/check-clawcode-adapter.sh` verifies 12 checks across 6 input shapes. Run with `scripts/run-fixtures.sh`.

## PostToolUse Parity

Current wiring is **PreToolUse-only**. A PostToolUse hook (`clawcode/hooks/post-adapter.js`) is being added by Wave 1 A3 (PR #13) and will scan output for secrets and record external reads for the taint/provenance system.

Claw Code PostToolUse event model has not been verified against a real installation. Until a contributor confirms event model support and documents the wiring path, the PostToolUse extension remains deferred for production use. See `references/owasp-agentic-coverage.md` (ASI05) for current coverage status.

## Target Paths

Recommended project-local targets:

- `tools/horus/clawcode/WIRING_PLAN.md`
- `tools/horus/clawcode/CLAWCODE_POLICY_MAP.md`
- `tools/horus/clawcode/CLAWCODE_APPLY_CHECKLIST.md`
- `tools/horus/clawcode/COMPATIBILITY_STRATEGY.md`
- `tools/horus/clawcode/examples/`

Potential future integration targets, only after explicit review:

- per-project Claw Code config references;
- project-local role presets;
- optional module enablement snippets.

## Wiring Steps (Contributor Must Confirm)

1. Determine where Claw Code reads PreToolUse hook configuration.
2. Set hook entry point to the absolute path of `clawcode/hooks/adapter.js`.
3. Verify the actual hook payload by logging stdin to a temp file before the adapter runs.
4. If the payload shape differs from the shapes above, update `extractCommand`/`extractCwd` in `clawcode/hooks/adapter.js`.
5. Confirm that `scripts/check-clawcode-adapter.sh` passes against real payloads.
6. File a PR updating this document and promoting the harness from EXPERIMENTAL to Supported.

## Wiring Model

Use Agent Runtime Guard as an external policy and config-template source.

Claw Code should consume:

- the hook adapter via PreToolUse event;
- `CLAWCODE_POLICY_MAP.md` as a policy reference;
- `CLAWCODE_APPLY_CHECKLIST.md` as an operator guide.

Prefer project-local references and adapter glue over direct core patching. Do not change global Claw Code defaults automatically in this step.

## Approval Mapping

### Auto-allowed

- reading local project files;
- writing new local documentation;
- adding project-local policy notes;
- using trusted external agents only after payload review.

### Approval-required

- overwriting existing important Claw Code config files;
- enabling external-write or system-write plugins;
- enabling external data flow with personal or confidential data;
- global user-level Claw Code config mutation.

## Rollback Strategy

If integration causes instability:

1. remove the hook registration from your Claw Code config;
2. delete the local `tools/horus/clawcode/` directory;
3. revert any manual changes to Claw Code project config if applicable.

The adapter makes no global writes. Rollback is non-destructive.

## Definition Of Done

- Contributor confirms actual Claw Code hook payload format.
- `WIRING_PLAN.md` updated with verified wiring steps (remove SPECULATIVE banner).
- `scripts/check-clawcode-adapter.sh` passes against real payloads.
- Harness status promoted from EXPERIMENTAL to Supported in `clawcode/README.md`.
- PostToolUse wiring confirmed or documented as unsupported.
