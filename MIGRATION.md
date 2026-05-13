# Migration Notes

Operator-facing migration notes for runtime/contract/schema changes. Older
schema migrations (contract v1→v2, v2→v3) are documented in
`CHANGELOG.md` and exercised by `scripts/check-migrate-v1-v2.sh` and
`scripts/check-migrate-v2-v3.sh`.

---

## ADR-007 — Canonical Action IR + Decision Lattice (PR-A → PR-D)

**Status:** additive. No operator action required.

The HAP ADR-007 series (`references/adr-007-canonical-action-ir.md`) lands
in four sequential PRs on the master branch. Every change is additive: the
contract schema is byte-stable, no existing decision flips outcome, and no
new third-party dependency is introduced.

### What changed

| PR | Surface | Effect |
|---|---|---|
| PR-A | `runtime/decision-lattice.js`, `runtime/action-ir.js` | New zero-dep modules. Engine unchanged. |
| PR-B | adapter-side `actionIr.build()`, manifests, cross-adapter parity fixtures | Every adapter now produces a byte-identical IR for the same logical action. `irHash` available on every gate invocation. |
| PR-C | `runtime/decision-engine.js` reads `LATTICE` for `decisionSource` / `floorFired`; receipts gain `irHash`, `rung`, `latticeVersion` (additive) | No floor predicate or precedence change. |
| PR-D | `scripts/replay-decisions.js`, `scripts/bench-ir.js`, `tests/fixtures/replay-corpus/`, baseline files under `artifacts/bench/` | New replay + perf regression gates. No runtime change. |

### Receipt / journal extras (PR-C onward)

Three additive fields appear on every runtime-decision receipt and journal
entry:

- `irHash` — `sha256:…` of the canonical Action IR.
- `rung` — integer rung from the lattice (`runtime/decision-lattice.js`).
- `latticeVersion` — currently `"1"`.

Downstream consumers that key off existing fields (`action`,
`decisionSource`, `floorFired`, `riskLevel`, `riskScore`, `reasonCodes`,
`tool`, `command`, `branch`, `targetPath`, `payloadClass`) are unaffected.
The journal append path explicitly preserves field order; the only
deltas are new keys at the end.

Operators who do not want the extras can opt out for one release with
`HORUS_IR_JOURNAL=0`. The flag is intended as a short-lived escape hatch
during cutover and will be removed once external consumers have parsed at
least one IR-on journal.

### Replay gate (PR-D)

`scripts/check-replay-corpus.sh` replays a frozen corpus
(`tests/fixtures/replay-corpus/*.jsonl`) through the live engine and asserts
that `action`, `decisionSource`, `floorFired`, and `irHash` stay
byte-identical for every recorded case. Drift = CI failure. Intentional
engine changes regenerate the corpus via
`node tests/fixtures/replay-corpus/build-corpus.js` and
`node tests/fixtures/replay-corpus/build-adversarial.js`. (The generators
live alongside the fixtures rather than under `scripts/` because their
CASES tables carry synthetic risky literals — `rm -rf`, `curl | bash`,
`npx -y` — that `scripts/audit-local.sh` rejects in top-level `scripts/`.)

The pre-existing `scripts/check-decision-replay.sh` (which replays the
sample journal under `artifacts/journal/`) still runs and is unaffected.

### Perf gate (PR-D)

`scripts/bench-ir.js` measures `actionIr.build()` and `decide()` end-to-end
p50/p95/p99 over 1 000 iterations. It enforces the same platform ceiling
ladder as `scripts/bench-runtime-decision.sh` (10 ms Linux, 200 ms macOS,
500 ms Windows / WSL-on-`/mnt`) and the same 1.5× regression gate against
the lineage-stamped `artifacts/bench/ir-baseline.json`.

`artifacts/bench/baseline.json` is the IR-on baseline for the existing
`decide()` bench; both files are regenerated on every CI run and held in
the CI cache (the `artifacts/bench/` directory is gitignored, by design,
so baseline drift cannot accidentally land in PRs).

### Backward compatibility

- Existing v1 / v2 / v3 contracts continue to load and decide identically.
- No new contract field is required; no contract regeneration is needed.
- `runtime/index.js` re-exports `actionIr` and `decisionLattice` namespaces
  alongside the existing flat exports — existing consumers are not
  affected.
- Hard Ethical Core (`rung 0` / `L1`) is reserved only; no predicate is
  wired in yet. Operators do not need to configure or accept anything.

### Rollback

Each PR can be reverted in isolation. To temporarily disable just the
journal extras without reverting code, set `HORUS_IR_JOURNAL=0` in the
operator environment.
