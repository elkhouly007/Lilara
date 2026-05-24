# OpenCode Wiring Plan

## Goal

Wire Agent Runtime Guard into OpenCode as a project-local safe-power layer without relying on raw upstream config or fragile core patching.

## Scope Of This Wiring

This wiring covers:

- runtime hook adapter (`opencode/hooks/adapter.js`);
- target file map;
- OpenCode config usage guidance;
- policy mapping for OpenCode roles and tools;
- project-local examples;
- compatibility guidance for future OpenCode changes.

It does not overwrite existing OpenCode user config or global files.

## Runtime Hook Adapter

`opencode/hooks/adapter.js` is a PreToolUse hook for OpenCode (Claude Code fork) that routes shell commands through `runtime.decide()`.

**Input shape (Claude Code / OpenCode native):**

```json
{ "tool_name": "Bash", "args": { "command": "...", "cwd": "..." } }
```

Also accepted: `tool_input.command`, `input.command`, direct `command` field.

**Wire into OpenCode config** as a `PreToolUse` hook on shell/bash tool calls. Point the hook command at the absolute path of `opencode/hooks/adapter.js`.

**Modes:**

- Warn mode (default): warns to stderr, exits 0 (tool call proceeds). Set no env var.
- Block mode: `export LILARA_ENFORCE=1` — exits 2 on high/critical risk (tool call aborted).

**Fixtures:** `tests/fixtures/opencode/` — 12 fixtures covering dangerous commands (rm -rf, force-push, curl\|sh, DROP TABLE, npx -y, git reset --hard), enforce mode, safe pass-through, and borderline sudo.

## PostToolUse Parity

Current wiring includes both PreToolUse and PostToolUse. `opencode/hooks/adapter.js` gates shell commands as PreToolUse; `opencode/hooks/post-adapter.js` (equivalent to `claude/hooks/output-sanitizer.js`) scans tool output for the 23 secret patterns via `runtime/secret-scan.js` and records external-source content into the provenance window via `runtime/taint.js` so the F10 taint floor can detect injected commands.

OpenCode is a Claude Code fork and shares the same hook event model. Wire `opencode/hooks/post-adapter.js` as a `PostToolUse` hook in your OpenCode config — point the hook command at the absolute path of the file, mirroring how the PreToolUse `adapter.js` is wired. Both hooks read from stdin, echo stdin to stdout unchanged, and write any warnings to stderr; PostToolUse cannot block (warns only) per the harness contract.

The `scripts/check-post-adapter-parity.sh` CI gate enforces that the OpenCode post-adapter requires `secret-scan` and `taint` and calls `scanSecrets()` + `recordExternalRead()` (in this implementation, via the shared `runtime/post-adapter-factory.js`). See `references/owasp-agentic-coverage.md` (ASI05) for the current coverage status — OpenCode is COVERED.

## Target Paths

Recommended project-local targets:

- `tools/horus/opencode/opencode.safe.jsonc`
- `tools/horus/opencode/prompts/`
- `tools/horus/opencode/WIRING_PLAN.md`
- `tools/horus/opencode/OPENCODE_POLICY_MAP.md`
- `tools/horus/opencode/OPENCODE_APPLY_CHECKLIST.md`
- `tools/horus/opencode/COMPATIBILITY_STRATEGY.md`
- `tools/horus/opencode/examples/`

Potential future integration targets, only after explicit review:

- per-project OpenCode config references;
- project-local role presets;
- optional module enablement snippets.

## Wiring Model

Use Agent Runtime Guard as an external policy, prompt, and config-template source.

OpenCode should consume:

- `opencode.safe.jsonc` as a reviewed starting point;
- planner, reviewer, security, and build-fix prompts;
- future module snippets only after policy classification.

Prefer project-local references and reviewed config copies over global mutation.

## Approval Mapping

### Auto-allowed

- local project config templates;
- local prompt files;
- local policy references;
- trusted external agents after payload review and non-sensitive confirmation.

### Approval-required

- overwriting existing important OpenCode config files;
- enabling external-write or system-write plugins;
- enabling external data flow with personal or confidential data;
- global user-level OpenCode config mutation.

## Rollback Strategy

If integration causes instability:

1. delete the local `tools/horus/opencode/` directory;
2. revert any manual changes to your project-local `.opencode.json` (if you were using the safe template).

## Definition Of Done

This first wiring step is complete when:

- OpenCode-specific wiring docs exist;
- project-local usage examples exist;
- config and role policy are mapped clearly;
- no global overwrite or risky mutation has happened.
