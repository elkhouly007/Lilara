# Modules

Agent Runtime Guard is a runtime decision spine and amplification surface. ECC (the upfront-contract model) is the enforcement foundation; agents, rules, skills, and the CLI form the amplification layer. For the longer-term direction, see [ROADMAP.md](../ROADMAP.md). For the module architecture and decision flow, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Core Modules

| Module | Path | Default | Purpose |
| --- | --- | --- | --- |
| Claude local instructions | `claude/AGENTS.md` | enabled by copying | Local-first agent operating rules. |
| Secret warning hook | `claude/hooks/secret-warning.js` | optional local hook (PreToolUse) | Scans prompt JSON for 23 secret patterns (API keys, tokens, JWTs, etc.). Blocks in `HORUS_ENFORCE=1`. |
| Dangerous command gate | `claude/hooks/dangerous-command-gate.js` | optional local hook (PreToolUse Bash) | Blocks/warns on 21 dangerous shell patterns: rm -rf, force-push, curl\|sh, DROP TABLE, prompt injection, etc. Highest-severity match wins. Blocks in `HORUS_ENFORCE=1`. |
| Build reminder hook | `claude/hooks/build-reminder.js` | optional local hook (PreToolUse Bash) | Reminds the user to review build/test output before continuing. |
| Git push reminder hook | `claude/hooks/git-push-reminder.js` | optional local hook (PreToolUse Bash) | Reminds before push; blocks force-push in `HORUS_ENFORCE=1`. |
| Quality gate hook | `claude/hooks/quality-gate.js` | optional local hook (PostToolUse Edit/Write) | Suggests linter/test commands after file edits based on file extension. |
| Session start hook | `claude/hooks/session-start.js` | optional local hook (SessionStart) | Loads instinct store, shows pending review count. |
| Session end hook | `claude/hooks/session-end.js` | optional local hook (Stop) | Captures session metadata to instinct store for future sessions. |
| Strategic compact hook | `claude/hooks/strategic-compact.js` | optional local hook (PostToolUse) | Suggests /compact when context window may be filling. |
| Output sanitizer hook | `claude/hooks/output-sanitizer.js` | optional local hook (PostToolUse) | PostToolUse secret scanner (delegates to `runtime/secret-scan.js`) |
| Memory load hook | `claude/hooks/memory-load.js` | optional local hook (SessionStart) | Loads project memory context at session start. |
| PR notifier hook | `claude/hooks/pr-notifier.js` | optional local hook (PostToolUse) | Notifies after PR-related actions. |
| Hook utilities | `claude/hooks/hook-utils.js` | shared library | readStdin (5 MB cap), commandFrom, collectText, hookLog, rateLimitCheck, classifyCommandPayload, classifyPathSensitivity (advisory, feeds risk-score), readSessionRisk. Used by all hooks. |
| Instinct utilities | `claude/hooks/instinct-utils.js` | shared library | Instinct store read/write/prune/TTL management for session-start and session-end hooks. |
| Dangerous patterns config | `claude/hooks/dangerous-patterns.json` | config | 21 extensible patterns with severity (critical/high/medium) for dangerous-command-gate. |
| Secret patterns config | `claude/hooks/secret-patterns.json` | config | 23 regex patterns for secret detection in secret-warning hook. |
| OpenCode safe config | `opencode/opencode.safe.jsonc` | template | Ask-by-default local agent config with no MCP or plugins wired yet. |
| Prompt pack | `opencode/prompts/`, `openclaw/prompts/` | template | Planning, review, security, and build repair prompts. |
| Local installer | `scripts/install-local.sh` | manual | Copies kit files into a local target. |
| Local auditor | `scripts/audit-local.sh` | manual | Flags risky strings for review. |
| Phase 1 policy reference | `references/phase1-policy.md` | enabled by reference | Defines trusted-agent, MCP, and shell rules. |
| Phase 2 policy reference | `references/phase2-policy.md` | enabled by reference | Defines plugin, browser, and notification rules. |
| Phase 3 policy reference | `references/phase3-policy.md` | enabled by reference | Defines installers, wrappers, daemons, and integration templates. |
| Upstream sync references | `references/capability-log.md`, `references/parity-matrix.json` | enabled by reference | Tracks upstream capability coverage and adoption decisions. |
| Phase 1 module registry | `modules/phase1/` | documentation only | Records policy for trusted agents, MCP, and shell classes. |
| Phase 2 module registry | `modules/phase2/` | documentation only | Records policy for plugins, browser automation, and notifications. |
| Phase 3 module registry | `modules/phase3/` | documentation only | Records policy for installers, wrappers, daemons, and integration templates. |
| Integration templates | `templates/` | template-only | Provides controlled starting points for Claude Code, OpenCode, and OpenClaw. |
| MCP capability pack | `modules/mcp-pack/` | reviewed-only | Provides the first reviewed MCP registry with local-first preference and explicit external review rules. |
| Wrapper capability pack | `modules/wrapper-pack/` | reviewed-only | Provides reviewed wrapper patterns with visible routing, payload review, and no approval bypass. |
| Plugin capability pack | `modules/plugin-pack/` | reviewed-only | Provides classified plugin patterns with local-only, external-read, and approval-gated external-write lanes. |
| Browser capability pack | `modules/browser-pack/` | reviewed-only | Provides reviewed browser capability patterns with explicit read/write separation. |
| Notification capability pack | `modules/notification-pack/` | reviewed-only | Provides local-first notification patterns with explicit external review boundaries. |
| Daemon/service pack | `modules/daemon-pack/` | optional-local-only | Provides scoped background helpers with explicit stop mechanisms, local-only defaults, and supervised external variants requiring approval. |

## Phase 1 Capability Areas

| Capability | Path | Default | Policy |
| --- | --- | --- | --- |
| Trusted external agents | `modules/phase1/trusted-agents.json` | allowed after payload review | Allowed when the harness is known and the outbound content has been reviewed. |
| Local MCP modules | `modules/phase1/mcp-policy.json` | allowed after review | Allowed when installed, reviewed, pinned, and documented. |
| External MCP modules | `modules/phase1/mcp-policy.json` | allowed after payload review | Allowed only with documented service/data flow and no sensitive outbound data without approval. |
| Shell execution | `modules/phase1/shell-policy.json` | mixed | Local safe classes may proceed; deletion, elevated use, sensitive overwrite, and similar high-risk classes require approval. |

## Phase 2 Capability Areas

| Capability | Path | Default | Policy |
| --- | --- | --- | --- |
| Plugins | `modules/phase2/plugins-policy.json` | classified | Local-only and reviewed external-read plugins may proceed after review; external-write and system-write plugins require approval. |
| Browser automation | `modules/phase2/browser-policy.json` | mixed | Read-oriented external browsing may proceed when the target and payload are clear; writes, uploads, purchases, and similar actions require approval. |
| Notifications | `modules/phase2/notifications-policy.json` | mixed | Local notifications are allowed; external notifications are allowed only when destination and content are low-risk and non-sensitive. |

## Phase 3 Capability Areas

| Capability | Path | Default | Policy |
| --- | --- | --- | --- |
| Installers | `modules/phase3/installers-policy.json` | mixed | Project-local non-destructive setup may proceed; deletes, global mutation, downloads, and elevated steps require approval. |
| Wrappers | `modules/phase3/wrappers-policy.json` | mixed | Transparent wrappers may proceed; hidden sends, destructive behavior, and global changes require approval. |
| Long-lived helpers and daemons | `modules/phase3/daemons-policy.json` | mixed | Local stoppable helpers may proceed; persistent, elevated, or unclear external daemons require approval. |
| Integration templates | `modules/phase3/integration-templates.json` | template-only | Use templates instead of raw installs so file targets and risky defaults stay visible. |

## Reviewed Capability Packs

| Pack | Path | Default | Purpose |
| --- | --- | --- | --- |
| MCP pack | `modules/mcp-pack/` | reviewed-only | Restores MCP capability through a reviewed registry, local/external notes, and an apply checklist. |
| Wrapper pack | `modules/wrapper-pack/` | reviewed-only | Restores wrapper convenience and orchestration through transparent reviewed wrapper patterns. |
| Plugin pack | `modules/plugin-pack/` | reviewed-only | Restores plugin capability through classified reviewed plugin patterns and an apply checklist. |
| Browser pack | `modules/browser-pack/` | reviewed-only | Restores browser capability through reviewed read-only and approval-gated write patterns. |
| Notification pack | `modules/notification-pack/` | reviewed-only | Restores notification capability through local-first and reviewed external patterns. |
| Daemon pack | `modules/daemon-pack/` | optional-local-only | Optional scoped background helpers: file watcher, health checker, upstream monitor. Local variants auto; supervised variants require approval. |

## Runtime Autonomy Layer (v1.0.0)

| Module | Path | Purpose |
| --- | --- | --- |
| Runtime entry point | `runtime/index.js` | Re-exports all runtime module functions as a flat namespace. Required by hooks via `require("../../../runtime")`. |
| Decision engine | `runtime/decision-engine.js` | Core `decide(input)` function — scores risk, checks learned policy and auto-allow-once, applies trajectory nudge, returns action/explanation/workflow-route. `HORUS_KILL_SWITCH=1` returns block immediately. |
| Intent classifier | `runtime/intent-classifier.js` | Maps shell commands to 8 intents (explore/build/deploy/modify/configure/cleanup/debug/unknown) using pure pattern matching. Zero I/O, zero deps. |
| Route resolver | `runtime/route-resolver.js` | Maps intents to routing lanes (direct/verification/review) via a static table with per-project override support. |
| Shell AST tokenizer | `runtime/shell-ast.js` | Zero-dep shell command tokenizer. Detects bypass patterns that pure-regex misses: base64-pipe-exec, IFS whitespace bypass, eval+dynamic-content, variable-as-command, network process substitution. Called by `risk-score.js` on every decision. |
| Risk scorer | `runtime/risk-score.js` | Computes 0–10 risk score from command patterns, path sensitivity, payload class, branch, session risk, trust posture, and shell-AST bypass signals. |
| Policy store | `runtime/policy-store.js` | Learned local allows, approval counts, pending suggestions, and auto-allow-once tokens. Persists to `~/.horus/learned-policy.json` (overridable via `HORUS_STATE_DIR`). |
| Session context | `runtime/session-context.js` | Rolling per-session decision history (last 12 entries). Powers `getSessionRisk()` and `getSessionTrajectory()`. State file mode 0600. |
| Decision journal | `runtime/decision-journal.js` | Append-only JSONL audit log at `~/.horus/decision-journal.jsonl`. Mode 0600. Set `HORUS_DECISION_JOURNAL=0` to disable writes (`ARG_DECISION_JOURNAL=0` is a deprecated alias). |
| Workflow router | `runtime/workflow-router.js` | Maps action → lane/surface/target/command for checks, review, setup, payload, wiring, escalation, and direct paths. |
| Action planner | `runtime/action-planner.js` | Builds structured action plans (commands, review types, modification hints) attached to each decision. |
| Promotion guidance | `runtime/promotion-guidance.js` | Lifecycle-aware guidance (new → approaching → eligible → promoted/dismissed) with concrete CLI hints. |
| Project policy | `runtime/project-policy.js` | Loads per-project `horus.config.json` for trust posture, protected branches, sensitive path patterns, and project scope. |
| Context discovery | `runtime/context-discovery.js` | Auto-detects project root, git branch, primary stack, and config presence from filesystem. |
| `state-paths.js`      | `runtime/state-paths.js`      | Single source of truth for storage paths; honors `HORUS_STATE_DIR` override. |
| `canonical-json.js`   | `runtime/canonical-json.js`   | Deterministic JSON stringify (keys sorted) for contract hashing. |
| `glob-match.js`       | `runtime/glob-match.js`       | Zero-dep glob matcher (`**`, `*`, `?`, `[abc]`, `!` negation, `${projectRoot}`). |
| `arg-extractor.js`    | `runtime/arg-extractor.js`    | Argv splitter; handles quoted args, escapes, heredocs (fail-closed on `<<HEREDOC`). |
| `decision-key.js`     | `runtime/decision-key.js`     | Builds `fineKey` (5-part) and `legacyKey` (4-part back-compat); classifies commands. |
| `config-validator.js` | `runtime/config-validator.js` | Typed-field walker; validates `horus.config.json` and `horus.contract.json`. |
| `contract.js`         | `runtime/contract.js`         | Contract lifecycle: load, verify, accept, generate, scope-match. |
| `secret-scan.js`      | `runtime/secret-scan.js`      | Cross-harness secret pattern scanner (shared by pre- and post-tool hooks). Exports `scanSecrets()` and `getPatterns()` (returns full 23-pattern set for use by journal redaction). |
| `telemetry.js`        | `runtime/telemetry.js`        | Structured event sink to `telemetry.jsonl`; never blocks. |
| `pretool-gate.js`     | `runtime/pretool-gate.js`     | Single enforcement spine called by all harness adapters; exports `runPreToolGate()`. |

All runtime modules write only to `HORUS_STATE_DIR` (or `~/.horus/`). No network access. No package manager invocations. State files are created with mode 0700 directories and 0600 files.

## Upstream Adoption Model

Use upstream as a reviewed feature feed, not as the trusted runtime base. Review `references/capability-log.md` and `references/parity-matrix.json` before adopting changes.

## Adding A Module

Add new modules as separate files or folders. Document each module's trust level, data flow, and approval trigger. If a module can call the network, run a package manager, write outside the project, or alter permissions, label it in `risk-register.md`, document the enable path, and tie it to the standing approval policy.
