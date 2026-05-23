# OpenClaw Wiring Plan

## Goal

Wire Agent Runtime Guard into OpenClaw in a way that is apply-ready, reviewable, and aligned with the standing approval policy.

## Scope Of This Wiring

This wiring covers:

- runtime hook adapter (`openclaw/hooks/adapter.js`);
- target file map;
- prompt pack layout;
- policy mapping for OpenClaw usage;
- manual apply guidance without forcing unsafe overwrites;
- compatibility guidance for frequent OpenClaw updates;
- project-local examples that avoid core patching.

It does not overwrite existing OpenClaw workspace files or global OpenClaw config.

## Runtime Hook Adapter

`openclaw/hooks/adapter.js` is a PreToolUse hook for OpenClaw that routes shell commands through `runtime.decide()`.

**Primary input shape (OpenClaw native):**

```json
{ "tool": "shell", "cmd": "...", "cwd": "..." }
```

**Fallback shapes (cross-harness compatibility):**

- `input.input.cmd` — nested OpenClaw
- `input.command` — Claude Code direct
- `input.args.command` — Claude Code args
- `input.tool_input.command` — Claude Code tool_input

**Wire into OpenClaw settings** as a `PreToolUse` hook on shell/bash tool calls. Point the hook command at the absolute path of `openclaw/hooks/adapter.js`.

**Modes:**

- Warn mode (default): warns to stderr, exits 0 (tool call proceeds). Set no env var.
- Block mode: `export LILARA_ENFORCE=1` — exits 2 on high/critical risk (tool call aborted).

**Fixtures:** `tests/fixtures/openclaw/` — 19 fixtures covering dangerous commands (rm -rf, force-push, curl|sh, DROP TABLE, npx -y, git reset --hard), enforce mode (dd, force-push, hard-reset, npx -y, rm --no-preserve-root, rm -rf), safe pass-through (git log, git push, ls, npm install), and borderline sudo.

## PostToolUse Parity

Current wiring includes both PreToolUse and PostToolUse. `openclaw/hooks/adapter.js` gates shell commands as PreToolUse; `openclaw/hooks/post-adapter.js` was added by Wave 1 A3 (merged in `3787b09`) and scans output for secrets and records external reads for the taint/provenance system.

OpenClaw is an OpenCode fork and shares the same hook event model. PostToolUse wiring follows the same pattern as `opencode/hooks/post-adapter.js`. Verify the actual hook configuration path in your OpenClaw installation before wiring the PostToolUse event. See `references/owasp-agentic-coverage.md` (ASI05) for current coverage status.

## Target Paths

Recommended project-local target paths:

- `tools/horus/openclaw/prompts/`
- `tools/horus/openclaw/WIRING_PLAN.md`
- `tools/horus/openclaw/OPENCLAW_POLICY_MAP.md`
- `tools/horus/openclaw/OPENCLAW_APPLY_CHECKLIST.md`
- `tools/horus/openclaw/examples/`

Potential future integration targets, only after explicit review:

- workspace prompt references in project instructions;
- per-project OpenClaw helper docs;
- optional task-specific prompt routing notes.

## Wiring Model

Use Agent Runtime Guard as an external policy and prompt source.

OpenClaw should consume:

- planner prompt;
- reviewer prompt;
- security prompt;
- future capability manifests and per-tool apply notes.

Prefer project-local references and adapter glue over direct core patching.
Do not change global OpenClaw defaults automatically in this step.

## Approval Mapping

### Auto-allowed

- reading local files;
- writing new local documentation;
- adding local prompt files;
- adding project-local policy notes;
- using trusted external agents only after payload review.

### Approval-required

- deleting or overwriting existing important workspace files;
- editing global OpenClaw config;
- enabling external modules with unclear data flow;
- routing personal or confidential data externally.

## Rollback Strategy

If integration causes instability:

1. remove the workspace prompt references from project instructions;
2. delete the local `tools/horus/openclaw/` directory;
3. revert any manual changes made to `.openclaw/settings.json` if applicable.

## Definition Of Done

This first wiring step is complete when:

- OpenClaw-specific wiring docs exist;
- prompt roles are mapped to policy;
- apply instructions are explicit;
- no risky overwrite or global mutation has happened.
