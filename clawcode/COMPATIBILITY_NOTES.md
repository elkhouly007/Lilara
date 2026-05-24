# Claw Code Compatibility Notes — Verified Integration

**Status: VERIFIED — 2026-05-23.** Hook protocol traced end-to-end against ClawCode v0.1.3 (`deepelementlab/clawcode`). See [`WIRING_PLAN.md`](./WIRING_PLAN.md) for the wiring guide.

## What is now known

| Question | Answer | Source |
|----------|--------|--------|
| Hook event model | Claude Code-compatible: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest` | `clawcode/plugin/hooks.py:69, 86-93` |
| Hook script invocation | `asyncio.create_subprocess_shell` with stdin = JSON `context` and stdout = decision JSON | `clawcode/plugin/hooks.py:252-280` |
| Exit-code blocking | **IGNORED.** ClawCode reads the permission decision from STDOUT JSON only | `clawcode/plugin/hooks.py:38-51, 279-280` |
| Stdin payload shape (PreToolUse) | `{ session_id, tool_call_id, tool_name, tool_input }` | `clawcode/llm/agent.py:1318-1323` |
| Stdin payload shape (PostToolUse) | adds `tool_output` | `clawcode/llm/agent.py:1428-1434` |
| Cwd in payload | **No** — passed via subprocess `cwd=working_directory` only | `clawcode/plugin/hooks.py:259-260` |
| Matcher semantics | Regex against `tool_name`. Empty / `"*"` matches all | `clawcode/plugin/hooks.py:86-114` |
| Hook timeout | 15s per hook | `clawcode/plugin/hooks.py:176` |
| Settings wiring | `.claude/settings.local.json` (ClawCode reads Claude-Code-compatible settings) | confirmed against canonical hook config in this repo |
| `LILARA_ENFORCE=1` behaviour | Adapter emits `{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"…"}}` on stdout AND exits 2. ClawCode honours the JSON decision; the exit is for cross-harness consistency | `clawcode/hooks/adapter.js` + ARG end-to-end test 2026-05-23 |

## Decisions taken

- **Trust posture default:** balanced. Same as OpenCode / OpenClaw. Operator overrides via `lilara.config.json` `trustPosture`.
- **Config file:** ClawCode sessions use the standard `lilara.config.json` per project, same as every other harness. No ClawCode-specific overrides.
- **Rate limiting:** same token-bucket as every other harness (`rateLimitKey: "clawcode-adapter"`); a busy ClawCode session can exhaust the bucket and skip the gate (fail-open with stdout `{}` for ClawCode, matching the other adapters' fail-open semantics).
- **Adapter output protocol:** `harnessOutput: "permission-json"` on the PreToolUse adapter. The PostToolUse adapter keeps the default echo-stdin protocol since ClawCode treats PostToolUse output as informational.

## What is still unverified

- **MCP tool interception** — the hook matcher will fire for any `tool_name`, so MCP coverage depends on the operator's matcher regex. No end-to-end MCP-tool fire has been traced against ARG.
- **Skill interception** — same caveat.
- **Per-tool output-channel observability beyond Bash** — file-write / commit / PR / browser tool payload schemas not enumerated against ClawCode source.

These are not blockers. They are mark-down items on the manifest that future PRs can promote as live ClawCode usage surfaces more tool-name diversity.

## Source-trace appendix

```
clawcode/plugin/hooks.py
  L41-51   _extract_permission_decision — reads `out.hookSpecificOutput` or bare object,
           pulls `permissionDecision` + `permissionDecisionReason`
  L69      docstring: "minimal Claude Code compatible hook execution engine"
  L86-114  matcher semantics (regex on tool_name; matcher_supported_events)
  L176     `asyncio.wait_for(..., timeout=15.0)` — 15s per-hook timeout
  L252-280 _run_command_hook — shell subprocess, stdin = JSON context,
           stdout parsed as JSON for decision; exit code IGNORED

clawcode/llm/agent.py
  L1313-1336 PreToolUse fire: context = { session_id, tool_call_id, tool_name, tool_input }
             checks `permissionDecision == "deny"` and aborts the tool call with the reason
  L1418-1438 PostToolUse fire: context adds `tool_output`
```

## Path to fuller verification

1. Trace an MCP tool fire end-to-end with an ARG matcher that covers the MCP tool_name. Update manifest `mcpInterception` from `unverified` to `supported`.
2. Same for Skill invocations.
3. Enumerate the PostToolUse payload shape for file-write tools (Write / Edit / MultiEdit equivalents in ClawCode's tool catalog). Update manifest `outputChannels.generatedFiles` from `observe` to `intercept` if ClawCode emits the file content in the payload.
4. Optional: add a stress harness scenario that points at a long-running ClawCode session and verifies ARG's lock floors hold under concurrent tool fires.
