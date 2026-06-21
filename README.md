# Lilara

> **Canonical sources at this repo root:** [`VISION.md`](VISION.md) · [`MISSION.md`](MISSION.md) · [`RED-LINES.md`](RED-LINES.md) · [`CONTRACT.md`](CONTRACT.md) · [`MEMORY.md`](MEMORY.md) · [`SOUL.md`](SOUL.md). **Scope + plan:** [`references/SCOPE.md`](references/SCOPE.md) · [`references/PLAN.md`](references/PLAN.md). **Owner refinement 2026-06-16 (the block model):** see [`CONTRACT.md`](CONTRACT.md) §2 and [`references/SCOPE.md`](references/SCOPE.md) §25.5.

**Lilara / ليلارا** — after the founder's daughters **Lily + Lara** — is a local-first, zero-dependency Node.js
runtime security guard for AI coding agents, growing into a trustworthy bounded-autonomy platform. The guard enforces
the upfront-contract model (consent-first, not per-action); the long arc is broader — an intelligent, safety-bounded
operating layer that decides which agent capabilities should run, when, and how.

People install powerful agent repos, skills, and tools **blindly** — running unknown code with broad authority and no
idea what leaves their machine. Lilara collects those capabilities, **redesigns and rewrites them clean-room**, and
delivers them safe by construction: **full power AND safety, never a trade-off.**

The goal is **more capability with less silent risk**:

- **A graded block ladder** — **Level 1** ordinary work proceeds; **Level 2** resolvable block (unapproved delete /
  ordinary egress — hold that action, warn, continue the rest); **Level 3** mandatory explicit manual approval
  (secret / credential egress — never silent, never absolute; remembered per-destination); **Level 4** absolute block
  (harm-to-a-person only — the only absolute, user-independent red line).
- **The consent contract** — gather permissions up front, work within them. Re-prompting inside a granted scope is a
  defect.
- **Safety floors that cannot be demoted** — kill-switch, critical risk, scope violation, secret payload class C,
  protected-branch writes, session-risk escalation, F15 execution-envelope divergence.
- **Context-aware decisions** — branch, project shape, session trajectory, payload class, and approval history all
  shape the next routing choice.
- **Workflow-shaped actions** — `require-review`, `require-tests`, `modify`, `escalate` come with concrete next
  steps, not just allow/deny.
- **A unified amplification surface** — specialist agents, language and domain rules, and high-leverage skills, all
  built around the Lilara philosophy.
- **One engine across harnesses** — runs on Claude Code, OpenCode, OpenClaw, Codex, Claw Code, and Antegravity
  through a single decision spine; adapters in flight for additional harnesses.
- **Execution-envelope verification for critical writes** — Claude now reports a stable F15 envelope (cwd inode, git
  HEAD, normalized command AST, env diff, resolved executable path, tracked target metadata), and the core re-checks
  sensitive writes immediately before execution.

**Power dimensions on the roadmap (now scoped as first-class — owner decision 2026-06-16):** Smart Memory / Memory
Souls (L2 — long-term memory for what matters; less-important things become smart tags; token-efficient — **reduces**
tokens, never inflates); Breath (L5 — always-on proactive heartbeat that watches dispatched tasks and keeps the goal
moving); Self-improvement (L3 — built last, can never weaken the guard's red lines); Skill orchestration (L4 — cheap
deterministic auto-select / multi-skill merge-compose / auto-create skill/agent). See [`MEMORY.md`](MEMORY.md) and
[`references/PLAN.md`](references/PLAN.md).

Every decision is journaled locally. Decision state and learned policy stay on the machine by default; any external
capability remains explicit, reviewed, and policy-bound.

**Status, honestly.** Lilara is being built toward the full scope. The L1 runtime decision spine, amplification
surface, and cross-harness integration are active and verified. The graded block ladder and the F27 reclassification
are encoded in the docs (`CONTRACT.md` §2, `SECURITY_MODEL.md`) and are the **default posture target**; encoding the
ladder into the runtime default is the Phase-3 build work in `references/PLAN.md` — until that lands, F27 continues
to fire on the existing mechanism (raise to `payloadClass=C` → hard floor) but the canonical target is the L3 model
above (mandatory manual approval, never silent, never absolute, remembered per-destination). A post-ship audit
(v2.1.1) closed the contract acceptance path and verification script gaps. Remaining work is forward-looking hardening
and expansion — see [`CHANGELOG.md`](CHANGELOG.md) and [`references/PLAN.md`](references/PLAN.md).

See [`references/SCOPE.md`](references/SCOPE.md) for the full layer map and floor inventory. See
[`CONTRACT.md`](CONTRACT.md) for the consent contract and block model. See [`references/PLAN.md`](references/PLAN.md)
for the phased build plan.

## Operating Policy (per the block model — [`CONTRACT.md`](CONTRACT.md) §2)

- **Proceed automatically** for ordinary in-contract work (Level 1): reading files, in-repo edits, running scripts to
  verify findings.
- **Resolvable block** (Level 2): unapproved delete or ordinary egress to an unapproved destination — hold *that
  action*, warn, **continue the rest of the task**, run + remember once approved.
- **Mandatory explicit manual approval** (Level 3): secret / credential egress — stop, name the destination, ask
  every new destination; never silent, never absolute; remembered per-destination on approval.
- **Absolute block** (Level 4): harming a person — refused outright, never asked, never lifted even with user
  approval. The only absolute, user-independent red line. See [`RED-LINES.md`](RED-LINES.md).

## Safe Defaults

- No unreviewed remote code execution.
- No `npx -y` or equivalent auto-download execution.
- No silent permission auto-approval.
- Hooks only read stdin, inspect local text, print warnings, and echo the original JSON unchanged.
- Install script copies files only into a project-local target unless you explicitly pass another path.
- External capability must be documented before it is enabled.

## Quick Start

```bash
# 1. One-command install — copies hooks, runtime enforcement engine, schemas, and
#    language rules into ./my-project; prints the wire-hooks snippet:
./scripts/lilara-cli.sh install ./my-project --profile rules --auto

# 2. Upgrade an existing installation in-place (preserves lilara.config.json):
./scripts/lilara-cli.sh upgrade ./my-project

# 3. Interactive setup wizard — answers 5 questions then gives you the command to run:
./scripts/lilara-cli.sh setup

# 4. Wire hooks into your Claude Code settings.json:
./scripts/lilara-cli.sh wire ./my-project

# 5. Run a local audit of this repository:
./scripts/lilara-cli.sh audit

# 6. Run runtime and structural checks, including install and apply-status verification:
./scripts/lilara-cli.sh check

# 7. Run all 406 fixture-based tests:
./scripts/lilara-cli.sh fixtures

# 8. Measure decision quality (FP/FN rates against the labeled corpus):
./scripts/lilara-cli.sh eval

# Verify installed enforcement end-to-end (F27 ssh-exfil + F3 rm-rf must block):
./scripts/check-install-smoke.sh
```

## What Is Included

**Version:** see `VERSION` file. **Changelog:** see `CHANGELOG.md`.

### Hooks (`claude/hooks/`)

13 Node.js hook files + shared utilities + pattern configs. All hooks: read stdin JSON, warn to stderr, echo stdin unchanged (or exit 2 to block in LILARA_ENFORCE=1 mode).

| Hook | Event | Purpose |
|------|-------|---------|
| `secret-warning.js` | PreToolUse | Scans prompt for 26 secret patterns (API keys, tokens, JWTs, etc.) |
| `dangerous-command-gate.js` | PreToolUse Bash | Blocks/warns on 23 patterns: rm -rf, find -delete, force-push, curl\|sh, DROP TABLE, prompt injection, etc. Claude also reports F15 execution envelopes from this hook path. |
| `build-reminder.js` | PreToolUse Bash | Reminds to review build/test output before continuing |
| `git-push-reminder.js` | PreToolUse Bash | Reminds before push; blocks force-push in enforce mode |
| `quality-gate.js` | PostToolUse Edit/Write | Suggests linter/test commands after file edits |
| `output-sanitizer.js` | PostToolUse | Scans tool output for secrets; warns if a credential was echoed by the tool; Claude also consumes F15 execution-envelope reports for post-run divergence journaling |
| `session-start.js` | SessionStart | Loads instinct store, shows pending review count |
| `session-end.js` | Stop | Captures session metadata to instinct store |
| `strategic-compact.js` | PostToolUse | Suggests /compact when context may be filling |
| `memory-load.js` | SessionStart | Loads project memory context |
| `pr-notifier.js` | PostToolUse | Notifies after PR-related actions |
| `hook-utils.js` | (shared library) | readStdin (5MB cap), commandFrom, hookLog, rateLimitCheck, classifyCommandPayload, classifyPathSensitivity, readSessionRisk |
| `instinct-utils.js` | (shared library) | Instinct store read/write/prune/TTL management |

Set `LILARA_ENFORCE=1` to activate block mode (exit 2) for secret-warning, dangerous-command-gate, and git-push-reminder.
Set `LILARA_HOOK_LOG=1` to log all detection events to `~/.lilara/hook-events.log`.
Set `LILARA_KILL_SWITCH=1` to immediately block all `runtime.decide()` calls regardless of risk score — emergency override for unsafe sessions.

### Agents (`agents/`) — 64 agents

Specialist reviewers, planners, and resolvers: security-reviewer, pr-reviewer, test-generator, architect, code-reviewer, tdd-guide, python/rust/go/kotlin/java/cpp/csharp/swift/typescript/flutter/dart reviewers, build-error-resolvers, performance-optimizer, a11y-architect, docker-reviewer, kubernetes-auditor, ci-pipeline-reviewer, infrastructure-auditor, dependency-auditor, and more. Every agent follows the ARG amplification philosophy: clear Mission, ARG-aware Activation, numbered Protocol, and measurable Done When criteria. See `agents/ROUTING.md` for quick-reference dispatch guide.

### Rules (`rules/`) — 107 rule files

Security, coding-style, patterns, testing, hooks, and performance rules across 12 language directories (Python, TypeScript, Go, Rust, Java, C++, Kotlin, C#, Dart, Swift, Perl, PHP) plus common, database, infrastructure, and web domains. Every rule file is original content written for the ARG amplification philosophy.

### Skills (`skills/`) — 57 skills

High-leverage workflow entry points: ARG runtime debug, policy tuning, learning review, capability audit, deep code analysis, intelligence amplification, autonomous improvement, multi-agent debug, semantic refactor, test intelligence, deployment safety, context maximizer, orchestration design, workflow acceleration, pattern extraction, plus domain-specific skills for git workflows, multi-agent orchestration, and infrastructure patterns.

### Scripts (`scripts/`) — 107 files

| Script | Purpose |
|--------|---------|
| `lilara-cli.sh` | Unified CLI entry point — all subcommands in one place |
| `install.sh` | One-command install: validates prereqs, copies files, prints wire-hooks snippet |
| `upgrade.sh` | In-place upgrade preserving `lilara.config.json` and state files |
| `setup-wizard.sh` | Interactive 5-question onboarding → install command + lilara.config.json |
| `install-local.sh` | Low-level file copy (profiles: minimal/rules/agents/skills/full) |
| `wire-hooks.sh` | Generate settings.json hook wiring snippet |
| `audit-local.sh` | Grep-based risk scanner for scripts and hooks |
| `audit-examples.sh` | Scan prose and GOOD code blocks for dangerous patterns |
| `verify-hooks-integrity.sh` | SHA-256 baseline check for all hook files |
| `run-fixtures.sh` | Fixture-based automated test runner (count managed by `check-fixture-count.sh`) |
| `eval-decision-quality.sh` | Measure `runtime.decide()` FP/FN rates against a labeled corpus; exits 1 if thresholds exceeded |
| `check-evals.sh` | Optional CI gate: run all `evals/*.eval.js` and assert exit 0; skip via `LILARA_SKIP_EVAL=1` |
| `check-skills.sh` | Validate skill file structure |
| `check-installation.sh` | Verify install profiles, config generation, and hook wiring |
| `check-inviolable-tier-unreachability.sh` | P3.1 / §19 #6 standing gate: (a) `canDemote(inviolable, *) === false` for every demotion source the engine uses; (b) monotonic — any change to `runtime/decision-lattice.js` or `runtime/floor-codes.js` in a commit range must be accompanied by an `artifacts/lattice-baseline.sha256` rebaseline AND a `[LATTICE-BASELINE-REBASELINE]` marker in `CHANGELOG.md` (so the rebaseline is reviewable, not silent) |
| `check-replay-posture-matrix.sh` | P3.3 / §19 #14 posture-matrix replay: replays the shipped replay corpus under all 8 combinations of `LILARA_TAINT_EGRESS` × `LILARA_DELETE_COORD` × `LILARA_KILL_CHAIN_ENFORCE`. **Two-faced gate**: the canonical baseline (all flags off) MUST be zero-drift (hard-fails on drift, exit 1); the other 7 combinations report their posture surface (drift is the F29 floor engaging, not a regression) and exit 0. Catches future default flips and non-deterministic posture reads in the canonical baseline before they can silently break byte-identical replay. Per-posture canonicalization is `NEEDS-APPROVAL` future work, not bundled. |
| `check-config-integration.sh` | Verify `generate-config`, `install-local`, and `wire-hooks --check` integration paths |
| `check-runtime-core.sh` | Verify the runtime decision core, learned policy, adaptive action plans, workflow routing guidance plus concrete tool targets for checks/review/setup/payload/wiring, source-file routing under balanced/strict trust postures, tool-aware wiring routing, payload-class-aware routing, session context, project-aware decisioning scaffold, and F15 envelope stability/divergence handling |
| `check-runtime-cli.sh` | Verify runtime local state display, suggestion accept/promote/dismiss flows, workflow routing guidance, concrete tool targets, and adaptive explain output |
| `runtime-state.js` | Inspect runtime learned policy, pending suggestions, reviewed-default lifecycle timing and compact lifecycle summaries, plus decision explanations, workflow routing guidance, and adaptive action plans locally |
| `check-hook-edge-cases.sh` | Verify hook behavior on empty stdin, large payloads, config edge cases, and multi-line dangerous commands |
| `check-apply-status.sh` | Verify apply-status counts, per-tool wiring evidence, and generator sync |
| `generate-apply-status.sh` | Regenerate `references/per-tool-apply-status.md` from parity counts and tool-state template |
| `check-executables.sh` | Verify core source-tree scripts are executable |
| `check-setup-wizard.sh` | Verify wizard output for Claude/OpenCode/OpenClaw flows and edge cases |
| `check-wiring-docs.sh` | Verify per-tool wiring plans, policy maps, and apply checklists exist |
| `check-superiority-evidence.sh` | Verify that measurable superiority claims are documented with concrete evidence and generator sync |
| `generate-superiority-evidence.sh` | Regenerate `references/superiority-evidence.md` with quantified superiority metrics |
| `generate-parity-report.sh` | Regenerate `references/parity-report.md` from `references/parity-matrix.json` |
| `generate-status-artifact.sh` | Generate a unified status artifact plus metadata from `status-summary.sh` |
| `check-status-docs.sh` | Verify `parity-report.md` sync and guard key counts inside `full-power-status.md` |
| `check-status-artifact.sh` | Verify status artifact generation and metadata integrity |
| `check-harness-support.sh` | Verify harness support matrix, stub directories, wizard rejection paths, and apply-status planned entries |
| `check-opencode-adapter.sh` | Verify OpenCode adapter.js syntax, safe pass-through, warn mode, enforce/block mode, and args.command field extraction |
| `check-openclaw-adapter.sh` | Verify OpenClaw adapter.js syntax, safe pass-through, warn mode, enforce/block mode, and OpenClaw cmd field extraction |
| `check-clawcode-adapter.sh` | Verify Claw Code adapter.js syntax, all 6 command-field fallback shapes (command/cmd/tool_input/input/args/params), enforce mode, kill-switch, and silent-fail contract |
| `check-owasp-coverage.sh` | Verify OWASP Agentic Top 10 (2026) coverage matrix — every ASI row names a specific file or `NOT COVERED` |
| `bench-runtime-decision.sh` | Latency benchmark — 1000 `runtime.decide()` calls, prints p50/p95/p99; platform-aware ceiling (500ms Windows, 10ms Linux CI) |
| `classify-payload.sh` | A/B/C payload sensitivity classification |
| `classify-changes.sh` | Categorize changes in a diff into risk classes |
| `redact-payload.sh` | Redact secrets/PII from payloads before external send |
| `review-payload.sh` | Pre-send payload review helper |
| `status-summary.sh` | Repo health summary |
| `upstream-diff.sh` | Compare local tree against upstream source path |
| `detect-sensitive-data.sh` | Scan for common secrets/PII in files or stdin |
| `policy-lint.sh` | Verify rule files follow Agent Runtime Guard standards |
| `audit-staleness.sh` | Flag rule files with stale last_reviewed dates |
| `generate-config.sh` | Probe project and generate starter lilara.config.json |
| `check-registries.sh` | Verify capability pack registry files |
| `check-scenarios.sh` | Verify approval and injection scenario files |
| `check-integration-smoke.sh` | Verify integration smoke cases |
| `check-version.sh` | Verify version and changelog alignment |
| `import-report.sh` | Generate import report from log and checklist |
| `smoke-test.sh` | Fast integration smoke test |
| `test-payload-protection.sh` | Verify redaction and classification on test payloads |
| `check-zero-deps.sh` | Assert runtime/*.js has no third-party require() calls |
| `check-counts.sh` | Assert agent/rule/skill/hook/fixture/script counts match documented values |
| `check-decision-replay.sh` | CI gate: replay the shipped sample journal through the current decision engine; exit 1 on any action divergence |
| `migrateV1ToV2.js` | Upgrade an lilara.contract.json from schema version 1 to version 2 (bumps revision, recomputes hash, validates result) |
| `check-migrate-v1-v2.sh` | Verify the v1→v2 migration: version bumps, revision increments, hash recomputes, schema validates, idempotency |

The SHA-256 hook integrity baseline lives at `artifacts/hooks-baseline.sha256` (data artifact, not a script) and is consumed by `verify-hooks-integrity.sh`.

### Documentation

- `references/capability-log.md` — capability growth log: what was added, when, and what it enables
- `references/owasp-agentic-coverage.md` — OWASP Agentic Top 10 (2026) coverage matrix with file-level verdicts
- `references/runtime-autonomy-roadmap.md` — next-cycle roadmap for autonomous decisioning and bounded self-operation
- `scripts/runtime-state.js` — inspect runtime learned policy, pending suggestions, reviewed-default lifecycle timing and compact lifecycle summaries, record approvals, and explain project-aware decisions plus action plans locally
- `SECURITY_MODEL.md` — trust boundaries, hook contract, known limitations
- `DECISIONS.md` — design decisions and rationale
- `MODULES.md` — module registry and capability policy
- `risk-register.md` — risk inventory with current mitigations
- `audit-notes.md` — construction notes on what was intentionally excluded
- `CHANGELOG.md` — full version history
- `references/` — 15 policy, coverage, and capability reference documents, including the canonical
  `references/SCOPE.md` (layer map + floor inventory) and `references/PLAN.md` (phased build plan). `ROADMAP.md` at the
  repo root was archived by owner decision (2026-06-12) — its source of truth moved to `references/SCOPE.md` and
  `references/PLAN.md`.
- `lilara.config.json.example` — per-project configuration template, including runtime trust posture, protected branches, and sensitive path patterns

## Canonical source-of-truth files (this repo root)

These mirror the handover package at `/root/lilara-handover/`. They are the canonical sources for what Lilara is, what
it allows, what it refuses, and how it grows:

| File | What it is |
|---|---|
| [`VISION.md`](VISION.md) | What Lilara is (founder's own words; Level 1 canonical). |
| [`MISSION.md`](MISSION.md) | Why Lilara exists (co-equal productivity and security). |
| [`RED-LINES.md`](RED-LINES.md) | The red lines + the consent-based security model (one absolute line; everything else resolvable). |
| [`CONTRACT.md`](CONTRACT.md) | The consent contract and the **graded block ladder** (L1/L2/L3/L4 — owner refinement 2026-06-16). |
| [`MEMORY.md`](MEMORY.md) | Smart Memory + Breath (first-class; owner elevation 2026-06-16). |
| [`SOUL.md`](SOUL.md) | Persona / identity. |

## Optional Risky Extensions

External modules such as remote MCP servers, documentation fetchers, GitHub apps, package-manager installers, notification integrations, and browser automation can be useful. They are intentionally not enabled here.

If you add them, document the module, make it opt-in, state what data may leave the machine, and require an explicit manual step.

## Harness Support Matrix

| Harness | Status | Directory | Setup Wizard | Wiring Doc |
|---|---|---|---|---|
| Claude Code | Supported | `claude/` | `--tool claude` | `claude/WIRING_PLAN.md` |
| OpenCode | Supported | `opencode/` | `--tool opencode` | `opencode/WIRING_PLAN.md` |
| OpenClaw | Supported | `openclaw/` | `--tool openclaw` | `openclaw/WIRING_PLAN.md` |
| Codex | Supported (verified 2026-05-24) | `codex/` | `--tool codex` | `codex/WIRING_PLAN.md` |
| Claw Code | Supported (verified 2026-05-23) | `clawcode/` | `--tool clawcode` | `clawcode/WIRING_PLAN.md` |
| antegravity | Supported (verified 2026-05-24) | `antegravity/` | `--tool antegravity` | `antegravity/WIRING_PLAN.md` |
| **Hermes Agent** | **Supported (clean-room, MIT, 2026-06-17)** | `hermes/` | `--tool hermes` | `hermes/WIRING_PLAN.md` |

All seven harnesses are now verified or supported. See each harness's `WIRING_PLAN.md` for the verified protocol and
integration instructions. **Note: Hermes uses a handler-wrap integration model (NOT a PreToolUse hook) — the Lilara
wrapper sits between Hermes's tool dispatcher and the handler.** See `hermes/WIRING_PLAN.md` for the model and
`references/hermes-license-check.md` for the clean-room / license attestation.

## Compatibility

The files are plain Markdown, JSONC, JavaScript, and shell. The hook scripts require Node.js only because Claude/OpenCode hook ecosystems commonly invoke JavaScript hooks. No npm package is required.
