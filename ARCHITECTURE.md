# Architecture — Agent Runtime Guard

## 1. Runtime Module Map

```
runtime/
├── index.js                Flat re-export namespace. Hooks require("../../../runtime") for all symbols.
├── decision-engine.js      Entry point. Walks the Section 3 precedence matrix and returns a decision.
├── risk-score.js           12 pattern classes, bounded 0–10, deterministic. No I/O.
├── decision-key.js         fineKey (5-part) + legacyKey (4-part back-compat). Classifies commands.
├── intent-classifier.js    8-intent pattern classifier: explore/build/deploy/modify/configure/cleanup/debug/unknown.
├── route-resolver.js       Maps intents to routing lanes (direct/verification/review). Per-project override.
├── policy-store.js         Learned-allow, auto-allow-once, approval counts. Atomic tmp+rename writes.
├── session-context.js      Per-session risk tracking. Session-id partitioning. Atomic writes.
├── decision-journal.js     JSONL append-only log with 5 MB rotation, 3-generation retention.
├── project-policy.js       Reads horus.config.json; falls back to defaults; validates via config-validator.
├── context-discovery.js    Git branch + project markers discovery. Git calls time-bounded at 1500 ms.
├── promotion-guidance.js   6-stage promotion lifecycle. Deterministic.
├── workflow-router.js      Recommends CI, PR, or review workflow based on action + risk.
├── action-planner.js       Builds a step-by-step action plan for the decided action.
├── pretool-gate.js         Single enforcement spine called by all harness adapters.
├── secret-scan.js          Cross-harness secret pattern scanner (was Claude-only before v1.7).
├── contract.js             Contract lifecycle: load, verify, accept, generate, scopeMatch.
├── glob-match.js           Zero-dep glob matcher (**/*/?/[abc]/! negation/${projectRoot}).
├── arg-extractor.js        Argv splitter. Quoted args, escapes, heredocs → <<HEREDOC (fail-closed).
├── canonical-json.js       Deterministic JSON stringify (keys sorted) for contract hashing.
├── config-validator.js     Typed-field walker. Validates horus.config.json and horus.contract.json.
├── state-paths.js          Single source of truth for all storage paths. HORUS_STATE_DIR override.
└── telemetry.js            Structured telemetry events to telemetry.jsonl. Never blocks.
```

Adapters (thin, ~30–70 lines each):
```
claude/hooks/dangerous-command-gate.js   → createAdapter({ harness:"claude", ... })   (hook-utils.js)
openclaw/hooks/adapter.js                → createAdapter({ harness:"openclaw", ... })  (hook-utils.js)
opencode/hooks/adapter.js                → createAdapter({ harness:"opencode", ... })  (hook-utils.js)
```

## 2. Decision Flow — Section 4.6 Precedence Matrix

Every `decide()` call walks this fixed ladder. Each rung can only make things more restrictive, except step 11 (contract-allow), which is the single demotion rung and cannot override a floor set above it.

```
Step  Rung                                  Can demote?  Can promote?  Floor-bound?
──────────────────────────────────────────────────────────────────────────────────
1     kill-switch (HORUS_KILL_SWITCH=1)        no           to block      yes (F1)
2     contract-hash-mismatch (strict mode)   no           to block      yes (F2)
3     critical-risk (score >= 8)             no           to block      yes (F3)
4     secret-class-C payload                 no           to block      yes (F4)
5     strict-mode + gated class + no cover   no           to block      yes (F5)
6     scope-violation                        no           to escalate   yes (F6)
7     novel-command-class                    no           to escalate   yes (F7)
8     protected-branch-write                 no           to review     yes (F8)
8.5   taint-floor (correlation >= 0.85)     no           to review     yes (F10)
9     session-risk >= 3                      no           to escalate   yes (F9)
9.5   taint-floor (F10, rung 8.5)            no           to review     yes (F10)
10    risk scoring                           no           establishes baseline action
10.5  validity-window (outside activeHoursUtc/
      activeDays AND payloadClass!=allow)     no           to block      yes (F11)
11    contract scope-allow                   YES          no            demotes baseline only
                                                                        (source=contract-allow)
12    learned-allow                          YES (narrow) no            destructive-delete only;
                                                                        cannot demote floors
13    auto-allow-once                        YES (narrow) no            same constraints; consumed
                                                                        only when actually needed
14    trajectory nudge                       no           +1 step       exempts contract-allow +
                                                                        learned-allow sources
15    emit + journal                         —            —             —
```

**Demotion rules:**
- Eleven floors are implemented: F1 (kill-switch, `decision-engine.js:82`), F2 (contract-hash-mismatch, `decision-engine.js:136`), F3 (critical-risk, `decision-engine.js:192`), F4 (secret-class-C, `decision-engine.js:222`), F5 (strict+gated+no-cover, `decision-engine.js:157`), F6 (posture-strict-no-cover, `decision-engine.js:268`), F7 (intent-unknown-strict, `decision-engine.js:285`), F8 (protected-branch, `decision-engine.js:196`), F9 (session-risk, `decision-engine.js:260`), F10 (taint-floor, `decision-engine.js:240`), F11 (validity-window, `decision-engine.js:298`). F2 and F5 fire only when `HORUS_CONTRACT_REQUIRED=1`. F9 carries a narrow `tool-allow-matched` carve-out (W11 intentional). F10 fires only for write/exec-class tools (read-only tools such as Read/Grep/Glob are exempt — see D37). F4 fires when `payloadClass === "C"` or `scanSecrets()` detects a class-C pattern; cannot be demoted by contract-allow (D26). F6 fires when `trustPosture === "strict"` + gated class + `!contractAllow`; does not fire in balanced or relaxed posture (D26). F7 fires when `intent === "unknown"` + `trustPosture === "strict"`; does not fire in balanced or relaxed posture (D26). B2 Phase 1 added F11 at rung 10.5.
- `contract-allow` demotes baseline only. Never demotes a floor.
- Project default `trustPosture` is overridden per-branch by `contract.contextTrust[]` (first-match-wins, schema-defined order) before risk scoring; affects risk score only, not scopes or floors (B2 commit 2).
- Step 11 per-tool source distinction: when contract scope-allow matches via `scopes.tools.perToolAllow`, source is `contract-allow-tool-scope` (not `contract-allow`). Both share the W11 escalate-demotion carve-out (B2 commit 3).
- `learned-allow` and `auto-allow-once` cannot demote anything a contract-allow would not have.
- Trajectory nudge is a promoter only. Exempt for `contract-allow` and `learned-allow` sources.
- `auto-allow-once` is consumed only when it actually changes the outcome.

## 3. Contract Specification

See [CONTRACT.md](CONTRACT.md) for full field reference.

Key flow:
1. `horus-cli.sh contract init` — writes `horus.contract.json.draft`
2. Human reviews and edits the draft
3. `horus-cli.sh contract accept` — hashes, writes final `horus.contract.json`, records in `~/.horus/accepted-contracts.json`
4. Every `decide()` recomputes the hash and verifies against the accepted record

Self-accept guard: `contract accept` refuses when harness session environment variables are detected (`CLAUDE_CODE_SESSION_ID`, etc.).

## 4. Storage Layout

All paths go through `runtime/state-paths.js`. Override with `HORUS_STATE_DIR`.

```
~/.horus/
├── decision-journal.jsonl          Append-only decision log
├── decision-journal.1.jsonl        Rotation generation 1 (most recent overflow)
├── decision-journal.2.jsonl.gz     Rotation generation 2
├── decision-journal.3.jsonl.gz     Rotation generation 3
├── session-context.json            Per-session risk + trajectory state
├── current-session-id              16-hex session ID written at SessionStart
├── policy.json                     Learned-allow, approvals, auto-allow-once grants
├── accepted-contracts.json         { <projectRootAbs>: { contractHash, acceptedAt, revision } }
└── telemetry.jsonl                 Structured telemetry events (never blocks decisions)

<projectRoot>/
├── horus.contract.json               Accepted contract for this project
├── horus.contract.json.draft         Draft (output of `contract init` / `contract amend`)
└── horus.config.json                 Per-project config (validated against schemas/horus.config.schema.json)

artifacts/bench/
└── baseline.json                   p50/p95/p99 per platform; used for 1.5× regression check
```

## 5. Environment Variable Catalog

| Variable | Default | Effect |
|---|---|---|
| `HORUS_KILL_SWITCH` | `0` | `1` = PreToolUse hooks exit 2 (block all tool calls unconditionally); informational hooks (PostToolUse/SessionStart/Stop) pass stdin through unchanged |
| `HORUS_ENFORCE` | `0` | `1` = hooks exit 2 on block (enforcement mode for adapters) |
| `HORUS_CONTRACT_ENABLED` | `1` | `0` = skip contract loading entirely (opt-out) |
| `HORUS_CONTRACT_REQUIRED` | `0` | `1` = gated capability classes blocked without valid accepted contract |
| `HORUS_READONLY_CONTRACT` | `0` | `1` = decisions proceed but zero writes to policy/session/journal (CI/review mode) |
| `HORUS_STATE_DIR` | `~/.horus` | Override storage directory |
| `HORUS_TRAJECTORY_THRESHOLD` | `3` | Escalation count triggering trajectory nudge |
| `HORUS_TRAJECTORY_WINDOW_MIN` | `30` | Lookback window in minutes for trajectory nudge |
| `HORUS_JOURNAL_MAX_MB` | `5` | Rotate decision journal when it exceeds this size |
| `HORUS_BENCH_P99_MS` | platform-auto | Override bench p99 ceiling (ms) |
| `HORUS_DECISION_JOURNAL` | `1` | `0` = disable journal writes |

## 6. Harness Adapter Contract

Each adapter must:
1. Read all stdin before exiting (prevents broken-pipe in the harness).
2. Echo raw stdin to stdout **unchanged**.
3. Write human-readable notices to stderr only.
4. Exit 0 to allow the action; exit 2 to block (when `HORUS_ENFORCE=1` and decision is block/escalate/require-review).
5. Never modify the JSON passed to the model.

`runtime/pretool-gate.js` implements steps 3–5 for all harnesses. Adapters provide only the harness-specific stdin parsing.

## 7. Zero-Dependency Policy

`runtime/*.js` imports only:
- Node builtins: `node:fs`, `node:path`, `node:crypto`, `node:os`, `node:zlib`
- Local `./` requires within `runtime/`

CI enforces this via `scripts/check-zero-deps.sh`. Any PR adding a third-party `require()` in `runtime/` fails CI immediately.
