# Codex — PostToolUse Event Shape

**Status: VERIFIED — 2026-05-24.** Payload shape confirmed against `codex-rs/hooks/src/events/post_tool_use.rs` (PostToolUseRequest struct).

## Verified PostToolUse Shape

Source: `codex-rs/hooks/src/events/post_tool_use.rs` — PostToolUseRequest struct. All field names are snake_case per `codex-rs/hooks/src/types.rs:38`.

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

The output field is `tool_response`. The Lilara shared `createPostAdapter()` factory (`runtime/post-adapter-factory.js`) leads with `tool_response` and falls back to `output`/`tool_output`/`content` for cross-harness compatibility.

## Current Adapter Coverage

| Event | Coverage |
|---|---|
| PreToolUse (shell gate) | VERIFIED — `codex/hooks/adapter.js` |
| PostToolUse (output scan) | VERIFIED — `codex/hooks/post-adapter.js` (secret-scan + taint via `createPostAdapter()`) |

## Known Coverage Gaps

The PostToolUse `tool_response` field name is confirmed for the Bash tool. For file-write, commit, PR, and browser tools, the per-tool PostToolUse payload schema has not been enumerated from codex-rs source. If Codex uses different field names for non-Bash tool output, the fallback chain (`output`/`tool_output`/`content`) will cover common shapes defensively.

## Appendix: How to Capture a Payload for Re-Verification

```bash
node -e "
const fs = require('fs');
let d = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  fs.appendFileSync('/tmp/codex-posttool.json', d + '\n');
  process.stdout.write(d);
});
"
```

Wire as a PostToolUse hook, run a Codex session, and inspect `/tmp/codex-posttool.json` to confirm the field names for any tool type of interest.
