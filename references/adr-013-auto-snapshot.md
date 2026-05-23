# ADR-013 — Auto-snapshot before destructive operations

**Status:** ACCEPTED — 2026-05-15 (v0.5 Stage D, wave 2).
**Scope refs:** `workstreams/agent-runtime-guard-scope.md` §5.1 ("Auto-snapshot
before destructive operations + restore command") and §8 v1 success criteria
("Auto-snapshot prevents 100% of destructive operations in field testing").
**Plan ref:** `workstreams/agent-runtime-guard-plan.md` §4.1 Stage D.

## 1. Why this exists

§5.1 requires Lilara to capture an undo bundle for every destructive file-tree
operation before it runs, and a restore command to roll the tree back. The
Canonical Action IR already classifies destructiveness (`destructive: true`,
`commandClass: "destructive-delete"`, `fileTargets[]` with absolute paths),
but until this PR there was no rail that consumed that signal. Operators had
no recourse if an agent successfully ran an allowed `rm -rf` against the
wrong directory.

ADR-013 closes the gap with a **side-effect rail** — not a floor — that
attaches to every `destructive-allow` decision and writes a verifiable
file-tree snapshot before the action is reported back to the adapter.

## 2. Decision

**Trigger point.** The engine fires `createSnapshot` AFTER every floor has
decided AND BEFORE the engine returns `action: "allow"` to the adapter, gated
on `ir.destructive === true`. For `require-review`, the snapshot fires only
at the moment the operator approves (so we never snapshot for actions that
never run); for `block`, no snapshot is created (the action will not
execute). For non-destructive IR, no snapshot is attempted.

**Side-effect rail, not a floor.** Snapshot creation never changes a decision
from `allow` to `block` or vice versa. Floors live in `decision-engine.js`
and have a well-known firing order — adding snapshot creation as a floor
would mean snapshot failure could mask or invert a security-critical
decision. The rail discipline is the only way to satisfy both "auto-snapshot
prevents 100% of destructive operations" (§8) and "snapshot failure ever
blocking a non-destructive action" (Hard Stop).

**Fail-open contract.** If `createSnapshot` throws, the engine logs the
failure in the receipt (`snapshot.status === "failed-fail-open"`) and
proceeds with the original decision unchanged. This is a deliberate
trade-off: a transient FS error (full disk, permission flake) on a
destructive op MUST NOT silently promote the action to `block`, because
that would re-introduce the very false-positive vector ADR-011 worked to
eliminate. Operators see the failure on the receipt and in the journal.

**Scope-plan algorithm** (`planSnapshotScope(ir, opts)`):

1. Start from `ir.fileTargets[]`. Every entry whose `path` resolves to an
   existing regular file is captured directly (symlinks skipped — they are
   not source-of-truth).
2. If `ir.commandClass === "destructive-delete"` and the target is a
   directory, the whole subtree is enumerated. Other intents on a directory
   (`write`, `read`) capture only explicitly-listed children — the parent
   directory itself isn't being mutated.
3. Paths are deduped + sorted. The walk truncates at `MAX_PATHS = 5000`;
   the manifest records `truncated: true` so audit can tell the difference
   between "scope was small" and "scope was clipped".

**Manifest.** Per-snapshot `manifest.json` (canonical-JSON byte-stable):

```
{
  "version":     "1",
  "createdAt":   "<ISO-Z>",
  "reason":      "<commandClass or 'destructive'>",
  "decisionKey": "<fineKey>",
  "irHash":      "sha256:..." | null,
  "truncated":   false,
  "fileCount":   <int>,
  "totalBytes":  <int>,
  "entries":     [ { path, size, sha256, mode }, ... ],   // sorted by path
  "snapshotId":  "<ISO-no-colons>-<sha12>",
  "manifestHash":"sha256:..."
}
```

`snapshotId` derives from the canonical-JSON of the manifest with
`createdAt` blanked, so two identical filesystem states yield identical
hashes modulo the timestamp. Idempotency case (§7) verifies this.

**Blob layout.** Snapshots live at
`<LILARA_STATE_DIR>/snapshots/<snapshotId>/`:

```
<snapshotId>/
  manifest.json
  data/<sha256-of-content>     # gzip-encoded (node:zlib)
```

Content-addressed blobs dedupe identical files within a snapshot. Pure
Node + `node:zlib` only — no shell-out to `tar`/`zip`, no third-party
dependency, verified by `check-zero-deps.sh`.

**Restore atomicity contract.** `restoreSnapshot(id, opts)` writes each
captured file to a sibling `*.lilara-restore-<pid>-<ts>` tempfile under the
target's directory and atomically `rename()`s it into place. Per-file
atomicity is the strongest guarantee a portable filesystem helper can
offer; the operation as a whole is best-effort (partial restores are
reported via `skipped[]` + `conflicts[]`). Restore REFUSES to overwrite
any target whose current sha256 differs from the captured baseline unless
`opts.force === true`. The hash-mismatch guard exists to detect the
operator overwriting an intentional change with a stale snapshot.

**Budgets.**

| Budget | Value | Behavior on overflow |
| --- | ---: | --- |
| `MAX_PATHS` | 5,000 | scope-plan truncates; manifest records `truncated:true` |
| `MAX_BYTES` per snapshot | 256 MiB | refuse with `status:"scope-too-large"`; decision proceeds |
| `MAX_KEPT` | 50 | LRU prune by createdAt at every `createSnapshot` |
| `MAX_AGE_MS` | 30 days | aged-out snapshots dropped before count + bytes passes |
| `MAX_TOTAL_BYTES` | 4 GiB | LRU prune oldest until store fits the budget |

Pruning runs inside `createSnapshot` so a runaway journal cannot grow the
store unbounded between explicit `horus snapshot prune` invocations.

**Receipt + journal.** Every destructive-allow decision gains an additive
receipt key:

```
snapshot: {
  attempted:  true,
  status:     "created" | "truncated" | "scope-too-large" | "failed-fail-open",
  snapshotId: "<id>" | null,
  paths:      <int>,
  bytes:      <int>,
  reason:     "<commandClass>" | "scope-too-large" | "<error-message>" | null
}
```

The key is absent on non-destructive or non-allow decisions so existing
receipts and journal entries stay byte-identical for unrelated decisions —
satisfying the additive-only contract from ADR-007 PR-C / ADR-010.

## 3. CLI surface

`scripts/lilara-cli.sh` gains a `snapshot` subcommand family:

- `horus snapshot list` — snapshots with id, createdAt, size, reason, decisionKey.
- `horus snapshot show <id>` — manifest contents (paths + sha256 + sizes, no file contents).
- `horus snapshot restore <id> [--apply] [--force]` — restore; default is dry-run.
- `horus snapshot prune` — explicit prune; prints what was deleted.
- `horus snapshot doctor` — verify the store: every blob re-hashes, no orphans, no corrupt entries.

## 4. Known limitations

- **File-tree only.** ADR-013 does NOT roll back side-effects of commands
  that touched the network, a database, or any external service. A snapshot
  captures the on-disk state that existed at decision time. If the agent
  ran `aws s3 rm s3://...` or `psql -c 'DROP TABLE ...'`, the snapshot
  cannot recover that state. Operators must combine Lilara snapshots with
  service-specific backups for non-file rollback. (Out-of-scope: SaaS-API
  state, DB rollback, container/VM state.)

- **Symlinks are not captured.** They are skipped during enumeration. If a
  destructive op targets the link target's contents the captured snapshot
  reflects the target file (when it appears explicitly in `fileTargets[]`),
  not the link.

- **Per-file atomicity, not transactional restore.** Restore is per-file
  atomic. A crash mid-restore leaves an inconsistent partial state; the
  next restore retries every file (the hash mismatch on already-restored
  files passes through cleanly).

- **No encryption at rest.** Snapshots inherit the `0700` mode of
  `LILARA_STATE_DIR`. Encrypted snapshots are deferred to a separate PR or
  to v1.0.

- **No cross-machine sync.** Snapshots are local. Cross-host portability
  belongs to ADR-011 (state-bundle), which already excludes the snapshots
  directory from export (the snapshot store is host-local and may contain
  sensitive file contents).

## 5. Retention policy

The triple-constraint `(MAX_KEPT, MAX_AGE_MS, MAX_TOTAL_BYTES)` is checked
on every `createSnapshot` and on every explicit `horus snapshot prune`.
Eviction order: age first (a 31-day-old snapshot is gone regardless of
count or size), then count (drop oldest until ≤ 50), then total bytes
(drop oldest until ≤ 4 GiB). Operators who need longer-tail retention
should copy snapshots out of `~/.lilara/snapshots/` to their own backup
location — Lilara intentionally does not promise indefinite retention.

## 6. Alternatives considered

- **Promote snapshot creation to a floor.** Rejected — would convert a
  transient FS error on a destructive op into a `block`, violating the
  fail-open invariant and the §5.1 / §8 success criteria. See §2.

- **Tar/zip shell-out.** Rejected — adds a binary dependency, violates
  `scripts/check-zero-deps.sh`, and forks 5,001+ subprocesses on a large
  scope. Pure Node + `node:zlib` blob layout is both simpler and faster.

- **Pre-compute snapshot at `require-review` emission.** Rejected — wastes
  I/O on actions that never run. The current rule (snapshot on the
  approval path, after the operator-token check, when `action === "allow"`)
  fires exactly when an undo is meaningful.

## 7. Tests

`tests/runtime/snapshot.test.js` covers:

- `planSnapshotScope` shape across four IR cases.
- `createSnapshot` round-trip: write, list, restore, verify byte-identical recovery.
- Hash-mismatch refusal: mutate target on disk → restore without `--force` refuses; with `--force` overwrites.
- Budget enforcement: simulated 5001-path scope truncates; >256 MiB scope returns `scope-too-large`.
- Fail-open: simulated FS error inside `createSnapshot` → engine returns `allow` + receipt records `failed-fail-open`.
- Retention: 51 snapshots created → oldest pruned automatically.
- Non-destructive IR: no snapshot attempted.
- Block decision: no snapshot attempted.
- Idempotency: identical IR + identical pre-action filesystem state → identical manifest hash modulo `createdAt`.
- End-to-end smoke: hermetic temp project tree, simulated `rm -rf` decision → snapshot created → restore-after-rm restores tree byte-identical.

## 8. Out-of-scope / future work

- Encrypted snapshots (separate v0.5 PR or v1.0).
- Cross-machine snapshot sync (ADR-011 boundary).
- Auto-restore on rollback (operator must explicitly invoke `horus snapshot restore`).
- Snapshot UI / dashboard surface.
- Snapshot of non-file side-effects (DB, network, external API state).
