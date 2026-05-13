# ADR-007 — Canonical Action IR + Explicit Decision Lattice

**Status:** ACCEPTED — Khouly 2026-05-10 (HAP scope + plan lock).
**PR-A status:** SHIPPED (skeleton only — zero behavior change).
**Authors:** Misk (scope owner), Claude Code (implementer).
**Repo authoritative cross-refs:** `DECISIONS.md` D49, `ARCHITECTURE.md` §1 + §2, `CHANGELOG.md` Unreleased.
**Workspace authoritative source:** `~/.openclaw/workspace/workstreams/hap-adr-007-claude-plan.md` (full implementation plan).

> The full HAP architecture decision lives in OpenClaw workspace per the HAP project's split between scope/strategy (workspace) and code (this repo). This file is a repo-local reference so contributors hitting the modules `runtime/decision-lattice.js` and `runtime/action-ir.js` can find the rationale without leaving the repo. If anything below conflicts with the scope (`agent-runtime-guard-scope.md`), the scope wins.

---

## 1. Why this exists

`agent-runtime-guard-scope.md` §4.1 invariants 9 and 10:

- **(9) Canonical Action IR.** Every adapter normalizes raw harness payloads into one canonical action representation before floors run: actor, harness, cwd, env delta, command AST, file targets, network targets, write intent, output channels where observable, declared goal, and trust/capability metadata.
- **(10) Explicit decision lattice.** Every floor declares its rung and precedence. Hard ethical core / kill > engine-baked floors > require-review > warn > contract/learned allow. No implicit precedence, no hidden demotion path.

Today (master @ feat/f18):
- The precedence ladder lives in prose in `ARCHITECTURE.md` §2 and in inline string literals (`source = "..."`, `floorFired = "..."`) scattered through `runtime/decision-engine.js`. Drift between prose and code is undetectable in CI.
- Adapter parity is by convention only. Codex / Clawcode / Antegravity adapters are explicitly best-effort but the engine reads raw fields (`input.command`, `input.cwd`, `input.tool`) without a normalized intermediate.
- Receipts/replay rely on the same flat fields, so cross-harness parity in receipts can't be asserted in a fixture.

ADR-007 closes both gaps with two small, zero-dep, fixture-pinned artifacts.

## 2. Decision (Option C — IR + declarative lattice; floors stay in code)

A thin in-process Canonical Action IR (`runtime/action-ir.js`) every adapter normalizes into before `decide()` runs, plus a single declarative lattice table (`runtime/decision-lattice.js`) that owns rung / precedence / demotability and is consulted — but not interpreted dynamically — by `decision-engine.js`. Floor predicates stay imperative (Node, zero-dep, fast); the table is the source of truth for **ordering, source tag, demotability, and fixture identity**, not the predicate body.

### Alternatives considered

| Option | Sketch | Why rejected |
|---|---|---|
| A. IR only (no explicit lattice) | Keep the imperative ladder; just normalize inputs. | Fails invariant 10. |
| B. Lattice only (no IR) | Document precedence in a table; floors keep reading raw `input.*`. | Fails invariant 9. |
| **C. IR + declarative lattice (chosen)** | One IR, one table, fixture parity across 6 adapters, predicates stay in code. | Meets both invariants; preserves the small-core + zero-dep + p99 budgets. |
| D. IR + fully data-driven engine (predicates as a JSON DSL) | A tiny interpreter evaluates predicates. | Adds engine complexity, audit surface, bug surface. Violates "small core". |
| E. Defer until v0.6 | Land F15/F16/F18 first, retrofit IR after. | Retrofit cost > upfront cost. Rejected by D-013 in `agent-runtime-guard-plan.md`. |

## 3. Roll-out — four sequential PRs on `feat/adr-007-canonical-action-ir`

| PR | Sizing | Goal |
|---|---|---|
| **PR-A (this PR)** | S (≈4h) | Ship the ADR + the table + the IR module skeleton. Zero behavior change. |
| PR-B | M (≈8h) | Adapter-side IR build via `actionIr.build()`; cross-adapter parity fixtures (6 adapters × ≥6 scenarios); manifests stub per adapter. `decide()` still reads legacy flat fields; only `irHash` is journaled, gated behind `HORUS_IR_JOURNAL=1`. |
| PR-C | M (≈8h) | `decision-engine.js` consults `LATTICE` for `decisionSource` / `floorFired` / demotability matrix. Receipts gain `irHash`, `rung`, `latticeVersion` (additive). Imperative predicates unchanged. |
| PR-D | S (≈4h) | Replay harness + 10-pattern adversarial seed + perf gates. |

The full PR-B/C/D plan + acceptance criteria + hard stops live in `~/.openclaw/workspace/workstreams/hap-adr-007-claude-plan.md`. Misk + Khouly reviewed and accepted that plan on 2026-05-10. PR-A only is in scope here.

## 4. What PR-A actually changes

**New (additive, zero-dep, pure):**
- `runtime/decision-lattice.js` — frozen `LATTICE` array, `LATTICE_VERSION = "1"`, helpers `getEntry`, `getRung`, `getFloor`, `listFloors`, `assertOrdered`. Rung 0 (`L1`) is reserved with `predicateRef: "reserved"` for the HAP v1.0 Hard Ethical Core; the engine does not yet consume it. Opt-in self-test on module load via `HORUS_LATTICE_SELFTEST=1`.
- `runtime/action-ir.js` — `EMPTY_IR`, `IR_VERSION = "1"`, `build(input, ctx)` (conservative best-effort builder returning a deeply-frozen IR; never throws on missing fields), `validate(ir) → { ok, reason }`, `canonicalize(ir)`, `irHash(ir)` (sha256 of `canonicalJson(ir with irHash = "")` via `runtime/canonical-json.js`).
- `scripts/check-lattice-ordering.sh` — CI gate: validates LATTICE invariants (frozen, strictly-increasing rungs, unique ids, required fields, expected floor ids present) and IR skeleton invariants (frozen `EMPTY_IR`, `build()` returns frozen IR, `validate()` accepts/rejects shapes, `irHash` canonical-stable, tool→toolKind classification correct).
- `tests/fixtures/decision-lattice/lattice-self-check.input` — JSON snapshot of LATTICE for human review + future parity diffs.
- `tests/fixtures/action-ir/empty-ir.input` — JSON snapshot of `EMPTY_IR` for human review + future parity diffs.
- `references/adr-007-canonical-action-ir.md` — this file.

**Touched (additive only, no semantic change):**
- `runtime/index.js` — re-export `actionIr` + `decisionLattice` namespaces alongside existing flat exports. Existing flat consumers unaffected.
- `ARCHITECTURE.md` — module map gains the two new files; precedence ladder note added pointing readers to `runtime/decision-lattice.js`.
- `DECISIONS.md` — D49 added.
- `CHANGELOG.md` — Unreleased / Added entry.
- `scripts/check-counts.sh` — `EXPECTED_SCRIPTS` 71→72; `EXPECTED_FIXTURES` 247→249 (two new `*.input` baseline fixtures).

**NOT touched in PR-A (explicit non-goals):**
- `runtime/decision-engine.js` — every line unchanged. Floor predicates, ordering, outcomes, source/floor strings: unchanged.
- `runtime/pretool-gate.js` — unchanged. No IR is built from gate calls yet.
- `schemas/horus.contract.schema.json` — byte-unchanged.
- Any harness adapter (`claude/`, `opencode/`, `openclaw/`, `codex/`, `clawcode/`, `antegravity/`) — unchanged. Manifests + IR consumption are PR-B work.
- Hard Ethical Core (Layer 1) — untouched. Rung 0 is a reservation only.

## 5. Canonical Action IR shape (PR-A skeleton)

```
ActionIR {
  // Identity
  irVersion        : "1"
  harness          : "claude"|"opencode"|"openclaw"|"codex"|"clawcode"|"antegravity"|null
  harnessVersion   : string|null
  sessionId        : string|null
  toolUseId        : string|null
  agentIdentity    : string|null
  ts               : string|null

  // Context
  cwd              : abs-path string|null    // path.resolve()'d in PR-A; PR-B adds realpath
  projectRoot      : abs-path string|null
  branch           : string|null
  envDelta         : { [key]: string }       // empty in PR-A; PR-B reuses envelope.js algorithm

  // Action
  tool             : string|null
  toolKind         : "shell"|"file-read"|"file-write"|"network"|"mcp"|"skill"|"final-message"|"unknown"
  command          : string                  // "" if not provided
  commandTokens    : string[]                // empty in PR-A
  commandClass     : string                  // "unknown" in PR-A
  argv0            : string|null

  // Targets
  fileTargets      : []                      // empty in PR-A; PR-B fills via arg-extractor
  networkTargets   : []                      // empty in PR-A; PR-B fills via network-egress
  mcpServer        : string|null
  skillName        : string|null

  // Intent
  writeIntent      : bool                    // derived from toolKind in PR-A
  destructive      : bool
  payloadClass     : "A"|"B"|"C"

  // Output channels (manifest-driven; default "none" until PR-B manifests land)
  outputChannels   : { toolOutput, generatedFiles, commitText, prText, finalMessage, terminal, screenshots }

  // Declared goal (plan-envelope hookpoint, future use)
  declaredGoal     : string|null
  planEnvelopeId   : string|null

  // Trust / capability
  trustMeta : {
    envelopeReporting : bool
    argsFidelity      : "exact"|"best-effort"|"opaque"
    cwdFidelity       : "exact"|"best-effort"|"opaque"
    mcpInterception   : "supported"|"unsupported"|"unverified"
    skillInterception : "supported"|"unsupported"|"unverified"
  }

  // Provenance hooks (not yet load-bearing)
  rawPayloadHash   : "sha256:..."
  irHash           : "sha256:..."|null       // populated via irHash() helper
}
```

`build(input, ctx)` is intentionally conservative: it never throws on missing or odd inputs and it leaves any field it cannot prove at the `EMPTY_IR` default. PR-B replaces the body of the per-field pickers with adapter-specific extractors; the public signature stays stable.

## 6. Decision lattice (PR-A skeleton)

`runtime/decision-lattice.js` exports a frozen `LATTICE` array. Each entry: `{ id, rung, name, action, source, demotableBy, predicateRef, notes }`.

Coverage in PR-A:

| rung | id | floor / rung name | action | demotable by | source tag |
|---|---|---|---|---|---|
| 0 | L1 | hard-ethical-core (reserved) | block | — | hard-ethical-core |
| 1 | F1 | kill-switch | block | — | kill-switch |
| 2 | F2 | contract-hash-mismatch | block | — | contract-floor |
| 3 | F5 | strict-gated-no-cover | block | — | harness-out-of-scope |
| 4 | F11 | validity-window | block | — | contract-floor |
| 5 | F12 | mcp-deny | block | — | contract-floor |
| 6 | F13 | skill-deny | block | — | contract-floor |
| 7 | F14 | budget-exceeded | block | — | contract-floor |
| 8 | F3 | critical-risk | block | — | risk-engine |
| 9 | F8 | protected-branch | require-review | — | risk-engine |
| 10 | F4 | secret-class-C | block | operator-token:class-c-review-demote | secret-class-C / f4-class-c-demoted |
| 11 | F10 | taint-floor | require-review | — | taint-floor |
| 12 | F9 | session-risk-floor | escalate | contract-allow:tool-allow-matched, contract-allow:tool-allow-tool-scope | session-risk-floor |
| 13 | F6 | posture-strict-no-cover | block | — | posture-strict-no-cover |
| 14 | F7 | intent-unknown-strict | require-review | — | intent-unknown-strict |
| 15 | F14b | session-over-duration | require-review | — | session-over-duration |
| 16 | F18 | network-egress | block | — | network-egress-denied |
| 17 | F15 | execution-envelope | block | — | execution-envelope-diverged |
| 18 | D-CONTRACT-ALLOW | contract-allow | demote-baseline | — | contract-allow / contract-allow-tool-scope |
| 19 | D-LEARNED-ALLOW | learned-allow | demote-narrow | — | learned-allow |
| 20 | D-AUTO-ALLOW-ONCE | auto-allow-once | demote-narrow | — | auto-allow-once |
| 21 | P-TRAJECTORY-NUDGE | trajectory-nudge | promote | — | trajectory-nudge |

**Rung numbering reflects code reality, not the prior `ARCHITECTURE.md` text.** Where code and prose disagree, the table mirrors what `decision-engine.js` actually does today; PR-C re-aligns the prose to the table without reordering code (per scope §4.1 invariant 10). If the *documented* order is preferred in any specific case, that is a separate small refactor proposal (ADR-007a), not bundled here.

## 7. Constraints honored

- **Zero runtime dependencies.** Both modules use Node builtins (`crypto`, `path`) plus local `runtime/canonical-json.js` only. `scripts/check-zero-deps.sh` passes.
- **Schema additive only.** `schemas/horus.contract.schema.json` byte-unchanged.
- **Hard Ethical Core untouched.** Rung 0 (`L1`) is a reservation slot; engine does not consume it.
- **No floor ordering or predicate change.** `decision-engine.js` not edited.
- **No HAP enforcement wired into Claude Code or OpenClaw.** Adapter manifests + IR consumption land in PR-B.
- **Default-deny preserved.** Missing IR fields stay at `EMPTY_IR` defaults; `build()` never throws; `validate()` is structural, not normalizing.
- **Three-mode operation preserved.** ADR-007 introduces no new mode.

## 8. Test results (PR-A)

Smallest meaningful gates that touch PR-A files:

| Gate | Command | Result |
|---|---|---|
| Lattice + IR invariants | `bash scripts/check-lattice-ordering.sh` | PASS (22 LATTICE entries; 19 IR test steps green) |
| Zero-dep policy | `bash scripts/check-zero-deps.sh` | PASS |
| File counts (scripts + fixtures bumped) | `bash scripts/check-counts.sh` | PASS (72 scripts, 249 fixtures) |
| Runtime core regressions | `bash scripts/check-runtime-core.sh` | PASS |

## 9. Hard stops (still active for PR-B onward)

- Any new `require()` outside Node builtins or local `runtime/`.
- Any contract-schema field added.
- Hard Ethical Core touched.
- p99 regression > 1.5× vs the soon-to-be-captured `baseline.pre-adr-007.json`.
- Cross-adapter parity check failing for any of the 6 baseline scenarios (PR-B onward).
- Floor ordering or predicate semantics change.
- HAP enforcement wired into Claude Code or OpenClaw beyond manifest publish.
- Receipts losing any existing field (PR-C: schema additive only).
- Replay harness finds drift on historical journal samples (PR-D).
- CI matrix loses coverage.

## 10. Authorization gate

- Misk + Khouly approved the full plan on 2026-05-10 (workspace `hap-adr-007-claude-plan.md`).
- PR-A authorization: Khouly per HAP self-build constraint; PR-B/C/D each require their own morning review per `agent-runtime-guard-plan.md` §7.2 (≤ 1 PR per morning).
