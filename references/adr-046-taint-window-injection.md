# ADR-046 — Restore `decide()` Cross-Call Purity for F10 (Inject the Taint Window via `input.*`)

**Status:** Implemented — PR1 (injection + disk fallback). PR2 (remove the fallback; migrate test harnesses) is the follow-up that makes `decide()` genuinely free of the cross-call disk read.

---

## Context

F10 (the taint floor) was the last decision floor that read disk **inside** `decide()`:

`decide()` (`decision-engine.js`, F10 block) → `correlateCommand()` (`taint.js`) →
`getProvenanceWindow()` (`session-context.js`) → `fs.readFileSync(provenance-window.json)`
plus a `Date.now()` TTL filter. `correlateCommand` additionally called `loadProjectPolicy({})`
— a second disk read.

This violated the invariant that grants and the provenance-graph already satisfy: **cross-call
mutable state is loaded at the impure boundary (`pretool-gate.js`) and injected via `input.*`;
`decide()` never reads it from disk** (`decision-engine.js` consent-grant comment; `pretool-gate.js`
consentGrant / provenanceGraph loads). F10 was the outlier. It survived replay only because the
corpus runs under a fresh empty `LILARA_STATE_DIR`, so the window is `[]` and `correlate()`
short-circuits *before* the read matters — the impurity was **invisible to replay, not actually safe.**

### Scope of "purity" for this ADR

`decide()` is already impure beyond F10: it unconditionally calls `discover()` (git + fs),
`loadProjectPolicy()` (fs), and `getContract()` at entry, plus a conditional `Date.now()` (F14).
These read **static, environment-pinned context** held constant under replay — they are **not**
cross-call mutable state. ADR-046 targets the **one cross-call mutable-state disk read** (the
provenance window) — the only one that makes `decide()` non-deterministic across an invocation
history, and the exact category grants/provenance-graph already fixed. Literal "zero fs in
decide()" (relocating discover/loadProjectPolicy/getContract) is explicitly **out of scope** and
would be a separate, much larger ADR.

---

## Caller Assessment

Every `decide()` call site that can reach F10, and its taint-window source after the change:

| Caller | Window source | Handled |
|---|---|---|
| `pretool-gate.js` primary call (live enforcement) | injected | PR1 |
| `pretool-gate.js` envelope-recheck call (Class-C / protected-branch) | injected — **same value as primary** | PR1 |
| `scripts/replay-decisions.js` (119-entry corpus) | absent → inert (byte-identical) | no change |
| `scripts/runtime-state.js` `explain` | injected | PR1 |
| `scripts/lilara-cli.sh` `sandbox` | injected | PR1 |
| `scripts/check-lattice-receipts.sh` (F10 fixture) | disk fallback (PR1) → injected (PR2) | PR2 migrate |
| `scripts/run-fixtures.sh` taint blocks + E2E | disk fallback (PR1) → injected (PR2) | PR2 migrate |
| `runtime/post-adapter-factory.js` | does NOT call `decide()` (only `recordExternalRead`) | n/a |

The window is loaded **once** at the `pretool-gate.js` boundary, above both `decide()` calls, and
passed to both — so F10 cannot fail open on the high-severity recheck path (Acceptance Criterion #1).

---

## Decision

### Option A (chosen): inject the window; deliver in two PRs (fallback-first)

A new injected field `input.provenanceWindow` (`Array<{content,source,ts}>`, the exact
`getProvenanceWindow()` shape, already TTL-filtered at load time) carries the taint window.
F10 consumes it via a new **pure** helper `taint.correlateCommandPure(command, recentReads,
toolName, taintPolicy)` — no disk, no `loadProjectPolicy`. The taint policy
(`taintSafeToolClasses`, `taintMinTokenLength`) comes from the `projectPolicy` already loaded in
`decide()`, eliminating the redundant `loadProjectPolicy({})` in `taint.js`. The pure correlation
kernel `correlate()` (`provenance-correlator.js`) is **unchanged** — only the data *source* moves.

- **PR1 (additive):** `decide()` resolves the window as `input.provenanceWindow != null ?
  input.provenanceWindow : getProvenanceWindow(60)` (F23-style fallback). Every existing caller
  keeps working; the boundary + operator tools inject. Nothing can fail open.
- **PR2 (subtractive):** remove the disk fallback (`decide()` becomes cross-call-pure) and migrate
  the test harnesses (lattice runner + `run-fixtures.sh` taint blocks) to inject.

`input.provenanceWindow` is registered in `input-materializer.js` `_ARRAY_FIELDS` so a non-array
injection normalizes to `null` (then `[]` via the F10 `Array.isArray` guard).

### Replay determinism

Corpus entries carry no `provenanceWindow` field → `decide()` sees `[]` (PR2) or
fallback-to-empty-disk (PR1) → `correlate(cmd, [], 6)` → `{tainted:false}` — **identical inputs to
the unchanged kernel → identical output.** Policy resolution is identical too: the repo
`lilara.config.json` has no `taint` section, so both `loadProjectPolicy({})` (old) and
`decide()`'s `loadProjectPolicy({...discovered})` (new) yield the same defaults; the corpus has
zero safe-tool-class entries. `irHash` never reads `provenanceWindow` (not in `EMPTY_IR`; IR built
from unmodified input). **Verified: `bash scripts/check-replay-corpus.sh` — 119 entries, zero
divergence.**

### F10 detection unchanged + coverage gap

The 119-entry corpus has **zero** entries that exercise F10 with a populated window (it runs with
an empty state dir) — it proves *no-regression* but not that F10 still *detects* anything. ADR-046
closes that gap with `tests/runtime/taint-window-injection.test.js`:
- `correlateCommandPure` honors the passed window + policy (incl. a non-default `taintMinTokenLength`).
- `decide()` fires F10 on an injected populated window, does not on unrelated commands or
  safe-tool-class tools, and threads a non-default `taint.minTokenLength` from config.
- **Gate-level** (`runPreToolGate`): a populated window makes F10 fire end-to-end (primary path),
  and the **recheck** decide() carries taint correlation (proving both calls get the shared
  window). This is the only test that catches a broken boundary injection (silent fail-open).

The disk-based populated-window coverage (lattice `F10-taint-floor.input`, `run-fixtures.sh` taint
blocks) keeps passing via the PR1 fallback and is migrated to injection in PR2.

### Option B (rejected): single atomic PR

Provably replay-safe, but the pure end-state has no fallback safety net during the broad
caller/test migration. Given this is the highest-risk refactor in the project, the fallback-first
2-PR split keeps F10 alive at every step.

---

## Scope and Invariants

- No floor IDs changed. No lattice mutation. No `EXPECTED_*` count bump.
- The correlation kernel `correlate()` is untouched → token-matching semantics are provably identical.
- `decide()` retains its static config/git reads (discover/loadProjectPolicy/getContract) by design
  — they are environment-pinned, not cross-call state.
- `input.provenanceWindow` is additive; callers that omit it leave F10 inert (PR2) / disk-backed (PR1).
- Operator behavior preserved: `explain` and `sandbox` inject the window so F10 still reflects
  recent external reads (no silent behavior change).
- **ADR-045 interaction (symmetric redaction).** The injected window is redacted **at rest on write**
  (`session-context.recordExternalRead`, gated `LILARA_TAINT_WINDOW_REDACT`, default ON). To keep F10
  detection intact, `correlateCommandPure` applies the **same `redact()` to the command** under the
  same env gate — exactly the symmetric redaction ADR-045 added to the old `correlateCommand`, carried
  through this refactor. So F10 compares **redacted-vs-redacted**: a secret shared by an external read
  and a command matches placeholder-vs-placeholder (fail-safe, never fails open), and non-secret tokens
  are unchanged by `redact()` and still match. `redact()` is a pure regex scrubber (no disk, no clock),
  so `decide()` cross-call purity is preserved; the replay corpus is byte-identical (empty window ⇒
  `correlate()` short-circuits before redaction can matter). Covered by the secret-token cases in
  `tests/runtime/taint-window-injection.test.js` (verified fail-without-fix / pass-with-fix).

---

## Implementation (PR1)

**`runtime/taint.js`** — add pure `correlateCommandPure(command, recentReads, toolName, taintPolicy)`;
keep disk `correlateCommand` (retired in PR2).

**`runtime/decision-engine.js`** — import `correlateCommandPure` + `getProvenanceWindow`; F10 block
consumes `input.provenanceWindow` with a PR1 disk fallback and the already-loaded `projectPolicy`
taint bits.

**`runtime/input-materializer.js`** — register `provenanceWindow` in `_ARRAY_FIELDS`.

**`runtime/pretool-gate.js`** — load the window once at the boundary (always, F10 is always-on);
inject the **same value** into both the primary and the envelope-recheck `decide()` calls, with a
do-not-drop comment on the recheck call (Acceptance Criterion #1).

**`scripts/runtime-state.js` (`explain`)** and **`scripts/lilara-cli.sh` (`sandbox`)** — inject the
window to preserve F10.

**`tests/runtime/taint-window-injection.test.js`** (11 tests) — pure helper, `decide()` consumption,
config policy threading, and gate-level primary + recheck boundary proofs. Wired into
`scripts/check-runtime-core.sh`.

### PR2 (follow-up)
Remove the `getProvenanceWindow` fallback/import from `decide()`; retire disk `correlateCommand`
(migrate its direct unit callers); migrate `scripts/check-lattice-receipts.sh` and the four
`run-fixtures.sh` taint blocks to inject `getProvenanceWindow(60)` after `recordExternalRead`.

---

## Risk callouts (each with its guard)

1. **(HIGH) Recheck `decide()` loses F10 → fail-open on the high-severity lane.** Guard: shared
   window injected into both calls; gate-level recheck test asserts the recheck decision carries
   taint correlation.
2. **(HIGH) Broken boundary injection fails open with no failing test.** Guard: the new
   `runPreToolGate` gate-level test (mandatory, lands in PR1).
3. **(MED) Incomplete `run-fixtures.sh` migration in PR2.** Guard: all four `recordExternalRead →
   decide` blocks enumerated; CI runs them.
4. **(MED) Operator tools go dark.** Guard: `explain` + `sandbox` inject (PR1).
5. **(LOW) `correlateCommandPure` drops `taintMinTokenLength`** (masked locally — repo has no taint
   config). Guard: unit test injects a non-default `taintMinTokenLength`.
6. **(MED) Policy-resolution shift** — F10 now uses `projectRoot`-resolved policy instead of
   `cwd`-resolved. Replay-neutral; a correctness improvement. Guard: documented; config-threading test.

---

## Related

- ADR-037 (F28 taint-egress — same injected-graph boundary pattern)
- ADR-042 (env-branch grant guard — same "boundary owns impurity" principle)
- ADR-043 (provenance taint engine unit-test coverage — the `correlate()` kernel this ADR reuses unchanged)
- ADR-045 (provenance-window at-rest redaction — symmetric-redaction counterpart on the same F10 data path; `correlateCommandPure` carries its command-side `redact()` through this refactor)
- ADR-030 (unguarded advisory calls — fail-safe discipline)
