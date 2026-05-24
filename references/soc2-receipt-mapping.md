# SOC2 receipt mapping (informal)

**Status:** ADR-014 companion document. **NOT a SOC2 attestation.**

This document maps each field in `schemas/receipt.v1.json` to a SOC2 Trust
Service Criteria (TSC) control category so an external auditor doing a
pre-read can see which control each receipt field supports. It is
**informal** — Lilara does not claim to be SOC2-certified, and this mapping
does not replace the formal audit. It exists so an auditor walking the
runtime log for the first time has a one-page legend.

Anchored to the 2017 TSC framework (SOC2 Type 2 typical attest scope).
Categories used here:

| Code | TSC criterion |
|------|--------------------------------------------------------|
| CC-6.1 | Logical and physical access controls |
| CC-6.6 | Logical access — credentials |
| CC-6.7 | Boundary protection / data exfiltration |
| CC-7.2 | System monitoring (detection of anomalies) |
| CC-7.3 | Incident response / change management |
| CC-8.1 | Change management — pre-change approval |
| A-1.2 | Availability — environmental protections |

## Field-by-field mapping

| Receipt field | Source code path | SOC2 expectation it supports |
|---------------|------------------|------------------------------|
| `ts` | `runtime/decision-journal.js append()` | CC-7.2 — timestamped event for monitoring |
| `kind` | `runtime/decision-journal.js append()` | CC-7.2 — event taxonomy |
| `action` | `runtime/decision-engine.js decide()` | CC-7.2, CC-7.3 — final disposition (allow / block / require-review) |
| `riskLevel` | `runtime/risk-score.js score()` | CC-7.2 — risk band attached to decision |
| `riskScore` | `runtime/risk-score.js score()` | CC-7.2 — numeric risk for trend analysis |
| `reasonCodes` | `runtime/decision-engine.js` (floor labels + contract tags) | CC-7.2, CC-7.3 — machine-readable rationale; supports incident triage |
| `tool` | adapter input | CC-6.1 — actor channel identification |
| `branch` | adapter input | CC-8.1 — change-management context (protected-branch coupling) |
| `targetPath` | adapter input (redactable) | CC-6.1, CC-6.7 — what resource the action touched |
| `notes` | engine assembly (redactable) | CC-7.2 — human-readable explanation |
| `redactInJournal` | `runtime/contract.js` `scopes.secrets.redactInJournal` | CC-6.6 — secrets redaction posture at the time of write |
| `contractId` | `runtime/contract.js load()` | CC-8.1 — which policy contract was in force |
| `contractRevision` | `runtime/contract.js load()` | CC-8.1 — which revision of the contract was in force |
| `scopeHit` | `runtime/contract.js scopeMatch()` | CC-6.1 — which contract scope authorised the action |
| `floorFired` | `runtime/decision-lattice.js` | CC-7.2 — which guard fired (F1..F20) |
| `taintSource`, `taintReason` | `runtime/taint.js` | CC-6.7 — external-influence attribution (prompt-injection chain) |
| `intent` | `runtime/intent-classifier.js` | CC-7.2 — classified command intent for monitoring |
| `ambientClass`, `ambientPath` | `runtime/ambient.js` | CC-6.1, CC-6.7 — ambient-authority touch (SSH key, git config, …) |
| `irHash` | `runtime/action-ir.js build()` | CC-7.2 — canonical Action IR fingerprint; ties receipt to a verifiable IR |
| `latticeVersion` | `runtime/decision-lattice.js` | CC-7.3 — guards-version snapshot for replay |
| `rung` | `runtime/decision-lattice.js getRungByName()` | CC-7.2 — precedence rank of the firing floor |
| `degradedMode` | `runtime/degraded-mode.js` (ADR-004 PR 37B) | A-1.2, CC-7.3 — degraded-mode marker; auditor can distinguish degraded receipts |
| `f19Detail.outputChannel` | `runtime/output-exfil.js` (ADR-010) | CC-6.7 — which output channel triggered the F19 floor |
| `f19Detail.matchClasses` | `runtime/output-exfil.js` | CC-6.6, CC-6.7 — secret class(es) detected |
| `f19Detail.redactedSample` | `runtime/output-exfil.js` | CC-6.7 — sanitised evidence of the leak attempt |
| `f19Detail.compensatingRestrictionApplied` | `runtime/output-exfil.js` | CC-6.7 — record of compensating control on not-observed channels |
| `changeIntent.declared` | `runtime/envelope.js loadDeclaredEnvelope()` | CC-8.1 — whether the run had a declared-intent envelope |
| `changeIntent.drift` | `runtime/change-intent.js` (ADR-012) | CC-8.1 — declared-envelope vs actual drift signal |
| `changeIntent.classes` | `runtime/change-intent.js` | CC-8.1 — drift class taxonomy |
| `changeIntent.redactedDetails` | `runtime/change-intent.js` | CC-8.1, CC-7.3 — first 5 drift values (≤64 chars each) for incident review |
| `changeIntent.severity` | `runtime/change-intent.js` | CC-8.1 — severity band for routing |
| `snapshot.attempted` | `runtime/snapshot.js` (ADR-013) | A-1.2 — undo-bundle attempt was logged |
| `snapshot.status` | `runtime/snapshot.js` | A-1.2 — bundle creation outcome (created / truncated / failed-fail-open) |
| `snapshot.snapshotId` | `runtime/snapshot.js` | A-1.2, CC-7.3 — restore reference |
| `snapshot.paths`, `snapshot.bytes` | `runtime/snapshot.js` | A-1.2 — bundle size |
| `snapshot.reason` | `runtime/snapshot.js` | A-1.2 — when status != "created", why |

## Chain-level controls (not single-field)

| Control | Mechanism | TSC |
|---------|-----------|-----|
| Tamper evidence | ADR-004 hash chain (`runtime/journal-chain.js verify()`); checkpoint HMAC bound to install key | CC-7.2, CC-7.3 |
| Degraded-mode propagation | ADR-004 PR 37B; suppresses operator-token demotions until chain is restored | A-1.2, CC-7.3 |
| Cross-host portability | ADR-011 state bundle (`runtime/state-bundle.js`) | CC-7.3 |
| Auditor redaction | `runtime/receipt-export.js` `redact: true` — proof-of-existence tokens with sha256 prefix | CC-6.6, CC-6.7 |
| Schema enforceability | `scripts/generate-receipt-schema.sh` exhaustiveness gate; `LILARA_VALIDATE_RECEIPTS=1` dev-mode validator | CC-7.2 |

## What this mapping does NOT do

- It does **not** certify Lilara against any TSC. Certification requires an
  accredited SOC2 audit firm; that is M9+ work (commercial layer).
- It does **not** cover infrastructure controls (where the journal lives,
  how the install key is stored, hardware boundary). Those are operator
  responsibilities anchored to the deployment environment.
- It does **not** map non-engine logs (operator-token mints, contract
  amendments, hook event log, adapter logs). Those live in their own ADRs.

For the version policy and threat model of this document, see
`references/adr-014-audit-grade-receipts.md`.
