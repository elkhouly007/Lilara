# OWASP Top 10 for Agentic Applications 2026 — Coverage Matrix

Source: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
Last reviewed: 2026-04-23

This matrix records what Agent Runtime Guard does (or explicitly does not do) for each
ASI risk. Every row must name a specific file or state NOT COVERED.
No vague claims. Deferred items are explicit.

---

| ASI | Risk | Coverage | File(s) |
|-----|------|----------|---------|
| ASI01 | Prompt Injection / Goal Hijacking | PARTIAL — intercepts dangerous command patterns before execution; blocks on critical risk score; **A1 (G1 PARTIAL):** regex-based bypass detector covers 5 documented bypass shapes: (1) base64-pipe-exec, (2) ifs-bypass, (3) eval-dynamic-exec, (4) variable-as-command, (5) network-process-sub; novel bypass shapes outside this set trigger `shell-ast-unresolvable` escalation but are not specifically identified; does not detect NLP-level injection in prompt text | `claude/hooks/dangerous-command-gate.js`, `runtime/decision-engine.js`, `runtime/shell-bypass-detector.js` |
| ASI02 | Excessive Agency / Tool Misuse | COVERED — risk-scored decision engine routes all tool calls; workflow-router constrains targets; `HORUS_ENFORCE=1` exits code 2 to block; trajectory nudge limits runaway sessions | `runtime/decision-engine.js`, `runtime/workflow-router.js`, `claude/hooks/dangerous-command-gate.js` |
| ASI03 | Memory / Context Corruption | PARTIAL — session state files are mode 0600; no injection-resistant memory store; memory contents are never written to hook output | `runtime/session-context.js`, `claude/hooks/hook-utils.js` |
| ASI04 | Sensitive Information Disclosure | PARTIAL — `secret-warning.js` detects 23 secret patterns before Bash tool calls and blocks in `HORUS_ENFORCE=1`; hook log records metadata only, never content; path-sensitivity classifier flags high-sensitivity paths. `redact-payload.sh` is an offline audit tool — not wired into hook execution. **A4:** `decision-journal.js:append()` now enforces `contract.scopes.secrets.redactInJournal`; when true, `targetPath` and `notes` are redacted with the 23-pattern set before JSONL write (remaining gap: journal fields beyond targetPath/notes are not yet redacted). | `claude/hooks/secret-warning.js`, `claude/hooks/hook-utils.js`, `scripts/redact-payload.sh`, `runtime/decision-journal.js`, `runtime/secret-scan.js` |
| ASI05 | Improper Output Handling | PARTIAL — `audit-examples.sh` scans prose and GOOD blocks for dangerous patterns; `audit-local.sh` scans scripts and hooks; **Claude Code** scans tool output via `output-sanitizer.js` PostToolUse hook (23-pattern set, warns on credential echo); OpenCode and OpenClaw post-tool scanning deferred (see NOT COVERED) | `scripts/audit-examples.sh`, `scripts/audit-local.sh`, `claude/hooks/output-sanitizer.js` |
| ASI06 | Inadequate Authorization | COVERED — `project-policy.js` loads per-project trust posture and protected-branch config; `decision-engine.js` enforces strict/balanced/relaxed posture; protected-branch commands require review | `runtime/project-policy.js`, `runtime/decision-engine.js` |
| ASI07 | Unsafe Tool / Supply Chain Compromise | COVERED — `verify-hooks-integrity.sh` checks SHA-256 of all hook files; `install-local.sh` copies from a pinned local source; no remote download at runtime | `scripts/verify-hooks-integrity.sh`, `scripts/install-local.sh` |
| ASI08 | Uncontrolled Agentic Loops / Cascading Failures | COVERED — token-bucket rate limiter caps hook invocations per second; session-trajectory routing escalates after repeated risky decisions; `HORUS_KILL_SWITCH=1` halts all decisions | `claude/hooks/hook-utils.js` (`rateLimitCheck`), `runtime/session-context.js` (`getSessionTrajectory`), `runtime/decision-engine.js` |
| ASI09 | Human-Agent Trust Exploitation | PARTIAL — escalate action routes to human-gate; `require-review` action blocks auto-allow on protected branches; no cryptographic agent-identity verification (single-host scope) | `runtime/workflow-router.js`, `runtime/decision-engine.js` |
| ASI10 | Rogue Agents / Uncontrolled Autonomy | COVERED — `HORUS_KILL_SWITCH=1` blocks all decisions immediately; policy-store prevents auto-promotion without operator approval; auto-allow-once is single-use and eligible-gated | `runtime/decision-engine.js` (`HORUS_KILL_SWITCH`), `runtime/policy-store.js` |

---

## Deferred

- **Cryptographic agent identity / inter-agent trust protocol** (relevant to ASI09): Out of scope
  for a single-host Claude Code / OpenCode / OpenClaw helper. There is no multi-agent network
  to protect. Explicitly deferred — single-host scope.
  See: Microsoft Agent Governance Toolkit for a reference implementation.

## NOT COVERED

- NLP-level prompt injection detection (ASI01): Would require an LLM-in-the-loop classifier;
  out of scope for a local hook that must complete in <1 ms.
- Post-tool output sanitisation (ASI05): **Claude Code** scans tool output via `claude/hooks/output-sanitizer.js` (PostToolUse). **OpenCode** is a Claude Code fork and likely supports PostToolUse via the same hook event model, but in-repo wiring (`opencode/WIRING_PLAN.md`) currently documents PreToolUse only — extension deferred until a contributor confirms upstream OpenCode PostToolUse support and documents the wiring path. **OpenClaw** post-tool event model is unverified — deferred.
- Cryptographic inter-agent trust (ASI09): Deferred — single-host scope (see above).
