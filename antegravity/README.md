# antegravity Harness — VERIFIED

**VERIFIED — 2026-05-24.** Hook protocol traced end-to-end against `google-gemini/gemini-cli` (Apache-2.0). BeforeTool / AfterTool payload shapes confirmed via `packages/core/src/hooks/types.ts` (BeforeToolInput / AfterToolInput interfaces). Decision protocol confirmed via `packages/core/src/hooks/hookRunner.ts` (exit 2 = deny). Event-name / tool-name mapping confirmed via `packages/cli/src/commands/hooks/migrate.ts`.

> **Important:** Antegravity uses Gemini CLI event names, not Claude Code names. Wire as `BeforeTool` / `AfterTool` (not `PreToolUse` / `PostToolUse`) and match `run_shell_command` (not `Bash`). Run `agy hooks migrate` to auto-convert a Claude Code config. See [WIRING_PLAN.md](WIRING_PLAN.md) for full wiring details.

## What This Is

`hooks/adapter.js` delegates to `claude/hooks/hook-utils.js → createAdapter()`, which calls `runtime/pretool-gate.js` — the same single enforcement spine used by the Claude Code, OpenCode, and OpenClaw adapters.

`hooks/post-adapter.js` delegates to `runtime/post-adapter-factory.js → createPostAdapter()` — the same secret-scan + taint-record path used by all six harnesses. It reads `tool_response` from the AfterTool payload (verified field in AfterToolInput).

## Protocol Summary

| Property | Value |
|---|---|
| Upstream source | `google-gemini/gemini-cli` (Apache-2.0) |
| Event name: pre-tool | `BeforeTool` |
| Event name: post-tool | `AfterTool` |
| Shell tool name | `run_shell_command` |
| Payload encoding | snake_case JSON on stdin |
| cwd field | `cwd` (string in HookInput base) |
| command field | `tool_input.command` |
| Post-tool output field | `tool_response` |
| Block decision | exit code 2 (or JSON `{ "decision": "deny" }` on stdout) |
| Config file | `~/.gemini/settings.json` or `<project>/.gemini/settings.json` |
| Default timeout | 60 000 ms |

## What Is Verified

- PreToolUse / PostToolUse blocking + observation wired via BeforeTool / AfterTool
- Payload field names and nesting (snake_case, `tool_input.command`, `cwd`, `tool_response`)
- Decision protocol: exit 2 = deny; exit 0 = allow; JSON stdout HookOutput also parsed
- Event-name translation from Claude Code names (see `migrate.ts` mapping)

## What Is NOT Yet Verified

- **Live end-to-end `agy` v1.0.1 fire with corrected event names.** Protocol is verified against the upstream source. A live hook fire in the actual `agy` binary has not yet been confirmed. See the capture recipe in `WIRING_PLAN.md`.
- **MCP tool-handler coverage.** `BeforeToolInput` carries an optional `mcp_context` field, indicating MCP invocations may reach the hook surface, but per-handler dispatch coverage is not enumerated. Manifest carries `mcpInterception: "unverified"`.
- **Per-tool output-channel observability** beyond `run_shell_command` — the AfterTool payload schema for file-write / commit / PR tools has not been enumerated in the source beyond the base AfterToolInput.
- **Skills.** Gemini CLI has no Skills concept; `skillInterception: "none"`.

See `COMPATIBILITY_NOTES.md` for the full known/unknown table.

## CI

`scripts/check-antegravity-adapter.sh` — 16 checks covering all 6 fallback-chain shapes plus the verified canonical BeforeToolInput / AfterToolInput payload shapes.

## How to Wire

See [WIRING_PLAN.md](WIRING_PLAN.md) for the complete wiring guide with verified settings.json examples, the migration trap, and the live re-check recipe.
