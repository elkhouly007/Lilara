> **Status:** Superseded by `ENHANCEMENT_PLAN.md`. Retained for history.

# Amplification Plan — Agent Runtime Guard

Author: Misk (workspace assistant)
Owner: Khouly
Drafted: 2026-05-07
Target: hand off to Claude Code for staged implementation
Status: PLAN ONLY — no code changes have been made

---

## 0. Framing

The user ask: make agentic coding tools (Claude Code, OpenCode, OpenClaw, Codex, Clawcode, Antegravity) more powerful while staying secure.

ARG today does an excellent job at the security half: hard floors, contract verification, learned-allow narrowed to destructive-delete, cross-harness secret-scan parity, OWASP Agentic Top 10 coverage matrix. The amplification half is partial — agents still lose flow at borderline calls, three harnesses are stubs, and there is no upfront capability negotiation between agent and runtime.

This plan closes documented gaps and adds amplification surface in the same waves. Every item is engineered to either reduce silent risk or remove unnecessary friction. Items that buy power at the cost of safety are explicitly rejected (Section 9).

The plan does not change ECC's foundational invariants. Hard floors remain non-demotable. Local-first stays. Zero-dependency runtime stays. The decision precedence ladder is extended, not rewritten.

---

## 1. Operating Principles (do not break)

- Hard floors stay engine-baked. No new capability may demote a floor (steps 1-9 of the precedence matrix).
- `runtime/*.js` stays zero-dependency (Node builtins only). CI gate `check-zero-deps.sh` is authoritative.
- All learned and pre-validated state stays under `HORUS_STATE_DIR` (default `~/.horus`). No outbound telemetry by default.
- Existing `horus.contract.json` v1 and v2 files must continue to validate and verify after every change. Schema additions are additive only.
- Every new decision path must journal with `floorFired`, `source`, and `reason` fields populated.
- Decision p99 budget: < 10 ms on Linux CI, < 500 ms on Windows/WSL slow-fs. New work must respect the existing `bench-runtime-decision.sh` ceiling.
- Every new module ships with: fixtures, a `check-*.sh` script, an entry in `MODULES.md`, and OWASP coverage row update where applicable.
- Three-mode behavior is preserved everywhere: warn (default), enforce (`HORUS_ENFORCE=1`), kill (`HORUS_KILL_SWITCH=1`).
- Backwards compat: contracts, journal entries, and policy-store records written by older versions must remain readable. Migrations bump revisions, never delete.

---

## 2. Strengths Audit (one-paragraph baseline)

ARG v3.0 has a single enforcement spine (`pretool-gate.js`), a 15-rung precedence ladder with non-demotable floors, contract acceptance + hash verification, fineKey-scoped learned-allow, session trajectory nudge, JSONL audit trail, kill switch, cross-harness PreToolUse secret-scan parity, Claude PostToolUse output sanitizer, intent classifier (8 intents), route resolver, action planner, promotion lifecycle (6 stages), per-project `horus.config.json`, schema v2 (validity windows / contextTrust / per-tool scopes), 216 fixture-based tests, OWASP Agentic Top 10 (2026) coverage matrix, and decision-replay CI. Brand and state migration to `HORUS_*` / `~/.horus` is complete.

This is a strong base. The remaining work is amplification + closing two documented bypass classes + completing harness parity.

---

## 3. Documented Gaps (verbatim from the project)

These are stated honestly in `SECURITY_MODEL.md`, `ROADMAP.md`, and `CHANGELOG.md`. Solving them is the entry condition for amplification, not a separate track.

G1. Shell-AST bypass — `dangerous-command-gate.js` is regex-only; `cmd="rm -rf /"; $cmd`, `base64 -d | sh`, and split-variable equivalents pass.
G2. Indirect prompt injection — content read from external sources (browser, MCP results, fetched docs) is treated as trusted text. Injection embedded in fetched content is not classified.
G3. PostToolUse output-sanitizer parity for OpenCode and OpenClaw is deferred. Codex / Clawcode / Antegravity have no PostToolUse at all.
G4. Codex / Clawcode / Antegravity adapters are best-effort, not verified against real hook payload shapes — status is "Planned".
G5. Rate limiter TOCTOU race — accepted as performance-only, not a security gate; documented but worth tightening if cheap.
G6. MASTER_PLAN.md Sections 7 (Component Inventory) and 8 (Host Compatibility Matrix) are stubbed; Phase 3 work is blocked on these.
G7. **PARTIAL** — Contract scope expansion: validity.activeHoursUtc, validity.activeDays, contextTrust, scopes.tools.perToolAllow are now wired end-to-end into `decide()` (B2 Phase 1, PR #19). scopes.mcp and scopes.skills are now wired (B2 Phase 2, commit 1). scopes.session.maxDurationMin and scopes.budget are now wired (B2 Phase 2, commit 2). Still missing: v2→v3 migration script — Phase 2 commit 3.

---

## 4. Improvement Areas

Each area lists: Problem, Solution, Files, Power gain, Safety gain, Acceptance.

### A. Plan-Mode Contract — pre-approved multi-step envelopes

Problem. Agents stall mid-task on every borderline call. Each escalation costs operator attention and breaks the agent's planning frame.

Solution. Add a "plan envelope": agent submits a structured JSON action plan up front (commands, paths, capability classes, time bound). `runtime/plan-validator.js` validates the entire plan against the active contract + project policy + risk model and returns a signed `envelopeToken` (HMAC over canonical JSON, key in `~/.horus/plan-key`). Within token's TTL, `decide()` matches each tool call against an unconsumed step in the envelope; matches return `action: allow, source: plan-envelope`. Non-matches fall back to the normal precedence ladder (envelope cannot demote floors). Token is single-session-bound and revocable via `horus-cli.sh plan revoke`.

Files. NEW `runtime/plan-validator.js`, `runtime/plan-envelope.js`. EXTEND `runtime/decision-engine.js` (insert plan-envelope check at step 11.5, after contract-allow, before learned-allow), `runtime/state-paths.js` (envelope store), `runtime/contract.js` (declare plan-envelope grants gated to `tool-allow-matched` scope intersection), `scripts/horus-cli.sh` (`plan validate`, `plan show`, `plan revoke`), `schemas/horus.plan.schema.json`. CI: `scripts/check-plan-envelope.sh`, fixtures.

Power. Big tasks (refactors, multi-file edits, package upgrades) drop from N approvals to 1. Reasonable expectation: 60-80% reduction in mid-task escalations on long tasks.

Safety. Envelope cannot demote any floor (steps 1-9). Token is HMAC-signed and bound to session-id + project root + revision. Each consumed step is journaled with envelope id and step index. Time-bound and explicitly revocable. Agent cannot mint or refresh its own envelope — `plan validate` requires human acceptance like contract-accept.

Acceptance. (1) End-to-end fixture: agent submits plan, runs five matching tool calls without escalation, sixth call (out-of-envelope) routes normally. (2) Floors still fire: kill-switch, secret payload C, scope violation, protected-branch write all override envelope. (3) Decision-replay CI passes with envelope entries. (4) p99 stays under budget.

### B. Shell-AST Defense — replace regex-only matchers

Problem. Documented bypass class (G1). Regex pattern set is bypassable by variable-expansion, base64, command-substitution, split-variable, and quote-in-quote tricks.

Solution. Add a minimal zero-dep shell tokenizer in `runtime/shell-ast.js`: handles word splitting, quote contexts, variable references (including $cmd, ${var}, $(cmd), backticks), heredocs, pipelines, and base64-decoded payloads when the input contains `base64 -d` or `base64 --decode`. Output a normalized command tree. `dangerous-command-gate.js` and `risk-score.js` consume the AST; existing regex set becomes a fallback for tokens the AST cannot resolve (fail-safe-up: unresolvable variables raise risk class to "unknown" → escalate via existing novel-command-class floor).

Files. NEW `runtime/shell-ast.js`. EXTEND `runtime/risk-score.js`, `claude/hooks/dangerous-command-gate.js`, all harness adapters. Fixtures cover the documented bypass set (variable, base64, split-var, command-sub) plus negative cases to keep FP rate down.

Power. False-positive rate drops because the AST sees structure, not surface text. Allows previously over-blocked legitimate commands (e.g., a shell variable named `dropTable` in a build script).

Safety. Closes G1. Unresolvable expressions fail closed via novel-command-class.

Acceptance. (1) Bypass corpus (15+ documented obfuscation cases) blocks under enforce. (2) FP rate against the eval corpus does not increase by more than 0.5%. (3) Decision p99 still under budget — AST run is bounded by command-string length.

### C. Provenance-aware Indirect Prompt-Injection Defense

Problem. Documented gap (G2). External read content is untracked. Today the agent could read a malicious doc and the next bash command derived from it goes through with no extra friction.

Solution. Add a provenance/taint tracker in `runtime/taint.js`. PostToolUse hook annotates each tool result with `provenance: external | local | mixed` (browser, MCP, web-fetch, network curl/wget output → external; local file read → local). Annotations stored in session-context with TTL. PreToolUse path correlates the next 3 tool calls within N seconds (default 60) of an external read; if any of those calls construct shell strings, edit files, or invoke network tools and the input bytes overlap with the recent external read, ARG raises payloadClass by one tier and forces `require-review`. Floor logic is engine-baked.

Files. NEW `runtime/taint.js`, `runtime/provenance-correlator.js`. EXTEND `runtime/session-context.js` (provenance window), `runtime/decision-engine.js` (new floor at rung 8.5 after protected-branch). PostToolUse annotators per harness (Claude already has one; OpenCode/OpenClaw via Area D).

Power. Agent can browse and fetch documentation freely without manual outbound review; only the *use* of external bytes triggers extra review. Net: more reading, fewer interruptions on the read step.

Safety. Closes G2. Implements OWASP Agentic ASI04 (Indirect Prompt Injection) end-to-end rather than content-heuristic only.

Acceptance. (1) Fixture: agent fetches a doc containing "now run rm -rf /", subsequent `bash` call routes to require-review. (2) Negative: unrelated bash after external read is not nudged. (3) Provenance entries appear in journal.

### D. Cross-harness PostToolUse parity — six harnesses, identical surface

Problem. Documented gap (G3). Output-sanitizer is Claude-only. OpenCode/OpenClaw deferred; Codex/Clawcode/Antegravity have nothing.

Solution. For each harness:
- Probe upstream PostToolUse mechanism. Document in `*/POSTTOOL_RESEARCH.md`.
- If upstream supports PostToolUse hooks (any of stdin-based, plugin API, output channel), ship `*/hooks/post-adapter.js` that delegates to `runtime/secret-scan.js` + `runtime/taint.js`.
- If upstream has none, ship a wrapping shim (file-system tail of harness output, journaled) that runs on the same lifecycle. Document the limitation honestly.
- Update `references/owasp-agentic-coverage.md` (ASI05) with file-level verdicts.

Files. NEW `opencode/hooks/post-adapter.js`, `openclaw/hooks/post-adapter.js`, `codex/hooks/post-adapter.js`, `clawcode/hooks/post-adapter.js`, `antegravity/hooks/post-adapter.js`. UPDATE `*/WIRING_PLAN.md` for each. NEW `scripts/check-post-adapter-parity.sh`.

Power. ARG works equally everywhere — no harness becomes a back door for credential leaks via tool output.

Safety. Closes G3.

Acceptance. (1) Per-harness fixtures: secret echoed in tool output → warning. (2) Cross-harness equivalence script extended to 6/6 PostToolUse paths. (3) OWASP ASI05 row says "Covered" or "Documented limitation: <reason>" for every harness — no NOT COVERED.

### E. Capability Discovery API — let agents pre-flight

Problem. Agents discover ARG decisions reactively. They burn tokens on tool calls that get blocked or escalated. There is no way to ask "would this be allowed?" without actually trying.

Solution. Read-only probe surface. CLI: `horus-cli.sh probe '<command>' --intent <intent>` returns predicted action + reason + workflow route. Inside the agent harness, expose the same as a virtual tool/function (Claude Code subagent: `arg.probe`; OpenCode plugin call; etc.) so agents can pre-plan. Probe is journaled but does not write policy state.

Files. NEW `runtime/capability-probe.js`. EXTEND `scripts/horus-cli.sh probe`. Per-harness probe-tool exposure docs in `*/WIRING_PLAN.md`. Schema entry in `runtime/index.js`.

Power. Agents plan around constraints up front. Tighter loops, fewer wasted turns. Combined with Area A, agents can build a plan, probe it, then submit the envelope.

Safety. Read-only by construction. No state mutation. Probe results are advisory; the actual decide() at call time is authoritative.

Acceptance. (1) `horus-cli.sh probe 'rm -rf /tmp/build'` returns predicted action + reason. (2) Probe latency under 50 ms. (3) Probe is journaled with `mode: probe`.

### F. Contract Scope Expansion — finish what v2 started

Problem. Documented gap (G7). Schema v2 added validity windows, contextTrust, per-tool scopes — but the runtime does not yet read all these fields end to end. Operators set them and they silently no-op.

Solution. Wire the v2 schema fields into `decide()`:
- `validity.activeWindows` → if outside, gated classes block, non-gated classes warn.
- `validity.daysOfWeek` → same logic.
- `contextTrust.<branch-glob>` → per-branch trust posture override (relaxed/balanced/strict) consumed by risk-score.
- `scopes.tools.<toolName>` → per-tool commandGlobs/pathGlobs allowlist consumed by scopeMatch.
Add v3 schema (additive) for: `scopes.mcp.<serverName>` (per-MCP-server policy), `scopes.skills.<skillName>` (per-skill policy), `scopes.session.maxDurationMin` (auto-expire), `scopes.budget` (quota: max external bytes per session, max destructive ops).

Files. EXTEND `runtime/project-policy.js`, `runtime/contract.js`, `runtime/decision-engine.js`, `runtime/risk-score.js`, `schemas/horus.contract.schema.json`. NEW migration `scripts/migrateV2ToV3.js`, `scripts/check-migrate-v2-v3.sh`.

Power. Operators pre-approve broad bounded zones (e.g., "this session can call npm/pytest/git/jq freely until 18:00, max 50 destructive ops, only in src/**"). Inside the zone, agent runs with minimal interruption.

Safety. Bound by clock + harness session id + budget counters. Out-of-window or out-of-budget falls back to default risk model. Counters persisted in session-context.

Acceptance. (1) Time-window fixture: command allowed inside, blocked outside. (2) Budget fixture: 51st destructive op escalates. (3) Per-MCP-server policy fixture. (4) v2→v3 migration round-trips losslessly.

### G. Multi-Agent Trust — parent/child session linkage

Problem. When Claude Code spawns a subagent (or OpenCode launches an inner agent), the subagent inherits the project but gets a fresh session-id. Session-risk and trajectory don't inherit. A subagent can sidestep parent's earned tightening.

Solution. Session-tree state. PreToolUse hook reads `parentSessionId` env (`CLAUDE_CODE_PARENT_SESSION_ID` or harness-equivalent) and links child → parent in `~/.horus/session-tree.json`. `getSessionRisk` and `getSessionTrajectory` aggregate up the tree. Plan envelopes are inheritable: child's effective scope = intersection(parent envelope, child contract).

Files. NEW `runtime/session-tree.js`. EXTEND `runtime/session-context.js`, `runtime/decision-engine.js`, harness adapters (parent-id detection per harness).

Power. Rich subagent workflows: a parent can issue a plan envelope and let three subagents work inside it concurrently.

Safety. Subagent cannot widen parent scope. Trajectory nudges propagate so escalation chains across agents.

Acceptance. (1) Parent-child fixture: parent's session-risk=2 + child's risk=2 → effective risk=4 → trajectory nudge fires for child. (2) Child cannot consume an envelope step that parent excluded. (3) Tree reset when parent ends.

### H. Promote Codex / Clawcode / Antegravity adapters from Planned to Supported

Problem. Documented gap (G4). Three harnesses ship best-effort adapters with no real-payload verification.

Solution. For each: capture real PreToolUse and (where available) PostToolUse payload shapes (vendor docs, source repo inspection, or contributed live samples). Tighten command-field extraction to a verified order. Extend the cross-harness equivalence script to all 6/6. Bump the harness support matrix in `README.md` from "Planned" to "Supported".

Files. UPDATE `codex/hooks/adapter.js`, `clawcode/hooks/adapter.js`, `antegravity/hooks/adapter.js`. NEW per-harness real-payload fixtures. EXTEND `scripts/check-cross-harness-equivalence.sh`. Update `README.md`, `MODULES.md`, `references/per-tool-apply-status.md`.

Power. ARG covers the full agentic-coding ecosystem — operators can pick any harness without losing safety floors.

Safety. Verified payload extraction reduces false-allows from misparsed inputs.

Acceptance. (1) 6/6 harnesses pass cross-harness equivalence. (2) `check-codex-adapter.sh`, `check-clawcode-adapter.sh`, `check-antegravity-adapter.sh` all pass against real-shape fixtures. (3) Setup wizard accepts `--tool codex|clawcode|antegravity` without "not yet supported" message.

### I. Operator UX — bulk approval, suggestions, time windows

Problem. Operators get fatigued. Even with learned-allow + auto-allow-once, repeated similar approvals happen.

Solution.
- `horus-cli.sh suggest` — ranks the top-N policy candidates from the journal (frequency, low-risk, project-scoped) and prints a `runtime promote` command.
- `horus-cli.sh approve --bulk --window 2h --classes safe-build` — time-windowed bulk approval bound to a session.
- `horus-cli.sh decisions tail` — live tail with annotations.
- `horus-cli.sh suggest --interactive` — accept/dismiss each candidate in a single flow.

Files. EXTEND `scripts/horus-cli.sh`. NEW `runtime/policy-suggest.js` (already partially implied by Phase 4 roadmap — wire it up). NEW fixtures.

Power. Operator runs `horus-cli.sh suggest` once a week, promotes 5 patterns, agent runs cleaner.

Safety. Suggestion-only by default. Bulk approval is time-bound and journaled. No silent promotion.

Acceptance. (1) Sample journal yields a deterministic suggest output. (2) Bulk approval auto-expires after window. (3) Suggestions never include high-risk patterns.

### J. Behavioral Test Harness + Canary Mode (Phase 5 from roadmap)

Problem. Today's tests verify structure (counts, fixture pass/fail). Phase 5 of the roadmap asks for outcome metrics: autonomy %, false-block %.

Solution.
- Canary/shadow mode: `HORUS_SHADOW=1` runs `decide()` but does not enforce; emits `would-have-been: <action>`. Operator runs a sprint in shadow before flipping enforce, then uses the journal to compare predicted vs. actual operator-corrected actions.
- New CLI: `horus-cli.sh metrics` — prints autonomy %, false-block %, false-allow %, mean time-to-decision.
- New CLI: `horus-cli.sh diff-decisions <fromTs> <toTs>` — already exists as a stub; finish it.
- Add a metrics CI gate: warn if false-block crosses a configurable threshold.

Files. EXTEND `runtime/decision-engine.js` (shadow flag), `scripts/horus-diff-decisions.sh`, `scripts/horus-cli.sh metrics`. NEW `runtime/metrics.js`. New thresholds in `horus.config.json`.

Power. Operators can roll out tighter modes without surprise breakages.

Safety. Shadow runs do not weaken anything — they add observation only.

Acceptance. (1) Shadow run on the eval corpus produces autonomy/false-block numbers within a stable variance band. (2) Metrics CI gate fails when synthetic regression is injected.

### K. Self-Rollback Skill — reversibility as a first-class capability

Problem. Destructive writes are bound by approval, but reversibility is not built in. If a destructive command is approved and turns out wrong, recovery is manual.

Solution. New optional skill `skills/self-rollback/`: every contract-allowed destructive write is preceded by a `git stash --include-untracked` checkpoint with metadata in `~/.horus/rollback-log.json`. CLI: `horus-cli.sh rollback last`, `rollback show`, `rollback apply <id>`. Local-only; never network.

Files. NEW `skills/self-rollback/SKILL.md`, `runtime/rollback.js`, `scripts/horus-cli.sh rollback`. EXTEND `runtime/action-planner.js` to include rollback hint in destructive-class action plans.

Power. Operators can let agent run more destructive actions because mistakes are recoverable.

Safety. Local git only; no remote ops. Doesn't add network surface.

Acceptance. (1) `rm -rf build/` under contract allow → checkpoint created → restore works. (2) Rollback log is journaled and pruned.

### L. Pre-flight Test Runner Skill — autonomous test-first loops

Problem. Agents under contract scope can edit but often skip tests because running them costs flow. A pre-wired test-runner skill that automatically picks the right command per language and runs scoped tests before commits would close the loop.

Solution. New skill `skills/pre-flight-tests/`: detects language (already in context-discovery), maps to test command (`pytest -q`, `go test ./...`, `cargo test`, `npm test --silent`), runs only tests touching changed files where possible. Output journaled. Action-planner inserts the test command into the plan whenever `require-tests` fires.

Files. NEW `skills/pre-flight-tests/SKILL.md`. EXTEND `runtime/action-planner.js`, `runtime/context-discovery.js` (already detects language).

Power. The `require-tests` workflow becomes self-executing: agent gets a tested change-set instead of "go run tests yourself".

Safety. Tests are local, sandboxed by contract scope. No new external surface.

Acceptance. (1) Edit on a Python file → `require-tests` route → action plan includes `pytest -q` against changed files. (2) Same for Go, Rust, JS, TS.

### M. MASTER_PLAN.md Sections 7 & 8 — unblock Phase 3

Problem. Documented gap (G6). Phase 3 work is blocked on these stubs.

Solution. Author Section 7 (Component Inventory: every runtime module → MASTER_PLAN role) and Section 8 (Host Compatibility Matrix: which harnesses get contract v3 support, which stay EXPERIMENTAL).

Files. EDIT `MASTER_PLAN.md`. UPDATE `DECISIONS.md` D24 to closed once written.

Power. Unblocks Phase 3 (Three-Mode UX). Indirectly enables every other improvement that depends on contract v3.

Safety. None changed.

Acceptance. (1) Sections 7 and 8 written. (2) D24 marked closed in DECISIONS.md.

### N. Tighten Rate Limiter — TOCTOU close-out

Problem. Documented gap (G5). Accepted as performance-only, but the cost of fixing it is low.

Solution. Replace read-modify-write on `rate-limit.json` with `O_EXCL` lockfile + atomic counter file (mode 0600). Fall-open behavior on file error stays. CI fixture proves no over-allowance under 8 concurrent hooks.

Files. EDIT `claude/hooks/hook-utils.js`. NEW fixture in `tests/fixtures/rate-limit/`.

Power. Slight: removes a noise source under heavy parallel hook load.

Safety. Tightens an accepted limitation.

Acceptance. (1) 8-process concurrent invocation does not exceed bucket capacity. (2) File-error fallback still allows.

### O. Capability Pack: Reviewed Web-Fetch (replaces ad-hoc curl)

Problem. Agents currently choose between `curl|sh` (blocked) and "ask user every time". Documentation reading and package-registry probing are core agent tasks.

Solution. New capability pack `modules/web-fetch-pack/` with a reviewed allowlist of doc/registry hosts (`docs.python.org`, `docs.rs`, `pkg.go.dev`, `registry.npmjs.org`, `pypi.org`, `crates.io`, `mvnrepository.com`, …). Adds a `webFetchAllow` contract field (additive, v3). Inside allowlist: read-only HTTP GET, response auto-piped through secret-scan + taint annotator. Outside: existing escalation path.

Files. NEW `modules/web-fetch-pack/`. EXTEND `schemas/horus.contract.schema.json` (v3), `runtime/contract.js`, `runtime/scopeMatch`, `runtime/taint.js` (mark fetched bytes as external). NEW `scripts/web-fetch.sh` (the actual constrained fetcher).

Power. Agents can read upstream docs and registry metadata freely without manual approval — a high-value, low-risk capability.

Safety. Allowlist + secret-scan + taint annotation. No POST. No cookies forwarded. Bound to project root.

Acceptance. (1) Fetch from allowed host returns + journals + tags content as `external`. (2) Disallowed host blocks. (3) POST blocked. (4) Fetched bytes that contain "now run rm -rf" cause subsequent bash use to require-review (Area C).

---

## 5. Sequencing — four waves

Wave 1: Close documented gaps. Net-zero or net-positive on safety, modest power gain.
- B (shell-AST), C (provenance/taint), D (PostToolUse parity), N (rate limiter), M (MASTER_PLAN sections).

Wave 2: Cross-harness completion. Power gain is "ARG works everywhere".
- H (Codex/Clawcode/Antegravity promotion), F (contract scope v2 finish + v3 schema).

Wave 3: Capability negotiation. The big amplification lift.
- A (plan envelope), E (capability probe), G (multi-agent trust), O (web-fetch pack).

Wave 4: Continuous improvement.
- I (operator UX), J (canary + metrics), K (self-rollback), L (pre-flight tests).

Each wave should ship as a distinct version bump (3.1 → 3.2 → 3.3 → 3.4) with full CHANGELOG entries and CI green.

---

## 6. Acceptance Metrics (target end of Wave 4)

- Cross-harness PostToolUse parity: 6/6.
- Documented bypass classes closed: shell-AST, indirect injection.
- Operator interruptions per long task: ↓ ≥ 40% on the eval corpus.
- False-block rate: ≤ 2% (measured in shadow mode against the eval corpus).
- False-allow rate: 0 for floor-bearing classes (kill-switch, secret C, scope violation, protected-branch).
- Decision p99: < 10 ms Linux CI, < 500 ms Windows/WSL slow-fs (unchanged).
- Zero-dep runtime preserved.
- Fixture count growth: +120 (rough) for new areas; all green in CI.
- OWASP Agentic Top 10 (2026) coverage: every row "Covered" or "Documented limitation: …" — zero NOT COVERED.

---

## 7. Implementation Handoff Notes for Claude Code

When Claude Code picks this up, work area-by-area, not wave-by-wave inside an area. For each area:

1. Read the current state of every file listed under "Files".
2. Write the new module first, with fixtures, *before* wiring into `decide()`.
3. Add the `check-*.sh` script and call it from `scripts/run-fixtures.sh`.
4. Wire into `decision-engine.js` last, behind a feature flag where reasonable (env var `HORUS_FEATURE_<NAME>=1`) so a partial rollout cannot regress shipped behavior.
5. Update `MODULES.md`, `ARCHITECTURE.md` (Section 1 and Section 2 if precedence ladder changes), `references/owasp-agentic-coverage.md`, `CHANGELOG.md` (Unreleased section), and `ROADMAP.md` (move closed items to "Closed").
6. Bench: run `scripts/bench-runtime-decision.sh` and refuse to merge if p99 regresses by > 1.5×.
7. CI gates that must stay green: `check-zero-deps.sh`, `check-counts.sh`, `check-decision-replay.sh`, `check-cross-harness-equivalence.sh`, `eval-decision-quality.sh`.

Hard rules during implementation:
- Do not change canonical-json output format. Contract hashes must stay stable across versions.
- Do not delete journal entries. Rotation only.
- Do not add a third-party `require()` in `runtime/`.
- Do not put state outside `HORUS_STATE_DIR`.
- Do not weaken any floor under any flag.
- Do not skip fixtures. New surface without a fixture is rejected.

---

## 8. Out of Scope (deliberately)

- Hosted dashboard / web UI. Local-first stays. (Operator UX is CLI.)
- Cloud telemetry aggregation. Could enable later, opt-in only, but not part of this plan.
- Replacing Node hooks with a compiled binary. Adds build complexity for a marginal speed gain; current p99 already meets budget.
- Generic plugin marketplace. Capability packs cover the same need with stricter boundaries.
- Auto-applying policy suggestions. Suggestion engine surfaces; operator promotes. D11/D13/D20 are explicit on this.
- LLM-based command classifier. Local-first + zero-dep + deterministic precludes this.

---

## 9. Rejected Ideas (explain why, so we don't revisit)

- **"Soft floors" for trusted harnesses.** Some floors could be relaxed if the harness identity is verified. Rejected: floor identity is the foundation. Anything below the floor is not a floor.
- **Agent self-acceptance of contract changes.** Plan envelope is signed by agent's runtime; contract amendments still require operator. Rejected because amend → accept is the human gate that makes the rest of the system trustable.
- **Auto-promote learned-allow at low risk without human review.** Rejected per D11/D13/D20. The visible-suggestion model is the contract.
- **MCP servers running outside contract scope.** Rejected: MCP is in scope of contract via Area F (per-MCP-server policy). No silent surface.
- **Outbound network egress without allowlist.** Rejected: web-fetch pack (Area O) gates by host. Anything else is escalation.
- **Cross-machine policy sync.** Out of scope of "local-first". Could be added later as a one-way export, never auto-import.

---

## 10. Quick Reference — what changes vs. what stays

| Surface | Change | Rationale |
|---|---|---|
| Hard floors | unchanged | foundational invariant |
| `runtime/*.js` zero-dep | unchanged | foundational invariant |
| `~/.horus` storage | unchanged paths; new files added | backward compat |
| Contract schema v1, v2 | unchanged | additive evolution to v3 |
| Decision precedence ladder | extends from 15 to 17 rungs (plan-envelope at 11.5, taint floor at 8.5) | additive |
| CLI entry points | new subcommands: `plan`, `probe`, `metrics`, `suggest`, `rollback` | additive |
| Fixtures | grows | additive |
| Per-harness adapters | tightened (Codex/Clawcode/Antegravity) | promotion |
| Hooks | new PostToolUse adapters per harness | parity closure |

---

## 11. End-state

When Wave 4 closes, an operator running ARG on Claude Code or any of the five other harnesses gets:

- a single contract that covers filesystem, network, secrets, branches, shell tools, MCP servers, skills, time windows, and budgets;
- a plan envelope they can review and sign once for a multi-step task, then watch the agent run silently inside it;
- a probe surface the agent uses to plan around constraints up front;
- provenance-aware injection defense that lets the agent read freely and only escalates on suspicious *use*;
- a self-rollback safety net for destructive ops;
- canary/shadow mode plus measurable autonomy and false-block rates;
- the same surface across every supported harness with no silent gaps.

The agent runs harder. The operator approves less. The audit trail tells the whole story. The hard floors never moved.
