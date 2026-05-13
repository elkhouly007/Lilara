# ADR-009 — Ambient-Authority Path Classifier (F16 PR-A foundation)

**Status:** ACCEPTED — Khouly 2026-05-13 (foundation only; no behavior change).
**PR-A status:** SHIPPED (classifier + tests only).
**Authors:** Khouly (scope), Claude Code (implementation).
**Repo cross-refs:** `runtime/ambient.js`, `runtime/index.js`, `tests/runtime/ambient.test.js`.

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
