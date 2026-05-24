# Antegravity Compatibility Notes

**Status: VERIFIED — 2026-05-24.** Protocol traced against `google-gemini/gemini-cli` (Apache-2.0).

## Known (Verified)

| Item | Finding | Source |
|---|---|---|
| Hook event names | `BeforeTool` / `AfterTool` (NOT `PreToolUse` / `PostToolUse`) | `packages/core/src/hooks/types.ts` — `HookEventName` enum |
| Shell tool name | `run_shell_command` (NOT `Bash`) | `packages/cli/src/commands/hooks/migrate.ts` mapping table |
| PreTool payload encoding | snake_case JSON on stdin | `packages/core/src/hooks/types.ts` — `HookInput` + `BeforeToolInput` interfaces |
| PostTool payload encoding | snake_case JSON on stdin with `tool_response` field | `packages/core/src/hooks/types.ts` — `AfterToolInput` interface |
| cwd field | `cwd` (string, absolute path, in base `HookInput`) | `packages/core/src/hooks/types.ts` — `HookInput.cwd: string` |
| command field | `tool_input.command` | `packages/core/src/hooks/types.ts` — `BeforeToolInput.tool_input: Record<string, unknown>` |
| Block decision — exit code | Exit `2+` → `{ decision: 'deny', reason: stderr }` | `packages/core/src/hooks/hookRunner.ts` — `convertPlainTextToHookOutput` |
| Block decision — JSON stdout | `{ "decision": "deny", "reason": "..." }` in stdout also accepted | `packages/core/src/hooks/hookRunner.ts` — JSON stdout parsed before exit-code fallback |
| Allow decision | Exit `0` → allow; or `{ "decision": "allow" }` on stdout | `packages/core/src/hooks/hookRunner.ts` |
| Non-blocking warning | Exit `1` → allow with warning (non-blocking) | `packages/core/src/hooks/hookRunner.ts` |
| Default timeout | 60 000 ms | `packages/core/src/hooks/hookRunner.ts` — `DEFAULT_HOOK_TIMEOUT` |
| Config file | `~/.gemini/settings.json` (user) or `<project>/.gemini/settings.json` (project) | `docs/hooks/reference.md` |
| Event name migration | `agy hooks migrate` converts Claude Code config → Gemini native config | `packages/cli/src/commands/hooks/migrate.ts` |
| Env vars in hook command | `$GEMINI_PROJECT_DIR`, `$GEMINI_CWD`, `$GEMINI_PLANS_DIR`, `$GEMINI_SESSION_ID`, `$CLAUDE_PROJECT_DIR` (compat alias) | `packages/core/src/hooks/hookRunner.ts` — `expandCommand()` |
| MCP context in payload | `BeforeToolInput.mcp_context?: McpToolContext` — field present | `packages/core/src/hooks/types.ts` |

## Unknown / Unverified

| Item | Status | Notes |
|---|---|---|
| Live `agy` v1.0.1 hook fire | Unconfirmed | Protocol verified via source. Use the capture recipe in `WIRING_PLAN.md` to confirm end-to-end. |
| MCP tool-handler coverage | Partial | `mcp_context` field present in BeforeToolInput but per-handler dispatch not traced. |
| Per-tool payload schema beyond shell | Unverified | AfterToolInput base structure confirmed; exact `tool_input` shape for non-shell tools not enumerated. |
| `.antigravity/` config path precedence | Unverified | Binary strings reference `.antigravity`; exact precedence between `~/.gemini/`, `.gemini/`, `.antigravity/` not traced. |
| Skills interception | None | Gemini CLI has no Skills concept; no skill-invocation hook event exists. |

## What Is Assumed (Now Confirmed)

The previous version of this document made no assumptions. After verification:

- `tool_input.command` is the canonical command field (not `command` / `cmd` at top level).
- `cwd` is in the base payload (not passed via subprocess `cwd` env as in ClawCode).
- Exit code 2 blocks the tool call (unlike ClawCode, which ignores exit codes entirely).

## Upstream Source Appendix

```
google-gemini/gemini-cli  (Apache-2.0)
  packages/core/src/hooks/types.ts          — HookEventName, HookInput, BeforeToolInput, AfterToolInput
  packages/core/src/hooks/hookRunner.ts     — payload write, output parsing, exit-code semantics, DEFAULT_HOOK_TIMEOUT
  packages/core/src/hooks/hookEventHandler.ts — fireBeforeToolEvent, fireAfterToolEvent
  packages/cli/src/commands/hooks/migrate.ts — Claude Code → Gemini CLI event/tool name mapping
  docs/hooks/reference.md                   — settings.json schema, config file locations
```
