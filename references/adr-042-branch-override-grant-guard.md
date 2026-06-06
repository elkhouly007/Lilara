# ADR-042 — Env-Supplied Branch Cannot Drive Security Grants (ON by Default)

**Status:** Implemented

---

## Context

`runtime/context-discovery.js` `discover()` accepts `LILARA_BRANCH_OVERRIDE` as a branch
fallback. The override exists so adapter/fixture scripts can isolate from the live git
HEAD without modifying the input object. The resolved `branch` is spread into `enriched`
and then drives two **permission-granting** paths in `decide()`:

1. **contextTrust posture override** (`decision-engine.js:366-373`) — can flip
   `enriched.trustPosture` from "strict" → "relaxed", which disables the F6 and F7
   strict-posture-gate floors. An env-override branch matching a `contextTrust.branchPattern`
   glob effectively defeats the strict posture for any command in that decide() call.

2. **`forcePushAllow` scope demotion** (`decision-engine.js:415-427`) — the branch is
   passed to `_contractScopeMatch(contract, { branch, … })` where
   `scopes.branches.forcePushAllow` globs are matched. A match sets `contractAllow=true`,
   which prevents F6 from firing (F6 requires `!contractAllow`) and can demote the final
   action via the Step 11 contract-allow demotion.

The trust-boundary map (`references/trust-boundary-map-2026-06-02.md`) claimed this
env read "feeds only the branch/project-root detection, not decision logic directly" —
**that claim was wrong.**

---

## Consumer Assessment

Audited every `LILARA_BRANCH_OVERRIDE` reference in the codebase. Two legitimate roles:

1. **Branch detection/display** — `runtime/vcs-adapter.js:24` and the documented CI use
   case (`skills/multi-vcs-setup.md`). The skills file already warns "Use with caution in
   production pipelines."

2. **Test/CI isolation** — `scripts/replay-decisions.js`, all `tests/fixtures/replay-corpus/build-*.js`
   generators, `tests/adversarial/run-adversarial.js`,
   `scripts/check-{kill-chain,codex,clawcode,antegravity,opencode,openclaw}-adapter.sh`,
   `tests/runtime/{protected-branch-gating,ambient-adversarial-replay,delete-coord}.test.js`,
   `scripts/run-fixtures.sh`. Every one pins a **non-protected, non-allow-matching sentinel**
   (`replay/isolated-context`, `test-isolation`, `feature/hermetic-test-run`, etc.) purely
   to prevent decisions from inheriting the CI checkout's real branch. The replay/adversarial/
   adapter harnesses additionally run with **`LILARA_CONTRACT_ENABLED=0`** (contracts disabled),
   so `contextTrust` and `forcePushAllow` — both contract features — can never engage there
   regardless of the env var value.

**Conclusion:** For the two GRANT paths (contextTrust relax, forcePushAllow demotion), the
env override is **purely a spoofing vector — zero legitimate consumers.** The guard ships
**ON by default** so the gap closes rather than sitting as an opt-in.

---

## Decision

### Option A (chosen): guard env-sourced branches from the grant paths, ON by default

In `context-discovery.js`, additively return `branchSource` (`"input"` | `"env-override"` |
`"git"` | `"none"`) recording how the branch was resolved.

In `decision-engine.js`, define `_branchFromEnv` (active when `branchSource === "env-override"`
AND `!enriched.branchExplicit` AND `LILARA_BRANCH_DEMOTE_GUARD !== "0"`):

- **contextTrust block**: skip when `_branchFromEnv` — posture stays at the project/input value.
- **`_contractScopeMatch`**: pass `branch: _branchFromEnv ? null : enriched.branch` — a null
  branch cannot match any `forcePushAllow` glob.

Explicit `input.branch` (branchSource="input") and git-verified HEAD (branchSource="git") are
NOT affected — only the spoofable env source is distrusted for *grants*.

**Replay determinism:** the replay harnesses disable contracts (`LILARA_CONTRACT_ENABLED=0`),
so neither grant path is reachable there. The change is byte-identical for all corpus entries.
Verified: `bash scripts/check-replay-corpus.sh` — 119 entries, zero divergence.

**Escape hatch:** `LILARA_BRANCH_DEMOTE_GUARD=0` restores legacy (spoofable) behavior.
Documented as security-weakening; intended only as a rollback if an unforeseen consumer
surfaces after deployment.

### Option B (rejected): ship OFF by default

Leaves the gap open until an operator explicitly enables the guard. Given zero legitimate
grant consumers, there is no justification for defaulting to the vulnerable state.

---

## Scope and Invariants

- The guard operates only on the two GRANT paths. The protected-branch (F8) detection
  direction — which test isolation relies on (env override → non-protected sentinel → no F8
  block) — is entirely unaffected. F8 fires based on `enriched.branch` and the protected-branch
  list, neither of which is touched by this guard.
- No floor IDs changed. No lattice mutation. No EXPECTED_* count bump.
- `discover()` return shape is additive (`branchSource` is a new key) — all existing consumers
  that ignore unknown keys are unaffected.

---

## Implementation

**`runtime/context-discovery.js`**
- `discover()` now resolves branch in explicit priority order and records `branchSource`.
- Return object gains `branchSource` field additively.

**`runtime/decision-engine.js`**
- `_branchFromEnv` constant computed after `enriched` is built.
- contextTrust block: `if (contract && enriched.branch && !_branchFromEnv)`.
- scopeMatch call: `branch: _branchFromEnv ? null : enriched.branch`.

**`tests/runtime/branch-override-demotion-guard.test.js`** (9 tests)
- `discover()` branchSource for all four source types.
- `scopeMatch` null-branch mechanism (guards the forcePushAllow path).
- contextTrust blocked via F7 observable (guard ON → "require-review", guard OFF → "allow").
- Explicit branch still demotes (guard does not over-block).
- `LILARA_BRANCH_DEMOTE_GUARD=0` restores legacy behavior.

Wired into `scripts/check-runtime-core.sh`.

---

## Related

- ADR-028 (state-dir trust boundary — same principle: env-supplied paths are distrusted)
- ADR-031 (input materialization — env-supplied inputs are not trusted to drive security)
- Trust-boundary map cluster D2 corrected to RESOLVED
