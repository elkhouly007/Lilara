# ADR-009 — Ambient-Authority Path Classifier (F16)

**Status:** ACCEPTED — Khouly 2026-05-13.
**PR-A status:** SHIPPED (classifier + tests only).
**PR-B status:** SHIPPED (F16 floor wired into decision-engine + `scopes.ambient.allow[]` opt-in + fixtures + tests + this doc).
**PR-C status:** SHIPPED (receipt enrichment generalised — `ambientClass`/`ambientPath` on every decision that touches an ambient path).
**PR-D status:** SHIPPED (F16 adversarial corpus + replay fixtures; no engine LOC change; documents two known pre-D bypasses for a future PR-E to flip).
**Authors:** Khouly (scope), Claude Code (implementation).
**Repo cross-refs:** `runtime/ambient.js`, `runtime/decision-engine.js`, `runtime/decision-lattice.js`, `runtime/index.js`, `schemas/lilara.contract.schema.json`, `tests/runtime/ambient.test.js`, `tests/runtime/ambient-floor.test.js`, `tests/fixtures/floor-f16/`, `tests/fixtures/lattice-receipts/F16-ambient-authority.input`.

---

## 1. Why this exists

The runtime's existing trust boundary is the **project directory**: anything
under `projectRoot` lives in project trust; the rest is "outside the trust
boundary." Today that "outside" surface is unclassified — `decision-engine.js`
treats every non-project path the same way, even though some of those paths
carry **ambient authority**: their contents are auto-loaded by the operating
system, shell, version-control system, package manager, IDE, or browser at
session start, so a write into one of those paths silently grants persistent
privilege across sessions and projects.

Real ambient-authority paths the agent can reach today include:

| Path                                        | Authority granted on next session |
| ------------------------------------------- | --------------------------------- |
| `~/.ssh/authorized_keys`                    | Inbound SSH login as this user    |
| `~/.ssh/id_rsa`                             | Outbound SSH identity (impersonation) |
| `~/.gitconfig` (+ `~/.git/config`)          | `core.hooksPath` runs on every repo |
| `~/.bashrc`, `~/.zshrc`, `~/.profile`       | Code on every interactive shell   |
| `~/.npmrc`, `~/.yarnrc.yml`, `~/.cargo/credentials.toml` | Package registry creds + scripts |
| `~/.netrc`, `~/.git-credentials`            | Auth for every curl/git invocation |
| `~/.docker/config.json`                     | Image-pull credentials + helpers  |
| `~/.aws/credentials`, `~/.config/gcloud/...`, `~/.azure/...`, `~/.kube/config` | Cloud-CLI auth |
| `~/.vscode/...`, `~/.config/Code/User/...`, `~/.idea/...` | Tasks/extensions auto-run on workspace open |
| `~/.claude.json`, `~/.config/claude/...`, `claude_desktop_config.json`, `~/.continue/...`, `~/.codeium/...`, `~/.cline/...` | MCP servers auto-load on next agent start |
| `~/.mozilla/firefox/...`, Chrome profile dirs, browser `Cookies`/`Login Data` | Stored web sessions + cookies |
| `~/Library/Keychains/...`, `~/.gnupg/...`, `~/.password-store/...`, `~/.local/share/keyrings/...`, `Windows\System32\config\...` | OS credential vaults |

A write into any of these creates a **persistent backdoor** that survives
the current session — the user cannot revoke it by closing the terminal.
This is the F16 scope.

## 2. Decision (PR-A foundation only)

Land a **shape-only path classifier** as a zero-dep, pure module in
`runtime/ambient.js`, exporting:

```
classifyAmbientPath(targetPath) → "ssh" | "gitConfig" | "shellRc"
                                | "packageCache" | "credentialHelper"
                                | "ideSettings" | "mcpConfig"
                                | "browserProfile" | "osKeychain"
                                | "nonAmbient"
isAmbientPath(targetPath)        → boolean
AMBIENT_CLASSES                  → frozen string[] (the 10 class ids)
```

The classifier is **shape-only**: it operates on the path string, not on
the host OS. Linux, macOS, Windows, and WSL path shapes are all matched
as data, so the same classification is produced regardless of where the
agent is running. Pattern matching is anchored on path-segment
boundaries (`(^|/)…(/|$)`) to prevent embedded-substring false hits
(e.g. `/project/.sshield/` does NOT match `ssh`). Backslashes are
folded to forward slashes; `file://` URI scheme is stripped.

**PR-A explicitly does NOT change runtime behavior.** No decision-engine
floor, no contract schema field, no default-deny. The classifier is
exported so that later PRs (PR-B+) can wire:

| PR    | Goal                                                                |
| ----- | ------------------------------------------------------------------- |
| PR-A  | Classifier + tests + ADR (this PR). Zero behavior change.           |
| PR-B  | `decision-engine.js` floor: ambient class outside `projectRoot` → block. Schema-additive `scopes.ambient.allow[]` opt-in. |
| PR-C  | Receipt enrichment: `ambientClass` field on every decision that touches an ambient path. |
| PR-D  | Adversarial corpus + replay fixtures.                               |

## 3. Why shape-only (not membership-aware)

The classifier deliberately does NOT take a `projectRoot` argument. Two
reasons:

1. **Stable identifiers across processes.** A path classified `ssh` on
   one machine must classify `ssh` on every other machine, regardless
   of what each machine considers its current project root. This is
   the same design rationale as ADR-007's Canonical Action IR.

2. **Project-local exceptions are real.** Some classes — particularly
   `gitConfig` (`.git/config` inside the repo) and `ideSettings`
   (`.vscode/settings.json` inside the repo) — appear inside the project
   root **legitimately**. PR-B will intersect the classifier output
   with a project-membership check before applying any floor. Keeping
   that policy decision out of the classifier lets the classifier
   remain a pure lookup table.

## 4. Why NOT extend `classifyPathSensitivity`

`claude/hooks/hook-utils.js` already has `classifyPathSensitivity(p)`
returning `"high" | "medium" | "low"`. That classifier is **advisory**:
it feeds a risk-score nudge, not a floor. The F16 ambient class needs
to be:

- a **categorical** identifier (which authority is granted), not a
  severity scale;
- ultimately enforceable as a **hard floor** in a later PR;
- **schema-bound** via `scopes.ambient.allow[]` opt-ins (later PR).

Reusing the advisory classifier would entangle the F16 floor with a
field already shaped for risk-score weighting, and would force one
module to serve both purposes. Keeping `ambient.js` separate also
preserves the runtime's single-responsibility module convention.

## 5. Non-goals (PR-A)

- No `decision-engine.js` change. Floor predicates, ordering, source
  tags, lattice rungs: byte-unchanged.
- No `pretool-gate.js` change. Adapter inputs flow unchanged.
- No contract schema field. `schemas/lilara.contract.schema.json`
  byte-unchanged.
- No new fixture / hook / agent / rule / skill. Test lives at
  `tests/runtime/ambient.test.js` (mirrors the existing
  `tests/runtime/command-normalize.test.js` pattern); no change to
  fixture / script / hook counts.
- No Hard Ethical Core change. The HEC reservation in
  `runtime/decision-lattice.js` rung 0 is untouched.
- No third-party dependency. `runtime/ambient.js` is zero-dep, pure,
  and has no I/O.

## 6. Acceptance

- `node tests/runtime/ambient.test.js` — 30+ classifier cases including
  Linux / macOS / Windows / WSL path shapes, false-positive guards,
  case-insensitivity, and `AMBIENT_CLASSES` integrity.
- `bash scripts/check-runtime-core.sh` — unchanged runtime spine.
- `bash scripts/check-zero-deps.sh` — `runtime/ambient.js` declares no
  third-party imports.
- `bash scripts/check-counts.sh` — agent / rule / skill / hook / fixture
  / script counts unchanged.
- `bash scripts/check-status-docs.sh` — parity matrix unchanged.
- `bash scripts/audit-local.sh` — no risky patterns introduced.
- `LILARA_HERMETIC_TEST=1 bash scripts/run-fixtures.sh` — unchanged
  fixture behavior.

## 7. PR-B contract (SHIPPED)

PR-B turns the PR-A classifier into a hard floor. The runtime additions are:

### 7.1 LATTICE entry — F16

A single frozen entry was inserted into `runtime/decision-lattice.js` between
F15 (rung 17, `execution-envelope`) and `D-CONTRACT-ALLOW` (rung 18):

```js
{ id: "F16", rung: 17.5,
  name: "ambient-authority",
  action: "block",
  source: "ambient-authority-denied",
  demotableBy: [],
  predicateRef: "runtime/decision-engine.js + runtime/ambient.js",
  notes: "ADR-009 PR-B: write into ambient-authority path outside projectRoot. Demotion only via scopes.ambient.allow[<class>]=true or path-prefix entry." }
```

The non-integer rung is intentional: `assertOrdered()` only requires strict
monotonicity, and 17.5 keeps F15 < F16 < D-CONTRACT-ALLOW without renumbering
any existing rung. `demotableBy: []` makes F16 non-demotable — contract-allow,
learned-allow, auto-allow-once, operator tokens, and trajectory-nudge cannot
demote it. The ONLY legitimate bypass is the `scopes.ambient.allow[]` opt-in
described below.

### 7.2 Engine wiring (placement, ordering, fail-open)

The F16 check sits in `runtime/decision-engine.js:decide()` **immediately after
the F15 envelope check** and **before** risk scoring, contract-allow demotion,
auto-allow-once, trajectory-nudge, and F14b. The placement matches the rung:
17 < 17.5 < 18. When both F15 and F16 would fire, F15 wins (its early-block
returns first) — verified by an explicit lattice-ordering test in
`tests/runtime/ambient-floor.test.js`.

The check is wrapped in `try { … } catch { /* fail-open */ }` per the zero-dep
policy: if anything inside `runtime/ambient.js` throws on a specific input, the
engine continues to the rest of the precedence ladder rather than crashing.
Hoisted import (`require("./ambient")` at module top) mirrors the F18 wiring
style; the try/catch covers evaluation only.

### 7.3 Project-local exception list

Some ambient classes have a **legitimate in-project shape**:

| class         | legitimate in-project shape                                  |
| ------------- | ------------------------------------------------------------ |
| `gitConfig`   | `<projectRoot>/.git/config` — per-repo git config            |
| `ideSettings` | `<projectRoot>/.vscode/`, `<projectRoot>/.idea/`, `.cursor/` |

Writes whose path classifies as one of these AND is segment-aligned inside
`projectRoot` skip F16. Every other ambient class fires regardless of project
membership — a write to `<projectRoot>/.ssh/id_rsa` still blocks because the
`ssh` class has no legitimate in-project reason. Project-membership uses the
same shape-only normalization as the classifier (`\\` → `/`, strip `file://`,
trim trailing slash, case-insensitive).

### 7.4 Schema — `scopes.ambient.allow[]`

Additive opt-in extension to `schemas/lilara.contract.schema.json`. Shape:

```jsonc
"scopes": {
  "ambient": {
    "allow": [
      // class-only: permit ALL paths of this class
      { "class": "gitConfig", "reason": "global git config rotated externally" },
      // class + pathPrefix: permit only paths starting with the prefix
      { "class": "credentialHelper", "pathPrefix": "/home/user/.aws/" }
    ]
  }
}
```

- `class` is required; enum-restricted to the 9 ambient classes (the 10th
  member of `AMBIENT_CLASSES`, `nonAmbient`, is not a valid opt-in value).
- `pathPrefix` is optional. Matching is **case-insensitive** and
  **segment-aligned** (`pathPrefix:"/home/user/.aw"` does NOT permit
  `/home/user/.aws/credentials`). Prefix normalization mirrors ambient.js:
  backslashes fold to forward slashes, `file://` stripped, trailing slash
  trimmed.
- `reason` is operator-advisory (≤200 chars). It's logged through to the
  decision receipt for traceability.
- `additionalProperties: false` applied to both `scopes.ambient` and each
  `allow[]` entry, matching the convention of every other `scopes.*` block.

Existing contracts without `scopes.ambient` retain default-deny behavior: F16
fires whenever it would otherwise fire.

### 7.5 Receipt enrichment (PR-B scope)

When F16 fires, the decision receipt carries:

- `ambientClass`: the classifier's class id (`"ssh"`, `"gitConfig"`, …).
- `ambientPath`: the offending path (raw, pre-normalization, so the receipt
  reflects the agent's actual write target).

PR-B explicitly **does NOT** add `ambientClass` to non-F16 decisions; that is
PR-C's scope per §2 (receipt enrichment on every ambient touch).

### 7.6 Non-demotability

F16 is `demotableBy: []`. The PR-C `canDemote()` guard returns `false` for any
`(F16, attemptedSource)` pair. The floor-demotion-matrix fixture
(`tests/fixtures/decision-engine/floor-demotion-matrix.input`) was extended
with an F16 row asserting every common demotion source is rejected
(`contract-allow`, `contract-allow:tool-allow-matched`,
`operator-token:class-c-review-demote`, `learned-allow`, `auto-allow-once`).

### 7.7 Local gates added by PR-B

- `tests/runtime/ambient-floor.test.js` — 14 node:assert cases.
- `tests/fixtures/floor-f16/*.input` — 10 fixture-driven scenarios (1–10 from
  the PR-B brief).
- `tests/fixtures/lattice-receipts/F16-ambient-authority.input` — canonical
  per-floor receipt-shape pin (action, decisionSource, floorFired,
  ambientClass, rung, latticeVersion).
- `scripts/check-floor-f16.sh` — sweep runner, wired into `run-fixtures.sh`.
- `scripts/check-lattice-ordering.sh` — expectedFloors list now includes
  `F16`.
- `scripts/check-lattice-receipts.sh` — recognizes `expected.ambientClass`.

## 8. PR-C contract (SHIPPED)

PR-C generalises the PR-B receipt enrichment to **every** decision branch that
touches an ambient path, not just F16 fires. Closes the audit-completeness gap
that PR-B opened: post-hoc receipts can now distinguish ambient-touch allows
from non-ambient allows.

### 8.1 Receipt-field semantics

Two optional fields are appended to the decision receipt + journal entry when
any candidate path on the decision classifies as a non-`nonAmbient` ambient
class:

- `ambientClass` — the classifier's class id (`"ssh"`, `"gitConfig"`,
  `"shellRc"`, `"packageCache"`, `"credentialHelper"`, `"ideSettings"`,
  `"mcpConfig"`, `"browserProfile"`, `"osKeychain"`).
- `ambientPath` — the raw candidate path that produced the classification.

If `_collectAmbientCandidatePaths(input)` returns no candidates, OR every
candidate classifies as `nonAmbient`, **both fields are omitted entirely**
(not written as `null`). `null`/absent therefore means "this decision did
not touch an ambient path."

### 8.2 Where the enrichment fires

The fields are populated on every receipt-emitting branch:

- **F16 fire (PR-B existing behavior).** `ambientClass`/`ambientPath` reflect
  the class/path the floor actually fired on (which may be a later candidate
  in the iteration when an earlier one was skipped by the project-local
  exception or `scopes.ambient.allow[]`).
- **Allow inside `projectRoot`** for project-local-shape classes (`gitConfig`,
  `ideSettings`, `mcpConfig`) — receipt now carries the class.
- **Allow via `scopes.ambient.allow[]` opt-in** — receipt carries the class
  even though F16 was permitted by the opt-in.
- **Other early-block floors** (validity-window, mcp-deny, skill-deny,
  budget-exceeded, network-egress, envelope-divergence, contract-hash-mismatch,
  harness-out-of-scope, no-contract-strict) — when the decision also happened
  to touch an ambient path, the receipt carries the ambient labels alongside
  the floor's reason code.
- **Baseline allow/route/escalate/require-review/require-tests** — the final
  result + journal append carry the labels when an ambient candidate exists.

### 8.3 First-match precedence

`_classifyAmbientTouch(input)` iterates the same candidate set as
`_evalAmbientFloor` — `targetPath` first, then IR write/delete fileTargets,
then envelope.targets — and returns the FIRST candidate whose classifier
output is non-`nonAmbient`. The function does NOT replicate F16's project-local
exception or opt-in matching; that policy logic stays where it belongs (the
floor predicate), and the enrichment helper is a pure read.

### 8.4 Idempotency vs F16

On an F16 fire, the floor's call to `buildEarlyBlock` passes
`extra.ambientClass` + `extra.ambientPath` explicitly (PR-B behavior); PR-C's
fallback in `buildEarlyBlock` prefers those explicit fields over
`extra.ambientTouch.{class,path}`, so the F16-fire receipt path is
byte-identical to PR-B. The helper is idempotent — no double write.

### 8.5 Behavior invariant

PR-C is **receipt-only**. Every decision continues to produce the same
`action` and `floorFired` it produced before. The fixture sweep
(`tests/fixtures/**/*.input`) was re-run with zero allow/block divergences;
F16's PR-B behavior is unchanged (verified by `scripts/check-floor-f16.sh`).

### 8.6 Local gates added by PR-C

- `tests/runtime/ambient-receipt-enrichment.test.js` — 6 node:assert cases
  covering the new enrichment branches (allow-inside-projectRoot, allow via
  opt-in, F16-fire idempotency, non-ambient, nonAmbient-only candidate,
  IR-fileTargets ambient candidate).
- `runtime/decision-journal.js` — pass-through accepts the two new fields
  (engine computes; journal never derives).

## 9. PR-D contract (SHIPPED)

PR-D closes out the ADR-009 sequence by adding an F16 adversarial corpus + a
replay-stability pin. **No runtime behavior change** — engine, classifier,
schema, floor predicate, and decision-journal bytes are unchanged. PR-D is
fixture/replay/test only.

### 9.1 Corpus shape

A single JSONL — `tests/fixtures/replay-corpus/f16-adversarial.jsonl` —
generated by `tests/fixtures/replay-corpus/build-f16-adversarial.js`. The
JSONL mirrors the existing `adversarial.jsonl` line shape, with two
PR-D extensions:

```jsonc
{
  "tag":      "f16:fold:ssh-fileuri-id-rsa",
  "intent":   "<human-readable purpose; replay gate ignores>",
  "input":    { "tool": "Write", "harness": "claude", "branch": "feature/test",
                "projectRoot": "/tmp/horus-f16-adversarial-projectroot",
                "targetPath": "file:///home/user/.ssh/id_rsa",
                "file_path":  "file:///home/user/.ssh/id_rsa" },
  "expected": { "action":         "block",
                "decisionSource": "ambient-authority-denied",
                "floorFired":     "ambient-authority",
                "irHash":         "sha256:…",
                "ambientClass":   "ssh",
                "ambientPath":    "file:///home/user/.ssh/id_rsa" },
  "_knownBypass": { "id": "ARG-PRE-D-001", "followUp": "PR-E: …" } // optional
}
```

- `intent` and `_knownBypass` are corpus-side metadata. `scripts/replay-decisions.js`
  reads only `tag`, `input`, and `expected.{action,decisionSource,floorFired,irHash}` —
  the extra fields pass through untouched (no schema change to the replay gate).
- `expected.ambientClass` / `expected.ambientPath` are present iff the
  current engine emits them on the receipt. Absent in JSONL ⇒ MUST be
  absent on the receipt; the unit test enforces this as the homoglyph /
  nonAmbient invariant.
- The generator pins a synthetic projectRoot string
  (`/tmp/horus-f16-adversarial-projectroot`) so projectRoot-escape cases
  have a stable string anchor for `_isInsideProject`'s prefix compare. The
  path does not need to exist on disk — `context-discovery.safeGit` and
  `findConfig` both gracefully no-op when the directory is missing,
  keeping the generator hermetic across hosts.

### 9.2 Coverage classes

The 28 cases break down into five adversarial categories:

| # | category | cases | invariant locked |
|---|---|---|---|
| 1 | path-folding evasion (backslash, `file://`, mixed-slash, double-slash, Windows drive, UNC) | 9 fold + 1 defer pin | F16 fires after `_normAmbientPath` fold on every shape with an unambiguous absolute anchor; PR-B v2 shape-defer kicks in for bare-backslash relative-shape paths |
| 2 | NFKD / confusable homoglyphs (Cyrillic dze, fullwidth dot, Latin script g, ligature fi) | 4 | classifier is shape-only ASCII; lookalikes route to `nonAmbient`; receipt omits `ambientClass` / `ambientPath` |
| 3 | projectRoot escape via `..` segments and URL-encoded slashes | 3 fires + 4 `_knownBypass` pins | ssh / credentialHelper / mcpConfig still fire (no project-local exception); gitConfig / ideSettings escape via `..`/`%2e%2e` currently slip through (see 9.4) |
| 4 | IR-fileTargets adversarial shapes (empty string, non-string numeric, very long path) | 3 | `_collectAmbientCandidatePaths` filters non-string / empty without crashing; long paths still classify by ASCII suffix |
| 5 | multi-candidate ordering (targetPath ↔ IR.fileTargets ↔ envelope.targets) | 3 | first-match per §8.3 — receipt's `ambientClass`/`ambientPath` reflect the first non-`nonAmbient` candidate |

### 9.3 Replay-gate wiring

`scripts/check-replay-corpus.sh` already auto-discovers every `*.jsonl` in
`tests/fixtures/replay-corpus/`; dropping `f16-adversarial.jsonl` into that
directory is sufficient for the replay-gate to pick it up. No edits to
`scripts/replay-decisions.js` were needed: the JSONL's extra `intent` /
`_knownBypass` / `expected.ambientClass` / `expected.ambientPath` fields are
ignored by the replay comparator (only `action`, `decisionSource`,
`floorFired`, `irHash` are diffed), and `expected.{decisionSource,floorFired,irHash}`
fields are skipped from the diff only when explicitly null — every PR-D
case records them so the diff is strict.

### 9.4 Behavior invariant + known pre-D bypasses

PR-D adds **no engine LOC**. Every case's `expected.action` /
`expected.floorFired` reflects the engine's CURRENT behavior at the
PR-C merge commit. Four cases tagged `f16:bypass:…` lock in *current*
behavior even though it diverges from the security-ideal (F16 should
fire). They carry an `_knownBypass` block naming the gap + the follow-up:

| `_knownBypass.id` | shape | follow-up |
|---|---|---|
| `ARG-PRE-D-001` | `<projectRoot>/../.gitconfig` or `<projectRoot>/../.vscode/settings.json` — string-prefix `_isInsideProject` matches via prefix while `..` escapes the project boundary; `gitConfig` + `ideSettings` are project-local-exception classes, so F16 skips. | Resolve `..` (e.g. `path.normalize`) on both sides of `_isInsideProject` before the prefix compare, in a dedicated future PR. Limited to the two PROJECT_LOCAL classes — ssh / credentialHelper / mcpConfig / shellRc still fire. |
| `ARG-PRE-D-002` | `<projectRoot>/%2e%2e/.gitconfig` — engine does not URL-decode; the literal still string-prefix-matches `<projectRoot>/` and gitConfig's project-local-exception applies. | URL-decode (or reject) `%2e` / `%2f` in `_normAmbientPath` before classification + membership compare. |

These bypasses are *recorded* by PR-D so a future engine-side fix (PR-E)
flips them deliberately and traceably: replay would drift, the PR-E
author regenerates `f16-adversarial.jsonl`, and the diff in this ADR
demonstrates the security improvement. Until PR-E lands, the bypasses are
mitigated in practice by adapter-side `path.resolve(cwd, …)` normalization
(real adapter invocations never reach the engine with raw `..` segments)
— the corpus is the canonical regression pin for the gap, not a
production-exploitable attack path.

### 9.5 Local gates added by PR-D

- `tests/fixtures/replay-corpus/build-f16-adversarial.js` — zero-dep
  generator; deterministic output (`md5sum` byte-identical on second run).
- `tests/fixtures/replay-corpus/f16-adversarial.jsonl` — 28 cases
  (>=20 required by the PR-D scope).
- `tests/runtime/ambient-adversarial-replay.test.js` — 33 node:assert
  cases: 28 JSONL-driven receipt-pin replays + 5 inline contract-aware
  `scopes.ambient.allow[]` opt-in abuse cases (class-only / off-by-one
  prefix / trailing-slash variance / cross-class bleed / segment-alignment).
- `scripts/check-replay-corpus.sh` — already auto-discovers; the new
  JSONL is picked up without script edits.

No change to fixture / agent / rule / skill / hook / script counts —
`scripts/check-counts.sh` thresholds untouched. The new generator + test
files live under `tests/fixtures/` and `tests/runtime/` respectively, both
of which the counts gate scopes out (`.input` fixtures + top-level
`scripts/*.sh|*.js` only).

### 9.6 PR-E closure — ARG-PRE-D-001 + ARG-PRE-D-002 fixed

PR-E closes both PR-D bypasses with a surgical change inside
`runtime/decision-engine.js` `_normAmbientPath`:

- **ARG-PRE-D-001 (`..` traversal):** the helper now collapses `.` and `..`
  segments via a pure-string POSIX-style walk (no `path.resolve`, so the
  `_f16Abs` shape detector and zero-dep contract are preserved).
  `<projectRoot>/../.gitconfig` normalizes to `/.gitconfig` before the
  `_isInsideProject` prefix-compare; the `gitConfig` / `ideSettings`
  project-local exception no longer applies and F16 fires.
- **ARG-PRE-D-002 (`%2e` / `%2f` URL-encoded traversal):** the helper now
  decodes `%2e` and `%2f` (case-insensitive) to `.` and `/` BEFORE the
  segment walk. Decoding is intentionally narrow — `decodeURIComponent`
  throws on malformed input and would expand the surface beyond what the
  membership check needs.

The four `_knownBypass`-tagged corpus entries flip from
`expected.action: "allow"` to `"block"` with
`expected.floorFired: "ambient-authority"`; `_knownBypass` is removed.
The receipt's `ambientPath` continues to record the literal raw input
(audit fidelity); the normalized form is used internally for membership
only. `f16-adversarial.jsonl` is regenerated byte-stably and
`scripts/check-replay-corpus.sh` re-validates with no drift.

Unit-level pins live in `tests/runtime/ambient-traversal-normalization.test.js`
(string-level helper extraction + end-to-end via `decide()`).
