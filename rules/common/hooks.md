---
last_reviewed: 2026-04-23
version_target: 1.0.x
---

# ARG Hooks

Configuration rules for Agent Runtime Guard hooks. These hooks protect the tool call execution layer.

## Overview

ARG hooks intercept PreToolUse events before a tool call executes. They scan for dangerous commands, secret exposure, and policy violations. Understanding how they work allows you to configure them correctly.

## Hook Activation

ARG hooks activate on every tool call where `LILARA_HOOKS=1` is set or when the hook files are installed in the Claude Code hooks configuration. They run synchronously before the tool executes.

- `dangerous-command-gate.js`: scans Bash commands for dangerous patterns (rm -rf, curl|sh, force-push, DROP TABLE, etc.)
- `secret-warning.js`: scans all tool inputs for secrets (API keys, tokens, private keys, connection strings)
- `git-push-reminder.js`: intercepts git push operations, especially force-push

## Enforcement Modes

- **Warn mode** (default): dangerous patterns trigger a warning to stderr but the command proceeds. Useful for learning which patterns trigger the gate.
- **Enforce mode** (`LILARA_ENFORCE=1`): dangerous patterns cause the hook to exit code 2, aborting the tool call. Use this in production and CI environments.

Set enforcement mode in your environment:
```bash
export LILARA_ENFORCE=1  # enforce mode — blocks dangerous commands
export LILARA_ENFORCE=0  # warn mode (default)
```

## Policy Store

The ARG runtime maintains a policy store at `$LILARA_STATE_DIR/policy.json` (default: `~/.lilara/policy.json`).

- **Learned allow**: policies learned from repeated approvals. Once approved N times, automatically allowed.
- **Auto-allow-once**: temporary grants for single-use approvals.
- **Kill switch**: `LILARA_KILL_SWITCH=1` disables the runtime decision engine entirely. The hook still runs, but only severity-based fallbacks apply.

## Test Isolation

Always set `LILARA_STATE_DIR` to a temporary directory in tests. The runtime reads and writes state files; without isolation, tests can interfere with each other and with your live session state.

```bash
export LILARA_STATE_DIR=$(mktemp -d)
# run your tests
# state is isolated
```

## Hook Log

Hooks emit JSONL events to `$LILARA_STATE_DIR/hook-events.log` when `LILARA_HOOK_LOG=1`. Each line is a valid JSON object with: `timestamp`, `hook`, `action`, `pattern`. Use this log for auditing and for understanding what ARG is doing.

## Adding New Patterns

To add a pattern to the dangerous-command-gate, add an entry to the `DANGEROUS_PATTERNS` array in `claude/hooks/dangerous-command-gate.js`. Each entry needs: `name`, `pattern` (regex), `severity` (critical/high/medium), and `reason`.

To add a pattern to the secret scanner, add to the `SECRET_PATTERNS` array in `claude/hooks/secret-warning.js`. Include: `name`, `pattern` (regex), and optionally `hint` for the warning message.
