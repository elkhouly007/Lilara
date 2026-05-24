# Antegravity Wiring Plan

## Status

**VERIFIED — 2026-05-24.** Hook protocol traced end-to-end against `google-gemini/gemini-cli` (Apache-2.0). BeforeTool / AfterTool stdin payload shapes confirmed via `packages/core/src/hooks/types.ts` (BeforeToolInput / AfterToolInput). Decision protocol confirmed via `packages/core/src/hooks/hookRunner.ts`. Event-name / tool-name translation mapping confirmed via `packages/cli/src/commands/hooks/migrate.ts`.

> **Live end-to-end caveat:** The protocol is verified against the upstream source that Antegravity v1.0.1 embeds. A live hook fire in `agy` with corrected event names (`BeforeTool` / `AfterTool` + `run_shell_command` matcher) has not yet been confirmed end-to-end. See the capture recipe below.

## What Antegravity Is

Antegravity is Google's agentic coding CLI (binary: `agy`, website: `antigravity.google`). It is built on the open-source **Gemini CLI** framework (`github.com/google-gemini/gemini-cli`, Apache-2.0). The internal build string `google3/third_party/gemini_coder/framework/core/core.runHooks` maps to the public `HookRunner` class in `packages/core/src/hooks/hookRunner.ts`.

## The Migration Trap

> **Critical:** Antegravity uses Gemini CLI event names — NOT Claude Code event names. If you copy a Claude Code hook config, the hooks will silently not fire.

| Claude Code | Gemini CLI (Antegravity) |
|---|---|
| `PreToolUse` | **`BeforeTool`** |
| `PostToolUse` | **`AfterTool`** |
| `UserPromptSubmit` | `BeforeAgent` |
| `Stop` / `SubAgentStop` | `AfterAgent` |
| `PreCompact` | `PreCompress` |
| `Bash` (tool matcher) | **`run_shell_command`** |
| `Edit` (tool matcher) | **`replace`** |
| `$CLAUDE_PROJECT_DIR` (env var) | **`$GEMINI_PROJECT_DIR`** |

Source: `packages/cli/src/commands/hooks/migrate.ts`. Running `agy hooks migrate` converts `.claude/settings.local.json` → `.gemini/settings.json` automatically.

## Hook Event Model

| Event | When | Can block? |
|-------|------|------------|
| `BeforeTool` | Before each tool call | Yes — exit code 2; reason surfaced to model |
| `AfterTool` | After successful tool call | No (observation only) |
| `BeforeAgent`, `AfterAgent`, etc. | Agent lifecycle | Not used by Lilara |

## Stdin Payload Shapes (Verified)

All fields are snake_case. Source: `packages/core/src/hooks/types.ts`.

**BeforeTool** (BeforeToolInput extends HookInput):

```json
{
  "session_id": "<session id>",
  "transcript_path": "/path/to/transcript.json",
  "cwd": "/absolute/path/to/project",
  "hook_event_name": "BeforeTool",
  "timestamp": "2026-05-24T00:00:00.000Z",
  "tool_name": "run_shell_command",
  "tool_input": { "command": "..." },
  "mcp_context": null,
  "original_request_name": null
}
```

**AfterTool** (AfterToolInput extends HookInput):

```json
{
  "session_id": "<session id>",
  "transcript_path": "/path/to/transcript.json",
  "cwd": "/absolute/path/to/project",
  "hook_event_name": "AfterTool",
  "timestamp": "2026-05-24T00:00:00.000Z",
  "tool_name": "run_shell_command",
  "tool_input": { "command": "..." },
  "tool_response": "<stdout/stderr from the tool>"
}
```

The Lilara shared `createPostAdapter()` factory (`runtime/post-adapter-factory.js`) already leads with `tool_response` for output extraction — no adapter-side change needed.

## Decision Protocol (Verified)

Antegravity parses the hook subprocess output as follows (hookRunner.ts lines 371–388):

1. **JSON stdout** parsed first into `HookOutput { decision?, reason?, hookSpecificOutput?, continue?, systemMessage?, suppressOutput? }`. `HookDecision` values: `'ask' | 'block' | 'deny' | 'approve' | 'allow' | undefined`.
2. **Plain-text + exit-code fallback** when stdout is not valid JSON:
   - Exit `0` → allow (tool call proceeds)
   - Exit `1` → allow with warning (non-blocking)
   - **Exit `2+` → deny** (Antegravity aborts the tool call, surfaces stderr reason to model)

Lilara's default `harnessOutput: "echo"` path (exit 2 on block) is fully compatible. No `harnessOutput: "permission-json"` opt-in is needed (contrast with ClawCode, which ignores exit codes and reads stdout JSON).

Default timeout: **60 000 ms** (`DEFAULT_HOOK_TIMEOUT` in hookRunner.ts).

Env vars expanded in hook command: `$GEMINI_PROJECT_DIR`, `$GEMINI_CWD`, `$GEMINI_PLANS_DIR`, `$GEMINI_SESSION_ID`, `$CLAUDE_PROJECT_DIR` (compat alias).

## Adapter Wiring

Config file locations (either user-level or project-level):
- `~/.gemini/settings.json` — applies to all Antegravity sessions
- `<project>/.gemini/settings.json` — applies to this project only

Antegravity may also read `.antigravity/` config — check `agy --help` or `agy config` for the authoritative path on your installed version.

**Preferred: run `agy hooks migrate`** if you already have a `.claude/settings.local.json`. The command auto-converts Claude Code hook names and tool names.

**Or wire manually** in `.gemini/settings.json`:

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "run_shell_command",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/lilara/antegravity/hooks/adapter.js",
            "timeout": 60000
          }
        ]
      }
    ]
  }
}
```

To gate write-class tools beyond shell (file replace, multi-edit), broaden the matcher regex: `"run_shell_command|replace|create_file|move_file"`.

For AfterTool parity (secret-scan + taint recording on tool output), add:

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "run_shell_command",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/lilara/antegravity/hooks/adapter.js",
            "timeout": 60000
          }
        ]
      }
    ],
    "AfterTool": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/lilara/antegravity/hooks/post-adapter.js",
            "timeout": 60000
          }
        ]
      }
    ]
  }
}
```

(Empty matcher fires for every tool — desired for output secret-scanning.)

## Modes

- **Warn mode** (default): exits 0 with stderr warning. Tool call proceeds.
- **Enforce mode** (`LILARA_ENFORCE=1`): on block decisions, exits 2; Antegravity aborts the tool call and shows the stderr reason to the model.
- **Kill switch** (`LILARA_KILL_SWITCH=1`): exits 2 for every command regardless of risk score.

## What Is NOT Yet Verified

- **Live end-to-end `agy` v1.0.1 fire.** Use the capture recipe below to confirm and report.
- **MCP tool-handler coverage.** `BeforeToolInput.mcp_context` is present in the type, suggesting MCP invocations reach the hook, but per-handler dispatch has not been traced.
- **Per-tool output-channel observability** beyond `run_shell_command` — AfterTool payload schema for file-write / commit / PR tools not enumerated.
- **`.antigravity/` config path.** Binary strings show this directory name; the exact precedence between `~/.gemini/`, `<project>/.gemini/`, and `.antigravity/` has not been traced.

## How to Capture a Live Payload

```bash
# 1. Write a capture hook
cat > "$HOME/capture-antegravity.js" <<'EOFI'
#!/usr/bin/env node
"use strict";
const fs = require("fs");
let d = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  fs.appendFileSync("/tmp/antegravity-payload.json", d + "\n");
  process.stdout.write(d);
});
EOFI
chmod +x "$HOME/capture-antegravity.js"

# 2. Wire it as a BeforeTool hook in your project
mkdir -p .gemini
cat > .gemini/settings.json <<EOFJ
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "run_shell_command",
        "hooks": [{ "type": "command", "command": "$HOME/capture-antegravity.js" }]
      }
    ]
  }
}
EOFJ

# 3. Run a shell-tool prompt in Antegravity, then inspect the payload
cat /tmp/antegravity-payload.json
```

If the payload shape matches the verified `BeforeToolInput` above, the integration is confirmed end-to-end. Report the result so `manifest.json` can note the live-fire confirmation.

## Lilara Configuration Referenced

- Adapter: `antegravity/hooks/adapter.js` — uses `createAdapter()` with default `harnessOutput: "echo"`.
- Post-adapter: `antegravity/hooks/post-adapter.js` — uses `createPostAdapter()` with `envelopeReporting: false`.
- Manifest: `antegravity/manifest.json` — `verifiedAt: "2026-05-24"`.
- Check gate: `scripts/check-antegravity-adapter.sh` — 16 checks covering fallback shapes (1–12) and verified canonical payload shapes (13–16).
