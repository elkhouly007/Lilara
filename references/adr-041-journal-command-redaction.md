# ADR-041 — Decision-Journal Write-Boundary Redaction: `command` Field + Comprehensive Scrub

**Status:** Implemented

---

## Context

The decision journal (`runtime/decision-journal.js`) is the SOC2-grade audit trail that
persists every decision receipt to `<stateDir>/decision-journal.jsonl`.  Prior to this ADR,
the redaction policy at the journal *write boundary* was an **allow-list**: only `targetPath`
and `notes` passed through `secret-scan.redact()` (the D28 policy comment said so explicitly).

Two classes of gap remained:

1. **`command` not captured at all for audit.** The shell command supplied by the agent (e.g.
   `curl -H "Authorization: Bearer sk-abcd…" https://api.example.com`) is the field most
   likely to embed a bearer token, API key, or DB URI as a literal argument.  Not journaling it
   means the audit trail carries no record of what was actually executed — including when a
   secret-laden command fires a floor and the receipt should show *why*.

2. **Free-text user-derived fields bypassing `clean()`.** Three fields that can carry secrets
   supplied transitively through the agent's actions were passed verbatim even when the contract
   `redactInJournal` scope was active:
   - `taintReason` — free-text explanation of *why* a path was tainted (can echo back portions
     of a secret-bearing command or file content).
   - `ambientPath` — file path where an ambient-authority write was detected (could expose
     sensitive path segments containing credential material).
   - `scopeHit` — contract scope label (can contain path globs or free-text embedded by an
     operator that includes credential substrings in pathological configs).

Neither gap affected `decide()` purity, the decision result, or `irHash`. The `irHash` is
computed from `input.ir.command` in `action-ir.js` (`_computeIrHash`) before `decide()` is
called; the journal write happens after `decide()` returns and is entirely one-way (nothing in
`append()` feeds back into the decision). The gaps were pure **data-at-rest** leaks in the
audit journal.

This is classified **ASI04 PARTIAL** — a runner-up finding from the #147 trust-boundary audit.

---

## Decision

### Option A (chosen): extend the write-boundary redaction + opt-in `command` capture

Extend `clean()` coverage in `append()` to `taintReason`, `ambientPath`, and `scopeHit`.
Add an opt-in `command` field gated on `LILARA_JOURNAL_COMMAND=1` (off by default for
byte-identical existing journals; mirroring the `LILARA_IR_JOURNAL` precedent).

**Invariants preserved:**
- `decide()` remains pure. `append()` takes the entry object by-value and never writes back.
- `irHash`, `action`, `decisionSource`, `floorFired` in the entry are passed verbatim to the
  `record` — `clean()` is never applied to them.
- `LILARA_JOURNAL_COMMAND` off (default) → no `command` key in the record → journals
  byte-identical → replay corpus zero-divergence.
- `clean()` is identity (`(t) => String(t || "")`) when `shouldRedact` is false — so routing
  `taintReason`/`ambientPath`/`scopeHit` through `clean()` is byte-identical on all non-redact
  paths (production default, replay, and any path without an active `redactInJournal` contract
  scope).

### Option B (rejected): always capture `command` unconditionally

Would change the JSON shape of every receipt even without a contract scope, breaking the
"additive-only, never rename" schema guarantee and causing replay corpus divergence. Rejected.

### Option C (rejected): redact at IR build time (`action-ir.js`)

Would alter `irHash` (the hash is computed over the IR including `command`). Hard-rejected —
this breaks the replay-determinism guarantee.

---

## Implementation

**`runtime/decision-journal.js`**
- Updated `clean()` application: `scopeHit`, `taintReason`, `ambientPath` now pass through
  `clean()` instead of being String-coerced verbatim.
- Added the `command` field block (guarded by `LILARA_JOURNAL_COMMAND === "1"`).
- Updated the D28 comment to reflect the new policy.

**`runtime/decision-engine.js`**
- The main `append({…})` call now passes `command: input.command || ""` so the field is
  available to `append()` for conditional journaling.

**`schemas/receipt.v1.json`**
- Added optional `command` property (`type: string, maxLength: 256`) with a description noting
  the ADR-041 redaction guarantee.  Optional ⇒ existing receipts continue to validate.

**`tests/runtime/journal-command-redaction.test.js`** (8 tests)
- (a) Secret in `command` → redacted to `[REDACTED:…]`; raw secret absent.
- (b) Secrets in `taintReason`, `ambientPath`, `scopeHit` → each redacted independently.
- (c) `action`, `floorFired`, `irHash` byte-identical across all four `redact×flag` combos.
- (d) No false redaction when `entry.redact = false` (identity path).
- (e) `command` key absent from journal when flag unset or `=0`.

Wired into `scripts/check-runtime-core.sh`.

---

## Scope Limits

- Redaction uses `secret-scan.redact()` which is regex-based (27 named patterns +
  5 fallbacks). It does **not** cover secrets that do not match a known pattern — e.g.
  a bespoke internal token with a non-standard prefix. This is the same coverage bound
  as the pre-existing `targetPath`/`notes` redaction and the export-path redactor.
- `taintSource` (a structural source-identifier label, not a user-derived value) is
  intentionally NOT redacted — it carries only engine-computed tags like `"session-context"`.
- The `command` field is present in the receipt only when `LILARA_JOURNAL_COMMAND=1`.
  Enabling this flag in production is recommended for environments with secrets-redaction
  contracts (`contract.scopes.secrets.redactInJournal = true`).

---

## Related

- ADR-014 (audit-grade receipts, `receipt-validator`, export-path redactor)
- ADR-007 PR-B (`LILARA_IR_JOURNAL` precedent for opt-in IR fields)
- Trust-boundary audit finding ASI04 (#147 runner-up)
