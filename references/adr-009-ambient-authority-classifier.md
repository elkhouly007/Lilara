# ADR-009 — Ambient-Authority Path Classifier (F16)

**Status:** ACCEPTED — Khouly 2026-05-13.
**PR-A status:** SHIPPED (classifier + tests only).
**PR-B status:** SHIPPED (F16 floor wired into decision-engine + `scopes.ambient.allow[]` opt-in + fixtures + tests + this doc).
**Authors:** Khouly (scope), Claude Code (implementation).
**Repo cross-refs:** `runtime/ambient.js`, `runtime/decision-engine.js`, `runtime/decision-lattice.js`, `runtime/index.js`, `schemas/horus.contract.schema.json`, `tests/runtime/ambient.test.js`, `tests/runtime/ambient-floor.test.js`, `tests/fixtures/floor-f16/`, `tests/fixtures/lattice-receipts/F16-ambient-authority.input`.

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
- No contract schema field. `schemas/horus.contract.schema.json`
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
- `HORUS_HERMETIC_TEST=1 bash scripts/run-fixtures.sh` — unchanged
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

Additive opt-in extension to `schemas/horus.contract.schema.json`. Shape:

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
