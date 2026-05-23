# Claw Code Wiring Plan

## Status

**VERIFIED — 2026-05-23.** Hook protocol traced end-to-end against ClawCode v0.1.3 source (`deepelementlab/clawcode`). PreToolUse / PostToolUse stdin payload shapes confirmed via `clawcode/llm/agent.py:1313-1438`. Permission-decision protocol confirmed via `clawcode/plugin/hooks.py:38-51` (decision extraction) and `clawcode/plugin/hooks.py:252-280` (subprocess invocation). Adapter `clawcode/hooks/adapter.js` exercised end-to-end against the canonical payload and observed to emit ClawCode-compatible stdout JSON decisions.

## What ClawCode is

ClawCode is a Claude Code-inspired Python+Rust coding agent CLI that supports 200+ LLM providers via OpenAI-compatible APIs. Its plugin/hook system is, per its own source, **"a minimal Claude Code compatible hook execution engine"** (`clawcode/plugin/hooks.py:69`).

## Hook event model

ClawCode emits four hook events that accept tool-name matchers:

| Event | When | Can block? |
|-------|------|------------|
| `PreToolUse` | Before each tool call | Yes — emit `permissionDecision: "deny"` |
| `PostToolUse` | After successful tool call | No (observation only) |
| `PostToolUseFailure` | After failed tool call | No (observation only) |
| `PermissionRequest` | Permission gate | Yes |

Matcher is a regex applied to `tool_name`. Empty matcher or `"*"` matches all tools.

## Stdin payload shapes (verified)

**PreToolUse** (`clawcode/llm/agent.py:1318-1323`):

```json
{
  "session_id": "<session id>",
  "tool_call_id": "<tool call id>",
  "tool_name": "Bash",
  "tool_input": { "command": "...", "description": "..." }
}
```

**PostToolUse / PostToolUseFailure** (`clawcode/llm/agent.py:1428-1434`):

```json
{
  "session_id": "<session id>",
  "tool_call_id": "<tool call id>",
  "tool_name": "Bash",
  "tool_input": { "command": "...", "description": "..." },
  "tool_output": "<stdout/stderr from the tool>"
}
```

Note: ClawCode does **NOT** include `cwd` in the payload — the working directory is passed to the hook subprocess via `cwd=working_directory` (`clawcode/plugin/hooks.py:259-260`) but not as a JSON field. The ARG adapter falls back to context-discovery for branch / project information.

## Decision protocol (critical)

ClawCode parses the hook subprocess **STDOUT as JSON** for the permission decision. The exit code is **IGNORED** (`clawcode/plugin/hooks.py:252-280`). To block a tool call, emit:

```json
{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"<reason text>"}}
```

The wrapping `hookSpecificOutput` key is optional (the engine extracts both `out.hookSpecificOutput` and the bare object — `hooks.py:43`). To allow, emit any JSON without a `permissionDecision` field; `{}` is the canonical empty response.

ARG's `clawcode/hooks/adapter.js` uses `harnessOutput: "permission-json"` to emit this format. It also still exits 2 on block for cross-harness consistency (so the same adapter runs under harnesses that DO read exit codes).

## Adapter wiring

In your ClawCode project, create `.claude/settings.local.json` (ClawCode reads Claude-Code-compatible settings):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/agent-runtime-guard/clawcode/hooks/adapter.js"
          }
        ]
      }
    ]
  }
}
```

**Matcher coverage:** the example matches only the `Bash` tool. To gate shell-class tools beyond Bash (file edits, write tools, MCP shell wrappers), broaden the matcher regex to cover them — e.g. `"Bash|BashOutput|Write|Edit|MultiEdit"` for full ARG floor coverage on Claude-Code-style tool surfaces.

For PostToolUse parity (secret-scan + taint recording on tool output), add:

```json
{
  "PostToolUse": [
    {
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "/absolute/path/to/agent-runtime-guard/clawcode/hooks/post-adapter.js"
        }
      ]
    }
  ]
}
```

(Empty matcher fires for every tool — desired for output secret-scanning.)

## Modes

- **Warn mode** (default): exits 0 with stderr warning; stdout `{}`. Tool call proceeds.
- **Enforce mode** (`HORUS_ENFORCE=1`): on block decisions, stdout carries the deny JSON; ClawCode aborts the tool call with the supplied reason. Exit 2 is also emitted for cross-harness consistency.
- **Kill switch** (`HORUS_KILL_SWITCH=1`): stdout deny + exit 2 for every command.

## Hook timeout

ClawCode enforces a 15s timeout per hook (`clawcode/plugin/hooks.py:176`). The ARG adapter completes in <20ms on warm cache, well under the limit.

## What is NOT yet verified

- **MCP tool interception** — ClawCode's hook matcher will fire for any `tool_name`, so MCP tools route through the same surface IF the operator's matcher regex covers them. No end-to-end MCP-tool fire has been traced against ARG's adapter; the manifest carries `mcpInterception: unverified` until that lands.
- **Skill interception** — same caveat; depends on operator's matcher regex.
- **Per-tool output-channel observability** beyond Bash — the PostToolUse payload schema for file-write / commit / PR / browser tools has not been enumerated against ClawCode source.

These are not blockers for production use. They are mark-down items on the manifest that a future PR can promote as ClawCode usage in the wild surfaces more tool-name diversity.

## How to capture a new payload yourself

```bash
# 1. Write a capture hook
cat > "$HOME/capture-hook.sh" <<'EOFI'
#!/usr/bin/env bash
cat > "$HOME/clawcode-payload.json"
EOFI
chmod +x "$HOME/capture-hook.sh"

# 2. Point ClawCode at it (in your clawcode workspace)
mkdir -p .claude
cat > .claude/settings.local.json <<EOFJ
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "$HOME/capture-hook.sh" }] }
    ]
  }
}
EOFJ

# 3. Run a Bash-tool prompt in clawcode, then read the file
cat "$HOME/clawcode-payload.json"
```

## ARG configuration referenced

- Adapter: `clawcode/hooks/adapter.js` — uses `createAdapter({ harnessOutput: "permission-json" })`.
- Post-adapter: `clawcode/hooks/post-adapter.js` — uses `createPostAdapter()` with `envelopeReporting: false`.
- Manifest: `clawcode/manifest.json` — `verifiedAt: "2026-05-23"`.
- Check gate: `scripts/check-clawcode-adapter.sh` — exercises both the legacy exit-code path AND the verified stdout-JSON decision protocol.
