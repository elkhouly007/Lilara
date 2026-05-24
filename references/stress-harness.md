# Stress + graceful-degradation harness

Operational doc for the harness under `tests/stress/`. Tracks v0.5 Stage D
locked scope §5.1: "Stress + graceful-degradation harness (provider down,
rate-limit, network out, disk full, lockfile stuck, clock skew)". Cadence
per plan §5.1: nightly run + 8+ scenarios.

This harness is **observability-only**. It does NOT change runtime behavior
and is NOT a required CI status check. Failures here surface real engine
gaps but do not block PR merges.

## Layout

```
tests/stress/
├── run-stress.js                       # discovery + per-scenario runner
├── lib/
│   ├── assert-graceful.js              # shared assertion helper
│   ├── inject-clock.js                 # Date.now shim + restore
│   ├── inject-fs-error.js              # chmod-readonly injector + restore
│   └── inject-rate-limit.js            # synthetic 429-throwing adapter
└── scenarios/
    ├── provider-down.scenario.js
    ├── rate-limit.scenario.js
    ├── network-out.scenario.js
    ├── disk-full.scenario.js
    ├── lockfile-stuck.scenario.js
    ├── clock-skew.scenario.js
    ├── journal-corruption.scenario.js
    └── concurrent-floods.scenario.js
```

## Per-scenario contract

Each `*.scenario.js` exports:

| Field             | Role                                                                |
|-------------------|---------------------------------------------------------------------|
| `id`              | Stable scenario identifier (used in artifact path).                 |
| `description`     | Human-readable one-liner.                                           |
| `setup(ctx)`      | Inject the failure mode. May return a teardown callback.            |
| `exercise(engine, ctx)` | Call `engine.decide(...)`; return `{ result, extra? }`.         |
| `assertGraceful(out, journal, ctx)` | Assert graceful behavior (throws on failure).       |

`ctx` carries `{ id, stateDir, projectDir, outDir, root }`. The runner
mkdtemp's a fresh `LILARA_STATE_DIR` per scenario and reloads `runtime/*`
from the require cache so memoised engine state cannot leak across runs.

A run is "graceful" when (per `assert-graceful.js`):

1. `exercise()` did not let an exception escape to the harness;
2. `decide()` returned a non-null object with a `reasonCodes` array;
3. either the runtime-decision journal append succeeded for this call OR
   the result carries `degradedMode.active === true`;
4. no thrown error escaped to the harness.

## Scenario catalogue

| ID                  | Injection                                            | Engine contract under test                                                                |
|---------------------|------------------------------------------------------|--------------------------------------------------------------------------------------------|
| provider-down       | input carries `adapterManifest.capabilities.network = false` | engine returns a deterministic decision without throwing (G4 capability degradation)        |
| rate-limit          | synthetic adapter throws `RateLimitError` (HTTP 429) on first call | engine remains decision-stable; assertion observes adapter throw + journal-or-marker         |
| network-out         | F18 `evaluateDns` with a stub lookup that throws `ENOTFOUND` | F18 FC #4 fires (`dns_lookup_failed`); `decide()` returns without crash                      |
| disk-full           | `LILARA_STATE_DIR` chmod 0o500 + F17 lock conflict (early-block path) | engine reaches `buildEarlyBlock`, wrapped journal/append silently fails, decision returns    |
| lockfile-stuck      | stale `cross-agent-locks/*.json` owned by a fictitious agent | F17 fires deterministically across 10 repeated `decide()` calls; bounded wait (<30 s)        |
| clock-skew          | `Date.now()` frozen at 2000-01-01T00:00Z             | engine + `journal-chain.verify()` remain clean (chain is timestamp-agnostic by design)       |
| journal-corruption  | one chain entry's payload tampered after append      | engine enters degraded mode (ADR-004); `verify()` reports corruption                         |
| concurrent-floods   | 200 `decide()` calls via `Promise.all` + F17 conflict | 200 F17 blocks, 200 journal entries, chain clean, bounded wall-clock (<60 s)                 |

## Known engine gaps (filed as follow-ups)

These are real engine bugs the scenarios surface or document. The harness
scope is observe-and-report — fixes belong in scoped follow-up PRs.

- **disk-full non-block path** — `runtime/decision-engine.js` line 1456
  (`append`) and line 1488 (`recordDecision`) are NOT wrapped in
  `try/catch`. Under `LILARA_STATE_DIR` chmod 0o500, both throw `EACCES`
  on the non-block return path. The disk-full scenario today exercises
  the wrapped F17 early-block path so the harness ships green; the
  unwrapped path remains a follow-up.
- **disk-full degraded-mode marker** — the brief asks the engine to "log
  degraded-mode and return decision without crash" under disk-full.
  Today the degraded-mode descriptor is driven only by
  `journal-chain.verify()` failure (ADR-004 PR 37A/B); a disk-write
  failure does not flip the descriptor. Follow-up: widen the descriptor
  trigger or stamp a transient `degradedMode.reason = "journal-write-failed"`
  on receipt when an unwrapped write site fails.
- **rate-limit conservative routing** — the brief asks the engine to
  "journal degraded-mode and return a conservative decision (not allow
  on uncertainty)". Today the engine has no concept of an uncertainty
  signal carried on `decide()` input. Follow-up: thread an
  `input.adapterError` / `input.uncertaintySignals[]` field into the
  risk score so write-likes route conservatively when set.

## Running locally

```
node tests/stress/run-stress.js
STRESS_SCENARIO=lockfile node tests/stress/run-stress.js   # filter
```

The harness writes `artifacts/stress/<id>/receipt.json` plus copies of
`decision-journal.jsonl` and `journal-chain.jsonl` per scenario, and a
top-level `artifacts/stress/summary.json`.

Exit code: 0 when all scenarios pass; 1 when any scenario fails; 2 when
the harness itself crashes or discovers no scenarios.

## Adding a new scenario

1. Drop a `tests/stress/scenarios/<id>.scenario.js` that exports the four
   fields described above.
2. Keep total harness + scenarios + lib ≤ 450 LOC (the locked scope cap).
3. Update the scenario catalogue above.
4. Run `node tests/stress/run-stress.js` locally before pushing.

## Retention policy

Nightly artifacts (`actions/upload-artifact`) retain for 14 days. The
harness deliberately does not check in journal corpus — every run starts
from a fresh mkdtemp state dir so cross-run determinism is preserved.

## CI wiring

`.github/workflows/stress-nightly.yml`:
- `schedule: cron '17 2 * * *'` + `workflow_dispatch`.
- Linux-only (Ubuntu) — Windows + macOS stress is post-v0.5.
- Uploads `artifacts/stress/` on both pass and fail.
- Comments on the most recent open PR labeled `stress-watch` on failure.
- **Hard rule:** this workflow is NOT a required status check and does NOT
  modify `ci.yml` or any other existing workflow.
