# Codex Wiring Plan

## Status

**VERIFIED — 2026-05-24.** Hook protocol traced end-to-end against openai/codex (codex-rs). PreToolUse / PostToolUse stdin payload shapes confirmed via `codex-rs/hooks/src/events/pre_tool_use.rs` (PreToolUseRequest struct) and `codex-rs/hooks/src/events/post_tool_use.rs` (PostToolUseRequest struct). Snake-case serialisation confirmed via `codex-rs/hooks/src/types.rs:38` (`#[serde(rename_all = "snake_case")]` on HookPayload). Exit-code decision protocol confirmed via the authoritative public docs at `developers.openai.com/codex/hooks`.

## What Codex is

Codex is OpenAI's agentic CLI tool (codex-rs, the Rust implementation). It exposes a hook system for intercepting tool calls before and after execution. The hook subprocess receives a JSON payload on stdin and uses exit code 2 to block a tool call (Codex surfaces the stderr reason text to the model).

## Hook event model

Codex emits two hook events:

| Event | When | Can block? |
|-------|------|------------|
| `PreToolUse` | Before each tool call | Yes — exit code 2; stderr reason shown to model |
| `PostToolUse` | After successful tool call | No (observation only) |

Hook configuration keys tools by name. The PreToolUse hook fires before Codex executes the tool; exit code 2 causes Codex to abort the tool call and relay the hook's stderr to the model.

## Stdin payload shapes (verified)

**PreToolUse** (`codex-rs/hooks/src/events/pre_tool_use.rs` — PreToolUseRequest struct):

```json
{
  "session_id": "<session id>",
  "turn_id": "<turn id>",
  "subagent": false,
  "cwd": "/absolute/path/to/project",
  "transcript_path": null,
  "model": "o4-mini",
  "permission_mode": "default",
  "tool_name": "Bash",
  "matcher_aliases": [],
  "tool_use_id": "<tool use id>",
  "tool_input": { "command": "..." }
}
```

All field names are snake_case (`codex-rs/hooks/src/types.rs:38`). `cwd` is an absolute path string typed as `AbsolutePathBuf` (`codex-rs/hooks/src/types.rs:41`). For Bash and apply_patch tools, `tool_input` contains a `command` field.

**PostToolUse** (`codex-rs/hooks/src/events/post_tool_use.rs` — PostToolUseRequest struct):

```json
{
  "session_id": "<session id>",
  "turn_id": "<turn id>",
  "tool_name": "Bash",
  "tool_use_id": "<tool use id>",
  "tool_input": { "command": "..." },
  "tool_response": "<stdout/stderr from the tool>"
}
```

The verified output field is `tool_response`. The Lilara shared `createPostAdapter()` factory (`runtime/post-adapter-factory.js`) leads with `tool_response` and falls back to `output`/`tool_output`/`content` for cross-harness compatibility.

## Decision protocol

Codex uses **exit-code** semantics (unlike ClawCode, which ignores exit codes and reads stdout JSON):

- Exit code `0` — allow: tool call proceeds.
- Exit code `2` — block: Codex aborts the tool call and shows the hook's stderr to the model.
- Any other non-zero — error: Codex treats as an unexpected hook failure.

`stderr` carries the human-readable block reason that Codex surfaces to the model. `stdout` is passed through unchanged (Codex does not parse it for decisions).

The Lilara adapter (`codex/hooks/adapter.js`) uses the default `harnessOutput: "echo"` path — no stdout JSON is emitted on allow or block. This is in contrast with the ClawCode adapter (`clawcode/hooks/adapter.js`), which uses `harnessOutput: "permission-json"` because ClawCode ignores exit codes entirely and reads stdout JSON instead.

## Adapter wiring

In your Codex project, create `.codex/hooks.json`:

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "command": "/absolute/path/to/lilara/codex/hooks/adapter.js",
      "timeout": 30
    }
  ]
}
```

Alternatively, use `~/.codex/hooks.json` for user-level wiring (applies to all projects). Config locations in priority order: `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`, `~/.codex/hooks.json`, `~/.codex/config.toml` (per `developers.openai.com/codex/hooks`).

For PostToolUse parity (secret-scan + taint recording on tool output), add:

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "command": "/absolute/path/to/lilara/codex/hooks/adapter.js",
      "timeout": 30
    },
    {
      "event": "PostToolUse",
      "command": "/absolute/path/to/lilara/codex/hooks/post-adapter.js",
      "timeout": 30
    }
  ]
}
```

## Modes

- **Warn mode** (default): exits 0 with stderr warning. Tool call proceeds.
- **Enforce mode** (`LILARA_ENFORCE=1`): on block decisions, exits 2; Codex aborts the tool call and shows the stderr reason to the model.
- **Kill switch** (`LILARA_KILL_SWITCH=1`): exits 2 for every command regardless of risk score.

## Hook timeout

Codex enforces a default 600s timeout per hook subprocess (`developers.openai.com/codex/hooks`), configurable per-hook via the `timeout` field. The Lilara adapter completes in <20ms on warm cache, well under the limit.

## What is NOT yet verified

- **MCP tool-handler coverage** — Codex's hook dispatch is per tool-handler. Not all tool handlers emit PreToolUse events; openai/codex#20204 documents inconsistent coverage, and openai/codex#16732 (fixed in PR #18391) showed ApplyPatch was missing from the hook dispatch path. MCP-delegated tool calls may not reach the hook surface.
- **Skill interception** — subject to the same handler-coverage gaps as MCP.
- **Per-tool output-channel observability** beyond Bash — the PostToolUse payload schema for file-write / commit / PR / browser tools has not been enumerated against the codex-rs source beyond the Bash case.

These are manifest-level caveats, not blockers for production use. The `mcpInterception: "partial"` and `skillInterception: "partial"` claims in `codex/manifest.json` reflect this state accurately.

## How to capture a new payload yourself

```bash
# 1. Write a capture hook
cat > "$HOME/capture-codex.js" <<'EOFI'
#!/usr/bin/env node
"use strict";
const fs = require("fs");
let d = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  fs.appendFileSync("/tmp/codex-payload.json", d + "\n");
  process.stdout.write(d);
});
EOFI
chmod +x "$HOME/capture-codex.js"

# 2. Wire it as a PreToolUse hook in your Codex project
mkdir -p .codex
cat > .codex/hooks.json <<EOFJ
{
  "hooks": [
    {
      "event": "PreToolUse",
      "command": "$HOME/capture-codex.js",
      "timeout": 30
    }
  ]
}
EOFJ

# 3. Run a Bash-tool prompt in Codex, then inspect the payload
cat /tmp/codex-payload.json
```

## Lilara configuration referenced

- Adapter: `codex/hooks/adapter.js` — uses `createAdapter()` with default `harnessOutput: "echo"`.
- Post-adapter: `codex/hooks/post-adapter.js` — uses `createPostAdapter()` with `envelopeReporting: false`.
- Manifest: `codex/manifest.json` — `verifiedAt: "2026-05-24"`.
- Check gate: `scripts/check-codex-adapter.sh` — exercises fallback coverage (checks 1–12) and verified canonical payload shapes (checks 13–16).
