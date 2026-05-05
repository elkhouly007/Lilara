# Claude Hooks — Agent Runtime Guard

Local-only Node.js scripts. All hooks follow the same safety contract:

## Safety Contract

| Rule | Detail |
|------|--------|
| stdin → stdout unchanged | Always echo raw input to stdout — harness depends on this |
| stderr for messages | All warnings and summaries go to stderr only |
| No external packages | stdlib only: `fs`, `path`, `os` |
| No network calls | Zero outbound connections |
| No content access | Never read prompt text, file contents, or API responses |
| Silent fail | `catch(() => process.exit(0))` — hooks never crash the harness |
| Local writes only | Only `~/.horus/` (instincts, session counter, telemetry) |

---

## Hook Map

### SessionStart Hooks
| Hook | What it does |
|------|-------------|
| `memory-load.js` | Reads `~/.claude/.../memory/MEMORY.md`, prints item count + 3 titles to stderr. Read-only. |
| `session-start.js` | Reads instinct store, prints pending/candidate/confident counts to stderr. Prunes expired instincts. |

### Stop Hooks
| Hook | What it does |
|------|-------------|
| `session-end.js` | Captures tool_name + event_type metadata, writes one candidate instinct to `~/.horus/instincts/pending.json`. Never captures content. |

### PreToolUse Hooks
| Hook | Matcher | What it does |
|------|---------|-------------|
| `secret-warning.js` | all tools | Warns if prompt contains common secret patterns (sk-, ghp_, AKIA...). Non-blocking. |
| `dangerous-command-gate.js` | Bash only | Hard-blocks destructive commands (rm -rf /, dd, mkfs, fork bombs) per `dangerous-patterns.json`. Exit 2 with reason. |
| `git-push-reminder.js` | Bash only | Warns before `git push`. Non-blocking. |
| `build-reminder.js` | Bash only | Reminds to check output after build/test commands. Non-blocking. |

### PostToolUse Hooks
| Hook | Matcher | What it does |
|------|---------|-------------|
| `strategic-compact.js` | all tools | Tracks call count in `~/.horus/session-counter.json`. Suggests `/compact` at 50, 100, and every 25 after. Also fires after Agent/WebFetch/WebSearch. |
| `output-sanitizer.js` | all tools | Scans tool output for secrets (delegates to `runtime/secret-scan.js`). Cannot block; emits stderr warning for cross-harness consistency. |
| `pr-notifier.js` | Bash only | Detects GitHub PR URL in output after `gh pr create`. Prints URL + review commands. |
| `quality-gate.js` | Edit / Write | Reads `file_path` metadata, suggests typecheck/lint command for `.ts`, `.py`, `.go`, `.rs`, `.java/.kt` files. |

### Shared Utilities
| File | Purpose |
|------|---------|
| `instinct-utils.js` | Read/write/score/prune instinct store. Not a hook — imported by session hooks. |
| `hooks.json` | Reference wiring config. Copy into `~/.claude/settings.json` after adjusting paths. |

---

## Instinct Learning Flow

```
During session
  → user runs /learn "description"     → candidate instinct saved immediately

Session ends
  → session-end.js                     → metadata-only candidate saved to pending.json

Next session start
  → session-start.js                   → shows counts: N pending, N candidates, N confident
  → memory-load.js                     → shows memory index summary

User review
  → /instinct-status                   → lists candidates with confidence scores
  → Ahmed fills in trigger + behavior  → edits pending.json
  → Ahmed promotes                     → candidate moves to confident.json

Evolution
  → /evolve                            → clusters ≥3 confident instincts into a skill file
  → /prune                             → soft-deletes expired / empty / negative instincts
```

---

## Wiring into Claude Code

Copy this block into `~/.claude/settings.json` (replace `/ABS_PATH/` with the full path to this directory):

```json
"hooks": {
  "SessionStart": [
    { "hooks": [{ "type": "command", "command": "node /ABS_PATH/memory-load.js" }] },
    { "hooks": [{ "type": "command", "command": "node /ABS_PATH/session-start.js" }] }
  ],
  "Stop": [
    { "hooks": [{ "type": "command", "command": "node /ABS_PATH/session-end.js" }] }
  ],
  "PreToolUse": [
    { "hooks": [{ "type": "command", "command": "node /ABS_PATH/secret-warning.js" }] },
    { "matcher": "tool_name == \"Bash\"", "hooks": [
      { "type": "command", "command": "node /ABS_PATH/git-push-reminder.js" },
      { "type": "command", "command": "node /ABS_PATH/build-reminder.js" }
    ]}
  ],
  "PostToolUse": [
    { "hooks": [{ "type": "command", "command": "node /ABS_PATH/strategic-compact.js" }] },
    { "matcher": "tool_name == \"Bash\"", "hooks": [
      { "type": "command", "command": "node /ABS_PATH/pr-notifier.js" }
    ]},
    { "matcher": "tool_name in [\"Edit\", \"Write\"]", "hooks": [
      { "type": "command", "command": "node /ABS_PATH/quality-gate.js" }
    ]}
  ]
}
```

## Runtime Environment Variables

| Variable | Values | Effect |
|----------|--------|--------|
| `HORUS_ENFORCE` | `0` (default) / `1` | When `1`, hooks exit code 2 to block the tool call instead of warning. |
| `HORUS_KILL_SWITCH` | unset (default) / `1` | When `1`, `runtime.decide()` returns `action: "block"` for **every** input, regardless of risk score. Use in emergencies to stop all agentic tool use immediately. Unset with `unset HORUS_KILL_SWITCH` to restore normal operation. Hook output will print `kill-switch engaged` prominently when active. |
| `HORUS_HOOK_LOG` | `0` (default) / `1` | When `1`, writes structured JSONL events to `~/.horus/hook-events.log`. |
| `HORUS_RATE_LIMIT` | `1` (default) / `0` | When `0`, disables the token-bucket rate limiter (useful in CI / tests). |
| `HORUS_STATE_DIR` | path | Override the runtime state directory (policy store, session context, decision journal). Defaults to `~/.horus`. Useful for test isolation. |
| `HORUS_TRAJECTORY_THRESHOLD` | integer (default `3`) | Number of recent escalations before trajectory nudge activates. |
| `HORUS_TRAJECTORY_WINDOW_MIN` | integer (default `30`) | Sliding window in minutes for trajectory escalation counting. |

## Verify Installation

```bash
# All hooks should pass syntax check
node --check session-start.js
node --check session-end.js
node --check memory-load.js
node --check strategic-compact.js
node --check pr-notifier.js
node --check quality-gate.js

# Smoke test: session-end should echo input and write a summary to stderr
echo '{"event_type":"Stop","tool_name":"Bash"}' | node session-end.js
```
