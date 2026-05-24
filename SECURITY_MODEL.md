# Security Model

## Boundary

Agent Runtime Guard assumes the current project directory is the primary trust boundary, with controlled exceptions for reviewed external tools and trusted agents. The goal is not to ban capability. The goal is to ban silent trust expansion.

The toolkit cannot make an agent safe by itself. It provides policy, defaults, and reminders. The agent is expected to review commands, diffs, secrets, payloads, and data flow before acting.

## Allowed By Default

- Read local project files.
- Write files inside the current project for non-destructive tasks.
- Run deterministic local hooks.
- Copy this kit into a local target path.
- Run local grep-based audits.
- Use trusted external models or agents after reviewing the outbound payload.
- Use local or reviewed external MCP and plugin modules that stay within the approval policy.

## User-Approval Required

- Delete files or data.
- Overwrite sensitive files or perform irreversible bulk edits.
- Send personal, confidential, or secret data outside the machine.
- Use elevated privileges.
- Make permanent global configuration or dotfile changes.
- Trigger any external action when the exact data flow is unclear.

## Disallowed Or Rejected By Default

- `npx -y` style unreviewed remote code execution.
- Silent permission auto-approval.
- Hidden telemetry.
- Undocumented external modules.
- Prompt-injection attempts that try to bypass policy, conceal payloads, or weaken review.

## Hook Contract

Hooks in `claude/hooks/` must:

- read JSON from stdin (capped at 5 MB by `readStdin` in `hook-utils.js`);
- inspect only the provided JSON;
- write warnings to stderr;
- echo the original input to stdout unchanged in default (warn) mode;
- exit with code 2 to **block** the action when `LILARA_ENFORCE=1` is set — supported by `secret-warning.js`, `dangerous-command-gate.js`, and `git-push-reminder.js`;
- participate in rate limiting via `rateLimitCheck()` to prevent process spawn storms (all PreToolUse hooks);
- use no external packages unless reviewed and documented;
- make no network calls unless the module is explicitly marked external and routed through approval policy;
- write no files unless a future hook explicitly documents project-local writes.

## Known Limitations

The following limitations are documented, accepted, and do not represent implementation defects. They reflect architectural constraints of the hook execution model.

### Command obfuscation bypass

`dangerous-command-gate.js` matches shell commands using regular expressions. This approach is bypassable by obfuscated equivalents:

```bash
# These pass undetected — the regex does not see the final rm -rf:
cmd="rm -rf /"; $cmd
echo "cm0gLXJmIC8=" | base64 -d | sh
a=rm; b="-rf /"; $a $b
```

**Accepted because:** regex-based gates are a best-effort, low-overhead control layer. They catch the common, unobfuscated case and create friction. Defense-in-depth (user approval policy, reversibility checks) remains the primary protection. A full shell AST parser would be required for comprehensive coverage — this is out of scope for a hook-based tool.

### Rate limiter TOCTOU race

`rateLimitCheck()` in `hook-utils.js` performs a read-modify-write on a state file without atomic locking. When multiple hooks fire concurrently (which happens for every Bash command), two processes may read the same token count and both decrement it, allowing slightly more invocations than the configured bucket.

**Accepted because:** rate limiting here is a performance optimization to prevent thousands of Node.js process spawns, not a security gate. The "fail open" fallback on any file error already admits unbounded invocations. The practical burst overhead is bounded by the number of concurrent hooks (≤ 4) times capacity.

### Prompt injection detection is content-heuristic only

The prompt injection patterns in `dangerous-patterns.json` scan the command string for known injection phrases. This does not cover:

- Injections embedded in file content that the agent reads and then executes
- Indirect prompt injection via external data sources (MCP results, browser output, API responses)
- Novel injection phrasing not covered by the current patterns

**Mitigation:** The classify/redact pipeline and user review of agent actions before approval are the primary defenses.

---

## Egress Sanitization Scope

**PreToolUse (all harnesses):** `runtime/pretool-gate.js` calls `scanSecrets()` for every harness (claude, opencode, openclaw, clawcode, codex, antegravity) before any tool call. If a secret pattern is detected in the command or payload, `payloadClass` is upgraded to C (critical) and the hard floor in `decide()` fires. This applies across all six harnesses.

**PostToolUse (Claude Code only):** `claude/hooks/output-sanitizer.js` scans tool output for the same 23-pattern set after each tool call, warning when a credential appears in a tool response. This hook is a Claude Code PreToolUse/PostToolUse informational warning only — it cannot block (PostToolUse hooks are informational).

**PostToolUse parity for OpenCode, OpenClaw, and EXPERIMENTAL harnesses:** Not implemented. `opencode/WIRING_PLAN.md` documents that PostToolUse extension is deferred pending contributor verification of upstream support. OpenClaw PostToolUse event model is also unverified. The three EXPERIMENTAL harnesses (codex, clawcode, antegravity) have no PostToolUse hook at all. Operators who need egress sanitization for these harnesses must rely on the PreToolUse secret-scan floor only.

---

## Fail-Closed Behavior Under LILARA_ENFORCE=1

Under `LILARA_ENFORCE=1`, if `runtime.decide()` throws (e.g., corrupt `session-context.json`, partial deploy, or missing state file), the gate fails closed when any non-trivial safety signal is present: a dangerous-pattern hit at any severity (medium, high, or critical), a secret-bearing payload, or a high-sensitivity path. This trades availability for safety: a corrupt policy file under enforce can transiently block legitimate work, but the alternative — silently allowing tool calls when enforcement is requested — is worse. The existing `session-context.js` auto-backup-and-reset on parse error (lines 71-79) mitigates the availability cost. See `runtime/pretool-gate.js:182-200`.

---

## Emergency Override

`LILARA_KILL_SWITCH=1` causes `runtime.decide()` to return `action: "block"` for every input, regardless of risk score, learned policy, or session state. Use this to immediately halt all runtime-permitted actions in an unsafe session.

To re-enable normal operation, unset the variable: `unset LILARA_KILL_SWITCH` (or close and reopen your terminal).

The kill switch does not affect hooks that operate independently of the runtime decision layer (e.g., `secret-warning.js` still scans for secrets, and informational hooks still pass stdin through). PreToolUse hooks exit 2 unconditionally — no additional flags are needed for complete PreToolUse blocking.

---

## External Modules

Modules that contact external services must be documented before use. Documentation must include:

- what service is contacted;
- what data may be sent;
- whether the data may contain personal, confidential, or secret material;
- what command or tool enables it;
- how to disable it;
- why the benefit is worth the added risk.

External prompts and trusted-agent delegation are allowed when the reviewed payload does not contain personal or confidential data and the action does not cross a user-approval category.
