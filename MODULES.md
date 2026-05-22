# Modules

Agent Runtime Guard is a runtime decision spine and amplification surface. ECC (the upfront-contract model) is the enforcement foundation; agents, rules, skills, and the CLI form the amplification layer. For the longer-term direction, see [ROADMAP.md](../ROADMAP.md). For the module architecture and decision flow, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Core Modules

| Module | Path | Default | Purpose |
| --- | --- | --- | --- |
| Claude local instructions | `claude/AGENTS.md` | enabled by copying | Local-first agent operating rules. |
| Secret warning hook | `claude/hooks/secret-warning.js` | optional local hook (PreToolUse) | Scans prompt JSON for 23 secret patterns (API keys, tokens, JWTs, etc.). Blocks in `HORUS_ENFORCE=1`. |
| Dangerous command gate | `claude/hooks/dangerous-command-gate.js` | optional local hook (PreToolUse Bash) | Blocks/warns on 21 dangerous shell patterns: rm -rf, force-push, curl\|sh, DROP TABLE, prompt injection, etc. Highest-severity match wins. Claude now also reports F15 execution envelopes from this hook path. Blocks in `HORUS_ENFORCE=1`. |
| Build reminder hook | `claude/hooks/build-reminder.js` | optional local hook (PreToolUse Bash) | Reminds the user to review build/test output before continuing. |
| Git push reminder hook | `claude/hooks/git-push-reminder.js` | optional local hook (PreToolUse Bash) | Reminds before push; blocks force-push in `HORUS_ENFORCE=1`. |
| Quality gate hook | `claude/hooks/quality-gate.js` | optional local hook (PostToolUse Edit/Write) | Suggests linter/test commands after file edits based on file extension. |
| Session start hook | `claude/hooks/session-start.js` | optional local hook (SessionStart) | Loads instinct store, shows pending review count. |
| Session end hook | `claude/hooks/session-end.js` | optional local hook (Stop) | Captures session metadata to instinct store for future sessions. |
| Strategic compact hook | `claude/hooks/strategic-compact.js` | optional local hook (PostToolUse) | Suggests /compact when context window may be filling. |
| Output sanitizer hook | `claude/hooks/output-sanitizer.js` | optional local hook (PostToolUse) | PostToolUse secret scanner + taint recorder. Scans output via `runtime/secret-scan.js`; records external-source tool output (WebFetch, mcp, curl, Browser) to provenance window via `runtime/taint.js`. Claude also consumes reported F15 execution envelopes here for post-run divergence journaling. |
| Memory load hook | `claude/hooks/memory-load.js` | optional local hook (SessionStart) | Loads project memory context at session start. |
| PR notifier hook | `claude/hooks/pr-notifier.js` | optional local hook (PostToolUse) | Notifies after PR-related actions. |
| Hook utilities | `claude/hooks/hook-utils.js` | shared library | readStdin (5 MB cap), commandFrom, collectText, hookLog, rateLimitCheck (O_EXCL lockfile — atomic token-bucket, contention→deny, FS-error→fail-open), classifyCommandPayload, classifyPathSensitivity (advisory, feeds risk-score), readSessionRisk. Used by all hooks. |
| Instinct utilities | `claude/hooks/instinct-utils.js` | shared library | Instinct store read/write/prune/TTL management for session-start and session-end hooks. |
| Dangerous patterns config | `claude/hooks/dangerous-patterns.json` | config | 21 extensible patterns with severity (critical/high/medium) for dangerous-command-gate. |
| Secret patterns config | `claude/hooks/secret-patterns.json` | config | 23 regex patterns for secret detection in secret-warning hook. |
| OpenCode safe config | `opencode/opencode.safe.jsonc` | template | Ask-by-default local agent config with no MCP or plugins wired yet. |
| Prompt pack | `opencode/prompts/`, `openclaw/prompts/` | template | Planning, review, security, and build repair prompts. |
| Local installer | `scripts/install-local.sh` | manual | Copies kit files into a local target. |
| Local auditor | `scripts/audit-local.sh` | manual | Flags risky strings for review. |
| Contract migrator | `scripts/migrateV2ToV3.js` | manual | Zero-dep Node tool. Reads v1/v2 contract, sets version=3, recomputes hash, writes to horus.contract.json.draft. Idempotent (v3 input → exit 0). Never overwrites the live file. |
| Migration CI gate | `scripts/check-migrate-v2-v3.sh` | CI | End-to-end migration gate: synthesizes a v2 fixture, runs migrateV2ToV3.js, asserts losslessness + hash correctness + schema validity + idempotency. |
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

## Runtime Autonomy Layer (v3.1.0)

| Module | Path | Purpose |
| --- | --- | --- |
| Runtime entry point | `runtime/index.js` | Re-exports all runtime module functions as a flat namespace. Required by hooks via `require("../../../runtime")`. |
| Decision engine | `runtime/decision-engine.js` | Core `decide(input)` function — scores risk, checks learned policy and auto-allow-once, applies trajectory nudge, returns action/explanation/workflow-route. `HORUS_KILL_SWITCH=1` returns block immediately. |
| Intent classifier | `runtime/intent-classifier.js` | Maps shell commands to 8 intents (explore/build/deploy/modify/configure/cleanup/debug/unknown) using pure pattern matching. Zero I/O, zero deps. |
| Route resolver | `runtime/route-resolver.js` | Maps intents to routing lanes (direct/verification/review) via a static table with per-project override support. |
| Shell bypass detector | `runtime/shell-bypass-detector.js` | Zero-dep regex-based bypass-pattern detector (not a true shell tokenizer; a real AST is a future item). Detects 5 named bypass patterns: base64-pipe-exec, IFS whitespace bypass, eval+dynamic-content, variable-as-command, network process substitution. Sets `isUnresolvable` when command substitution is present but no named pattern fires. Called by `risk-score.js` on every decision. |
| Risk scorer | `runtime/risk-score.js` | Computes 0–10 risk score from command patterns, path sensitivity, payload class, branch, session risk, trust posture, and shell-AST bypass signals. |
| Policy store | `runtime/policy-store.js` | Learned local allows, approval counts, pending suggestions, and auto-allow-once tokens. Persists to `~/.horus/learned-policy.json` (overridable via `HORUS_STATE_DIR`). |
| Session context | `runtime/session-context.js` | Rolling per-session decision history (last 12 entries). Powers `getSessionRisk()` and `getSessionTrajectory()`. Also owns the provenance window (`recordExternalRead`, `getProvenanceWindow`) used by taint.js. State file mode 0600. |
| Provenance correlator | `runtime/provenance-correlator.js` | Low-level overlap detection between a shell command and a list of external-read records. Extracts significant tokens (length ≥ 6, not flag-style) and checks for exact command substring or token-level matches. Returns `{ tainted, reason, source, matchedToken? }`. Zero external dependencies. |
| Taint tracker | `runtime/taint.js` | High-level provenance/taint API. `recordExternalRead(content, source)` annotates tool results from external sources (browser, MCP, web-fetch, curl). `correlateCommand(command)` checks for overlap with the 60-second provenance window. Called by `decision-engine.js` F10 taint floor. |
| Decision journal | `runtime/decision-journal.js` | Append-only JSONL audit log at `~/.horus/decision-journal.jsonl`. Mode 0600. Set `HORUS_DECISION_JOURNAL=0` to disable writes (`ARG_DECISION_JOURNAL=0` is a deprecated alias). |
| Workflow router | `runtime/workflow-router.js` | Maps action → lane/surface/target/command for checks, review, setup, payload, wiring, escalation, and direct paths. |
| Action planner | `runtime/action-planner.js` | Builds structured action plans (commands, review types, modification hints) attached to each decision. |
| Promotion guidance | `runtime/promotion-guidance.js` | Lifecycle-aware guidance (new → approaching → eligible → promoted/dismissed) with concrete CLI hints. |
| Project policy | `runtime/project-policy.js` | Loads per-project `horus.config.json` for trust posture, protected branches, sensitive path patterns, and project scope. |
| Context discovery | `runtime/context-discovery.js` | Auto-detects project root, git branch, primary stack, and config presence from filesystem. |
| `state-paths.js`      | `runtime/state-paths.js`      | Single source of truth for storage paths; honors `HORUS_STATE_DIR` override. |
| `canonical-json.js`   | `runtime/canonical-json.js`   | Deterministic JSON stringify (keys sorted) for contract hashing. |
| `envelope.js`         | `runtime/envelope.js`         | F15 execution-envelope builder/verifier. Captures cwd inode, git HEAD, normalized command AST, env diff, resolved executable path, and tracked target metadata; persists env baselines + pending envelopes under `HORUS_STATE_DIR`. |
| `glob-match.js`       | `runtime/glob-match.js`       | Zero-dep glob matcher (`**`, `*`, `?`, `[abc]`, `!` negation, `${projectRoot}`). |
| `arg-extractor.js`    | `runtime/arg-extractor.js`    | Argv splitter; handles quoted args, escapes, heredocs (fail-closed on `<<HEREDOC`). |
| `decision-key.js`     | `runtime/decision-key.js`     | Builds `fineKey` (5-part) and `legacyKey` (4-part back-compat); classifies commands. |
| `config-validator.js` | `runtime/config-validator.js` | Typed-field walker; validates `horus.config.json` and `horus.contract.json`. |
| `contract.js`         | `runtime/contract.js`         | Contract lifecycle: load, verify, accept, generate, scope-match. v2 helpers: `getValidity(contract)`, `isInActiveWindow(contract, now)`, `getContextTrust(contract, branch)` (B2 Phase 1). v3 helpers: `getMcpPolicy(contract, serverName)`, `getSkillPolicy(contract, skillName)`, `extractMcpServerName(toolName)` (B2 Phase 2, commit 1). `getSessionConstraints(contract)`, `getBudgetLimits(contract)` (B2 Phase 2, commit 2). |
| `session-budget.js`   | `runtime/session-budget.js`   | Per-session destructive-op and external-bytes counters. Atomic tmp+rename writes, mode 0600. State at `~/.horus/session-budget/<session-id>.json`. API: `getCounters`, `recordDestructiveOp`, `recordExternalBytes`, `resetCounters`. |
| `secret-scan.js`      | `runtime/secret-scan.js`      | Cross-harness secret pattern scanner (shared by pre- and post-tool hooks). Exports `scanSecrets()` and `getPatterns()` (returns full 23-pattern set for use by journal redaction). |
| `telemetry.js`        | `runtime/telemetry.js`        | Structured event sink to `telemetry.jsonl`; never blocks. |
| `pretool-gate.js`     | `runtime/pretool-gate.js`     | Single enforcement spine called by all harness adapters; exports `runPreToolGate()`. Builds/report F15 envelopes when the adapter supports it and re-checks critical writes immediately before execution. |

### Stage A–D additions (v0.5 milestone, PRs #34–#54)

| Module | Path | Purpose |
| --- | --- | --- |
| `action-ir.js` | `runtime/action-ir.js` | Canonical Action IR (ADR-007 PR-A). Normalises every adapter's raw payload into one IR shape before floors run. Exports `build()`, `validate()`, `irHash()`, `EMPTY_IR`. Frozen, zero-dep. |
| `decision-lattice.js` | `runtime/decision-lattice.js` | Explicit decision lattice table (ADR-007 PR-A). Single source of truth for floor rung, action, demotability, and source tag. Strictly-increasing rungs, unique ids, frozen at module load; `scripts/check-lattice-ordering.sh` enforces invariants in CI. |
| `command-normalize.js` | `runtime/command-normalize.js` | Shared command-shape canonicaliser used by `action-ir.js` and IR-consuming floors so adapters cannot drift on whitespace/quoting/separators. |
| `ambient.js` | `runtime/ambient.js` | F16 ambient-authority floor (ADR-009). Path classifier + `scopes.ambient.allow` opt-in gate. Receipts gain `ambientClass` on every ambient-touch decision. Unicode + path-traversal bypasses closed via adversarial corpus. |
| `cross-agent-lock.js` | `runtime/cross-agent-lock.js` | F17 cross-agent-lock floor (PR-A). Per-action mutual-exclusion lock; prevents two harnesses driving the same destructive action concurrently. |
| `output-exfil.js` | `runtime/output-exfil.js` | F19 output-channel exfiltration guard (ADR-010). Inspects outbound channels for taint-class payloads and blocks/escalates per lattice rung. |
| `change-intent.js` | `runtime/change-intent.js` | F20 change-intent diffing (ADR-012). Detects drift between the declared envelope and the resolved IR; floors fire when the realised action diverges from what the contract pre-agreed. |
| `network-egress.js` | `runtime/network-egress.js` | Plaintext-network default-deny (`network.allowPlaintext` opt-out). Default-deny `http://` outbound; allowlist via contract. |
| `degraded-mode.js` | `runtime/degraded-mode.js` | ADR-004 degraded-mode enforcement. Detects state-store / chain / lock-floor health degradation; emits `degraded-mode` receipts and triggers `degraded-mode-entered` notification. |
| `journal-chain.js` | `runtime/journal-chain.js` | ADR-004 tamper-evident hash-chained decision journal. Each entry chains to the prior hash; `scripts/verify-decision-journal.sh` CLI verifies the chain. |
| `snapshot.js` | `runtime/snapshot.js` | ADR-013 auto-snapshot before destructive ops. Captures pre-action state under `~/.horus/snapshots/`; receipts carry the snapshot ref. |
| `state-bundle.js` | `runtime/state-bundle.js` | ADR-011 state portability — export/import bundle for `~/.horus/` (learned-policy, journal, instincts, snapshots). Used by `scripts/horus-cli.sh state export|import`. |
| `receipt-export.js` | `runtime/receipt-export.js` | ADR-014 audit-grade receipts exporter. Canonical receipt JSON with stable field order, `irHash`, `rung`, `latticeVersion`, floor source. |
| `receipt-validator.js` | `runtime/receipt-validator.js` | ADR-014 receipt validator. Schema-validates exported receipts; powers `scripts/check-receipt-schema.sh`. |
| `notify.js` | `runtime/notify.js` | ADR-015 notification router. Fire-and-forget hook called by `decision-engine.js` AFTER receipt + journal append, NEVER awaited. Allowlist-only PII scrubber (`scrubForNotify`). Four trigger kinds: `approval-request`, `kill-switch-fire`, `degraded-mode-entered`, `adversarial-bypass-detected`. Receipts gain additive `notifyAttempted: true` only when the hook fires. |
| `notify/discord.js` | `runtime/notify/discord.js` | Discord webhook transport (pure `node:https`, no `axios`, no third-party HTTP). 5s timeout, exponential backoff `[200, 1000, 5000]` ms, max 3 retries, 4xx no-retry. |
| `notify/slack.js` | `runtime/notify/slack.js` | Slack webhook transport, same constraints as Discord transport. |
| `notify/email.js` | `runtime/notify/email.js` | SMTP transport (pure `node:net` / `node:tls`, no `nodemailer`). Credentials via env only: `HORUS_SMTP_HOST/PORT/USER/PASS/FROM`. |
| `post-adapter-factory.js` | `runtime/post-adapter-factory.js` | Shared factory used by all six harness adapters' `hooks/post-adapter.js`. Calls `scanSecrets()` and `recordExternalRead()`; consumes any reported F15 envelopes. Keeps the six adapter files near-identical. |

All runtime modules write only to `HORUS_STATE_DIR` (or `~/.horus/`). No network access from the decision path. The notification transports under `runtime/notify/` are the only outbound surface; they are fire-and-forget, never awaited by the engine, and gated by `notifications.enabled === true` in the contract.

## PostToolUse Adapters (A3 — cross-harness parity)

Each harness has a PostToolUse hook that: (1) scans tool output for secrets via `runtime/secret-scan.js`, (2) records external-source outputs into the provenance window via `runtime/taint.js` so the F10 taint floor can detect injected commands.

| Harness | Path | Notes |
|---------|------|-------|
| Claude | `claude/hooks/output-sanitizer.js` | Canonical implementation (A3 taint recording + F15 envelope post-run verification) |
| OpenCode | `opencode/hooks/post-adapter.js` | Claude Code fork — same PostToolUse hook format; F15 manifest stub currently reports `envelopeReporting: false` |
| OpenClaw | `openclaw/hooks/post-adapter.js` | Claude Code-compatible shape; F15 manifest stub currently reports `envelopeReporting: false` |
| Codex | `codex/hooks/post-adapter.js` | Best-effort — API unverified; F15 manifest stub currently reports `envelopeReporting: false` |
| Clawcode | `clawcode/hooks/post-adapter.js` | Best-effort — API unverified; F15 manifest stub currently reports `envelopeReporting: false` |
| Antegravity | `antegravity/hooks/post-adapter.js` | Best-effort — API unverified; F15 manifest stub currently reports `envelopeReporting: false` |

`scripts/check-post-adapter-parity.sh` CI gate enforces that all 6 files require both secret-scan and taint modules and call both `scanSecrets()` and `recordExternalRead()`.

## Upstream Adoption Model

Use upstream as a reviewed feature feed, not as the trusted runtime base. Review `references/capability-log.md` and `references/parity-matrix.json` before adopting changes.

## Adding A Module

Add new modules as separate files or folders. Document each module's trust level, data flow, and approval trigger. If a module can call the network, run a package manager, write outside the project, or alter permissions, label it in `risk-register.md`, document the enable path, and tie it to the standing approval policy.
