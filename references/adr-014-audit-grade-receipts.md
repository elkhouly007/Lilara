# ADR-014 — Audit-grade receipts (SOC2-readable from day 1)

**Status:** ACCEPTED — 2026-05-15 (v0.5 Stage D, wave 3).
**Scope refs:** `workstreams/agent-runtime-guard-scope.md` §5.1 ("Audit-grade
receipts (SOC2-readable from day 1)" + "Receipt schema readable by SOC2
audit-trail expectations") and §8 v1 success criteria ("100% of decisions
produce an exportable, SOC2-readable receipt").
**Plan ref:** `workstreams/agent-runtime-guard-plan.md` §4.1 Stage D.

## 1. Why this exists

§5.1 says every Lilara decision must produce an audit receipt that an external
SOC2 auditor can consume as-is. The runtime already journals rich content
through `runtime/decision-journal.js` (action, riskLevel, reasonCodes,
contractId, journal hash chain via ADR-004, ambient-touch, F19 output-channel
detail, F20 change-intent, F21 snapshot). What's missing for audit-grade is
*formal grounding* of that shape: a JSON Schema the runtime validates against,
an exporter that materialises it in canonical-JSON + CSV, a redaction
guarantee under test, and a SOC2-mapping document that names which control
each field supports.

ADR-014 fills the gap with a **schema-additive review + tooling layer**.
Zero floor change, zero decision change, zero new dependency. Existing
receipts continue to validate byte-identical; new fields are additive only.

## 2. Decision

**The receipt is the journal entry.** The canonical "receipt" for audit is
the record `runtime/decision-journal.js` writes to
`<LILARA_STATE_DIR>/decision-journal.jsonl`. The decide() return value carries
additional ephemeral fields (e.g. `context`, `actionPlan`) that are not
journaled because they are runtime routing aids, not audit material.

**Schema authority.** `schemas/receipt.v1.json` is hand-authored to express
the SOC2-readable expectation. It is draft-2020-12, `additionalProperties:
false` at the top level, with every field that any code path in
`runtime/decision-journal.append()` emits enumerated. `runtime/receipt-
validator.js` is a pure, zero-dep validator supporting the subset of JSON
Schema we use (`type`, `enum`, `const`, `pattern`, `format: date-time`,
`minLength`/`maxLength`, `items`, `minimum`/`maximum`, `additionalProperties:
false`, `required`).

**Exhaustiveness gate.** `scripts/generate-receipt-schema.sh` replays the
lattice-receipts fixture corpus through `decide()`, collects the union of
top-level keys actually emitted, and fails if any key is absent from the
schema. So a future change that adds a journal field but forgets the schema
is caught in CI. The schema itself is byte-stable on canonical re-serialisation.

**Dev-mode validation.** `LILARA_VALIDATE_RECEIPTS=1` makes
`decision-journal.append()` run every assembled record through
`validateReceipt()` and throw on failure. Off by default — the production
hot path remains the same `JSON.stringify + appendFileSync` pair. Tests
opt-in via the env var to assert schema/code agreement at runtime.

**Schema versioning policy.** The schema is `receipt.v1.json`. Additive
edits (new optional property, broader enum) are non-breaking and may ship
in a minor v0.5+ release. Renames, retypes, removals, or new top-level
required keys require a `receipt.v2.json` and a documented migration. The
`additionalProperties: false` posture guarantees a v1 consumer sees a clear
"unknown field" signal rather than silently passing a malformed receipt.

**Exporter.** `runtime/receipt-export.js` reads the on-disk journal,
applies an optional `{ since, until, sessionId, decisionAction, riskLevel,
kind }` filter, and emits either jsonl (canonical-JSON, alphabetical keys
per entry) or CSV (column order from `Object.keys(schema.properties)`).
Round-trip discipline: the jsonl output is its own inverse — parsing then
re-emitting yields byte-identical bytes (`roundTrip(buffer, "jsonl")`).
The manifest sha256s the canonical content so two byte-identical exports
of the same filtered slice produce the same `bundleHash`. This reuses the
state-bundle hashing pattern (ADR-011) for consistency.

**Redaction model and threat model.** Redaction operates only on the
exporter, never on the journal write-path: the on-disk receipt is the
trusted hashed record, and the chain MUST remain stable. When the export
filter sets `redact: true`, every string leaf in every entry is run through
the F19 pattern set (`ssh-private-key`, `aws-access-key-id`,
`aws-secret-access-key`, `github-pat`, `openai-api-key`, `slack-token`).
Each match is replaced with `[REDACTED:<class>:<sha256-prefix-12>]` where
the sha-prefix is the first 12 hex chars of `sha256(matched-value)`. This
**proof-of-existence** form lets an auditor confirm a value of a given
class was present at the point of journaling without recovering the
plaintext. The replacement is byte-stable: re-exporting the same source
journal under the same redaction policy produces the same token.

The threat model the redaction defeats is the *auditor-readable* path —
SOC2 review, third-party access to the export. It does NOT defeat an
attacker with read access to the raw journal file (the journal is local
state, mode 0600). For at-rest encryption of the journal see the explicit
non-goal in §4.

**Exporter format rationale.** jsonl + CSV. jsonl preserves nested objects
(`degradedMode`, `f19Detail`, `changeIntent`, `snapshot`) losslessly and
is the format auditor-side tooling already speaks; CSV is what
spreadsheet-driven workflows want and reads column-deterministic for
pivot analysis. Object-valued fields are serialised as canonical-JSON
inside the CSV cell, which keeps the column count fixed and the row
shape uniform.

**CLI surface.** `scripts/lilara-cli.sh receipts` exposes `validate`,
`export`, `schema [--print]`, and `doctor`. The doctor runs validate +
round-trip on the local journal and is the one-command "is my audit
trail healthy?" check.

## 3. Where this stops

- This is **not** a SOC2 attestation. It is an informal mapping that pre-
  reads as the auditor's checklist for Lilara's runtime logs.
  `references/soc2-receipt-mapping.md` is labelled accordingly.
- This is **not** an SIEM. The exporter is a one-shot dump; integration
  with Splunk / Elastic / Datadog is downstream tooling that consumes
  the jsonl.
- This does **not** cover non-engine logs: contract amendments, operator
  tokens, hook scripts, adapters. Those live in adjacent ADRs (ADR-004
  for the chain, ADR-007 for IR, etc.).
- This does **not** replace `tests/fixtures/lattice-receipts/*.input`
  pinning: that fixture sweep guards labelling, ADR-014 guards shape.

## 4. Non-goals (explicit out-of-scope)

- Full SOC2 attestation kit (commercial layer, M9+).
- Receipt encryption at rest (separate v0.5+ work).
- Auditor-facing web dashboard (Phase 6.2+).
- Schema migration tool (v1 is the first published schema; no v0 to
  migrate from).
- Wiring Lilara enforcement into Claude Code or OpenClaw runtimes.

## 5. Acceptance evidence

- `node tests/runtime/receipt-schema.test.js`
- `node tests/runtime/receipt-export.test.js`
- `node tests/runtime/receipt-redaction.test.js`
- `bash scripts/generate-receipt-schema.sh`
- 50-receipt end-to-end via fixture replay → export jsonl → re-import →
  byte-identical to journal entries' canonical-JSON form.

## 6. References

- ADR-004 — tamper-evident journals (the chain that this schema rides on)
- ADR-007 — Canonical Action IR (irHash + latticeVersion + rung fields)
- ADR-010 — output-channel exfiltration (f19Detail receipt key)
- ADR-011 — state portability (bundle / manifest sha256 pattern reused)
- ADR-012 — change-intent drift (changeIntent receipt key)
- ADR-013 — auto-snapshot (snapshot receipt key)
