# Changelog

All notable changes to Agent Runtime Guard are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

No pending changes.

---

## [3.0.0] — 2026-04-27

> **Breaking:** All `ECC_*` environment variables renamed to `HORUS_*`. Config file `ecc.config.json` → `horus.config.json`. Contract file `ecc.contract.json` → `horus.contract.json`. State dir `~/.openclaw/agent-runtime-guard` → `~/.horus`. CLI `ecc-cli.sh` → `horus-cli.sh`. ContractId prefix `arg-` → `hap-`. See `scripts/horus-rebrand.sh` for the migration script.

### Migration — existing state under `~/.openclaw/agent-runtime-guard/`

The runtime default state directory has moved. If you have an existing installation:

- **Option A (recommended):** Move your state dir — `mv ~/.openclaw/agent-runtime-guard ~/.horus`
- **Option B (preserve old path):** Set `HORUS_STATE_DIR=$HOME/.openclaw/agent-runtime-guard` in your shell profile or `horus.config.json` to keep using the legacy location.

The `HORUS_STATE_DIR` environment variable overrides the default in all runtime modules (`policy-store.js`, `contract.js`, `decision-journal.js`, `session-context.js`) and is already used by all CI/test scripts for isolation.

### Phase 1 — Foundation: rebrand + close structural weaknesses

#### Added
- `MASTER_PLAN.md`: Strategic architecture document (20 sections). Pass-1 sections fully authored: Vision, Product Identity, Research Findings (top 5 capability areas), Rebranding Specification, Architecture Overview, Phase Plan, Language Policy, Risk Assessment, Non-Goals, Decision Log, Execution Flow, Security Contract UX.
- `references/v2-rewrite-plan-rev3.md`: Canonical W1–W14 weakness status reconstruction. 11 fully fixed, 3 closed by this release (W8, W11, W14).
- `scripts/horus-rebrand.sh`: One-time rename script (ECC_ → HORUS_, ecc.* → horus.*). Supports `--dry-run` (default) and `--apply` modes.

#### Fixed (W11 — High-risk non-destructive pre-approval)
- `runtime/contract.js` (`scopeMatch`): Added `scopes.shell.toolAllow` prefix-matching before the class-specific remote-exec/auto-download/global-install gates. Commands listed in `toolAllow` (e.g. `"npx -y"`, `"curl | bash"`, `"npm install -g"`) return `reason: "tool-allow-matched"`.
- `runtime/decision-engine.js` (Step 11): `canDemoteEscalate` flag — `escalate → allow` demotion is now permitted when `contractReason === "tool-allow-matched"`. All other hard floors (block, require-review, critical) are unchanged.
- `scripts/run-fixtures.sh`: 6 new inline assertions for toolAllow pre-approval. Fixture count 180 → 183.

#### Fixed (W14 — Docs/reality drift)
- `ARCHITECTURE.md`: Added `index.js`, `intent-classifier.js`, `route-resolver.js` to the Runtime Module Map (count 20 → 23).
- `MODULES.md`: Added `intent-classifier.js` and `route-resolver.js` to the Runtime Autonomy Layer table.
- `DECISIONS.md` (D5): Updated from stale "hooks do not enforce" to accurate two-mode description (warn default / exit 2 enforce).

#### Changed (W8 — state-paths.js unified + brand rename)
- `runtime/state-paths.js`: `stateDir()` default → `~/.horus`. `hookStateDir()` legacy `.openclaw/ecc-safe-plus` default → `~/.horus`. `instinctDir()` default → `~/.horus/instincts`. Override via `HORUS_STATE_DIR`.
- All 95 files touched by the rename: `ECC_*` → `HORUS_*`, `ecc.*` → `horus.*`, `arg-` contractId prefix → `hap-`.
- `runtime/contract.js`: `newContractId()` generates `hap-YYYYMMDD-hex` (was `arg-`). `acceptedContractsPath()` reads `HORUS_STATE_DIR`.
- `schemas/horus.contract.schema.json`: contractId pattern `^arg-` → `^hap-`.
- File renames: `schemas/ecc.config.schema.json` → `schemas/horus.config.schema.json`, `schemas/ecc.contract.schema.json` → `schemas/horus.contract.schema.json`, `scripts/ecc-cli.sh` → `scripts/horus-cli.sh`, `scripts/ecc-diff-decisions.sh` → `scripts/horus-diff-decisions.sh`, `ecc.config.json.example` → `horus.config.json.example`, `ecc.contract.json.example` → `horus.contract.json.example`.

Fixture count after Phase 1: **183 fixture-based tests**.

---

### Phase 3 — Autonomous routing foundation

#### Added
- `runtime/intent-classifier.js`: Pure pattern-based classifier mapping shell commands to one of eight intents (`explore`, `build`, `deploy`, `modify`, `configure`, `cleanup`, `debug`, `unknown`). Returns `{ intent, confidence, indicators }`. Zero external dependencies.
- `runtime/route-resolver.js`: Static routing table mapping classified intents to workflow lanes (`direct`, `verification`, `review`) plus an optional target script. Supports per-project overrides via `context.routingTable`. Exports `resolveRoute`, `DEFAULT_ROUTING_TABLE`, `KNOWN_INTENTS`.
- `runtime/decision-engine.js`: `decide()` now calls `classifyIntent(input.command)` and exposes `intent` in the return object, the explanation string, and the decision journal entry.
- `runtime/index.js`: Exports `classifyIntent`, `resolveRoute`, `DEFAULT_ROUTING_TABLE`, `KNOWN_INTENTS`.
- `scripts/horus-cli.sh runtime classify <command>`: CLI subcommand that classifies a shell command and prints `{ intent, confidence, indicators }` as JSON.
- `scripts/horus-cli.sh runtime route <command>`: CLI subcommand that classifies then routes a command, printing combined classification + route JSON.
- `scripts/run-fixtures.sh`: 18 new inline assertions — 12 intent-classifier unit tests + 6 route-resolver unit tests. Executed test count: 158 → 180.

---

### Phase 1 — Context isolation + fixture correctness

#### Added
- `tests/fixtures/dangerous-command-gate/dcg-enforce-npx-y-feature-branch.*`: Companion fixture — `npx -y` on a non-protected feature branch with HORUS_ENFORCE=1 routes (exit 0). Covers the medium-risk warn path.
- `tests/fixtures/dangerous-command-gate/dcg-enforce-hard-reset-feature-branch.*`: Companion fixture — `git reset --hard` on a non-protected feature branch with HORUS_ENFORCE=1 routes (exit 0).
- `tests/fixtures/opencode/opencode-enforce-npx-y-feature-branch.*`: Same coverage for OpenCode adapter.
- `tests/fixtures/opencode/opencode-enforce-hard-reset-feature-branch.*`: Same coverage for OpenCode adapter.

#### Fixed
- `runtime/pretool-gate.js`: `discover()` call now forwards `rawInput.branch` so fixture inputs (and real hook payloads) can supply a branch override, bypassing live git detection. Prevents protected-branch context from contaminating fixtures run from the `master` working tree.
- `tests/fixtures/dangerous-command-gate/dcg-enforce-npx-y.*` and `dcg-enforce-hard-reset.*`: Corrected `expected_exit` 0 → 2 and `expected_stderr` → `BLOCKED`. These fixtures run without a branch override, so context-discovery detects `master` (protected), pushing the risk score from medium to critical — the runtime correctly blocks them.
- `tests/fixtures/opencode/opencode-enforce-npx-y.*` and `opencode-enforce-hard-reset.*`: Same correction as above for the OpenCode adapter path.

Fixture count after Phase 1: **183 fixture-based tests** (179 → 183; +4 companion fixtures).

---

### Pre-release hardening: cross-harness parity + output sanitization

#### Added
- `claude/hooks/output-sanitizer.js`: PostToolUse hook scans tool output for 23 secret patterns. Warns when a credential is echoed by a tool; cannot block (PostToolUse is informational). Extends the same `runtime/secret-scan.js` patterns used by the PreToolUse spine.
- `runtime/pretool-gate.js`: Cross-harness secret-scan parity — `scanSecrets()` is now called for every harness (claude, opencode, openclaw), not just via the Claude-specific `secret-warning.js` hook. Secrets upgrade `payloadClass` to C, triggering the hard floor in `decide()` identically across all harnesses.
- `tests/fixtures/cross-harness/ch-secret-api-key.input`: New fixture verifying `sk-proj-*` bearer token detection via the cross-harness path.
- `tests/fixtures/dangerous-command-gate/dcg-enforce-hard-reset.{input,expected_exit,expected_stderr}`: Enforce-mode fixture for `git reset --hard` — confirms medium-risk (route) command warns but does NOT block in enforce mode (exit 0). Closes gap in claude enforce coverage.
- `tests/fixtures/dangerous-command-gate/dcg-enforce-npx-y.{input,expected_exit,expected_stderr}`: Enforce-mode fixture for `npx -y` — confirms medium-risk command warns but does not block (exit 0).
- `tests/fixtures/dangerous-command-gate/dcg-enforce-rm-no-preserve-root.{input,expected_exit,expected_stderr}`: Enforce-mode fixture for `rm --no-preserve-root -rf /` — confirms critical-risk command blocks (exit 2).
- `tests/fixtures/kill-switch/ks-output-sanitizer.input`: Kill-switch fixture for output-sanitizer (exit 0, passthrough informational hook).

#### Fixed
- `tests/fixtures/opencode/opencode-enforce-hard-reset` and `oc-enforce-hard-reset`: Wrong expected_exit (was 2, corrected to 0). `git reset --hard` scores medium risk (5) → route → enforcementAction=warn → exit 0 in enforce mode.
- `tests/fixtures/opencode/opencode-enforce-npx-y` and `oc-enforce-npx-y`: Wrong expected_exit (was 2, corrected to 0). `npx -y` scores medium risk (5) → route → exit 0 in enforce mode.

#### Changed
- `runtime/risk-score.js`: Protected-branch matching now uses `globMatch()` from `runtime/glob-match.js` instead of `.includes()`. Glob patterns like `release/*` in `branches.protected` now correctly match `release/1.2` and similar branch names.
- `scripts/check-counts.sh`: `EXPECTED_HOOKS` 12 → 13; `EXPECTED_FIXTURES` 175 → 179.
- `scripts/check-kill-switch.sh`: Added output-sanitizer.js as a passthrough hook (exit 0); count updated 12 → 13.
- `scripts/run-fixtures.sh`: Added output-sanitizer kill-switch fixture run.
- `scripts/hooks-baseline.sha256`: Added output-sanitizer.js entry.
- `README.md`: Hook count 12 → 13; fixture count 174 → 179; added output-sanitizer.js to hook table.
- `references/full-power-status.md`: Fixture count updated 174 → 179 (179/179 passing).

Fixture count after this batch: **179 fixture-based tests**.

### Contract schema v2 evolution

#### Added

- `schemas/horus.contract.schema.json`: `version` enum expanded to `[1, 2]`. Three new optional top-level fields (v2 only):
  - `validity` — UTC time-window (`activeHoursUtc: {start, end}`) and `activeDays` array. Controls when `contract-allow` demotions are honoured; engine floors always apply.
  - `contextTrust` — ordered array of `{branchPattern, trustPosture}` entries for per-branch trust posture overrides. First match wins; falls back to top-level `trustPosture`.
  - `scopes.tools` — `perToolAllow` array of `{tool, commandGlobs?, pathGlobs?}` entries for finer-grained per-tool allowlists beyond the shell scope.
  All v1 contracts continue to validate without change (new fields are optional).
- `scripts/migrateV1ToV2.js`: In-place upgrade script. Reads a v1 contract, bumps `version` to 2 and `revision` by 1, updates `acceptedAt`, recomputes `contractHash` via `canonical-json.js`, validates against the updated schema, writes the result. Supports `--dry-run` and `--input`/`--output` flags.
- `scripts/check-migrate-v1-v2.sh`: CI check verifying round-trip migration correctness: creates a v1 fixture, runs migration, validates version/revision/hash, confirms idempotency (v2 → v2 is a no-op).
- `.github/workflows/check.yml`: Added "Contract schema v2 migration" CI step.

#### Changed

- `scripts/check-counts.sh`: `EXPECTED_SCRIPTS` 61 → 63.
- `README.md`: Scripts section count updated; `migrateV1ToV2.js` and `check-migrate-v1-v2.sh` added to script table.

---

### Scope-defined contract CI gate

#### Added

- `scripts/check-decision-replay.sh`: CI gate that replays the shipped sample journal through the current decision engine and exits 1 on any action divergence. Catches regressions in risk scoring, decision routing, or policy logic.
- `artifacts/journal/sample-journal.jsonl`: 12 representative JSONL entries (allow, route, modify, require-tests, escalate, block across low/medium/high/critical risk) generated with `HORUS_TRAJECTORY_WINDOW_MIN=0` and per-entry fresh state for deterministic replay.
- `.github/workflows/check.yml`: Added "Decision replay (sample journal CI gate)" step between cross-harness and contract checks.

#### Changed

- `scripts/check-counts.sh`: `EXPECTED_SCRIPTS` 60 → 61 (sh+js count).
- `README.md`: Scripts section count 61 → 62 (total file count, including `hooks-baseline.sha256`); added `check-decision-replay.sh` to script table.

---

### Legacy 4-part learned-allow key removal

#### Changed

- `runtime/policy-store.js`: Removed the legacy 4-part key read fallback from `isLearnedAllowed()`, `getApprovalCount()`, `recordApproval()`, `getSuggestionForInput()`, and `getPolicyFacts()`. These functions now read exclusively from the 5-part `fineKey` (project-scoped, shipped as the write path in v2.0.1). The one-release back-compat window has closed. Old learned-allow decisions stored under the legacy 4-part key are no longer honoured; operators who need to migrate can re-record approvals.

---

### Correctness hardening batch (H1–H3 + doc sync)

#### Fixed

- **H1 — Hermetic fixture state** (`scripts/run-fixtures.sh`): Added suite-level `HORUS_STATE_DIR=$(mktemp -d)` + cleanup trap, plus per-fixture `HORUS_STATE_DIR` on each `node` invocation. Previously, trajectory state (`recentEscalations`, `sessionRisk`) accumulated across fixture invocations in `~/.horus/session-context.json`. Once ≥3 escalations built up from earlier fixtures, the trajectory-nudge in `runtime/decision-engine.js:235-239` promoted medium-risk commands to `require-review` → `enforcementAction="block"` → exit 2, causing `dcg-enforce-hard-reset`, `dcg-enforce-npx-y`, and their opencode/oc variants to fail. Fixture count: 158 pass, 0 fail.
- **H1 — enforce-action gap** (`runtime/decision-engine.js:283`): Added `require-tests` to the `enforcementAction` blocking set (`["block","escalate","require-review","require-tests"]`). High-risk destructive-delete commands (score 7, `require-tests` action) now block (exit 2) under HORUS_ENFORCE=1 rather than silently warning. Previously these were relying on accumulated session-risk state to trigger the block — correct behavior, wrong mechanism.
- **H2 — bench platform detection** (`scripts/bench-runtime-decision.sh`): Broadened Windows detection from `grep -qi mingw` to also match `OS=Windows_NT`, MinGW/MSYS/Cygwin, and WSL-on-`/mnt/`. Added `slow_fs` flag passed as argv[5] to Node. Node side now keys the baseline by `platformKey` (`win32-slowfs` on slow-FS environments, raw `process.platform` elsewhere) instead of `process.platform` alone. Added 3× sanity guard: if current p50 is >3× the recorded baseline, the overwrite is skipped (indicates wrong FS context).
- **H2 — bench baseline reset** (`artifacts/bench/baseline.json`): Prior `"linux"` entry contained Windows-magnitude p50=36.892ms / p99=178.876ms — physically inconsistent with real Linux (documented p50<1ms, p99<5ms). The entry was written during a WSL-on-`/mnt/c` session where `process.platform === "linux"` but FS IO was Windows-class; the bash-side `mingw`-only detection fell through to the 5ms Linux ceiling, producing the reported failure `p99 236.673ms exceeds cap 5.000ms`. File reset to `{}` and regenerated with correct `win32-slowfs` key.
- **H3 — fail-closed under HORUS_ENFORCE=1** (`runtime/pretool-gate.js:182-200`): The `decide()` error catch block now closes on ANY non-trivial safety signal under enforce: a dangerous-pattern hit at any severity (medium/high/critical), a secret-bearing payload (`secretHit`), or a high-sensitivity path. Previously only `critical` or `high` pattern hits triggered fail-closed; secret-only payloads, sensitive-path signals, and medium-severity patterns were silently allowed when the runtime was unavailable.

#### Changed

- `SECURITY_MODEL.md`: Added "Fail-Closed Behavior Under HORUS_ENFORCE=1" section documenting the decide()-throw semantics and the availability/safety tradeoff.
- `references/owasp-agentic-coverage.md`: ASI05 updated — table row now reflects `claude/hooks/output-sanitizer.js` PostToolUse implementation for Claude Code; NOT COVERED section updated with honest deferral status for OpenCode (PreToolUse-only in-repo wiring, pending contributor verification) and OpenClaw (event model unverified).
- `opencode/WIRING_PLAN.md`: Added "PostToolUse Parity" section documenting that PostToolUse extension is deferred pending upstream verification.
- `ROADMAP.md`: Added hardening batch summary to `[Unreleased]`; added "OpenCode PostToolUse output-sanitizer parity" to `Post-v2.1 Candidates`.

#### Deferred

- **OpenCode PostToolUse output-sanitizer parity**: In-repo wiring (`opencode/WIRING_PLAN.md`) documents PreToolUse only. No confirmed upstream PostToolUse support. Extension deferred until a contributor verifies the wiring path. See `Post-v2.1 Candidates` in ROADMAP.md.
- **OpenClaw PostToolUse**: PostToolUse event model is unverified for OpenClaw. Remains deferred.

---

## [2.1.1] — 2026-04-25

Post-implementation reality audit. Four verified defects fixed: contract subsystem was non-functional (accept/verify always threw), two new check scripts were structurally broken, and docs had drifted from behavior.

### Fixed
- `runtime/config-validator.js`: **Critical** — validator computed `actualType = typeof value`, which returns `"number"` for all numeric values, never `"integer"`. Schema declares `version` and `revision` as `integer`. Every `validateContract()` call failed with "expected integer, got number", making `contract accept` and `contract verify` throw unconditionally. Users could run `contract init` (which skips validation) but could never reach an accepted contract. Fixed by promoting numeric integers to `"integer"` when the schema expects `integer` and `Number.isInteger(value)` is true.
- `runtime/config-validator.js`: Added `minimum` and `maximum` range enforcement for numeric fields. `revision` schema declares `"minimum": 1` — previously silently ignored.
- `scripts/check-decide-on-every-call.sh`: **Critical (vacuous)** — script ran `node runtime/pretool-gate.js "claude"`, but `pretool-gate.js` is a CommonJS module with no `require.main === module` block. Node loaded and exited without calling `runPreToolGate()` or writing any journal entries. Rewritten to call `runPreToolGate()` directly via `require()` — the same call shape used by production adapters.
- `scripts/check-cross-harness-equivalence.sh`: All three harness calls shared one Node process and one `_stateCache` in `session-context.js`. `recordDecision()` mutated in-process state; harness #2 and #3 saw trajectory contaminated by harness #1's call. Added `resetCache()` call before each harness invocation. Also added a temporary isolated `HORUS_STATE_DIR` so the check does not touch real session state.
- `runtime/session-context.js`: Added `resetCache()` helper (flips `_stateCache = null`). Used by test scripts only — production code paths reload from disk.
- `scripts/check-contract.sh`: `validateContract` was imported but never called in the script. The integer-type bug shipped green because the failing code path was entirely uncovered. Added three new assertions: round-trip (`validateContract(generate(...))` must return `valid: true`), negative-string (`version: "1"` must fail integer check), and negative-minimum (`revision: 0` must fail minimum). Fixed false-pass: script printed "all assertions passed" unconditionally regardless of node heredoc exit code; now conditional on `_anyFailed`.

### Added
- `scripts/check-session-isolation.sh`: Asserts that trajectory state is partitioned by session ID — session B sees zero escalations from session A's history. Regression guard for `resetCache()` and session-context isolation.

### Changed
- `scripts/check-counts.sh`: Bumped `EXPECTED_SCRIPTS` 59 → 60.
- `runtime/pretool-gate.js`: Block messages now include the primary reason code in the "Runtime decision" line (e.g., `[no-contract-strict]`), making the internal reason diagnosable from logs without requiring structured JSON parsing.
- `runtime/risk-score.js`: Added two new risk patterns: `dd`+`of=` scores +8 (`disk-write-pattern`). rm targeting filesystem root (`rm … /` trailing slash with no further path segments) scores +4 (`filesystem-root-target`) by inspecting the command string, matching cases where `targetPath` is not available in the hook input.
- `VERSION`: Bumped to 2.1.1.

### Docs
- `ARCHITECTURE.md` env-var table: `HORUS_KILL_SWITCH=1` row now correctly describes "PreToolUse hooks exit 2 (block); informational hooks pass stdin through unchanged". Previous text said "all hooks pass through immediately" — that was the pre-2.0.1 bug behavior, not the fixed behavior.
- `SECURITY_MODEL.md`: Kill-switch section no longer says "for full blocking, also set HORUS_ENFORCE=1". PreToolUse hooks exit 2 unconditionally — no additional flags needed.
- `README.md`: Fixture count updated from 130 to 174 fixture-based tests.
- `CHANGELOG.md` (2.0.1 entry): Tightened `fineKey` description — "5-part: includes `projectRoot`" → "5-part: tool / commandClass / pathBucket (project-relative) / branchBucket / payloadClass — closes the cross-project leak via the relative-path bucket". The pathBucket uses `path.relative(projectRoot, ...)` rather than literally including the projectRoot string.

---

## [2.1.0] — 2026-04-25

Phase D hardening: macOS CI now required, bench baseline persisted across runs, three new harness adapters, telemetry aggregation.

### Added
- `codex/hooks/adapter.js`, `clawcode/hooks/adapter.js`, `antegravity/hooks/adapter.js`: Best-effort PreToolUse adapters using the broadest input-shape fallback chain. APIs not publicly documented — adapters are unverified; test against real hook payloads before using in production. READMEs updated to reflect adapter presence while retaining NOT YET SUPPORTED status.
- `runtime/telemetry.js`: Added `readTelemetry()` and `summarizeTelemetry()` exports. Groups events by type with count and lastSeen; returns date range.
- `scripts/horus-cli.sh telemetry report`: Prints a telemetry event summary (counts by event type, date range). `telemetry clear` removes the log file.

### Changed
- `.github/workflows/check.yml` (D1): Removed `allow_failure: true` from macOS matrix entry. macOS p99 ceiling is now required (200 ms). A failing macOS bench fails the entire CI run.
- `.github/workflows/check.yml` (D2): Added `actions/cache@v4` restore + save steps around the bench run. Cache key: `bench-baseline-${os}-${sha}`; restore key: `bench-baseline-${os}-`. The bench script's 1.5× baseline regression check now uses a persistent cross-run baseline instead of a local-only file.

---

## [2.0.1] — 2026-04-25

Security hotfix. Closes seven enforcement gaps found by post-ship audit (issues C1–C11 in audit-notes).

### Fixed
- `runtime/decision-engine.js` (C2): `blockResult` was undefined — `ReferenceError` was silently swallowed by the outer `catch{}`, allowing strict-mode + tampered contract hash to fall through. Replaced with `buildEarlyBlock(...)`.
- `runtime/pretool-gate.js` (C1): `decide()` was only called when a dangerous-pattern regex matched. Commands with no pattern match bypassed the entire decision engine (contract scope, payload-class, session-risk, trajectory). Now `decide()` runs on every tool call; pattern hits annotate but no longer gate.
- `runtime/pretool-gate.js`, all 10 PreToolUse hooks (C3, C4): Kill-switch was `exit 0` (silent allow). PreToolUse hooks now `exit 2` (block). Informational hooks (PostToolUse/SessionStart/Stop) remain `exit 0` + echo stdin.
- `claude/hooks/git-push-reminder.js` (C4): Had zero kill-switch handling. Added guard at handler start.
- `runtime/contract.js` (C5, C6): `scopeMatch()` used only `input.targetPath` string. Now calls `arg-extractor.extractPaths()` to get all command targets, resolves via `path.resolve` + `fs.realpathSync` (symlink escape protection), applies all-or-nothing semantics.
- `runtime/policy-store.js` (C7): `isLearnedAllowed()` used the legacy 4-part key — `rm -rf node_modules` in project A could unlock `rm -rf /etc` in project B. Switched to `fineKey` (5-part: tool / commandClass / pathBucket (project-relative) / branchBucket / payloadClass — closes the cross-project leak via the relative-path bucket) with one-release legacy read fallback.
- `runtime/decision-engine.js` (C8): Session-risk ≥ 3 was not a true floor — only +1..3 score points. Now escalates unconditionally before `contract-allow` can demote.
- `runtime/decision-engine.js` (C9): Learned-allow could demote any medium/high action. Now narrowed to `destructive-delete-pattern` at high risk only.
- `runtime/decision-engine.js` (C10): `contract-allow` could demote `require-review` (protected-branch floor). Guard now also protects `require-review`.
- `runtime/decision-engine.js` (C11): `floorFired` field was never written to journal entries. Now included when a floor constrained the decision.
- `runtime/contract.js` (C14): `auto-download` always denied regardless of `remoteExecAllow`. Now reads `scopes.network.remoteExecAllow`; denies only when empty.
- `runtime/contract.js` (C15): `hard-reset`, `destructive-db`, and `disk-write` were in `GATED_CLASSES` but had no `scopeMatch()` handler — all fell through to `gated-class-${cmdClass}-no-coverage`. Now handled via `destructiveAllow` by `commandClass`.
- `runtime/decision-engine.js`, `runtime/contract.js` (C13): `GATED_CLASSES` differed between files. Now a single export from `contract.js`, imported by `decision-engine.js`.
- `schemas/horus.contract.schema.json` (B9): Added `description` fields to `outboundDeny`, `branches.protected`, and `secrets.scanMode` explaining floor semantics and the relationship between contract configuration and engine-level floors. `scanMode` enum `["block", "warn"]` already prevented "off" — this is documented explicitly. `payloadClasses.C` enum `["warn", "block"]` is unchanged and remains the model for floor enforcement at the schema level.

### Changed
- `scripts/horus-cli.sh contract amend`: Was a print-only stub. Now loads the accepted contract, calls `generate()` with `existingRevision + 1`, writes the draft, and prints the next revision number.
- `scripts/check-kill-switch.sh`: Updated expected exit codes — PreToolUse hooks must exit 2 under kill-switch (previously incorrectly asserted exit 0). Added `HORUS_ALLOW_MISSING_NODE=1` bypass; missing `node` now exits 1 instead of silently passing.
- `scripts/check-cross-harness-equivalence.sh`: Missing `node` now exits 1 instead of silently passing. Added `HORUS_ALLOW_MISSING_NODE=1` bypass.
- `scripts/check-counts.sh`: Bumped `EXPECTED_SCRIPTS` 57 → 59.
- `scripts/check-decide-on-every-call.sh`: New script. Fires 10 representative commands through `pretool-gate.js` (benign + gated) and asserts each one writes a journal entry. Verifies C1 fix holds.
- `scripts/check-cross-harness-equivalence.sh`: Missing `node` now exits 1 instead of silently passing. Added `HORUS_ALLOW_MISSING_NODE=1` bypass. Now reads commands from `tests/fixtures/cross-harness/*.input` when present; falls back to inline baseline.
- `claude/hooks/hook-utils.js`: Added `createAdapter({ harness, rateLimitKey, extractCommand, extractCwd, extractTool })` factory. Encapsulates stdin read, rate-limit guard, JSON parse, pretool-gate delegation, stderr output, hookLog, and exit-code handling.
- `claude/hooks/dangerous-command-gate.js`, `opencode/hooks/adapter.js`, `openclaw/hooks/adapter.js`: Reduced from 47/59/71 lines to 15/16/17 lines using `createAdapter`. No behavior change.
- `tests/fixtures/kill-switch/`: 12 new fixture inputs — 6 PreToolUse hooks asserting exit 2, 6 informational hooks asserting exit 0.
- `tests/fixtures/contract/`: 12 new fixture pairs covering gated-command strict-mode blocks, critical risk blocks, and allow paths.
- `tests/fixtures/cross-harness/`: 20 new fixture inputs (10 safe + 10 dangerous commands) used by `check-cross-harness-equivalence.sh`.
- `scripts/run-fixtures.sh`: Added kill-switch and contract fixture suite sections.

### Corrected (1.9.0 entry)
> The 1.9.0 CHANGELOG claimed: "All 12 hooks gated by kill-switch" and "`scripts/check-kill-switch.sh`: fires all 12 hooks… asserts exit 0 and stdout === stdin for each." Both statements were false. `git-push-reminder.js` had no kill-switch guard, and the correct kill-switch behavior for PreToolUse hooks is `exit 2` (block), not `exit 0`. Fixed in this release.

---

## [2.0.0] — 2026-04-25

Upfront security contract model. All fourteen structural weaknesses (W1–W14) from the v2.0 plan audit are addressed. Contracts are now default-on.

### Added
- `ARCHITECTURE.md`: Authoritative module map, Section 4.6 precedence matrix verbatim, storage layout, environment variable catalog, adapter contract, zero-dep policy. Closes W14 (docs drift).
- `CONTRACT.md`: Full field reference for `horus.contract.json`. Quick start, schema, gated capability classes, hash verification, scope matching algorithm, floors that cannot be overridden. Closes W14.
- `ROADMAP.md`: Forward-looking work only. Merged from `IMPROVEMENT_PLAN.md` + aspirational fragments. Closes W14.

### Changed
- `runtime/decision-engine.js`: Flipped `HORUS_CONTRACT_ENABLED` default — contracts are now **on by default**. Opt out with `HORUS_CONTRACT_ENABLED=0`. Previously required `HORUS_CONTRACT_ENABLED=1`.
- `runtime/decision-engine.js`, `runtime/session-context.js`, `runtime/policy-store.js`, `runtime/decision-journal.js`: Added `HORUS_READONLY_CONTRACT=1` guards on all write paths. In read-only mode, decisions proceed normally but zero bytes are written to policy-store, session-context, or decision-journal. Useful for CI/review runs.
- `.github/workflows/check.yml`: Added `macos-latest` with `bench_p99_ms: "200"` and `allow-failure: true` (one cycle, then enforce). Closes Section 7.6 of plan.
- `scripts/bench-runtime-decision.sh`: Added persistent baseline at `artifacts/bench/baseline.json` (per-platform p50/p95/p99). Fails if current p99 > 1.5× baseline p99 or > ceiling, whichever is tighter. Added cold-cache vs warm-cache reporting (first 10 calls vs full 1000). Closes Section 7.5 of plan.
- `README.md`: Rewrote L3–5 (was aspirational roadmap, now factual description of what v2.0 delivers). Updated script count to 57. Added links to ARCHITECTURE.md, CONTRACT.md, ROADMAP.md.
- `MODULES.md`: Removed broken references to `upstream-sync.md`, `vendor-policy.md`, `import-checklist.md` (files never existed). Replaced with existing `capability-log.md` and `parity-matrix.json`. Closes W14.
- `scripts/check-counts.sh`: No count changes; counts remain at v1.9.0 values.

### Deleted
- `IMPROVEMENT_PLAN.md`: Historical parity-phase doc. Content merged into `ROADMAP.md`. Closes W14.
- `references/unified-master-plan.md`: Stale, 92-fixture count was two versions behind. Content superseded by `ROADMAP.md`. Closes W14.

---

## [1.9.0] — 2026-04-25

Contract integration: wires `runtime/contract.js` into `decide()` (Phase 3, flag-gated). Session-id partitioning. All 12 hooks gated by kill-switch. `horus-diff-decisions.sh` regression replay harness.

### Added
- `runtime/decision-engine.js`: Section 4.6 precedence matrix implemented. Contract loaded lazily when `HORUS_CONTRACT_ENABLED=1`. Steps 2/5/11 added: hash-mismatch block, harness-out-of-scope block, contract-allow demotion. Gated capability classes (`GATED_COMMAND_CLASSES`) defined. `buildEarlyBlock()` helper journals every contract-floor refusal. `contract-allow` source exempt from trajectory nudge. Journal entries gain `contractId`, `contractRevision`, `scopeHit`. Closes W3 (no upfront contract) and W11 (high-risk non-destructive cannot pre-approve). Strict mode (`HORUS_CONTRACT_REQUIRED=1`) gates by capability class per Section 4.5a.
- `runtime/session-context.js`: Session-id partitioning. `startSession()` writes 16-hex session ID to `current-session-id` file. `recordDecision()` writes to `sessions[sid]` (up to 23 per session) while maintaining legacy `recent` field. Exports `startSession`, `currentSessionId`. Closes W2 (no session boundary).
- `claude/hooks/session-start.js`: calls `startSession()` at session begin so all subsequent `decide()` calls within the session are correctly partitioned.
- `scripts/horus-diff-decisions.sh`: replays last N journal `runtime-decision` entries through the current decision engine. Reports action promotions (more restrictive) as divergences; ignores legitimate `contract-allow` demotions (less restrictive). Exit 0 = clean. Closes Section 7.4 of plan.
- `scripts/check-kill-switch.sh`: fires all 12 hooks with `HORUS_KILL_SWITCH=1 HORUS_ENFORCE=1`, asserts exit 0 and stdout === stdin for each. Closes Section 7.2 kill-switch coverage requirement.

### Changed
- `scripts/check-counts.sh`: updated `EXPECTED_SCRIPTS` from 56 → 57.
- `scripts/horus-cli.sh check`: added "Kill-switch (all 12 hooks)" section running `check-kill-switch.sh`.
- `.github/workflows/check.yml`: added "Kill-switch (all 12 hooks)" step.

---

## [1.8.0] — 2026-04-25

Contract scaffolding behind `HORUS_CONTRACT_ENABLED=0`. Runtime ignores contracts for decisions this version; contracts can be authored and validated.

### Added
- `runtime/glob-match.js`: zero-dep glob matcher supporting `**`, `*`, `?`, `[abc]`, `!` negation, `${projectRoot}` substitution, Windows case-folding. No minimatch dependency.
- `runtime/canonical-json.js`: deterministic JSON stringify (keys sorted recursively) for contract hashing. Zero external deps.
- `runtime/arg-extractor.js`: minimal argv splitter (single/double quotes, backslash escapes, heredocs → opaque `<<HEREDOC`). Used for scope matching.
- `runtime/config-validator.js`: typed-field walker validating horus.config.json and horus.contract.json against JSON schemas. No ajv/zod dependency. Closes W9 (config has no schema; misconfiguration is silent).
- `runtime/decision-key.js`: finer-grained decision key with `pathBucket` (project-relative path prefix) and `branchBucket` (protected/feature/other). Closes W10 (decisionKey too coarse). Preserves legacy key for backward-compat.
- `runtime/contract.js`: contract lifecycle — `load()`, `verify()`, `accept()`, `generate()`, `scopeMatch()`, `harnessInScope()`. Hash is SHA-256 of canonical JSON excluding `contractHash` field itself. Self-accept guard: refuses when harness session env vars are detected.
- `schemas/horus.config.schema.json`: JSON schema for horus.config.json (W9).
- `schemas/horus.contract.schema.json`: JSON schema for horus.contract.json. Version 1. Payload class C cannot be set to `off` (floor complement).
- `horus.contract.json.example`: example contract document with inline comments.
- `scripts/check-contract.sh`: ≥50 assertions covering canonical-json, glob-match, arg-extractor, config-validator, decision-key, and contract module (generate, hash, scopeMatch, harnessInScope, tamper detection, revision downgrade rejection).
- `horus-cli.sh contract`: new subcommand with `init`, `accept`, `show`, `verify`/`status`, `diff`, `amend` operations.

### Changed
- `scripts/check-counts.sh`: updated `EXPECTED_SCRIPTS` from 55 → 56.
- `scripts/horus-cli.sh check`: added "Contract module" section running `check-contract.sh`.
- `.github/workflows/check.yml`: added "Contract module" step.
- `README.md`: updated script count to 56.

---

## [1.7.0] — 2026-04-25

### Added
- `runtime/pretool-gate.js`: single enforcement spine for all three harnesses (claude, openclaw, opencode). Inlines `classifyCommandPayload` and `classifyPathSensitivity`, loads dangerous patterns, runs `runtime.decide()`, enforces with exit 2. Closes W1 (triplicated decision logic). Returns `{ exitCode, stderrLines, logAction, logHitName }` for thin adapter wrappers.
- `runtime/secret-scan.js`: extracted secret pattern scanning logic from `claude/hooks/secret-warning.js`. Loads from `claude/hooks/secret-patterns.json` with fallback patterns. Exports `scanSecrets(text)`. Closes W5 (secret scan Claude-only).
- `scripts/check-cross-harness-equivalence.sh`: calls `runPreToolGate` with all three harness names for 20 representative commands and asserts identical `exitCode + logAction` across harnesses. Closes W13.
- 7 new enforce fixtures for OpenClaw (`oc-enforce-force-push`, `oc-enforce-drop-table`, `oc-enforce-curl-pipe`, `oc-enforce-hard-reset`, `oc-enforce-npx-y`, `oc-enforce-dd-device`, `oc-enforce-rm-no-preserve-root`). OpenClaw now has 8 enforce fixtures. Closes W12 for openclaw.
- 7 new enforce fixtures for OpenCode (`opencode-enforce-force-push`, `opencode-enforce-drop-table`, `opencode-enforce-curl-pipe`, `opencode-enforce-hard-reset`, `opencode-enforce-npx-y`, `opencode-enforce-dd-device`, `opencode-enforce-rm-no-preserve-root`). OpenCode now has 8 enforce fixtures. Closes W12 for opencode.
- `horus-cli.sh ci`: new full CI superset subcommand — runs `check` + `audit-local` + `audit-examples` + `verify-hooks-integrity` + `run-fixtures` + `bench-runtime-decision`. Matches the GitHub Actions workflow step-for-step. Closes Section 8.4 of the v2.0 plan.

### Changed
- `claude/hooks/dangerous-command-gate.js`: rewritten as ~30-line thin adapter delegating to `runtime/pretool-gate.js`. Closes W1.
- `claude/hooks/secret-warning.js`: rewritten as thin adapter delegating to `runtime/secret-scan.js` for pattern matching. Closes W5.
- `openclaw/hooks/adapter.js`: rewritten as ~30-line thin adapter delegating to `runtime/pretool-gate.js`. Closes W1.
- `opencode/hooks/adapter.js`: rewritten as ~30-line thin adapter delegating to `runtime/pretool-gate.js`. Closes W1.
- `scripts/horus-cli.sh check`: added cross-harness-equivalence section; removed bench (moved to `ci`); prints guidance to run `horus-cli.sh ci` for full CI set on success.
- `scripts/check-counts.sh`: updated `EXPECTED_FIXTURES` from 116 → 130, `EXPECTED_SCRIPTS` from 54 → 55.
- `.github/workflows/check.yml`: added "Cross-harness equivalence" step.
- `scripts/hooks-baseline.sha256`: regenerated after `dangerous-command-gate.js` and `secret-warning.js` rewrites.

---

## [1.6.0] — 2026-04-25

### Added
- `runtime/state-paths.js`: centralized path resolution for all state directories (`stateDir`, `hookStateDir`, `instinctDir`). Replaces two coexisting storage conventions and three hardcoded `~/.openclaw/` paths.
- `runtime/telemetry.js`: lightweight append-only telemetry log (`telemetry.jsonl`) for internal runtime events (corruption, migration). Records metadata only; disable with `HORUS_TELEMETRY=0`.
- `scripts/check-zero-deps.sh`: CI guard asserting `runtime/*.js` has no third-party `require()` calls. Fails if any non-builtin, non-relative import is found.
- `scripts/check-counts.sh`: CI guard asserting agent/rule/skill/hook/fixture/script counts match expected values. Fails on count drift.
- `references/archive/CLAUDE_CODE_HANDOFF-v1.0.md`: archived v1.0.0 handoff document (was stale at v1.0.0; current is v1.6.0).

### Changed
- `runtime/decision-journal.js`: journal rotation at 5 MB — rotates to `decision-journal.1.jsonl`, compresses older generations to `.2.jsonl.gz` / `.3.jsonl.gz`, drops generation 4+. Override threshold with `HORUS_JOURNAL_MAX_MB`. Closes W6 (unbounded journal).
- `runtime/policy-store.js`, `runtime/session-context.js`, `runtime/project-policy.js`: corrupt file handling — on JSON parse failure, copies file to `<file>.corrupt-<ts>.bak`, writes to stderr, emits telemetry event, then defaults. Closes W7 (silent reset on corruption).
- `claude/hooks/hook-utils.js`: `hookLog` and `rateLimitCheck` now resolve state directory via `runtime/state-paths.hookStateDir()` instead of a hardcoded path.
- `claude/hooks/strategic-compact.js`, `claude/hooks/instinct-utils.js`: resolve storage directories via `runtime/state-paths` instead of hardcoded `~/.openclaw/` paths. Closes W8 (two storage conventions + hardcoded paths).
- `claude/hooks/memory-load.js`: removed hardcoded developer-machine path (`-home-khouly--openclaw-workspace-sand`). Closes W8 leaked developer path.
- `claude/hooks/session-start.js`, `session-end.js`, `strategic-compact.js`, `memory-load.js`, `pr-notifier.js`, `build-reminder.js`, `quality-gate.js`: added `HORUS_KILL_SWITCH` guard — all 7 non-decide hooks now honor the kill switch. Closes W4 (kill-switch 7/12 gap).
- `CLAUDE_CODE_HANDOFF.md`: replaced with redirect notice pointing to the archive.
- `horus.config.json.example`: removed dead `hooks.enforce_secrets` field.
- `README.md`: corrected rule count (81→82), script count (51→54), added `check-zero-deps.sh` and `check-counts.sh` to the scripts table.

### Fixed
- Kill-switch (`HORUS_KILL_SWITCH=1`) now reaches all 12 hook files, not just the 5 that call `runtime.decide()`.

---

## [1.5.0] — 2026-04-24

### Added
- `opencode/hooks/adapter.js`: real runtime hook adapter for OpenCode harnesses (Claude Code fork). Reads OpenCode's native `{ "tool_name": "Bash", "args": { "command": "..." } }` input shape, runs all 20 dangerous patterns, calls `runtime.decide()`, warns to stderr or exits 2 in enforce mode.
- `tests/fixtures/opencode/`: 12 fixtures for the adapter (104 → 116/116 passing) covering dangerous commands, enforce/block mode, safe pass-through, and borderline sudo.
- `scripts/check-opencode-adapter.sh`: standalone adapter smoke test — existence, syntax, safe/dangerous/enforce/args-field extraction.
- `opencode/WIRING_PLAN.md`: updated with adapter wiring instructions and input shape documentation.

---

## [1.4.0] — 2026-04-24

### Added
- `openclaw/hooks/adapter.js`: real runtime hook adapter for OpenClaw-style harnesses. Reads OpenClaw's native `{ "tool": "shell", "cmd": "..." }` input shape (with Claude Code shape fallback), runs all 20 dangerous patterns from `claude/hooks/dangerous-patterns.json`, calls `runtime.decide()`, warns to stderr in warn mode and exits 2 in enforce mode (`HORUS_ENFORCE=1`).
- `tests/fixtures/openclaw/`: 12 fixtures for the adapter (92 → 104/104 passing) covering dangerous commands (rm-rf, force-push, curl|sh, DROP TABLE, npx -y, git reset --hard), enforce/block mode, safe pass-through (ls, git-log, npm install, git push), and borderline sudo.
- `scripts/check-openclaw-adapter.sh`: standalone adapter smoke test — existence, syntax, safe/dangerous/enforce/cmd-field extraction.
- `openclaw/WIRING_PLAN.md`: updated with adapter wiring instructions, input shape documentation, and fixture reference.

---

## [1.3.1] — 2026-04-24

### Added
- `runtime/risk-score.js`: four new risk patterns closing documented engine gaps:
  - `hard-reset-pattern` (`git reset --hard`) — +4 points, medium → `route`
  - `kubectl-delete-pattern` (`kubectl delete|remove`) — +4 points, medium → `route`
  - `git-clean-pattern` (`git clean -f`) — +3 points, medium → `route`
  - `broad-permission-pattern` (`chmod 777/666/o+w/a+w`) — +3 points, medium → `route`
- `tests/eval-corpus.json`: 7 new entries (57 total: 29 safe / 12 dangerous / 16 borderline):
  - borderline-08/09 updated from `allow` (known gap) to `warn` (now caught)
  - borderline-14 (`git clean -fd`), borderline-15 (`chmod 777`), borderline-16 (`kubectl delete namespace`)
  - safe-26 (`git reset HEAD~1` — soft reset, no `--hard`), safe-27 (`kubectl get pods`), safe-28 (`chmod +x`), safe-29 (`git clean --dry-run`)
- `references/decision-quality.md`: baseline updated to v1.3.1 (57 entries, 0.0% FP / 0.0% FN).

---

## [1.3.0] — 2026-04-24

### Added
- `tests/eval-corpus.json` — 50-entry labeled eval corpus: 25 safe, 12 dangerous, 13 borderline. Each entry drives one `runtime.decide()` call and specifies an expected action class and expected reason codes.
- `scripts/eval-decision-quality.sh` — decision quality measurement script. Runs the labeled corpus through `runtime.decide()` in isolation (per-entry `sessionRisk=0`, `HORUS_TRAJECTORY_THRESHOLD=9999`), maps outcomes to `allow/warn/block` classes, and reports false-positive rate (safe entries blocked) and false-negative rate (dangerous entries missed). Exits 1 if FP% > `HORUS_EVAL_MAX_FP_PCT` (default 10%) or FN% > `HORUS_EVAL_MAX_FN_PCT` (default 20%).
- `horus-cli.sh eval` subcommand — dispatches to `eval-decision-quality.sh`. Supports `--verbose`, `--max-fp-pct`, `--max-fn-pct`, `--corpus`.
- `references/decision-quality.md` — baseline quality report for v1.3.0: 0.0% FP / 0.0% FN against the corpus, with per-entry table and notes on known engine gaps.
- README updated: Quick Start step 8 (`eval`); scripts table updated (count: 50 → 51).

### Baseline (v1.3.0)
- False-positive rate: **0.0%** (0 / 25 safe entries blocked)
- False-negative rate: **0.0%** (0 / 12 dangerous entries missed)

---

## [1.2.0] — 2026-04-24

### Added
- `scripts/install.sh` — single-command install entry point. Validates Node.js and git, copies kit files, generates `horus.config.json` if missing, prints the wire-hooks snippet. Replaces the three-step wizard → install-local → wire-hooks flow. Flags: `--profile`, `--tool`, `--auto`, `--yes`, `--dry-run`.
- `scripts/upgrade.sh` — in-place upgrade for existing installations. Reads installed `VERSION`, re-runs install with the same profile (from `horus.config.json`), preserves `horus.config.json` unconditionally, updates `VERSION`, and reports the version delta. State files in `HORUS_STATE_DIR` are never touched.
- `horus-cli.sh install` now dispatches to `install.sh` (was `install-local.sh`); `horus-cli.sh upgrade` added as new subcommand.
- `check-installation.sh` extended with sections 10–13: `install.sh --dry-run`, fresh install, same-version no-op, and version-bump upgrade with config preservation.
- README Quick Start updated to lead with `install` + `upgrade` commands; scripts table updated with new entries (count: 48 → 50).

---

## [1.1.0] — 2026-04-24

### Added
- Unified decision path: `secret-warning.js` and `git-push-reminder.js` now route through `runtime.decide()` for unified policy, trajectory tracking, and explainability. Secret and force-push decisions are now subject to session risk escalation, decision journaling, and consistent `[Agent Runtime Guard]` output prefix.
- `references/unified-master-plan.md` — canonical project plan replacing `IMPROVEMENT_PLAN.md`'s stale parity-tracking content. Covers current-state audit, end-state definition, multi-harness support strategy, gap analysis, full phased roadmap, and project score.

### Fixed
- `secret-warning.js` and `git-push-reminder.js` output prefix changed from `[ECC Safe-Plus]` to `[Agent Runtime Guard]` to match `dangerous-command-gate.js`. All 23 fixture `expected_stderr` files updated accordingly.
- `IMPROVEMENT_PLAN.md` deprecated with a notice pointing to `unified-master-plan.md`; stale baselines (129 skills, 48 agents, 50 rules) are now clearly labeled as historical.
- `scripts/hooks-baseline.sha256` regenerated after hook changes.

---

## [1.0.3] — 2026-04-24

### Fixed
- `scripts/check-runtime-core.sh`: use `fs.realpathSync.native` (Windows `GetFinalPathNameByHandleW`) to resolve 8.3 short paths (e.g. `RUNNER~1` → `runneradmin`) before path comparisons in the `discover-git-repo` test. Fixes Windows CI failure where `os.tmpdir()` returns an 8.3 abbreviated path while `git rev-parse --show-toplevel` returns the canonical long form.
- `scripts/check-runtime-core.sh`: suppress decision-journal file writes during tests via `HORUS_DECISION_JOURNAL=0`; eliminates potential AV-locking failures on the Windows CI runner.

---

## [1.0.2] — 2026-04-23

### Added
- Enforce/block-mode fixtures: 4 new DCG enforce pairs (curl-pipe-sh, force-push, dd-device, drop-table) and 3 new secret-warning enforce pairs (private-key-block, aws-access-key-id, openai-key). Total fixtures: 85 → 92/92.
- Windows CI runner added to check workflow matrix (`windows-latest`, 500ms bench ceiling). All check steps now run on both Ubuntu and Windows.
- `check-scenarios.sh` now verifies scenario counts: 20 approval-boundary and 14 prompt-injection (was existence-only check).

### Fixed
- `dangerous-command-gate.js`: `runtimeDecision()` now runs in its own isolated try/catch with severity fallback — a corrupted policy file or runtime throw can no longer silently bypass the gate. All `hookLog()` calls in the block path moved to after `console.error()` and wrapped in try, ensuring `process.exit(2)` is always reached.
- `secret-warning.js`: `hookLog()` moved after `console.error()` and wrapped in try in the ENFORCE block, ensuring `process.exit(2)` is always reached.
- `git-push-reminder.js`: same `hookLog()` ordering fix in the ENFORCE block.
- `runtime/policy-store.js`: module-level cache eliminates 4+ redundant `fs.readFileSync` calls per `decide()` invocation. Cache is invalidated on every write.
- `runtime/session-context.js`: same read-cache pattern — eliminates 2 redundant state reads per `decide()` call.
- OWASP matrix ASI04 verdict corrected from `COVERED` to `PARTIAL`: `redact-payload.sh` is an offline audit tool, not wired into hook execution. `secret-warning.js` is the real runtime control.

---

## [1.0.1] — 2026-04-23

### Added
- Expanded fixture coverage from 54 to 85/85: added positive fixtures for all 21 dangerous-command-gate patterns (was 10/21) and all 23 secret-warning patterns (was 4/23). Private-key block, certificate block, and 17 other patterns now have explicit test inputs.
- `classifyPathSensitivity` unit tests in `check-runtime-core.sh` covering low/medium/high tiers.
- JSONL audit trail end-to-end assertion in `check-hook-edge-cases.sh`.
- Trajectory-nudge negative tests: verified learned-allow and auto-allow-once remain exempt under 3+ escalation seeds.
- `check-status-artifact.sh` wired into `horus-cli.sh check` (was CI-only); `check-scenarios.sh` wired into both `horus-cli.sh check` and CI.
- `check-owasp-coverage.sh` and `bench-runtime-decision.sh` added to README scripts table.

### Fixed
- Fixture count in README, full-power-status.md updated to 85/85.
- IMPROVEMENT_PLAN.md `Last updated` header corrected from 2026-04-21 to 2026-04-23.
- CLAUDE_CODE_HANDOFF.md: CI check step count corrected from "20" to "24"; broken `STATUS.md` link replaced with `artifacts/status/status-summary.txt`.
- `hookLog` and `rateLimitCheck` now route through `HORUS_STATE_DIR` when set (back-compat fallback preserved).
- `HORUS_DECISION_JOURNAL=0` added as primary kill switch for decision journal; `ARG_DECISION_JOURNAL=0` kept as deprecated alias.
- `workflow-router.js` `primaryStack` priority aligned to `action-planner.js` (explicit input wins over auto-detected).

---

## [1.0.0] — 2026-04-23

### Added
- **B.1 — Auto-allow-once**: `grantAutoAllowOnce(key)`, `consumeAutoAllowOnce(key)`, `hasAutoAllowOnce(key)` in `runtime/policy-store.js`. Only policies with a pending suggestion (approvalCount ≥ 3) may receive a single-use grant. `runtime.decide()` checks and consumes the token for non-critical, non-high-risk commands; emits `auto-allow-once=consumed` in explanation. CLI verb: `horus-cli.sh runtime auto-allow-once '<policy-key>'`.
- **B.2 — Trajectory-driven routing**: `getSessionTrajectory()` in `runtime/session-context.js` returns `{ recentEscalations, recentReviews, lastDecisionAt }` bounded to a configurable window (`HORUS_TRAJECTORY_WINDOW_MIN`, default 30 min). `runtime/decision-engine.js` nudges actions up one step (allow→route, route→require-review, require-review→escalate) when `recentEscalations >= HORUS_TRAJECTORY_THRESHOLD` (default 3); learned-allow and auto-allow-once sources are exempt; nudge appears in `explanation` and new `trajectoryNudge` result field. Sprint R3 acceptance items now closed.
- Tests for B.1 and B.2 in `scripts/check-runtime-core.sh` and B.1 CLI test in `scripts/check-runtime-cli.sh`.
- **C.1 — OWASP Agentic Top 10 2026 coverage matrix**: `references/owasp-agentic-coverage.md` maps each ASI01–ASI10 risk to specific files or explicit NOT COVERED / PARTIAL / DEFERRED verdicts. `scripts/check-owasp-coverage.sh` enforces all 10 rows exist, each has a verdict, and every referenced file exists. Wired into CI and `horus-cli.sh check`.
- **C.2 — Path-sensitivity classifier**: `classifyPathSensitivity(path)` in `claude/hooks/hook-utils.js` returns `low | medium | high` based on SSH keys, cloud credentials, vault paths, `.env` files, infra dirs, etc. `dangerous-command-gate.js` computes it from `targetPath` and passes `pathSensitivity` to `runtime.decide()`; `runtime/risk-score.js` adds +1 (medium) or +2 (high) to risk score; hook prints "Sensitive path detected" when ≥ medium. Advisory only — does not block unilaterally.
- **C.3 — Kill switch**: `HORUS_KILL_SWITCH=1` env var causes `runtime.decide()` to return `action: "block"` for every input immediately, regardless of risk score. Documented in `claude/hooks/README.md` with full env-var reference table. Test case added to `check-runtime-core.sh`.
- **C.4 — Runtime decision latency bench**: `scripts/bench-runtime-decision.sh` runs 1000 representative `decide()` calls and prints p50/p95/p99. Platform-aware ceiling: 5ms on Linux CI, 500ms on Windows (file-system overhead). Documented in `references/full-power-status.md`. Wired into CI (`HORUS_BENCH_P99_MS=10`) and `horus-cli.sh check`.
- **C.5 — JSONL audit trail**: `hookLog()` in `claude/hooks/hook-utils.js` now emits structured JSONL (`{"ts":"...","hook":"...","event":"...","label":"..."}`) instead of tab-separated text. `horus-cli.sh log --since '<timestamp>'` filter added to select entries by ISO timestamp using inline Node.js.

### Release Summary
- Sprint R3 fully closed: auto-allow-once lifecycle and trajectory-driven routing complete all R3 acceptance criteria.
- OWASP Agentic Top 10 2026 coverage mapped and machine-verified.
- Kill switch, path-sensitivity classifier, JSONL audit trail, and latency bench complete community-informed improvement cycle.
- CI workflow now covers all 18 check groups (was 8 at v0.9.0).

---

## [0.9.0] — 2026-04-23

### Added (Tier A — self-maintaining hardening follow-up)
- `scripts/check-fixture-count.sh` now also validates the fixture count in the `CHANGELOG.md` current section, closing the gap where the docstring claimed CHANGELOG coverage but the grep was absent.
- `scripts/horus-cli.sh check` now preflights `node` on PATH and exits 2 with a clear message (including the known LMStudio bundled path hint) when `node` is absent; removes the previous silent-failure mode for node-dependent check groups.

### Changed (Tier A — self-maintaining hardening follow-up)
- `scripts/check-harness-support.sh` Supported-harness assertion now uses a single anchored regex (`\| *<Harness> *\|[^|]*Supported`) and fails loudly if a Supported label is dropped; the previous `|| true` softness is removed.

### Added (Sprint R3 opener — hook fidelity + multi-harness honesty)
- `classifyCommandPayload()` in `claude/hooks/hook-utils.js` — in-process payload classification (A/B/C) for command strings, mirroring `classify-payload.sh` tier logic without spawning a shell.
- `readSessionRisk()` in `claude/hooks/hook-utils.js` — explicit session-risk reader wrapping `runtime.getSessionRisk()` for hook integration.
- Dedicated `escalation` workflow lane in `runtime/workflow-router.js` — action `escalate` now routes to `lane=escalation`, `suggestedSurface=security-reviewer`, `suggestedTarget=human-gate`; remains human-gated with `enforcementAction=block`.
- `scripts/check-fixture-count.sh` — verifies fixture `.input` count matches `README.md` and `references/full-power-status.md`.

### Changed (Sprint R3 opener)
- `claude/hooks/dangerous-command-gate.js` now computes `payloadClass` and `sessionRisk` in the hook process and passes both to `runtime.decide()`, closing the hook/engine fidelity gap from R2; hook stderr now prints payload class (if non-A), session risk (if non-zero), workflow route lane (if non-direct), and an explicit ESCALATION ROUTE marker when action is `escalate`.
- `scripts/check-runtime-core.sh` extended with three new cases: escalate lane routing, payloadClass-C-to-review routing, sessionRisk bump reflected in decision explanation, and in-process `classifyCommandPayload` classification.
- `scripts/check-runtime-cli.sh` extended with escalate-lane routing test via `runtime explain`.
- `scripts/status-summary.sh` now prints disk-count summary lines after the [Agents], [Rules], and [Skills] sections, making uncovered drift immediately visible.
- `scripts/check-status-docs.sh` now validates per-tool table row counts in `references/per-tool-apply-status.md` against parity-matrix values.
- `scripts/horus-cli.sh check` and `scripts/status-summary.sh` [Verification] block now include `check-fixture-count.sh`.
- `references/runtime-autonomy-roadmap.md` updated to record Sprint R3 opener as landed and explicitly call out what remains open in Sprint R3.

### Added (W3 — multi-harness honesty)
- Stub harness directories `codex/`, `clawcode/`, `antegravity/` — each with `README.md` (explicit NOT YET SUPPORTED marker + integration contract sketch) and `COMPATIBILITY_NOTES.md` (full list of unknowns and path to support).
- `scripts/check-harness-support.sh` — verifies the Harness Support Matrix in README.md, stub directory presence and NOT YET SUPPORTED markers, wizard rejection behavior, and per-tool-apply-status Planned Harnesses section.

### Changed (W3 — multi-harness honesty)
- `README.md` now includes a "Harness Support Matrix" section distinguishing Supported (Claude Code, OpenCode, OpenClaw) from Planned (Codex, Claw Code, antegravity) harnesses.
- `scripts/setup-wizard.sh` now exits non-zero with a clear "NOT YET SUPPORTED" message for planned harness tool names (`codex`, `clawcode`, `antegravity`) and a pointer to the Harness Support Matrix; completely unknown tool names also exit non-zero.
- `scripts/check-setup-wizard.sh` extended to assert that planned harness tool names produce the non-zero exit + not-yet-supported message.
- `scripts/generate-apply-status.sh` extended with a "Planned Harnesses" section listing Codex, Claw Code, and antegravity with explicit `status=planned, wiring=not-implemented` entries.
- `scripts/horus-cli.sh check` and `scripts/status-summary.sh` [Verification] block now include `check-harness-support.sh`.

### Added (earlier in Unreleased)


- `references/runtime-autonomy-roadmap.md` to define the next improvement cycle around bounded autonomy, risk scoring, local learning, and self-maintaining runtime behavior.
- `runtime/decision-engine.js`, `runtime/risk-score.js`, and `runtime/decision-journal.js` as the first autonomy-layer scaffold.
- `runtime/workflow-router.js` for initial workflow-lane recommendations across review, checks, setup, payload, wiring, and direct execution paths.
- `runtime/policy-store.js` and `runtime/session-context.js` for learned local policy and rolling session-risk state.
- `runtime/promotion-guidance.js` for structured lifecycle-aware policy promotion guidance (stages: new, approaching, eligible, promoted, dismissed, ineligible) with concrete CLI hints surfaced in hook output, runtime explain, and runtime state.
- `scripts/check-runtime-core.sh` to verify runtime decisioning primitives, learned policy behavior, session context, and promotion guidance.
- `scripts/generate-status-artifact.sh` and `scripts/check-status-artifact.sh` to produce and verify a unified repo status artifact with metadata.

### Changed
- `claude/hooks/hook-utils.js` now exposes a lightweight runtime decision entry point for hook integration.
- `scripts/status-summary.sh`, `README.md`, `references/full-power-status.md`, and `references/superiority-evidence.md` now include status-artifact-aware self-maintenance coverage, and the artifact generator now avoids recursive self-check execution during generation.
- `claude/hooks/dangerous-command-gate.js` now consults the runtime decision layer and surfaces learned-allow versus block/escalate behavior.
- `runtime/policy-store.js` now promotes repeated approvals into pending learned-policy suggestions instead of silently relying on implicit state only, and reviewed-default lifecycle history is now surfaced as both raw timestamps and compact per-decision summaries.
- `references/runtime-autonomy-roadmap.md` and `references/full-power-status.md` now record Sprint R2 policy-lifecycle auditability as complete and identify Sprint R3 routing/workflow autonomy as the next runtime step.
- `horus-cli.sh` now exposes runtime state, suggestion acceptance, suggestion dismissal, explicit approval recording, and decision explanation flows.
- runtime decisions now load per-project runtime config from `horus.config.json`, including trust posture, protected branches, and sensitive path patterns.
- runtime context discovery now auto-detects project root and git branch, and decision actions now include bounded orchestration states like `require-review`, `require-tests`, and `modify`.
- workflow-style runtime actions now carry action plans with suggested commands, review types, or safer modification hints for hooks and CLI surfaces.
- action plans now adapt to local approval/suggestion history so recurring patterns can surface stronger policy-promotion guidance instead of staying static.
- `runtime/decision-engine.js` now attaches structured `promotionGuidance` (stage, guidance text, CLI hint) to every decision output.
- `runtime/decision-engine.js` and `scripts/runtime-state.js` now surface initial workflow routing guidance (`workflow-lane`, `workflow-surface`, `workflow-target`, `workflow-command`) for common low-risk paths, including review and audit flows alongside checks, setup, payload, wiring, a source-file-to-checks default, strict-trust escalation of source-file work toward review, tool-aware routing for direct settings/hook edits, and payload-class-aware review defaults for Class B/C work.
- `runtime/action-planner.js` now includes `promotionHint` in action plans when the pattern has promotion history.
- `claude/hooks/dangerous-command-gate.js` now surfaces promotion stage and CLI hints in hook stderr output.
- `scripts/runtime-state.js` now shows promotion stage, guidance, CLI hints, reviewed-default lifecycle timing (`created-at`, `eligible-at`, accepted/dismissed), and a compact lifecycle summary in `explain` output, plus explicit `promote` commands and lifecycle summaries in state output.
- `scripts/check-runtime-core.sh` and `scripts/check-runtime-cli.sh` now verify promotion guidance in decisions, explicit promotion flows, and CLI output.
- `horus-cli.sh check` and `status-summary.sh` now include runtime-core verification.

---

## [0.8.1] — 2026-04-22

### Fixed
- **MODULES.md** — expanded from 3 hooks to all 12 hooks plus 2 shared libraries and 2 pattern configs. Each entry now documents event type and `HORUS_ENFORCE=1` blocking behavior.
- **SECURITY_MODEL.md** — hook contract updated to document: 5 MB stdin cap, `HORUS_ENFORCE=1` exit-code-2 blocking mode, rate limiting via `rateLimitCheck()`, and which hooks support blocking.
- **risk-register.md** — copied from main repo and expanded from 10 to 15 risks covering dangerous shell commands, prompt injection, hook file tampering, hook spawn rate, and command obfuscation.
- **audit-notes.md** — copied from main repo to close documentation gap.

---

## [0.8.0] — 2026-04-21

### Added
- `check-config-integration.sh` for end-to-end verification of `generate-config.sh`, config-driven `install-local.sh`, and `wire-hooks.sh --check`.
- `check-hook-edge-cases.sh` for empty stdin, oversized payload, malformed config, and multi-line dangerous-command coverage.
- `generate-apply-status.sh`, `generate-parity-report.sh`, and `generate-superiority-evidence.sh` to reduce documentation drift.
- `check-status-docs.sh` to guard key count claims and generated report sync.
- `references/final-comparison-audit.md` to record the two-round closeout audit against both internal docs and the upstream baseline.

### Changed
- `horus-cli.sh check` and `status-summary.sh` now include config integration, hook edge cases, status-doc sync, and quantified superiority verification.
- `references/per-tool-apply-status.md`, `references/parity-report.md`, and `references/superiority-evidence.md` now follow semi-generated anti-drift workflows.
- Sprint 4 is now closed, and the repo status is documented as full parity plus measured superiority.

### Release Summary
- Full upstream content parity is now complete: 38/38 agents, 87/87 rules, and 156/156 skills adopted.
- Agent Runtime Guard now carries 57 ECC-only extensions beyond upstream.
- Runtime/usability verification is now enforced by 17 verification layers, including installation, config integration, hook edge cases, apply-status sync, superiority evidence, and status-doc sync.
- This release closes the parity-to-superiority project scope and marks the start of any future work as a new improvement cycle.

---

## [0.7.3] — 2026-04-20

### Fixed
- **classify-payload.sh** — Class B and C detection now uses multi-word / specific phrases to eliminate false positives. "internal combustion engine" no longer classifies as B; "customer service FAQ" no longer classifies as C. High-risk action wording section (additive, non-blocking) retains broad single-word matching by design.
- **audit-local.sh** — URL scan narrowed from bare `https?://` to fetch/download context (`curl`, `wget`, `fetch`, `http.get`, `axios.get`, `requests.get` + URL). Documentation links and example URLs no longer trigger false positives.
- **rules/python/security.md** — Anti-patterns table corrected: `random.token_hex()` (which doesn't exist in the `random` module) replaced with `random.randint()` as the BAD example, `secrets.token_hex()` / `secrets.token_bytes()` as the GOOD example.
- **strategic-compact.js** — Added `hookLog("strategic-compact", "INFO", ...)` when a compaction suggestion fires. Events now appear in `hook-events.log` when `HORUS_HOOK_LOG=1`.
- **skills/README.md** — Updated from listing 6 skills to documenting all 130 across 10 categories with a full category overview table.

---

## [0.7.2] — 2026-04-20

### Security
- **dangerous-patterns.json** — added 4 prompt injection patterns (medium severity): ignore-instructions, override-policy, exfiltrate-data, jailbreak-framing. Detected by `dangerous-command-gate.js` in warn mode (or block in `HORUS_ENFORCE=1`).
- **dangerous-command-gate.js** — replaced `.find()` with `.filter()` + sort by severity. Highest-severity pattern now always wins regardless of JSON ordering. Prevents silent severity downgrade when a medium pattern appears before a critical one.
- **SECURITY_MODEL.md** — added "Known Limitations" section documenting: command obfuscation bypass, rate limiter TOCTOU race, and heuristic-only prompt injection detection.

### Performance
- **build-reminder.js** — added `rateLimitCheck("build-reminder")`. All four PreToolUse hooks now participate in rate limiting.

### Testing
- **3 new DCG prompt injection fixtures** — `dcg-pi-ignore-instructions`, `dcg-pi-override-policy`, `dcg-pi-jailbreak-framing`. Total: 54 fixtures, 54/54 passing.

### Correctness
- **wire-hooks.sh `--verify`** — added `dangerous-command-gate.js` to the verification list (was the only hook missing).
- **hook-utils.js `rateLimitCheck`** — added detailed TOCTOU race condition comment with analysis of why it is accepted as benign.

---

## [0.7.1] — 2026-04-20

### Security (Tier 1 bug fixes from multi-model review)
- **secret-warning.js** — removed duplicated `readStdin`/`collectText` functions that lacked the 5 MB cap. Now imports `readStdin`, `collectText`, and `ENFORCE` directly from `hook-utils.js`. Oversized payloads are now correctly rejected before secret scanning begins.
- **setup-wizard.sh** — replaced hardcoded `/tmp/ecc_wizard_config.json` with `mktemp` to eliminate the symlink attack vector (same class of bug fixed in `strategic-compact.js` in v0.6.0).
- **instinct-utils.js** — `ensureDir()` now passes `mode: 0o700` to `mkdirSync`. The `~/.horus/instincts/` directory is no longer world-readable.
- **install-local.sh** — `minimal_files()` now includes all hook files (`session-start.js`, `session-end.js`, `strategic-compact.js`, `memory-load.js`, `pr-notifier.js`). Previously, a minimal install wired all hooks from `hooks.json` but only copied 10 of 15, causing runtime failures.

---

## [0.7.0] — 2026-04-20

### Added
- **setup-wizard.sh** — Interactive onboarding wizard (5 questions → ready-to-run install command + starter horus.config.json). Supports `--non-interactive` mode for automation.
- **check-skills.sh** — Validates all 130 skill files for required H1 heading and Trigger/Purpose section. `--errors-only` flag for CI. Zero errors across all 129 skills.
- **horus-cli.sh** — Unified CLI entry point consolidating 14 individual scripts into one interface with subcommands: `install`, `setup`, `audit`, `check`, `fixtures`, `integrity`, `status`, `review`, `classify`, `redact`, `wire`, `log`, `version`.

### Observability
- **hook-utils.js: hookLog()** — Append-only event log at `~/.horus/hook-events.log`. Activated by `HORUS_HOOK_LOG=1`. Records metadata only (hook name, timestamp, event type, detection label — never payload content or commands). Wired into `dangerous-command-gate.js`, `git-push-reminder.js`, and `secret-warning.js`.
- **horus-cli.sh log** — View log with `--tail N` or clear it with `--clear`.

### Performance
- **hook-utils.js: rateLimitCheck()** — File-based token-bucket rate limiter (60 token capacity, 30 tokens/s refill). Prevents 3000+ Node.js process spawns per minute during high-velocity sessions. Wired into all three PreToolUse hooks. Disable with `HORUS_RATE_LIMIT=0`.

### Audit
- **session-end.js instinct fields** — Verified: `extractSafeMetadata()` reads only `tool_name` and `event_type`; `trigger`/`behavior` fields are hardcoded placeholders filled by user on review. No auto-extracted session content, commands, or file paths captured.

---

## [0.6.0] — 2026-04-20

### Security
- **dangerous-command-gate.js** (new hook) — blocks `rm -rf`, `git push --force`, `curl | sh`, `DROP TABLE`, `npx -y`, `sudo rm`, and 13 other dangerous shell command patterns. `HORUS_ENFORCE=1` blocks critical/high-severity commands; default mode warns.
- **dangerous-patterns.json** — 17 extensible patterns with severity levels (critical/high/medium) and reasons. Add project-specific patterns without editing the hook.
- **git-push-reminder.js** — upgraded from warn-only to enforce-capable. `HORUS_ENFORCE=1` now blocks force pushes entirely.
- **secret-patterns.json** — fixed misleading `"The hook never blocks"` comment. Block mode with `HORUS_ENFORCE=1` was always supported but undocumented.
- **strategic-compact.js** — counter file moved from `/tmp/ecc-session-counter.json` to `~/.horus/session-counter.json` to eliminate Linux symlink attack risk.

### Added
- **hook-utils.js** — shared hook utilities: `readStdin` with 5 MB cap (prevents memory exhaustion), `commandFrom`, `collectText`, `ENFORCE`. Eliminates 9 identical copies of these functions across all hooks.
- **verify-hooks-integrity.sh** — SHA-256 baseline for all 15 hook files. Run `--update` after intentional changes; commit baseline to git so tampered hooks are visible in diffs.
- **scripts/hooks-baseline.sha256** — initial baseline for integrity checking.

### Fixed
- **quality-gate.js** — removed duplicate `.rs` key (cargo clippy only); unified to `cargo clippy && cargo test`. Added `.c` and `.h` file support.
- **quality-gate.js** — now imports `readStdin` from `hook-utils.js` instead of inline copy.

### Testing
- **run-fixtures.sh** — expanded from 2 fixture sections to 5: classify, secret-warning, dangerous-command-gate, git-push-reminder, redact-payload.
- **45 fixtures** total (was 22): 26 classify (20 new approval-boundary + 6 existing), 8 secret-warning (3 new prompt-injection), 7 dangerous-command-gate (all new), 4 git-push-reminder (all new), 6 redact-payload (all new).

### Rules
- **rust/security.md** — 67 → 333 lines. Added OWASP map, path traversal, command injection, JWT, rate limiting, secrecy crate, anti-patterns table.
- **kotlin/security.md** — 71 → 336 lines. Added OWASP map, open redirect, JWT verification, coroutine safety, log injection, anti-patterns table.
- **csharp/security.md** — 68 → 312 lines. Added OWASP map, XSS (Razor/Blazor), open redirect, AES-GCM, JWT config, anti-patterns table.
- **cpp/security.md** — 98 → 307 lines. Added OWASP map, format strings, RAII patterns, path traversal, fuzzing setup, compiler security flags, anti-patterns table.

### Install
- **install-local.sh** — reads `horus.config.json` from target directory; respects `profile` and `languages` fields. New hooks added to `minimal_files()`.
- **audit-examples.sh** — Pass 2 added: flags dangerous patterns inside GOOD-labeled code blocks (previously only scanned prose).
- **redact-payload.sh** — added IPv4 address redaction pattern.

---

## [0.5.0] — 2026-04-19

### Rules
- 12 thin rule files rewritten to production depth (150–400 lines each).
- Affected: common/patterns, common/performance, common/coding-style, common/security, common/testing, common/development-workflow, python/coding-style, python/testing, java/security, golang/security, swift/security, web/coding-style.

### Infrastructure
- hooks.json: /ABS_PATH/ placeholder guidance added.
- wire-hooks.sh: generates ready-to-paste settings.json snippet.
- audit-examples.sh: initial version for prose scanning.
- run-fixtures.sh: initial 22-fixture test runner.

---

## [0.4.0] — 2026-04-18

### Added
- 23 thin agent/skill files deepened to production quality.
- secret-patterns.json: expanded from 5 to 23 patterns.
- install-local.sh: profiles (minimal/rules/agents/skills/full), --auto language detection, --list dry-run.
- horus.config.json.example: per-project config template.
- agents/index.json, agents/ROUTING.md: agent routing and dispatch guide.
- classify-payload.sh, redact-payload.sh, review-payload.sh: payload protection pipeline.
- modules/daemon-pack/: scoped background helper patterns.

---

## [0.3.0] — 2026-04-17

### Added
- Initial 38 agents, 48 rules, 60 skills from ECC v1.10.0 source review.
- Phase 1/2/3 policy structure (trusted-agents, MCP, shell, plugins, browser, notifications, installers, wrappers, daemons).
- 9 hooks: secret-warning, build-reminder, git-push-reminder, quality-gate, strategic-compact, memory-load, session-start, session-end, pr-notifier.
- scripts: install-local.sh, audit-local.sh, check-registries.sh, smoke-test.sh, status-summary.sh.
- SECURITY_MODEL.md, MODULES.md, DECISIONS.md.
- references/: phase policies, upstream-sync, vendor-policy, import-checklist, payload guides.
