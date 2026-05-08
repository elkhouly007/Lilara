# Claw Code — PostToolUse Event Shape Research

> **Status: UNVERIFIED.** All payload shapes below are inferred from PreToolUse patterns and by analogy with Claude Code. A contributor with access to a live Claw Code installation must verify the actual PostToolUse event format before any adapter can be wired in production.

## Background

The Claw Code PreToolUse adapter (`clawcode/hooks/adapter.js`) is the most tested of the three EXPERIMENTAL harnesses: `scripts/check-clawcode-adapter.sh` verifies 12 checks across 6 input shapes. The PreToolUse shapes (inferred, unverified) are:

```json
{ "command": "...", "cwd": "..." }
{ "cmd": "...", "cwd": "..." }
{ "tool_input": { "command": "..." } }
```

The PostToolUse event carries the **tool output** after execution. Claw Code's heritage and the tool's hook model determine the event format.

## Hypothesised PostToolUse Shapes

### Hypothesis A: Claude Code-compatible event model

Claw Code may use the same hook event model as Claude Code:

```json
{
  "tool_use_id": "toolu_abc123",
  "tool_name": "Bash",
  "output": "<stdout of the command>",
  "is_error": false
}
```

Output extraction path: `input.output || input.tool_output || input.content`.

### Hypothesis B: Claw Code-native output format

If Claw Code uses its own format matching its PreToolUse shape:

```json
{
  "command": "<the command that ran>",
  "result": "<stdout of the command>",
  "exit_code": 0,
  "cwd": "..."
}
```

Output extraction path: `input.result || input.output || input.stdout`.

### Hypothesis C: Minimal output envelope

```json
{
  "exit_code": 0,
  "output": "<stdout>",
  "stderr": ""
}
```

Output extraction path: `input.output || input.stdout`.

## How to Verify

1. Add a stub PostToolUse hook that captures stdin:

```bash
node -e "
const fs = require('fs');
const buf = [];
process.stdin.on('data', d => buf.push(d));
process.stdin.on('end', () => {
  fs.appendFileSync('/tmp/clawcode-posttool.json', buf.join('') + '\n');
  process.stdout.write(buf.join(''));
});
"
```

2. Run a Claw Code session and invoke a shell command.

3. Inspect `/tmp/clawcode-posttool.json`.

4. Identify the output field path and any envelope keys.

5. File a PR updating this document with the verified shape and wiring instructions.

## Suspected Output Field Priority

Based on the Claude Code output-sanitizer pattern and the Claw Code PreToolUse shape, the recommended extraction fallback chain for a Claw Code post-adapter would be:

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
| PreToolUse (shell gate) | EXPERIMENTAL — `clawcode/hooks/adapter.js` (most tested EXPERIMENTAL harness) |
| PostToolUse (output scan) | NOT WIRED — pending verification (see PR #13 for implementation once A3 merges) |

## Relation To ASI05 Coverage

Until PostToolUse is verified and wired for Claw Code, ASI05 (Improper Output Handling) carries a documented limitation for this harness. See `references/owasp-agentic-coverage.md` ASI05 row for the current status.
