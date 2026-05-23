# Agent Runtime Guard Autonomy Roadmap

Last updated: 2026-04-23

This roadmap starts the next improvement cycle after parity-to-superiority closeout.

## Mission

Turn Agent Runtime Guard from a verified runtime kit into an adaptive runtime layer that can choose the right action automatically with one-time setup or minimal human intervention, while preserving safety and auditability.

> Long-term framing and three-horizon summary: see [ROADMAP.md — Executive Summary](../ROADMAP.md).

## Design Principles

1. Local-first learning, no hidden cloud dependency
2. Bounded autonomy, not blind autonomy
3. Every repeated approval should become a rule candidate
4. Verification must cover behavior, not only structure
5. High-risk actions stay explicitly human-gated

## Target Operating Model

### Autonomous zone
- lint, test, formatting, safe local edits
- safe repeated approvals in known contexts
- status/doc regeneration and sync
- low-risk routing between skills, agents, and checks

### Assisted zone
- medium-risk file changes
- routing with moderate uncertainty
- payload handling after learned policy
- branch-aware git actions outside protected branches

### Human-gated zone
- destructive production actions
- force pushes and protected-branch mutations
- outbound sensitive payloads
- privilege escalation
- trust-expanding remote execution

## Build Order

### Phase 1, Runtime decision foundation
- `runtime/risk-score.js`
- `runtime/decision-engine.js`
- `runtime/decision-journal.js`
- first runtime-core verification check

Acceptance:
- a unified action contract exists: `allow`, `modify`, `route`, `escalate`, `block`
- decisions can be recorded locally with metadata
- a baseline risk score exists for commands and payloads

### Phase 2, Learned policy and session context
- learned allowlists in project config or local runtime state
- rolling session context window
- repeated-approval promotion flow
- confidence-aware escalation thresholds

Current status:
- initial local learned-policy scaffold added
- repeated approvals now generate pending learned-policy suggestions
- initial rolling session-risk scaffold added
- first hook integration started in `claude/hooks/dangerous-command-gate.js`
- local state can now be inspected and suggestions can be accepted, promoted, or dismissed through `lilara-cli.sh runtime ...`
- explicit approval recording and decision explanation flows now exist through `lilara-cli.sh runtime record-approval ...` and `lilara-cli.sh runtime explain ...`
- per-project runtime config is now wired into decisions through `lilara.config.json` runtime settings
- project root and git branch can now be auto-discovered locally for decision context
- bounded workflow actions now include `require-review`, `require-tests`, and `modify`
- workflow actions now carry action plans so hooks and CLI surfaces can suggest concrete next steps
- action plans now adapt using local repetition/approval history to suggest when a workflow should become a reviewed local default
- lifecycle-aware promotion guidance now tracks `new`, `approaching`, `eligible`, `promoted`, `dismissed`, and `ineligible`
- runtime state and explain output now surface reviewed-default lifecycle timing (`created-at`, `eligible-at`, accepted/dismissed, `last-approved-at`) plus compact lifecycle summaries for audits

### Sprint R2, Policy lifecycle auditability

Current status: complete

Delivered in this sprint:
- adaptive action plans based on approval/suggestion history
- explicit promotion guidance with lifecycle stages and CLI hints
- dedicated `runtime promote` flow for reviewed local defaults
- promoted-default state visibility and timestamped audit metadata
- dismissed-default tracking with lifecycle metadata
- compact lifecycle summaries in `runtime explain`
- lifecycle timing in runtime state and explain output (`created-at`, `eligible-at`, accepted/dismissed, `last-approved-at`)
- status/roadmap/decision docs aligned to the real post-`v0.8.0` runtime sprint

Outcome:
- repeated safe patterns are now auditable across pending, promoted, and dismissed states
- operators can inspect both raw lifecycle timestamps and compact per-decision summaries
- Sprint R2 closes with clean verification and truthful status/docs

### Sprint R3, Routing and workflow fidelity — CLOSED

Sprint R3 opener delivered:
- `payloadClass` now flows through the hook path: `classifyCommandPayload()` computes it in-process from the command string and passes it to `runtime.decide()` in `dangerous-command-gate.js`
- `sessionRisk` is now explicitly read and passed to `runtime.decide()` from the hook via `readSessionRisk()` in `hook-utils.js`; hook output surfaces non-zero session risk so operators can see it
- `escalate` action now has a dedicated workflow lane in `workflow-router.js`: lane=`escalation`, surface=`security-reviewer`, target=`human-gate` — this is human-gated and not auto-allowed
- `dangerous-command-gate.js` now prints workflow route lane for all non-direct routes, and prints a clear ESCALATION ROUTE marker when the action is `escalate`
- `check-runtime-core.sh` extended with three new cases: escalate lane routes correctly, payloadClass C routes to review, sessionRisk bump is reflected in explanation

Sprint R3 completion delivered:
- one-time opt-in auto-allow (`auto_allow_once` counter in `policy-store.js`): once a pattern reaches eligible stage (pending suggestion), operator may grant a single-use bypass via `lilara-cli.sh runtime auto-allow-once '<key>'`; the token is consumed by `runtime.decide()` and emits `auto-allow-once=consumed` in explanation; only eligible-stage (pending) policies may receive a grant
- session-trajectory-driven routing (`getSessionTrajectory()` in `session-context.js`): when `recentEscalations >= LILARA_TRAJECTORY_THRESHOLD` (default 3) within `LILARA_TRAJECTORY_WINDOW_MIN` (default 30 min), `runtime.decide()` nudges the action up one step (allow→route, route→require-review, require-review→escalate) and sets `source=trajectory-nudge`; learned-allow and auto-allow-once sources are exempt; nudge is surfaced in explanation and `trajectoryNudge` result field

Acceptance:
- repeated approvals can become one-time opt-in auto-allows — DONE
- session history can influence the next decision trajectory, not only the current decision score — DONE

### Phase 3, Autonomous routing
- route task intent to skills, agents, checks, and tool targets
- unify runtime suggestions and project config
- auto-detect project shape with one-time confirmation

Acceptance:
- common tasks can be routed without manual selection of the workflow pieces
- setup is mostly auto-detected, wizard becomes fallback

### Phase 4, Self-maintaining system
- upstream drift detection
- unified status artifact generation
- scheduled verification and staleness checks
- policy suggestion engine from decision journal data

Acceptance:
- the project can detect upstream changes and local drift automatically
- policy improvements can be suggested from observed behavior

### Phase 5, Behavioral proof
- real integration harness for hook/runtime decisions
- autonomy metrics
- false-positive / false-block reporting
- canary mode for progressive rollout

Acceptance:
- superiority is measured with outcome metrics, not only file/process metrics

## First Execution Sprint

### Sprint A, Decision core
Ship these first:
1. runtime risk scoring
2. runtime decision engine
3. structured local decision journal
4. runtime-core checks in `lilara-cli.sh check`

This sprint does not aim to complete autonomy. It lays the decision substrate that later automation will rely on.
