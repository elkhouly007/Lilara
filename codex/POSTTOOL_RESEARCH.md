# Codex — PostToolUse Event Shape Research

> **Status: UNVERIFIED.** All payload shapes below are inferred from PreToolUse patterns and by analogy with Claude Code. A contributor with access to a live Codex installation must verify the actual PostToolUse event format before any adapter can be wired in production.

## Background

The Codex PreToolUse adapter (`codex/hooks/adapter.js`) handles the following input shapes (inferred, unverified):

```json
{ "tool": "bash", "command": "...", "workdir": "..." }
{ "tool_name": "Bash", "tool_input": { "command": "..." } }
```

The PostToolUse event carries the **tool output** after execution. Its shape depends on whether Codex uses a Claude Code-compatible event model or its own format.

## Hypothesised PostToolUse Shapes

### Hypothesis A: Claude Code-compatible event model

If Codex is a fork of or closely modelled on Claude Code's hook API:

```json
{
  "tool_use_id": "toolu_abc123",
  "tool_name": "Bash",
  "output": "<stdout of the command>",
  "is_error": false
}
```

Output extraction path: `input.output || input.tool_output || input.content`.

### Hypothesis B: Codex-native output format

If Codex uses its own event model keyed to its PreToolUse shape:

```json
{
  "tool": "bash",
  "command": "<the command that ran>",
  "result": "<stdout of the command>",
  "exit_code": 0,
  "workdir": "..."
}
```

Output extraction path: `input.result || input.output || input.stdout`.

### Hypothesis C: Wrapped envelope

Some AI CLI tools wrap tool events in an envelope:

```json
{
  "type": "tool_result",
  "tool": "bash",
  "content": "<stdout>",
  "exit_code": 0
}
```

Output extraction path: `input.content || input.output`.

## How to Verify

1. Add a stub PostToolUse hook that dumps stdin to a temp file:

```bash
node -e "
const fs = require('fs');
const buf = [];
process.stdin.on('data', d => buf.push(d));
process.stdin.on('end', () => {
  fs.appendFileSync('/tmp/codex-posttool.json', buf.join('') + '\n');
  process.stdout.write(buf.join(''));
});
"
```

2. Run a Codex session and invoke a Bash tool call.

3. Inspect `/tmp/codex-posttool.json` to see the actual event envelope.

4. Identify the output field path and `tool_name`/`tool` key.

5. File a PR updating this document with the verified shape and wiring instructions.

## Suspected Output Field Priority

Based on the Claude Code output-sanitizer pattern, the recommended extraction fallback chain for a Codex post-adapter would be:

```javascript
const outputText = String(
  input.output ||
  input.result ||
  input.tool_output ||
  input.content ||
  input.stdout ||
  ""
);
```

## Current Adapter Coverage

| Event | Coverage |
|---|---|
| PreToolUse (shell gate) | EXPERIMENTAL — `codex/hooks/adapter.js` |
| PostToolUse (output scan) | NOT WIRED — pending verification (see PR #13 for implementation once A3 merges) |

## Relation To ASI05 Coverage

Until PostToolUse is verified and wired for Codex, ASI05 (Improper Output Handling) carries a documented limitation for this harness. See `references/owasp-agentic-coverage.md` ASI05 row for the current status.
