# ADR-053 — Bulk structured-PII egress floor (emails / phones / national-residence IDs / cards / IBANs)

**Status:** Proposed (owner decision 6, 2026-06-13 — R3 intent re-verification, SCOPE §25)
**Date:** 2026-06-13
**Scope:** a new deterministic egress floor, near-term. Records the decision + design constraints; **no implementation
in this ADR** (scheduled in PLAN Phase 3.5, reusing the F27/F28 egress mechanism). Commits to *not* weakening
`decide()` purity, byte-identical replay, or the inviolable tier.

---

## Context

The §19 #4 reconciliation (ADR-051) stated the content-blind guard's deterministic egress guarantee precisely: the
**credential/secret subset** (F27/F28). It originally routed *all* remaining third-party personal data to enforcement
point (b) (the content layer). On re-verification the owner **split that remainder** (decision 6): bulk **structured**
PII is mechanically detectable at the tool boundary by shape (it does not need content understanding), so it should get
a **deterministic floor** rather than waiting on the unbuilt content layer. Only **unstructured / contextual** PII (a
name in free prose) stays at point (b).

## Decision

Add a **bulk structured-PII egress floor**: when **structured** personal data — emails, phone numbers,
national/residence ID numbers, credit-card numbers, IBANs — crosses to an external host **above a threshold**, the floor
fires. It **reuses the F27/F28 egress mechanism** (same boundary, same evaluation shape; it keys on structured-PII
*shape + volume → external host*, not on whose data it is — the guard stays content-blind to ownership).

- **Threshold-based, bulk.** A single email address in a legitimate message is not the target; *bulk* structured PII
  leaving to an external host is. The threshold is a calibrated parameter (Phase-3.5 / Phase-1 calibration).
- **Defense-in-depth under default-deny.** Under the ADR-052 default-deny egress model, the **destination gate is
  primary**; this floor is **defense-in-depth** (it catches a bulk-PII payload heading even to an approved destination,
  or a destination not yet gated).
- **Tier / demotion:** to be fixed in the implementing ADR. Likely demotable-by-consent like F28 (a user may
  legitimately export his own contact list to an approved destination), graduating behind its own FP budget per
  ADR-049 bucket (c). It is **not** in the on-at-install definitional tier (decision 12 / ADR-049 amendment).

## Implementation constraints (binding on the Phase-3.5 build)

- **Additive only.** New floor → additive replay-corpus entries (never mutations); inviolable-tier unreachability tests
  extended if it introduces any new source class; bench gate green (hot-path cost); posture injected as input
  (ADR-046 / §19 #14), never ambient state.
- **Content-blind to ownership.** The floor keys on structured-PII **shape + volume → external host**, never on a
  judgment about *whose* PII it is — consistent with SCOPE §4/§21 (no ownership signal at the boundary).
- **Neutral language.** Behavioral floor name + universal-harm framing only.
- **Anti-nag (P1/P2).** Calibrate the threshold so legitimate single-record operations never trip it; fix the
  threshold, never the tier, if it fires on legitimate work.

## Consequences

- SCOPE §1 HX block, §4 honest-scope, §20 G1/G4, §21 non-goal #3 are updated (done in the R3 SCOPE diff): the
  deterministic egress guarantee is now *credential/secret subset (F27/F28) + bulk structured-PII floor*; only
  unstructured/contextual PII routes to point (b).
- Closes part of the long-standing victim-aware-enforcement gap (G1) deterministically, without a content-judgment
  classifier.

## Non-goals / open design questions

- Exact PII shapes, detector implementation, and the threshold value — fixed in the implementing ADR/PR.
- Tier + demotion path — fixed in the implementing ADR (default expectation: demotable-by-consent, ADR-049 bucket (c)).
- Status stays **Proposed** until the Phase 3.5 design is accepted by the owner.
