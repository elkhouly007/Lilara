# antegravity — PostToolUse Event Shape Research

> **Status: UNVERIFIED.** All payload shapes below are inferred from PreToolUse patterns and by analogy with Claude Code. A contributor with access to a live antegravity installation must verify the actual PostToolUse event format before any adapter can be wired in production. antegravity has the least publicly available documentation of the three EXPERIMENTAL harnesses.

## Background

The antegravity PreToolUse adapter (`antegravity/hooks/adapter.js`) handles the following input shapes (inferred, unverified):

```json
{ "command": "...", "cwd": "..." }
{ "cmd": "...", "cwd": "..." }
{ "tool_input": { "command": "..." } }
```

antegravity is the least documented EXPERIMENTAL harness in this project. Its hook API and PostToolUse event model are unknown. Research below is entirely speculative.

## Hypothesised PostToolUse Shapes

### Hypothesis A: Claude Code-compatible event model

If antegravity uses Claude Code's hook API or is a derivative:

```json
{
  "tool_use_id": "toolu_abc123",
  "tool_name": "Bash",
  "output": "<stdout of the command>",
  "is_error": false
}
```

Output extraction path: `input.output || input.tool_output || input.content`.

### Hypothesis B: antegravity-native format

If antegravity uses a minimal output envelope matching its PreToolUse shape:

```json
{
  "command": "<the command that ran>",
  "output": "<stdout>",
  "exit_code": 0,
  "cwd": "..."
}
```

Output extraction path: `input.output || input.result || input.stdout`.

### Hypothesis C: Streaming result chunks

Some agentic runtimes emit output as streaming chunks. If antegravity is in this category:

```json
{ "type": "output_chunk", "content": "...", "done": false }
{ "type": "output_chunk", "content": "...", "done": true, "exit_code": 0 }
```

This would require a stream aggregator before secret scanning. Verification required before implementing.

## How to Verify

1. Add a stub PostToolUse hook that captures stdin (ensures non-blocking):

```bash
node -e "
const fs = require('fs');
const buf = [];
process.stdin.on('data', d => buf.push(d));
process.stdin.on('end', () => {
  fs.appendFileSync('/tmp/antegravity-posttool.json', buf.join('') + '\n');
  process.stdout.write(buf.join(''));
});
"
```

2. Run an antegravity session and invoke a shell/bash tool call.

3. Inspect `/tmp/antegravity-posttool.json` to see the actual event envelope.

4. Determine: (a) is PostToolUse even supported? (b) what fields carry the output? (c) does output arrive as one blob or streaming chunks?

5. File a PR updating this document with the verified shape and implementing the adapter if feasible.

## Suspected Output Field Priority

Until verified, the broadest extraction fallback chain is recommended:

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

## Additional Unknowns

Unlike Codex and Claw Code, antegravity has no known public documentation. The following are also unverified:

- Does antegravity support PostToolUse hooks at all?
- Is the hook event fired once (end of tool) or per-line (streaming)?
- Are there harness-level env vars that signal antegravity context (comparable to `CLAUDE_CODE_ENTRYPOINT`)?

These unknowns must be resolved by a contributor before an adapter can be written.

## Current Adapter Coverage

| Event | Coverage |
|---|---|
| PreToolUse (shell gate) | EXPERIMENTAL — `antegravity/hooks/adapter.js` |
| PostToolUse (output scan) | NOT WIRED — pending verification (see PR #13 for implementation once A3 merges) |

## Relation To ASI05 Coverage

Until PostToolUse is verified and wired for antegravity, ASI05 (Improper Output Handling) carries a documented limitation for this harness. See `references/owasp-agentic-coverage.md` ASI05 row for the current status.
