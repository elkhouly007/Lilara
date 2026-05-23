# ADR-010 — Output-Channel Exfiltration Guard (F19)

**Status:** ACCEPTED — Khouly 2026-05-14.
**PR-α status:** SHIPPED (classifier + lattice entry + engine wiring + IR
`outputs[]` / `declaredOutput[]` + manifest extension + tests + this doc).
**Authors:** Khouly (scope), Claude Code (implementation).
**Repo cross-refs:** `runtime/output-exfil.js`, `runtime/decision-engine.js`,
`runtime/decision-lattice.js`, `runtime/action-ir.js`,
`runtime/post-adapter-factory.js`, `scripts/check-adapter-manifests.sh`,
`tests/runtime/output-exfil.test.js`,
`tests/fixtures/lattice-receipts/F19-output-channel-exfiltration.input`,
`claude/manifest.json` (and the five sibling adapter manifests).

---

## 1. Why this exists

Locked product scope §5.1 calls out
**output-channel exfiltration** as a v1 concern:

> Output-channel exfiltration guard for observable channels (tool output,
> generated files, commit/PR text, final-message interception where adapter
> supports it); unsupported channels must be disclosed by manifest and
> compensated by stricter rules.

A coding agent can today leak secrets through six commonly-reachable
channels — `stdout`, `stderr`, generated files, commit messages, PR text,
and the assistant's final message. Each channel has a different
interception story per adapter: Claude Code intercepts stdout/stderr but
only observes the final message; Codex / Clawcode / antegravity haven't
verified any of those surfaces.

Existing floors do not cover this:
* **F4 (secret-class-C)** scans the **command** for credentials, not the
  channel content.
* **F10 (taint-floor)** flags external content read **into** the agent,
  not content emitted **out**.
* **F16 (ambient-authority)** blocks writes into ambient-authority paths,
  not channel-typed outputs.
* **F18 (network-egress)** controls outbound network targets, not the
  bytes flowing through an allowed channel.

F19 closes that gap by classifying channel content against a small
engine-baked corpus and routing the action at lattice rung 17.875
(immediately after F17 cross-agent-lock, immediately before the
contract-allow demotion rung).

## 2. In-scope channels

The F19 IR namespace uses six canonical channel names. Adapter manifests
MUST declare an observability state for each:

| Channel        | Source                                            |
| -------------- | ------------------------------------------------- |
| `stdout`       | Tool stdout captured by post-adapter              |
| `stderr`       | Tool stderr captured by post-adapter              |
| `generatedFile`| File written via `Write` / `Edit` tools           |
| `commitMessage`| `git commit -m …` body                            |
| `prText`       | `gh pr create --body …` body                      |
| `finalMessage` | Assistant's final-message text where intercepted  |

These intentionally differ from the **G4 capability-manifest**
`outputChannels` field (`toolOutput`/`generatedFiles`/…), which records
adapter **interception capability** (`intercept`/`observe`/`none`). G4 is
preserved verbatim (scope §4.1 hard stop: existing fields untouched). The
F19 sibling map sits next to it, with its own vocabulary
(`observed` / `limited` / `not-observed`), so the two layers stay
decoupled and both stay valid.

## 3. Manifest schema (additive)

Every adapter manifest now carries two new sibling fields. Both are
**additive only**; existing G4 fields are unchanged.

```json
{
  "outputChannelObservability": {
    "stdout":         "observed" | "limited" | "not-observed",
    "stderr":         "observed" | "limited" | "not-observed",
    "generatedFile":  "observed" | "limited" | "not-observed",
    "commitMessage":  "observed" | "limited" | "not-observed",
    "prText":         "observed" | "limited" | "not-observed",
    "finalMessage":   "observed" | "limited" | "not-observed"
  },
  "outputChannelCompensations": {
    "<channel>": "compensating-restriction prose, ≥1 char"
  }
}
```

Semantics:

* `observed`     — adapter delivers channel content to the engine; F19
                   classifies the actual bytes.
* `limited`      — adapter observes the channel post-hoc but cannot
                   intercept in-line; F19 still classifies whatever the
                   adapter forwarded.
* `not-observed` — adapter cannot prove the content reaches the engine.
                   F19 applies the **compensating stricter rule** for any
                   write-to-channel call on that channel.

`outputChannelCompensations` is the per-channel compensation registry. A
channel declared `not-observed` MUST either appear here with a non-empty
string OR be mentioned by a `compensatingRestrictions` entry; otherwise
the manifest gate (`scripts/check-adapter-manifests.sh`) fails CI.

## 4. Canonical Action IR extension (additive)

`runtime/action-ir.js` gains two array fields:

* `outputs[]`         — PostToolUse observed outputs. Each record:
                        `{ channel, content, sizeBytes, truncated, observedBy }`.
* `declaredOutput[]`  — PreToolUse declared outputs. Same record shape.

Both default to `[]`. Floors that pre-date F19 ignore them; F19 reads
them. `_normalizeOutputRecords()` enforces a fixed key order on each
record so canonical-JSON hashing stays byte-stable across machines.

Adapters or callers populate the IR with observability and compensation
via two additional optional top-level input fields the engine reads:

* `outputChannelObservability` — same shape as the manifest map.
* `outputChannelCompensations` — same shape as the manifest map.

The engine performs no manifest disk I/O. Adapters propagate manifest
data into the call payload (or the canonical IR); tests provide it
directly.

## 5. Severity model

`runtime/output-exfil.js` exposes `classifyOutput(content, opts) →
{ matches[], severity, redactedSample }` and the engine-facing
convenience `classifyOutputs(outputs[])`. Patterns:

| Class                | Pattern                                       | Severity     |
| -------------------- | --------------------------------------------- | ------------ |
| `ssh-private-key`    | `-----BEGIN [A-Z ]*PRIVATE KEY-----`          | `confirmed`  |
| `aws-access-key-id`  | `\bAKIA[A-Z0-9]{16}\b`                        | `confirmed`  |
| `aws-secret-access-key` | `AWS_SECRET_ACCESS_KEY\s*[=:]\s*['"]?…`   | `confirmed`  |
| `github-pat`         | `\bgh[pousr]_[A-Za-z0-9_]{20,}\b`             | `confirmed`  |
| `openai-api-key`     | `\bsk-[A-Za-z0-9_-]{20,}\b`                   | `confirmed`  |
| `slack-token`        | `\bxox[baprs]-[A-Za-z0-9-]{20,}\b`            | `confirmed`  |
| `high-entropy-hex`   | `\b[a-fA-F0-9]{32,}\b`                        | `suspicious` |

`secret-scan.js` regexes are **not duplicated**. `classifyOutput()` runs
the F19 local corpus AND pipes `redactedSample` through
`secret-scan.redact()` so anything in `claude/hooks/secret-patterns.json`
gets scrubbed even when F19's local list does not match.

The `redactedSample` is ≤32 chars after whitespace collapse and never
contains raw secret bytes.

## 6. Decision-engine wiring

F19 sits at **rung 17.875** — strictly between F17 (17.75) and the
contract-allow demotion rung (18). The engine evaluates F19 once per
`decide()` call. Outcome rules:

| Path                                      | Result                                              |
| ----------------------------------------- | --------------------------------------------------- |
| PostToolUse `outputs[].content` matches a `confirmed` pattern | `buildEarlyBlock(…)` → block (non-demotable) |
| PostToolUse matches `suspicious` only     | `action=require-review`, `floorFired=output-channel-exfiltration`, `source=output-exfil-denied` |
| PreToolUse `declaredOutput[]` matches `confirmed` | `buildEarlyBlock(…)` → block (non-demotable) |
| PreToolUse `declaredOutput[]` matches `suspicious` only | `require-review`; demotable to `allow` only via operator token (scope `output-exfil-review-demote`) |
| PreToolUse on `not-observed` channel + no content match | Compensating stricter rule: `require-review`. Demotable only when `outputChannelCompensations[<channel>]` is non-empty AND a valid operator token is presented. |

Non-demotability:

* `confirmed` matches are **non-demotable** — neither `learned-allow`,
  `contract-allow`, `auto-allow-once`, nor `trajectory-nudge` can reach
  them. The early-block path returns before those checks run, and the
  lattice entry's `demotableBy` only lists
  `operator-token-suspicious-only`.
* `suspicious` matches are **demotable only by a one-shot scoped operator
  token** (`LILARA_F19_DEMOTE_TOKEN`, scope `output-exfil-review-demote`).
  The engine routes the demotion through `canDemote(F19.id,
  operator-token-suspicious-only)` + `consumeScopedOperatorToken()` so
  drift cannot bypass the lattice.

Floors at lower rung — F3 (critical-risk), F4 (secret-class-C in command),
F8 (protected-branch), F10 (taint), F14b (session-over-duration) — still
win when they fire alongside F19, matching their lattice rung priority.

## 7. Receipt + journal enrichment

Every F19 fire emits the following on the decision result and journal
entry:

```json
{
  "floorFired": "output-channel-exfiltration",
  "decisionSource": "output-exfil-denied" | "f19-demoted",
  "outputChannel": "<channel>",
  "matchClasses": ["ssh-private-key", …],
  "redactedSample": "…≤32 chars, masked…",
  "compensatingRestrictionApplied": true | false
}
```

The journal entry also carries `f19Detail` (full receipt object) so
downstream auditors can reconstruct the decision without re-running the
engine. ADR-004 hash-chained the journal in PR 37A; F19 entries chain
identically.

## 8. Two known confirmed bypass classes (left for the follow-up PR)

PR-α intentionally ships without an adversarial corpus. The two bypass
classes currently in scope for a future PR-β (mirroring the F16 PR-D
pattern):

1. **Encoded-secret in output** — base64- or hex-wrapped credentials in
   `stdout` evade the F19 regex corpus while still decoding cleanly on
   the receiver side. PR-α does not normalize before classifying.
2. **Multi-line PEM wrapped in JSON escape sequences** — a JSON string
   with `\\n` linebreaks around the `-----BEGIN … PRIVATE KEY-----`
   header doesn't match the literal `-----BEGIN` pattern (linebreaks /
   escape interpretation differ across renderers).

Both are explicitly out of PR-α scope (§ "Non-goals / defer" in the PR
brief) and are tracked for follow-up.

## 9. What this PR does NOT change

* No floor ordering for any non-F19 floor.
* No demotability path of any existing floor.
* No contract schema change (the new fields live on adapter manifests,
  not on the user-signed contract).
* No Lilara enforcement wiring into Claude Code / OpenClaw runtime — F19
  evaluates in `decide()` only; adapters propagate observability via the
  input/IR shape.
* No fixture-runner changes — only one new lattice-receipt fixture and
  one new tests/runtime/ test file.
