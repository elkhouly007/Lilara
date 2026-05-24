# Migration Notes

Operator-facing migration notes for runtime/contract/schema changes. Older
schema migrations (contract v1→v2, v2→v3) are documented in
`CHANGELOG.md` and exercised by `scripts/check-migrate-v1-v2.sh` and
`scripts/check-migrate-v2-v3.sh`.

---

## v3.1.0 (HAP / Agent Runtime Guard) → v0.1.0 (Lilara) — clean-break upgrade

**Decision D-016:** Clean break. No dual-read fallback. No `HORUS_*` aliases.

### 1. Stop any running hooks

Close all Claude Code / OpenCode / OpenClaw / Codex / Antegravity sessions
before migrating. Running hooks will crash or silently fail once the env vars
and state dir are renamed.

### 2. Migrate state directory

```bash
mv ~/.horus ~/.lilara
```

If you want to keep both side-by-side during a trial period, wipe `~/.horus`
and start fresh — the only operator today is Khouly, so blast radius is one
person.

### 3. Migrate environment variables

Remove all `HORUS_*` entries from your shell rc files (`.bashrc`, `.zshrc`,
etc.) and replace with `LILARA_*` equivalents:

| Old | New |
|-----|-----|
| `HORUS_ENFORCE` | `LILARA_ENFORCE` |
| `HORUS_KILL_SWITCH` | `LILARA_KILL_SWITCH` |
| `HORUS_STATE_DIR` | `LILARA_STATE_DIR` |
| `HORUS_CONTRACT_ENABLED` | `LILARA_CONTRACT_ENABLED` |
| `HORUS_TRAJECTORY_WINDOW_MIN` | `LILARA_TRAJECTORY_WINDOW_MIN` |
| `HORUS_BENCH_P99_MS` | `LILARA_BENCH_P99_MS` |
| `HORUS_PERF_P99_MS` | `LILARA_PERF_P99_MS` |
| (all others follow the same pattern) | |

### 4. Re-accept your contracts

Existing accepted contracts carry a `contractId` with the `hap-` prefix.
That prefix no longer matches the schema regex `^lilara-...`. They are
invalid and will be ignored.

```bash
# Accept a fresh contract
bash scripts/lilara-cli.sh accept-contract ./lilara.contract.json

# Verify
bash scripts/lilara-cli.sh check
bash scripts/lilara-cli.sh state stats
```

### 5. Update wire-hook snippets

If your hooks file (e.g. `.claude/settings.json`) references `horus-cli.sh`,
update to `lilara-cli.sh`. Re-run `bash scripts/install.sh` to pick up the
renamed scripts automatically.

### 6. Verify

```bash
bash scripts/lilara-cli.sh check
bash scripts/lilara-cli.sh state stats   # journal/policy/snapshots intact
```

### Local git remote (after GitHub repo rename)

```bash
git remote set-url origin git@github.com:elkhouly007/lilara.git
```

GitHub auto-redirects old `agent-runtime-guard` URLs for ~12 months.

---

## ADR-007 — Canonical Action IR + Decision Lattice (PR-A → PR-D)

**Status:** additive. No operator action required.

The Lilara ADR-007 series (`references/adr-007-canonical-action-ir.md`) lands
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
`LILARA_IR_JOURNAL=0`. The flag is intended as a short-lived escape hatch
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
journal extras without reverting code, set `LILARA_IR_JOURNAL=0` in the
operator environment.

---

## v0.5 Stage A–D — Operator-Facing Notes

All Stage A–D changes (PRs #34–#54, v3.1.0) are additive. No contract
schema break since v3.0.0. The notes below describe new opt-in / opt-out
knobs, new state-directory subdirs, and new CLI surfaces that operators
should know about. None require action to stay on the upgrade path.

### ADR-009 — F16 ambient-authority (opt-in)

`scopes.ambient.allow` is a new optional contract array. Commands that
touch an `ambient`-classified path require an explicit entry; absent the
entry, F16 fires. Default behaviour for contracts that do not declare
`scopes.ambient` is unchanged. Receipts gain `ambientClass` on every
ambient-touch decision.

### F18 D-007 — plaintext network (opt-out)

`scopes.network.allowPlaintext` is a new optional contract boolean. When
the contract carries any F18 signal (`allowDomains`, `denyDomains`, or
`allowPlaintext`), a plaintext (`http://…`) target is blocked unless
`allowPlaintext === true`. Loopback is exempt. Contracts that do not
carry any F18 signal are unaffected.

### ADR-011 — state portability

New CLI: `lilara-cli.sh state export <path>` writes a self-contained
bundle of `~/.lilara/` (learned-policy, journal, instincts, snapshots,
session-budget, locks). `lilara-cli.sh state import <path>` restores it.
Useful for migrating between machines or moving from a test box to
production. Implemented in `runtime/state-bundle.js`.

### ADR-013 — auto-snapshot before destructive ops

New state subdir: `~/.lilara/snapshots/`. When a destructive action is
allowed/routed, `runtime/snapshot.js` captures pre-action state and
attaches the snapshot ref to the receipt. Disk usage grows with
destructive-op volume; prune with `lilara-cli.sh snapshot prune` (or
remove files older than your retention threshold manually). No
configuration is required for the feature to be active.

### ADR-014 — audit-grade receipts

New CLI: `lilara-cli.sh receipt export <session-id>` produces a canonical
receipt JSON for auditors. `scripts/redact-payload.sh` is an offline
audit tool that strips sensitive fields from an exported receipt; it is
NOT in the runtime path. CI gate: `scripts/check-receipt-schema.sh`.

### ADR-015 — notification routing (opt-in)

New optional contract section: `notifications`. Set
`notifications.enabled === true` to activate. Each transport has its own
keys:

- `notifications.discord.webhookUrl` — Discord incoming-webhook URL.
- `notifications.slack.webhookUrl` — Slack incoming-webhook URL.
- `notifications.email.{to, from?}` — email recipient(s). SMTP
  credentials live in the environment only: `LILARA_SMTP_HOST`,
  `LILARA_SMTP_PORT`, `LILARA_SMTP_USER`, `LILARA_SMTP_PASS`,
  `LILARA_SMTP_FROM`. Never stored in the contract or any state file.

The hook is fire-and-forget: transport failures do not change a
decision. Receipts gain an additive `notifyAttempted: true` ONLY when
the hook actually fires (contract enabled + matching event). Installs
without `notifications.enabled === true` produce byte-identical receipts
to v3.0.0.

Triggers:

- `approval-request` (severity `info`) when `action === "require-review"`.
- `kill-switch-fire` (`critical`) when F1 fires.
- `degraded-mode-entered` (`warning`) on the first process-lifetime
  `decide()` with a degraded marker.
- `adversarial-bypass-detected` (`critical`) when a G-series floor
  produces `block` (forward-compatible no-op until G-series ships).

PII scrubber is allowlist-only — only the explicitly listed keys ever
reach a transport.

### ADR-004 — degraded-mode + hash-chained journal

The decision journal is now hash-chained. `scripts/verify-decision-journal.sh`
walks the chain and exits non-zero on tamper. No operator action is
required; existing journals continue to append and verify cleanly.

If the runtime detects unhealthy state (store / chain / locks), it
emits a `degraded-mode-entered` marker on the first process-lifetime
fire. Operators see this as a stderr notice and (if notifications are
enabled) a `warning` event.

### Floor count

`ARCHITECTURE.md` §2 enumerates the implemented floors. As of v3.1.0:
F1–F14, F14b, F15, F16, F17, F18, F18-D007, F19, F20. Twenty floors
total. All additive to v3.0.0; no decision flips outcome under an
existing v3 contract that does not opt into the new scopes.

### Rollback for this batch

Each ADR ships behind a contract field or an env switch. To roll back a
single feature without reverting code:

| Feature | Opt-out |
|---|---|
| F16 ambient | omit `scopes.ambient` from the contract |
| F18 network-egress | omit `scopes.network.allowDomains` (and `denyDomains`, `allowPlaintext`) |
| F19 output-exfil | (no opt-out; lattice floor) |
| F20 change-intent | (no opt-out; lattice floor) |
| Auto-snapshot (ADR-013) | (no env flag yet; remove `~/.lilara/snapshots/` to reclaim disk) |
| Notifications (ADR-015) | omit `notifications` from the contract, or set `notifications.enabled` to `false` |
| Journal hash-chain (ADR-004) | (no opt-out; backwards-compatible append format) |
