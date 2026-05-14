# ADR-011 — State portability: export / import

**Status:** ACCEPTED — 2026-05-14 (v0.5 Stage D).
**Scope refs:** `workstreams/agent-runtime-guard-scope.md` §4.3 ("Operator can
always export and wipe. GDPR-baseline always; no operator state is held
hostage.") and §5.1 ("State portability (export / import)").
**Plan ref:** `workstreams/agent-runtime-guard-plan.md` §4.1 Stage D.

## 1. Why this exists

§4.3 elevates operator state portability to an invariant. §8 v1 success
criteria require "State export/import round-trips with zero data loss". Prior
to this PR, HAP state under `~/.horus` (or `HORUS_STATE_DIR`) had no documented
export/import path — operators wanting to migrate machines, back up state, or
exercise their GDPR "right to portability" had to hand-copy directories and
hope. That is not a baseline this project is willing to ship.

ADR-011 closes the gap with a zero-dep, byte-stable export bundle and an
import path that refuses on a broken journal chain.

## 2. Decision

**Format.** Hand-rolled POSIX-ustar tar layout containing:

- root `bundle-manifest.json` (the canonical manifest);
- `data/<rel>` for every included file, preserving directory structure.

Regular files only — symlinks, sockets, FIFOs, and directories are not encoded
as tar entries. The hand-rolled writer/reader stays under the LOC budget
(~110 LOC) and avoids any new dependency, preserving the HAP zero-deps
invariant verified by `scripts/check-zero-deps.sh`. (Alternative considered:
a hand-rolled zip container around `zlib.deflateRawSync`. Rejected — tar
without compression has fewer moving parts, the same byte-stability story,
and a simpler header.)

**Manifest.** Bundle root carries `bundle-manifest.json`:

```
{
  "version":           "1",
  "createdAt":         "<ISO-Z>",
  "exportedBy":        { "hostname": "...", "platform": "linux" },
  "hostFingerprint":   "hf_<16hex>",          // sha256(hostname|platform|arch)[0..16]
  "journalChainTipAt": "sha256:<...>" | null, // last entryHash of source chain
  "fileCount":         <int>,
  "totalBytes":        <int>,
  "entries":           [ { path, size, sha256 }, ... ],   // sorted by path
  "excluded":          [ { path, reason }, ... ],
  "bundleHash":        "sha256:<...>"          // see §3
}
```

**Bundle policy.**

- **Included.** Everything under `HORUS_STATE_DIR` not on the blacklist: the
  decision journal (and rotated generations), the journal hash chain
  (`journal-chain.jsonl`) and its checkpoint, the learned policy store,
  project-policy registrations, accepted contracts, session/budget state,
  telemetry, envelope baselines, lattice fixture pins. The list isn't
  hard-coded — `enumerateFiles()` walks the dir and applies the blacklist.
- **Excluded (blacklist, enforced both ways).**
  `install.key`, `operator-tokens.jsonl`, `*.key`, `*.pem`, `*.priv`,
  anything under `secrets/`, `*.sock`, `*.fifo`, `*.lock`, `*.tmp`, `*.swp`.
  These are live credentials (chain HMAC key, one-shot operator tokens),
  the operator's secret vault, host-local IPC handles, and host-local
  scratch — all unsafe to cross machines.
- **Special-cased.** Machine-specific fields embedded in receipts (absolute
  paths, host-specific config) are **not** rewritten on export. The import
  side detects cross-machine restores via `hostFingerprint` and either
  accepts (same-machine) or refuses without `--accept-cross-host`. We do
  this so the operator is informed; silent path rewriting is a hard stop
  per the brief.

**Hard stop adherence.** The blacklist is checked on three independent
paths: at enumeration time (export), in the manifest entries (import-side
manifest validation), and across the extracted data files (import-side data
validation). A bundle authored by a hostile actor cannot smuggle a
secret-blacklist file through any single check.

## 3. Byte-stability invariant

`bundleHash = "sha256:" + sha256(canonicalJson(manifest \ {bundleHash, createdAt}))`.

The two excluded fields are exactly the ones that can drift between two
exports of the same state. Every other field — `version`, `exportedBy`,
`hostFingerprint`, `journalChainTipAt`, `fileCount`, `totalBytes`, `entries[]`
(with each `{path,size,sha256}`), `excluded[]` — is canonically ordered and
deterministic. Result: two consecutive exports of the same state dir on the
same machine produce identical `bundleHash`, with `createdAt` the only
allowed delta. This is asserted in `tests/runtime/state-bundle.test.js`.

The `entries[]` array is sorted by `path` and each entry carries the file's
sha256, so the manifest alone tamper-evidences every file in the bundle.
`validateBundle()` re-hashes every extracted data file and refuses any
mismatch — a bundle author cannot rewrite a data file without also forging
the matching manifest entry, and forging the manifest changes `bundleHash`.

## 4. Journal chain-continuity on import

The hash chain (`journal-chain.jsonl`, ADR-004) is tamper-evident inside the
bundle: each entry's `entryHash` is recomputed and compared, `prevHash`
linkage is verified, and `seq` monotonicity is checked. The manifest's
`journalChainTipAt` must match the chain's final `entryHash` — this is what
makes "the chain that was exported" equal to "the chain that gets imported".
Import refuses on any chain failure. A tampered entry, a dropped tail entry,
or a `journalChainTipAt` that disagrees with the chain body all surface as
problems and block `--apply`.

**HMAC limitation.** Genesis and checkpoint HMACs depend on the source
`install.key`, which is on the blacklist. On cross-machine restore the
post-import chain therefore validates clean for `entryHash`/`prevHash`/`seq`
but produces `genesis-hmac-mismatch` / `checkpoint-hmac-mismatch` under
`journal verify` because the target machine's install key differs. This is
the explicit cost of refusing to transport the operator's secret key. On
same-machine restore (the dominant case — backup + restore) the install key
on disk is untouched and HMAC verification continues to pass.

This trade-off is the right one for v0.5: never pack the chain's signing
key in a portable bundle. Operators wanting fully-portable chain HMAC
verification land on encrypted bundles in a follow-up (see §7).

## 5. CLI surface

`scripts/horus-cli.sh` gains `state` with three subcommands:

- `horus-cli.sh state export <out-path> [--force]` — writes a bundle.
  Refuses to overwrite without `--force`. Emits a `state-export` receipt
  through `decision-journal` carrying `bundleHash`, `fileCount`, and the
  chain tip.
- `horus-cli.sh state import <bundle-path> [--apply] [--force] [--accept-cross-host]`
  — dry-run by default (validation only); `--apply` actually restores.
  Refuses to apply on top of a non-empty target dir without `--force`.
  Refuses cross-host restore without `--accept-cross-host`. Stage-then-swap
  semantics: data files are written to a sibling staging dir first, the
  current target dir (if any) is renamed to `<target>.pre-import-<ts>`
  as a backup, then the staging dir is renamed into place. On any failure
  before the final rename, the staging dir is removed and the original
  target is restored from the backup — the import is atomic from the
  caller's perspective. Emits a `state-import` receipt carrying
  `chain-tip-before` and `chain-tip-after`.
- `horus-cli.sh state doctor` — runs `buildExportManifest` and prints the
  includable file count, total bytes, excluded files (with reasons), the
  current chain tip, and the host fingerprint. The "is my state importable
  elsewhere?" pre-flight.

## 6. GDPR-baseline alignment

§4.3 invariant: *operator can always export and wipe.* This PR delivers the
export side and matches the wipe side already present (operator can `rm -rf
$HORUS_STATE_DIR` on any machine — nothing on disk is held under DRM, the
runtime regenerates state on next decide). Together they form the v0.5
GDPR portability baseline: a single zero-dep CLI command produces a
portable copy of every piece of operator-owned state, a single shell
command removes it.

## 7. Known follow-ups (out of v0.5)

1. **Encrypted bundles.** Optional bundle-level symmetric encryption keyed
   off an operator passphrase, with a published KDF and a manifest header.
   Would let the chain's install.key travel safely (a hostile actor without
   the passphrase still can't extract it) and close the cross-machine HMAC
   gap. Tracked for v0.5+.
2. **Cross-machine state sync.** Online sync (rather than offline bundle
   shuttle) requires identity, conflict resolution, and a transport. Out of
   v0.5; in scope for v2.0 per `agent-runtime-guard-plan.md` §8.

## 8. Tests + gates

- `tests/runtime/state-bundle.test.js` — round-trip, corrupted manifest
  rejection, tampered journal rejection, same- vs different-machine
  fingerprint behavior, secret-file exclusion, `bundleHash` byte-stability.
- `scripts/check-zero-deps.sh` — verifies `runtime/state-bundle.js` adds
  no third-party requires.
- `scripts/check-runtime-core.sh` — unchanged; the helper is additive.
- `scripts/check-counts.sh` — no new top-level scripts.
