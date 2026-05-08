# Enhancement Plan — Agent Runtime Guard

Author: Misk (workspace assistant)
Owner: Khouly
Drafted: 2026-05-07
Status: PLAN ONLY — no code changes have been made
Supersedes: `AMPLIFICATION_PLAN.md` (same root, untracked) — incorporates its 15 areas, drops one, adds four engineering-quality items, and reorders the waves

---

## 0. Why this exists

ARG v3.0.0 has a strong security spine. The next jump in operator value is a holistic v3.x → v4 push that does three things at once: closes the two remaining bypass classes, brings the six harnesses to true parity, and gives the agent enough capability negotiation surface that long tasks stop fragmenting into N approval prompts.

This plan is fresh. It folds in everything from `AMPLIFICATION_PLAN.md` that survived re-review, drops what doesn't, names new gaps the prior plan missed, and sequences the work so each wave ships a coherent story.

No item below trades safety for power. Where they would conflict, safety wins and the item is rewritten or dropped.

---

## 1. Operating invariants (do not break)

These are non-negotiable. Any item that would violate them is rejected.

- Hard floors stay engine-baked. Steps 1-9 of `decision-engine.js` are non-demotable. No flag, contract, envelope, or capability pack may demote a floor.
- `runtime/*.js` stays zero-dependency. CI gate `check-zero-deps.sh` is authoritative. Adding `require()` of a third-party package is a P0 regression.
- All learned/policy/journal state stays under `HORUS_STATE_DIR` (default `~/.horus`). No outbound telemetry by default.
- Contract schema evolution is additive. v1 and v2 contracts must continue to validate and verify after every change. v3 is additive over v2.
- Every new decision path journals with `floorFired`, `source`, and `reason` populated.
- Decision p99 budget unchanged: < 10 ms on Linux CI, < 500 ms on Windows/WSL slow-fs. New work respects `bench-runtime-decision.sh` ceiling.
- Three-mode preserved everywhere: warn (default), enforce (`HORUS_ENFORCE=1`), kill (`HORUS_KILL_SWITCH=1`). New surface ships in all three modes or doesn't ship.
- Backwards compat: contracts, journal entries, and policy-store records written by older versions remain readable. Migrations bump revisions, never delete.
- Every new module ships with: fixtures, a `check-*.sh` script, an entry in `MODULES.md`, and the OWASP coverage row updated where applicable.

---

## 2. Current state, in one paragraph

ARG v3.0.0 ships 23 zero-dep runtime modules behind a single 15-rung precedence ladder, validated by 216 fixture pairs across 13 categories and seven CI gates (zero-dep, counts, decision-replay, cross-harness equivalence, eval-decision-quality, bench, version). Six harnesses are wired: Claude Code is fully covered with 13 PreToolUse hooks plus one PostToolUse output sanitizer; OpenCode and OpenClaw share a Claude-compatible adapter for PreToolUse with PostToolUse deferred; Codex, Clawcode, and Antegravity ship best-effort adapters that have not been verified against real upstream payload shapes. Contract v1 is canonical; v2 added validity windows, contextTrust, and per-tool scopes but only some v2 fields are consumed end-to-end by `decide()`. v3 schema is drafted but not wired. Brand and state migration to `HORUS_*` / `~/.horus` is complete. Two documented bypass classes (shell-AST, indirect prompt injection) remain open. MASTER_PLAN.md sections 7 and 8 are stubbed and block Phase 3.

---

## 3. Gap inventory

Documented gaps (verbatim from `SECURITY_MODEL.md`, `ROADMAP.md`, and `CHANGELOG.md`):

- **G1.** Shell-AST bypass — `dangerous-command-gate.js` is regex-only; `cmd="rm -rf /"; $cmd`, `base64 -d | sh`, and split-variable equivalents pass.
- **G2.** Indirect prompt injection — content read from external sources (browser, MCP results, fetched docs) is treated as trusted text. Injection embedded in fetched content is not classified.
- **G3.** PostToolUse output-sanitizer parity for OpenCode and OpenClaw deferred. Codex / Clawcode / Antegravity have no PostToolUse at all.
- **G4.** Codex / Clawcode / Antegravity adapters are best-effort, not verified against real upstream payload shapes. Status: "Planned".
- **G5.** Rate limiter TOCTOU race — accepted as performance-only; tightening is cheap.
- **G6.** MASTER_PLAN.md sections 7 (Component Inventory) and 8 (Host Compatibility Matrix) stubbed; Phase 3 work blocks here.
- **G7. PARTIAL** — Contract scope expansion: validity.activeHoursUtc, validity.activeDays, contextTrust, scopes.tools.perToolAllow are now wired end-to-end into `decide()` (B2 Phase 1, PR #19). scopes.mcp and scopes.skills are now wired (B2 Phase 2, commit 1). Still missing: scopes.session.maxDurationMin, scopes.budget, and the v2→v3 migration script — Phase 2 commits 2-3.

New gaps (spotted during this review, not enumerated in the prior plan):

- **Q1. Decision-journal redaction is advisory only.** `redactInJournal` is a contract field, but `decision-journal.js:append()` does not implement actual redaction. Secrets pass through to JSONL. The flag reads as honored but isn't.
- **Q2. Self-acceptance gate uses an env-var allowlist.** `runtime/contract.js:acceptContract()` blocks self-accept by inspecting a hardcoded list of harness session env vars (CLAUDE_CODE_SESSION_ID etc.). A new harness whose env var isn't on the list bypasses the gate. The defense is fragile; it should be inverted (require positive operator signal, not absence of harness signal).
- **Q3. `decide()` boundary trusts input shape.** `decision-engine.js:decide()` reads `input.tool`, `input.command`, `input.branch` without validation; a malformed input silently produces undefined-driven decisions. There is no contract on the boundary.
- **Q4. Intent classifier confidence is hand-coded and never adjusted.** Patterns are regex-only; commands with unusual spacing/quoting may misclassify. There is no extensibility hook for project-specific intents.
- **Q5. No dry-run / simulation mode.** Every call to `decide()` mutates session-context and journals. There is no way to preview "would this be allowed?" without side effects. Capability probe (Track C) addresses this but the gap deserves naming.
- **Q6. Per-fixture state isolation is IO-coupled.** `session-context.js` uses real file IO during fixture runs. Recent H1 fix added `HORUS_STATE_DIR` per fixture, but the design forces IO into every test path. An in-memory store interface would speed runs and enable property-style tests.
- **Q7. Operator-side suggestion engine is stubbed.** `runtime/policy-suggest.js` is referenced in roadmap text but not present. The journal already contains the data; the surfacing layer is missing.
- **Q8. No structured incident review surface.** When a floor fires, the journal records it, but there is no `horus-cli.sh incidents` summary surface. After-action review currently means grepping JSONL.

---

## 4. Enhancement tracks

Five tracks. Each item gives Problem, Solution, Files, Acceptance, Risk-if-dropped. One recommended path per item — no menus.

### Track A — Close documented bypass classes (security floor work)

**A1. Shell-AST defense** (closes G1)

- **Problem.** Regex-only matchers in `dangerous-command-gate.js` miss variable-expansion, base64, command-substitution, split-variable, and quote-in-quote bypasses.
- **Solution.** Add a zero-dep shell tokenizer at `runtime/shell-ast.js`: word-splitting, quote contexts, variable references (`$cmd`, `${var}`, `$(cmd)`, backticks), heredocs, pipelines, base64 payloads when input contains `base64 -d`/`--decode`. Output a normalized command tree. `dangerous-command-gate.js` and `risk-score.js` consume the AST. Existing regex set becomes a fallback for tokens the AST cannot resolve. Unresolvable expressions raise risk class to "unknown" → escalate via the existing novel-command-class floor (fail-safe-up).
- **Files.** NEW `runtime/shell-ast.js`. EXTEND `runtime/risk-score.js`, `claude/hooks/dangerous-command-gate.js`, all six harness adapters' command extractors. NEW fixtures under `tests/fixtures/shell-ast/` covering at least 15 documented bypass cases plus 15 negative cases.
- **Acceptance.** (1) Bypass corpus blocks under enforce. (2) FP rate against the eval corpus does not increase by more than 0.5%. (3) Decision p99 stays under budget — AST run is bounded by command-string length.
- **Risk if dropped.** Highest-impact known bypass remains open. Operators relying on enforce mode for shell-injection defense have a false sense of coverage.

**A2. Provenance-aware indirect prompt-injection defense** (closes G2)

- **Problem.** External read content (browser, MCP results, web-fetch) is untreated. The agent can read a malicious doc and the next bash call derived from it goes through with no extra friction.
- **Solution.** Add a provenance/taint tracker at `runtime/taint.js`. PostToolUse hooks annotate each tool result with `provenance: external | local | mixed` (browser/MCP/web-fetch/network curl|wget output → external; local file read → local). Annotations stored in `session-context` with TTL. PreToolUse correlates the next 3 tool calls within N seconds (default 60) of an external read; if any of those construct shell strings, edit files, or invoke network tools and the input bytes overlap with the recent external read, ARG raises payloadClass by one tier and forces `require-review`. Floor logic engine-baked at rung 8.5.
- **Files.** NEW `runtime/taint.js`, `runtime/provenance-correlator.js`. EXTEND `runtime/session-context.js` (provenance window), `runtime/decision-engine.js` (new floor at 8.5 after protected-branch). NEW PostToolUse annotators per harness (Claude already has the surface; OpenCode/OpenClaw via A3).
- **Acceptance.** (1) Fixture: agent fetches a doc containing "now run rm -rf /", subsequent `bash` call routes to require-review. (2) Negative: unrelated bash after external read is not nudged. (3) Provenance entries appear in journal.
- **Risk if dropped.** Indirect injection is the second documented bypass. Closing it removes a class of attacks that grows in importance as MCP and browser tools expand.

**A3. Cross-harness PostToolUse parity** (closes G3)

- **Problem.** Output sanitizer is Claude-only. OpenCode/OpenClaw are deferred. Codex/Clawcode/Antegravity have nothing.
- **Solution.** For each harness: probe the upstream PostToolUse mechanism (stdin-based, plugin API, output channel). If supported, ship `*/hooks/post-adapter.js` that delegates to `runtime/secret-scan.js` + `runtime/taint.js`. If unsupported, ship a wrapping shim (filesystem tail of harness output, journaled) and document the limitation honestly. Update OWASP coverage row ASI05 with file-level verdicts.
- **Files.** NEW `opencode/hooks/post-adapter.js`, `openclaw/hooks/post-adapter.js`, `codex/hooks/post-adapter.js`, `clawcode/hooks/post-adapter.js`, `antegravity/hooks/post-adapter.js`. NEW per-harness `POSTTOOL_RESEARCH.md`. UPDATE `*/WIRING_PLAN.md` for each. NEW `scripts/check-post-adapter-parity.sh`.
- **Acceptance.** (1) Per-harness fixture: secret echoed in tool output → warning. (2) Cross-harness equivalence script extended to 6/6 PostToolUse paths. (3) OWASP ASI05 row says "Covered" or "Documented limitation: <reason>" for every harness — zero NOT COVERED.
- **Risk if dropped.** Five of six harnesses leak credentials in tool output. The cross-harness security claim doesn't hold.

**A4. Decision-journal redaction — actually implement it** (closes Q1)

- **Problem.** `redactInJournal` is referenced in the contract surface but is not implemented in `decision-journal.js`. The flag at `contract.scopes.secrets.redactInJournal` is declared in the schema and set to `true` in generated contracts, but `append()` writes every field verbatim — secrets land in `~/.horus/decision-journal.jsonl` regardless of the contract setting.
- **Solution.** Move redaction into `decision-journal.js:append()`. Use the existing 23-pattern set from `secret-scan.js` plus a configurable additional pattern list from contract. Redact in-place before writing JSONL; replace with `[REDACTED:<class>]`. Original-bytes never reach the journal. Add `redactInJournal` to per-event metadata so post-hoc audit can confirm the policy applied.
- **Files.** EXTEND `runtime/decision-journal.js`, `runtime/secret-scan.js` (export pattern set as a function). NEW fixture: a decide() call carrying a class-C secret, asserting JSONL output is redacted under `redactInJournal: true` and unredacted under `false`.
- **Acceptance.** (1) Fixture passes. (2) `eval-decision-quality.sh` corpus: zero raw secrets in journal under default config. (3) Decision p99 cost of redaction under 0.5 ms.
- **Risk if dropped.** A documented safety field doesn't work. Operators who rely on it for compliance posture (PII, PCI, HIPAA-adjacent flows) have a real exposure.

**A5. Rate limiter TOCTOU close-out** (closes G5)

- **Problem.** Read-modify-write on `~/.horus/rate-limit.json` over-allows under heavy parallel hook load.
- **Solution.** `O_EXCL` lockfile + atomic counter file (mode 0600). Fall-open behavior on file error stays. CI fixture: 8-process concurrent invocation does not exceed bucket capacity.
- **Files.** EDIT `claude/hooks/hook-utils.js`. NEW `tests/fixtures/rate-limit/` with concurrent-invocation harness.
- **Acceptance.** (1) Concurrent-invocation fixture passes. (2) Single-process baseline unchanged.
- **Risk if dropped.** Low. Performance-only, but the cost of fixing is small enough that "documented limitation" reads as carelessness.

### Track B — Cross-harness completion

**B1. Promote Codex / Clawcode / Antegravity adapters from Planned to Supported** (closes G4)

- **Problem.** Three harnesses ship best-effort adapters with no real-payload verification. Setup wizard shows "not yet supported" warnings for them.
- **Solution.** For each: capture real PreToolUse and (where available) PostToolUse payload shapes from vendor docs, source repo inspection, or contributed live samples. Tighten command-field extraction to a verified order rather than 6-level fallback chain. Add per-harness real-shape fixtures. Extend cross-harness equivalence to 6/6.
- **Files.** UPDATE `codex/hooks/adapter.js`, `clawcode/hooks/adapter.js`, `antegravity/hooks/adapter.js`. NEW fixtures per harness with real-shape payloads. EXTEND `scripts/check-cross-harness-equivalence.sh`. UPDATE `README.md`, `MODULES.md`, `references/per-tool-apply-status.md`.
- **Acceptance.** (1) `check-codex-adapter.sh`, `check-clawcode-adapter.sh`, `check-antegravity-adapter.sh` pass against real-shape fixtures. (2) 6/6 harnesses pass cross-harness equivalence. (3) Setup wizard accepts `--tool codex|clawcode|antegravity` with no "not yet supported" message.
- **Risk if dropped.** ARG's "works on every agentic-coding harness" claim has a footnote. Three harnesses become silent attack surfaces.

**B2. Contract scope v2 wire-up + v3 schema** (closes G7)

- **Problem.** v2 added `validity.activeWindows`, `validity.daysOfWeek`, `contextTrust.<branch-glob>`, `scopes.tools.<name>` — the runtime does not consume all of these. Operators set them and they silently no-op.
- **Solution.** Wire v2 fields end-to-end in `decide()`:
  - `validity.activeWindows` → outside window, gated classes block, non-gated warn.
  - `validity.daysOfWeek` → same logic.
  - `contextTrust.<branch-glob>` → per-branch trust posture override consumed by `risk-score`.
  - `scopes.tools.<toolName>` → per-tool commandGlobs/pathGlobs allowlist consumed by `scopeMatch`.
  Add v3 schema (additive): `scopes.mcp.<serverName>` (per-MCP-server policy), `scopes.skills.<skillName>` (per-skill policy), `scopes.session.maxDurationMin` (auto-expire), `scopes.budget` (max external bytes per session, max destructive ops). Migration script `scripts/migrateV2ToV3.js`.
- **Files.** EXTEND `runtime/project-policy.js`, `runtime/contract.js`, `runtime/decision-engine.js`, `runtime/risk-score.js`, `schemas/horus.contract.schema.json`. NEW migration + `scripts/check-migrate-v2-v3.sh`.
- **Acceptance.** (1) Time-window fixture: command allowed inside, blocked outside. (2) Budget fixture: 51st destructive op escalates. (3) Per-MCP-server policy fixture. (4) v2→v3 migration round-trips losslessly.
- **Risk if dropped.** v2 schema fields stay decorative. Operators lose trust in the contract surface. Track C items (plan envelope, multi-agent trust) need this foundation.

**B3. Self-acceptance gate hardening** (closes Q2)

- **Problem.** `acceptContract()` blocks self-accept by checking a hardcoded list of harness session env vars. A new harness whose env var isn't on the list bypasses the gate. Defense is by absence; it should be by presence.
- **Solution.** Invert. Require a positive operator signal: `acceptContract()` only succeeds when stdin is a TTY OR an explicit `HORUS_OPERATOR_TOKEN` is set (one-time, generated by `horus-cli.sh operator-token mint`, single-use, journaled). Drop the env-var allowlist. Document in `CONTRACT.md`.
- **Files.** EDIT `runtime/contract.js`. EXTEND `scripts/horus-cli.sh` (`operator-token mint|verify`). UPDATE `CONTRACT.md`. NEW fixture: agent harness invokes `acceptContract()` without TTY and without operator token → blocks.
- **Acceptance.** (1) Fixture passes. (2) Existing operator-driven `horus-cli.sh accept` flow unchanged from operator's perspective. (3) Migration note in `CHANGELOG.md`.
- **Risk if dropped.** A novel harness becomes a self-accept oracle the moment its env-var name doesn't match the allowlist. The whole acceptance gate model rests on this.

### Track C — Amplify agent autonomy

**C1. Plan-mode contract — pre-approved multi-step envelopes**

- **Problem.** Agents stall mid-task on every borderline call. Each escalation costs operator attention and breaks the agent's planning frame. This is the single biggest source of friction reported on long tasks.
- **Solution.** Plan envelope. Agent submits a structured JSON action plan up front (commands, paths, capability classes, time bound). `runtime/plan-validator.js` validates the plan against the active contract + project policy + risk model and returns a signed `envelopeToken` (HMAC over canonical JSON, key in `~/.horus/plan-key`). Within the token's TTL, `decide()` matches each tool call against an unconsumed step; matches return `action: allow, source: plan-envelope`. Non-matches fall through the normal precedence ladder. Envelope cannot demote any floor (rungs 1-9 still primary). Token is single-session-bound and revocable via `horus-cli.sh plan revoke`.
- **Files.** NEW `runtime/plan-validator.js`, `runtime/plan-envelope.js`. EXTEND `runtime/decision-engine.js` (insert plan-envelope check at rung 11.5, after contract-allow, before learned-allow), `runtime/state-paths.js` (envelope store), `runtime/contract.js` (declare plan-envelope grants gated to `tool-allow-matched` scope intersection), `scripts/horus-cli.sh` (`plan validate|show|revoke`), `schemas/horus.plan.schema.json`. NEW `scripts/check-plan-envelope.sh` + fixtures.
- **Acceptance.** (1) End-to-end fixture: agent submits plan, runs five matching tool calls without escalation, sixth (out-of-envelope) routes normally. (2) Floors override envelope: kill-switch, secret class C, scope violation, protected-branch write. (3) Decision-replay CI passes with envelope entries. (4) p99 stays under budget. (5) Agent cannot mint or refresh own envelope; `plan validate` requires human acceptance like `accept`.
- **Risk if dropped.** Headline amplification feature is missing. Operator interruptions per long task stay flat.

**C2. Capability discovery probe API** (also closes Q5)

- **Problem.** Agents discover ARG decisions reactively. Tokens burn on tool calls that get blocked or escalated. There is no way to ask "would this be allowed?" without trying.
- **Solution.** Read-only probe. CLI: `horus-cli.sh probe '<command>' --intent <intent>` returns predicted action + reason + workflow route. Inside agent harnesses, expose the same as a virtual tool/function (Claude Code subagent: `arg.probe`; OpenCode plugin call; equivalent for the rest). Probe is journaled with `mode: probe` but does not write policy state.
- **Files.** NEW `runtime/capability-probe.js`. EXTEND `scripts/horus-cli.sh probe`. Per-harness probe-tool exposure docs in `*/WIRING_PLAN.md`. Schema entry in `runtime/index.js`.
- **Acceptance.** (1) `horus-cli.sh probe 'rm -rf /tmp/build'` returns predicted action + reason. (2) Probe latency under 50 ms. (3) Probe is journaled with `mode: probe` and never mutates policy.
- **Risk if dropped.** Combined with C1, this is what makes plan envelopes practical — agent probes, then submits a plan it knows will validate. Without probe, plans land partially valid and the friction reappears.

**C3. Multi-agent trust — parent/child session linkage**

- **Problem.** When Claude Code spawns a subagent (or OpenCode launches an inner agent), the subagent inherits the project but gets a fresh session-id. Session-risk and trajectory don't inherit. A subagent can sidestep parent's earned tightening.
- **Solution.** Session-tree state. PreToolUse reads `parentSessionId` env (`CLAUDE_CODE_PARENT_SESSION_ID` or harness-equivalent) and links child → parent in `~/.horus/session-tree.json`. `getSessionRisk` and `getSessionTrajectory` aggregate up the tree. Plan envelopes inheritable: child's effective scope = intersection(parent envelope, child contract).
- **Files.** NEW `runtime/session-tree.js`. EXTEND `runtime/session-context.js`, `runtime/decision-engine.js`, harness adapters (parent-id detection per harness).
- **Acceptance.** (1) Parent-child fixture: parent's session-risk=2 + child's risk=2 → effective risk=4 → trajectory nudge fires for child. (2) Child cannot consume an envelope step parent excluded. (3) Tree cleared when parent ends.
- **Risk if dropped.** Subagent workflows are an emerging norm (Claude Code, OpenCode plugin agents). Today they bypass session-level tightening — quietly.

**C4. Reviewed web-fetch capability pack**

- **Problem.** Agents currently choose between `curl|sh` (blocked) and "ask user every time". Documentation reading and package-registry probing are core agent tasks; today they incur disproportionate friction.
- **Solution.** New capability pack `modules/web-fetch-pack/`. Reviewed allowlist of doc/registry hosts (`docs.python.org`, `docs.rs`, `pkg.go.dev`, `registry.npmjs.org`, `pypi.org`, `crates.io`, `mvnrepository.com`, …). Adds `webFetchAllow` contract field (additive, v3). Inside allowlist: read-only HTTP GET; response auto-piped through secret-scan + taint annotator. Outside: existing escalation path. No POST. No cookie forwarding. Bound to project root.
- **Files.** NEW `modules/web-fetch-pack/`. EXTEND `schemas/horus.contract.schema.json` (v3), `runtime/contract.js`, `runtime/scopeMatch`, `runtime/taint.js` (mark fetched bytes external). NEW `scripts/web-fetch.sh` (the constrained fetcher).
- **Acceptance.** (1) Fetch from allowed host returns + journals + tags content as external. (2) Disallowed host blocks. (3) POST blocked. (4) Fetched bytes containing "now run rm -rf" cause subsequent bash use to require-review (tied to A2).
- **Risk if dropped.** Operators end up disabling network checks entirely to make agents productive. The capability pack is the safer alternative.

### Track D — Engineering quality / DX

**D1. Shadow / canary mode + metrics surface** (also closes Q5 partially, Q8)

- **Problem.** Today's tests verify structure (counts, fixture pass/fail). There is no behavioral measurement of autonomy or false-block rates. Operators cannot roll out tighter modes without surprise breakages.
- **Solution.** Shadow flag: `HORUS_SHADOW=1` runs `decide()` but does not enforce; emits `would-have-been: <action>` to journal. Operator runs a sprint in shadow before flipping enforce, then uses the journal to compare predicted vs. actual operator-corrected actions. New CLI: `horus-cli.sh metrics` prints autonomy %, false-block %, false-allow %, mean time-to-decision. Add a metrics CI gate that warns when false-block crosses a configurable threshold.
- **Files.** EXTEND `runtime/decision-engine.js` (shadow flag), `scripts/horus-cli.sh` (`metrics`, finish stub `diff-decisions`). NEW `runtime/metrics.js`. New thresholds in `horus.config.json`.
- **Acceptance.** (1) Shadow run on the eval corpus produces autonomy/false-block numbers within stable variance. (2) Metrics CI gate fails when synthetic regression injected. (3) `horus-cli.sh incidents` lists floor-fire events with timestamps and reasons (closes Q8).
- **Risk if dropped.** ARG continues to ship without behavioral metrics. Tightening decisions are made on intuition. The Phase 5 roadmap promise remains vapor.

**D2. Self-rollback skill — reversibility as first-class**

- **Problem.** Destructive writes are bound by approval, but reversibility is not built in. If a destructive command is approved and turns out wrong, recovery is manual.
- **Solution.** New optional skill `skills/self-rollback/`: every contract-allowed destructive write is preceded by `git stash --include-untracked` checkpoint with metadata in `~/.horus/rollback-log.json`. CLI: `horus-cli.sh rollback last|show|apply <id>`. Local-only; never network.
- **Files.** NEW `skills/self-rollback/SKILL.md`, `runtime/rollback.js`, `scripts/horus-cli.sh rollback`. EXTEND `runtime/action-planner.js` to include rollback hint in destructive-class plans.
- **Acceptance.** (1) `rm -rf build/` under contract allow → checkpoint created → restore works. (2) Rollback log journaled and pruned.
- **Risk if dropped.** Operators stay conservative on destructive-class promotions because mistakes are unrecoverable. Track C envelopes lose value because operators won't sign envelopes that include destructive steps.

**D3. Pre-flight test runner skill**

- **Problem.** Agents under contract scope can edit but skip tests because running them costs flow. The `require-tests` workflow is asked for and not executed.
- **Solution.** New skill `skills/pre-flight-tests/`: detects language (already in `context-discovery`), maps to test command (`pytest -q`, `go test ./...`, `cargo test`, `npm test --silent`), runs only tests touching changed files where possible. Output journaled. Action-planner inserts the test command into the plan whenever `require-tests` fires.
- **Files.** NEW `skills/pre-flight-tests/SKILL.md`. EXTEND `runtime/action-planner.js`, `runtime/context-discovery.js`.
- **Acceptance.** (1) Edit on a Python file → `require-tests` route → action plan includes `pytest -q` against changed files. (2) Same for Go, Rust, JS, TS.
- **Risk if dropped.** `require-tests` workflow remains aspirational.

**D4. Operator UX — suggest, bulk approval, decisions tail** (also closes Q7)

- **Problem.** Operators get fatigued. Even with learned-allow + auto-allow-once, repeated similar approvals happen. The suggestion engine referenced in roadmap is not present.
- **Solution.**
  - `horus-cli.sh suggest` — ranks top-N policy candidates from journal (frequency, low-risk, project-scoped) and prints a `runtime promote` command.
  - `horus-cli.sh approve --bulk --window 2h --classes safe-build` — time-windowed bulk approval bound to a session.
  - `horus-cli.sh decisions tail` — live tail with annotations.
  - `horus-cli.sh suggest --interactive` — accept/dismiss each candidate in a single flow.
- **Files.** EXTEND `scripts/horus-cli.sh`. NEW `runtime/policy-suggest.js`. NEW fixtures.
- **Acceptance.** (1) Sample journal yields a deterministic `suggest` output. (2) Bulk approval auto-expires after window. (3) Suggestions never include high-risk patterns.
- **Risk if dropped.** Operator fatigue is the ceiling on adoption. Without the suggest surface, even experienced operators leave value on the floor.

**D5. Boundary input validation for `decide()`** (closes Q3)

- **Problem.** `decide()` reads `input.tool`, `input.command`, `input.branch` without validation. Malformed input silently produces undefined-driven decisions that then journal as "allow" by default.
- **Solution.** A small `runtime/decide-input.js` that validates and normalizes the input shape at the function boundary: required fields, type assertions, length caps. Reject with a structured error code (`E_INVALID_INPUT_SHAPE`) routed to fail-closed behavior under enforce. Update `pretool-gate.js` to handle the error code as a require-review escalation.
- **Files.** NEW `runtime/decide-input.js`. EXTEND `runtime/decision-engine.js` (call validator first thing in `decide()`), `runtime/pretool-gate.js`. NEW fixture: malformed adapter output → fail-closed escalation under enforce, warn under default.
- **Acceptance.** (1) Fixture passes. (2) Existing decisions unchanged for well-formed input. (3) Decision p99 unchanged.
- **Risk if dropped.** A malformed harness adapter (Q2-style novel harness, or a partial adapter under development) silently produces "allow" decisions. The cross-harness equivalence guarantee leaks.

**D6. In-memory state interface for fixtures** (closes Q6)

- **Problem.** `session-context.js` and `policy-store.js` use real file IO during fixtures. Test runs are slower than they need to be, and the IO coupling prevents property-style or fuzz tests.
- **Solution.** Extract a `StateBackend` interface in `runtime/state-paths.js` with two implementations: `FileBackend` (current behavior) and `MemoryBackend` (used when `HORUS_STATE_BACKEND=memory`). Fixtures opt into memory backend. Production unaffected.
- **Files.** EXTEND `runtime/state-paths.js`, `runtime/session-context.js`, `runtime/policy-store.js`, `runtime/decision-journal.js` (journal stays file-only; the others gain backends). EDIT `scripts/run-fixtures.sh` (set memory backend). NEW fixture: memory-backend roundtrip parity with file-backend.
- **Acceptance.** (1) Run-fixtures wall time drops measurably (target: 30%+). (2) Cross-harness equivalence still passes. (3) File backend unchanged on production paths.
- **Risk if dropped.** Test cost grows linearly with fixture count. Each new module's fixtures push run-fixtures wall-time up; eventually CI throttles.

**D7. Intent classifier hardening** (closes Q4)

- **Problem.** Patterns are regex-only. Hand-coded confidence scores. No extensibility for project-specific intents. Edge cases (double-spaces, atypical quoting) misclassify.
- **Solution.** Two changes. (1) Tokenize the command via `shell-ast` (from A1) before pattern matching — eliminates whitespace and quote sensitivity. (2) Add `intents.user` field in `horus.config.json` so projects declare additional intents with patterns and confidence; classifier merges built-ins and user-defined, user-defined never demoting a built-in.
- **Files.** EXTEND `runtime/intent-classifier.js`, `runtime/project-policy.js`, `schemas/horus.config.schema.json`. NEW fixtures: spacing/quoting edge cases; project-defined intent.
- **Acceptance.** (1) `npm  test` (double space) classifies same as `npm test`. (2) Project with `intents.user.deploy_canary` sees its custom intent on matching commands. (3) Built-in intents never demoted by user-defined.
- **Risk if dropped.** Intent classification is downstream of risk-score and route-resolver. Edge-case misclassifications produce surprising routing decisions and erode trust.

### Track E — Documentation completion

**E1. MASTER_PLAN.md sections 7 & 8** (closes G6)

- **Problem.** Section 7 (Component Inventory: every runtime module → MASTER_PLAN role) and Section 8 (Host Compatibility Matrix: which harnesses get contract v3 support, which stay EXPERIMENTAL) are stubbed. Phase 3 is blocked here.
- **Solution.** Author both sections from the current state of the codebase. Section 7 is a table mapping each `runtime/*.js` to its MASTER_PLAN role; Section 8 is a matrix of harness × contract version × support tier. Update `DECISIONS.md` D24 to closed.
- **Files.** EDIT `MASTER_PLAN.md`. UPDATE `DECISIONS.md`.
- **Acceptance.** (1) Sections 7 and 8 written. (2) D24 marked closed. (3) Phase 3 entry condition cleared in `ROADMAP.md`.
- **Risk if dropped.** Phase 3 stays blocked. Every other improvement that depends on contract v3 wiring inherits the block.

**E2. Per-harness wiring docs to parity**

- **Problem.** `claude/hooks/README.md` and `opencode/WIRING_PLAN.md` are complete; the other four are stubs or partial.
- **Solution.** Bring `openclaw/WIRING_PLAN.md`, `codex/WIRING_PLAN.md`, `clawcode/WIRING_PLAN.md`, `antegravity/WIRING_PLAN.md` to claude-level detail: payload shapes, hook entry points, examples, troubleshooting, post-tool research notes. Tied to B1 (the docs and the verified adapter ship together).
- **Files.** EDIT four `WIRING_PLAN.md` files. NEW `*/POSTTOOL_RESEARCH.md` (created in A3, finalized here).
- **Acceptance.** (1) All six harness wiring docs match a documented template. (2) `references/per-tool-apply-status.md` reflects current reality.
- **Risk if dropped.** Operators of the four lower-tier harnesses bounce to vendor docs and back; integration friction stays high.

---

## 5. Sequencing — four waves, mapped to versions

**Wave 1 — v3.1 (close documented bypass classes + unblock Phase 3).**
A1 (shell-AST), A2 (provenance taint), A3 (PostToolUse parity), A4 (journal redaction), A5 (rate limiter), E1 (MASTER_PLAN sections 7-8).
Net: zero or positive on safety; modest power gain via fewer FPs once shell-AST replaces regex.

**Wave 2 — v3.2 (cross-harness completion).**
B1 (Codex/Clawcode/Antegravity promotion), B2 (contract v2 wire-up + v3 schema), B3 (acceptance gate hardening), E2 (wiring docs to parity).
Net: ARG works equally everywhere. Contract surface becomes trustable end-to-end.

**Wave 3 — v3.3 (capability negotiation — the big amplification lift).**
C1 (plan envelope), C2 (capability probe), C3 (multi-agent trust), C4 (web-fetch pack).
Net: 60-80% reduction in mid-task escalations on long tasks. Subagent workflows safe by default.

**Wave 4 — v3.4 (engineering quality + operator UX).**
D1 (shadow + metrics + incidents), D2 (self-rollback), D3 (pre-flight tests), D4 (operator UX), D5 (boundary validation), D6 (state backend interface), D7 (intent classifier hardening).
Net: measurable autonomy, recoverable mistakes, lower operator fatigue, faster CI.

Each wave ships as a distinct version bump with full `CHANGELOG.md` entries, fixture additions, and CI green. A wave does not ship until every item in the wave is at acceptance.

Inside a wave, work area-by-area: write the new module + fixtures first; wire into `decision-engine.js` last; behind `HORUS_FEATURE_<NAME>=1` flag where reasonable so a partial rollout cannot regress shipped behavior.

---

## 6. Acceptance metrics (target end of Wave 4)

- Cross-harness PostToolUse parity: 6/6.
- Documented bypass classes closed: shell-AST, indirect injection, journal-redaction-flag-correctness.
- Operator interruptions per long task: ↓ ≥ 40% on the eval corpus.
- False-block rate: ≤ 2% (measured in shadow against the eval corpus).
- False-allow rate: 0 for floor-bearing classes (kill-switch, secret class C, scope violation, protected-branch).
- Decision p99: < 10 ms Linux CI, < 500 ms Windows/WSL slow-fs (unchanged).
- Zero-dep runtime preserved.
- Fixture count growth: +120 (rough) for new areas; all green in CI.
- OWASP Agentic Top 10 (2026) coverage: every row "Covered" or "Documented limitation: …" — zero NOT COVERED.
- `run-fixtures.sh` wall time: ↓ ≥ 30% via memory state backend (D6).
- Self-acceptance gate: positive-signal only; env-var allowlist removed.

---

## 7. Out of scope (deliberately)

- Hosted dashboard / web UI. Local-first stays. Operator UX is CLI.
- Cloud telemetry aggregation. Could enable later, opt-in only, but not in this plan.
- Replacing Node hooks with a compiled binary. Adds build complexity for a marginal speed gain; current p99 already meets budget.
- Generic plugin marketplace. Capability packs cover the same need with stricter boundaries.
- Auto-applying policy suggestions. Suggestion engine surfaces; operator promotes. D11/D13/D20 in `DECISIONS.md` are explicit on this and stay.
- LLM-based command classifier. Local-first + zero-dep + deterministic precludes this.

---

## 8. Rejected directions (explain why, so we don't revisit)

- **"Soft floors" for trusted harnesses.** Some floors could be relaxed if harness identity is verified. Rejected: floor identity is the foundation. Anything below the floor is not a floor.
- **Agent self-acceptance of contract changes.** Plan envelope is signed by the agent's runtime; contract amendments still require operator. Rejected because amend → accept is the human gate that makes the rest of the system trustable.
- **Auto-promote learned-allow at low risk without human review.** Rejected per D11/D13/D20. The visible-suggestion model is the contract.
- **MCP servers running outside contract scope.** Rejected: MCP is in scope of contract via B2 (per-MCP-server policy). No silent surface.
- **Outbound network egress without allowlist.** Rejected: web-fetch pack (C4) gates by host. Anything else is escalation.
- **Cross-machine policy sync.** Out of scope of "local-first". Could be added later as a one-way export, never auto-import.
- **Replacing the hand-coded confidence scores in intent classifier with a learned model.** Rejected: deterministic + zero-dep precludes a model. D7 keeps hand-coded scores but makes them tokenizer-aware and user-extensible.

---

## 9. Implementation handoff notes

For whoever picks this up:

1. **Read the current state of every file listed under "Files" before writing.** This plan is engineered against `runtime/*.js` as it stands at commit `a071011` (HEAD as of 2026-05-07). Drift checks: re-read `decision-engine.js` step boundaries, the contract schema, and the fixture catalogue at each wave start.
2. **Write the new module first, with fixtures, before wiring into `decide()`.** Wiring last makes the new code reviewable in isolation and reverts cleanly if a wave is paused.
3. **Add `check-*.sh` and call it from `scripts/run-fixtures.sh`.** Without this, the gate doesn't actually exist.
4. **Wire into `decision-engine.js` behind a feature flag (`HORUS_FEATURE_<NAME>=1`) where reasonable.** Partial rollout cannot regress shipped behavior. Remove the flag in the same wave once green.
5. **Update `MODULES.md`, `ARCHITECTURE.md` (Sections 1 and 2 if precedence changes), `references/owasp-agentic-coverage.md`, `CHANGELOG.md` (Unreleased), and `ROADMAP.md` (move closed items to "Closed") in the same PR as the code change.** Never separate.
6. **Bench every wave.** `scripts/bench-runtime-decision.sh` p99 must not regress > 1.5×. If it does, find the cause before merging.
7. **CI gates that must stay green every wave:** `check-zero-deps.sh`, `check-counts.sh`, `check-decision-replay.sh`, `check-cross-harness-equivalence.sh`, `eval-decision-quality.sh`, `bench-runtime-decision.sh`.
8. **Hard rules during implementation.**
   - Do not change canonical-json output format. Contract hashes must stay stable across versions.
   - Do not delete journal entries. Rotation only.
   - Do not add a third-party `require()` in `runtime/`.
   - Do not put state outside `HORUS_STATE_DIR`.
   - Do not weaken any floor under any flag.
   - Do not skip fixtures. New surface without a fixture is rejected at review.

---

## 10. Quick reference — what changes vs. what stays

| Surface | Change | Rationale |
|---|---|---|
| Hard floors | unchanged | foundational invariant |
| `runtime/*.js` zero-dep | unchanged | foundational invariant |
| `~/.horus` storage | unchanged paths; new files added | backward compat |
| Contract schema v1, v2 | unchanged | additive evolution to v3 |
| Decision precedence ladder | extends from 15 to 17 rungs (plan-envelope at 11.5, taint floor at 8.5) | additive |
| CLI entry points | new subcommands: `plan`, `probe`, `metrics`, `suggest`, `rollback`, `incidents`, `operator-token` | additive |
| Fixtures | grows ~120 | additive |
| Per-harness adapters | tightened (Codex/Clawcode/Antegravity) | promotion |
| Hooks | new PostToolUse adapters per harness | parity closure |
| State backend | new `StateBackend` interface (file + memory) | DX, fixture speed |
| Acceptance gate | env-var allowlist replaced by positive operator signal | hardening (Q2) |
| Decision journal | redaction actually implemented | hardening (Q1) |

---

## 11. End-state

When Wave 4 closes, an operator running ARG on Claude Code or any of the five other harnesses gets:

- a single contract that covers filesystem, network, secrets, branches, shell tools, MCP servers, skills, time windows, and budgets;
- a plan envelope they review and sign once for a multi-step task, then watch the agent run silently inside it;
- a probe surface the agent uses to plan around constraints up front;
- provenance-aware injection defense that lets the agent read freely and only escalates on suspicious *use*;
- a self-rollback safety net for destructive ops;
- shadow/canary mode plus measurable autonomy and false-block rates;
- the same surface across every supported harness with no silent gaps;
- a hardened acceptance gate that depends on positive operator signal, not the absence of harness signals;
- a decision journal where the redaction flag actually redacts.

The agent runs harder. The operator approves less. The audit trail tells the whole story. The hard floors never moved.
