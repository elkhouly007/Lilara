# ADR-052 — Default-deny egress allowlist + approved-destinations contract + network-level backstop

**Status:** Proposed (owner decision 14, 2026-06-13 — R3 intent re-verification, SCOPE §25)
**Date:** 2026-06-13
**Scope:** architecture direction for the egress model. Records the decision and the design constraints; **no
implementation in this ADR** (scheduled in PLAN Phase 3.5). Touches `decide()`/lattice/replay only later and only
additively — this ADR commits to *not* weakening `decide()` purity or byte-identical replay.

---

## Context

Lilara's prior egress model was a **denylist**: enumerate the known external-egress sinks (F27/F28 credential egress,
F18 network-egress, F19 output-channel) and stop those. SCOPE §21 carried this as an explicit non-goal — *"egress
channel coverage is enumerated, not universal"* — because a denylist is permanently behind: a novel transport (`scp`,
`rsync`, an arbitrary user binary, a side channel) is a blind spot until it is added.

The owner's core thesis (decision 13, SCOPE §0/§13) makes the user's #1 fear concrete: **data exfiltrated without him
knowing.** A denylist cannot deliver "data leaves only to destinations you approved" — it can only chase known leaks.
The content-blind guard (SCOPE §5) cannot inspect *what* is leaving, which under a denylist reads as a weakness.

## Decision

Flip the egress model from **denylist** to **DEFAULT-DENY ALLOWLIST**, gating on **where data goes, not what is inside**:

1. **Approved-destinations contract.** Outbound to an external destination is **denied by default.** The user approves
   a destination list once (SCOPE §8/§11 consent model). An approved destination inside the contract runs **freely**
   (anti-nag, P1/P2); a non-approved destination **stops-and-asks or blocks**. A **weekly reminder re-confirms** the
   approved-destination list (decision 13's ritual).
2. **Content-blindness stops being a weakness.** Because the gate is on the destination, not the payload meaning, the
   structured-PII / credential floors (ADR-053, F27/F28) become **defense-in-depth** behind the destination gate, not
   the primary control. SCOPE §21 non-goal #2 (enumerated egress) is **deleted**; non-goals #1/#3/#4/#5 are promoted to
   `[LOCKED]`.
3. **Network-level backstop.** Back the action-layer destination gate with a **network-level egress control**
   (host firewall / egress proxy) so that a novel transport OR a successful prompt-injection still cannot reach a
   non-approved destination even if the action-layer gate is bypassed.
4. **Taint-tracking protects the contract.** An injected agent structurally cannot reach a non-approved destination —
   taint (F10/F23) + the destination allowlist together cap *where* tainted data can go, not just *what* the agent
   intends.

## Implementation constraints (binding on the follow-on build, PLAN Phase 3.5)

- **No `decide()` / replay / lattice weakening.** Any new floor or posture is additive: replay-corpus entries are
  added, never mutated; inviolable-tier unreachability + bench gates stay green; posture is injected input (ADR-046 /
  §19 #14 pattern), never ambient state that breaks byte-identical replay.
- **Anti-nag (P1/P2).** An approved destination is never re-prompted within a grant. An over-broad default-deny set
  that blocks legitimate work is a P1 violation — calibrate the starting approved set on real runs; fix the set, never
  the tier.
- **Default-posture flips** follow ADR-049 (as amended): one ADR + owner sign-off per flip; never nag-by-default.
- **Artifact-sharing is EXEMPT** (decision 15, §16): the product-improvement artifact-sharing channel carries scrubbed
  system artifacts (not user data) and is the one sanctioned default-on egress — it is not folded into this gate.
- **Typed allowlist-only serializer** (§19 #5) is the by-construction enabler: only allowlisted fields can serialize
  across the boundary.

## Consequences

- SCOPE GAP **G15** opens (default-deny + network backstop NOT-YET) and closes as Phase 3.5 lands; non-goal #2 is gone.
- The core guarantee becomes deliverable: *data stays local; it leaves only to destinations you approved; a weekly
  reminder re-confirms them.*
- The structured-PII floor (ADR-053) and credential floors (F27/F28) are reframed as defense-in-depth.

## Non-goals / open design questions

- This ADR does not fix the network-backstop mechanism (firewall vs. egress proxy vs. OS-level) — that is its own
  design, likely its own sprint within Phase 3.5.
- It does not decide the approved-destinations UX (how a destination is approved, scoped, or expired) — taken up in the
  Phase 3.5 build with the L5/consent work.
- Status stays **Proposed** until the Phase 3.5 design is accepted by the owner.
