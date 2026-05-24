# Antegravity — AfterTool Event Shape Research

**Status: VERIFIED — 2026-05-24.** AfterTool payload shape confirmed against `google-gemini/gemini-cli` (Apache-2.0), `packages/core/src/hooks/types.ts`.

## Verified AfterTool Shape

`AfterToolInput` extends `HookInput` with additional fields:

```json
{
  "session_id": "<session id>",
  "transcript_path": "/path/to/transcript.json",
  "cwd": "/absolute/path/to/project",
  "hook_event_name": "AfterTool",
  "timestamp": "2026-05-24T00:00:00.000Z",
  "tool_name": "run_shell_command",
  "tool_input": { "command": "<the command that ran>" },
  "tool_response": "<stdout/stderr from the tool>"
}
```

The output field is `tool_response`. The Lilara shared `createPostAdapter()` factory (`runtime/post-adapter-factory.js`) already leads with `tool_response` in its extraction fallback chain — no adapter-side change needed.

## Extraction Fallback Chain

```javascript
const outputText = String(
  input.tool_response ||   // Verified: AfterToolInput.tool_response (Antegravity/Gemini CLI)
  input.output         ||  // Claude Code
  input.tool_output    ||  // ClawCode
  input.content        ||
  input.stdout         ||
  ""
);
```

## Adapter Coverage

| Event | Coverage |
|---|---|
| BeforeTool (shell gate) | VERIFIED — `antegravity/hooks/adapter.js` |
| AfterTool (output scan) | VERIFIED — `antegravity/hooks/post-adapter.js` |

## Relation to ASI05 Coverage

AfterTool is now verified for Antegravity. The DOCUMENTED LIMITATION for this harness in `references/owasp-agentic-coverage.md` (ASI05) is removed as of 2026-05-24. See that file for the updated row.

## What Remains Unverified

- Per-tool `tool_input` payload schema beyond `run_shell_command` — only the base structure is confirmed; file-write, commit, PR tools may add extra fields.
- Whether AfterTool fires for every tool or only for tools that match the operator's event-level configuration.
