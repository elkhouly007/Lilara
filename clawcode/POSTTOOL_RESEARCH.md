# Claw Code — PostToolUse Event Shape

> **Status: VERIFIED — 2026-05-23.** Traced against ClawCode v0.1.3 source.
> See [`WIRING_PLAN.md`](./WIRING_PLAN.md) for operator-facing wiring.

## Verified PostToolUse stdin payload

ClawCode fires PostToolUse (or `PostToolUseFailure` on tool error) via `_hook_engine.fire(...)` in `clawcode/llm/agent.py:1418-1438`. The `context` dict passed to the subprocess as stdin is:

```json
{
  "session_id": "<session id>",
  "tool_call_id": "<tool call id>",
  "tool_name": "Bash",
  "tool_input": { "command": "...", "description": "..." },
  "tool_output": "<stdout/stderr text from the tool execution>"
}
```

For `PostToolUseFailure`, the payload shape is identical — only the event name differs.

## Verified PreToolUse stdin payload

`clawcode/llm/agent.py:1318-1323`:

```json
{
  "session_id": "<session id>",
  "tool_call_id": "<tool call id>",
  "tool_name": "Bash",
  "tool_input": { "command": "...", "description": "..." }
}
```

(No `tool_output` — that field appears only on PostToolUse.)

## Output protocol — IMPORTANT

ClawCode's `_run_command_hook` (`clawcode/plugin/hooks.py:252-280`) reads the subprocess's STDOUT and tries to parse it as JSON. If the JSON carries `hookSpecificOutput.permissionDecision` (or `permissionDecision` at the top level — `hooks.py:43`), ClawCode honours the decision. The subprocess's **exit code is IGNORED**.

This applies to PreToolUse and PermissionRequest (the events that can block). PostToolUse output is observational; ClawCode does not act on its return.

## Adapter implications

- `clawcode/hooks/adapter.js` (PreToolUse) uses `harnessOutput: "permission-json"` so blocked tool calls actually fail in ClawCode. Without this, the previous adapter exited 2 but ClawCode allowed the command anyway.
- `clawcode/hooks/post-adapter.js` (PostToolUse) uses the shared `createPostAdapter` factory and the default echo-stdin output. It scans `tool_output` via `runtime/secret-scan.js` and records external-source content into the provenance window via `runtime/taint.js`.

## What ARG extracts from PostToolUse

`runtime/post-adapter-factory.js` reads:

- `input.tool_name` -> matched against `EXTERNAL_TOOLS` (WebFetch, web_fetch, mcp, curl, wget, browser_action, Browser, fetch) for taint recording.
- `input.tool_output` (fallback: `input.output`, `input.content`) -> scanned for the 23-pattern secret set via `runtime/secret-scan.scanSecrets()`. Warns to stderr on hit.

ClawCode's `tool_output` field maps directly to this -- no fallback needed for ClawCode. The fallback chain stays in place for cross-harness uniformity.

## What is NOT verified

- **MCP tool PostToolUse shape** -- when an MCP tool fires PostToolUse, the `tool_input` and `tool_output` schema for that tool is MCP-server-dependent. ARG's secret-scan operates on `tool_output` as plain text so this should be robust, but per-MCP-server verification has not been done.
- **File-write tool output** -- for tools that return file contents (Read-equivalent) or write confirmations (Write/Edit-equivalent), the `tool_output` shape varies. ARG falls through to `collectText(input)` which recursively gathers all string values -- covers most cases but not formally enumerated against ClawCode.

These are not blockers for production use. They are mark-down items for future PRs.
