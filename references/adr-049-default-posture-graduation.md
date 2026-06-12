# ADR-049 — Default-posture graduation policy (secure-by-default, evidence-gated)

**Status:** Accepted (policy) — owner (Khouly) decision Q2, 2026-06-12
**Date:** 2026-06-12
**Scope:** policy only — no runtime change in this ADR; each actual default flip lands later as its own ADR + code
change in its planned phase (PLAN Phase 1 calibration → Phase 3 flips)

> **Numbering note:** the owner's decision memo referenced "ADR-048" for this policy; ADR-048 was already allocated
> (F4 demotion path design, 2026-06-11). To avoid creating a third number collision (021×2, 022×2 exist and are
> frozen), this policy takes the next free number.

---

## Context

Out of the box, Lilara today stops nothing (SCOPE §18 default-posture table, GAP G12): `LILARA_ENFORCE=0` (block
decisions warn and exit 0), `LILARA_CONSENT=off`, F28 taint-egress and F29 delete-coordination are flag-gated off,
F23 kill-chain is observe-only. That warn-first posture served adoption, but it means two of the three hard exceptions
(HX1 cross-call half, HX3) are inert at defaults — a user who installs Lilara and assumes "the guard protects me" is
wrong until they configure it.

At the same time, the owner's first-order tenets (SCOPE §0.1, set 2026-06-12) bind every posture decision:

- **P0:** Lilara exists to make users more productive — powerfully and safely.
- **P1:** security must ENABLE work; a guard that blocks legitimate work is a failure.
- **P2 (anti-nag):** a granted scope is a contract — the agent is never re-asked inside it; re-prompting inside an
  already-granted scope is a defect. Halts happen only at genuine hard exceptions.

## Decision

Lilara graduates to **secure-by-default**, under an **evidence gate** and an **owner gate**, floor class by floor
class:

1. **First wave — catastrophic inviolable floors.** Ship `LILARA_ENFORCE=1` as the **default** for the catastrophic
   inviolable tier — **F3 (critical-risk), F14 (budget-exceeded), F10 (taint-floor), F27 (secret-egress-external)** —
   once Phase-1 real-run calibration (SCOPE §19 #3 eval slices, measured under the declared flags-on posture) shows
   **near-zero false positives on those floors**. These are the floors whose firings are, by design, signature-true
   red lines; enforcing them by default is the smallest change that makes the out-of-the-box guard real.
2. **Heuristic-heavy demotable floors stay OPT-IN until individually proven.** **F28 (taint-egress), F29
   (delete-coordination), F23 (kill-chain)** each remain opt-in until that floor meets **its own measured FP budget**
   on real runs — then each flips **one at a time**.
3. **One ADR + owner sign-off per flip.** No default changes as a side effect of anything else. Each flip is its own
   reviewed ADR citing the measured evidence, signed off by the owner.
4. **The env override always remains.** Power users can dial any default back down. This is host-operator
   configuration inside the host-trust boundary (SCOPE §21) — it is NOT a lattice demotion path: every inviolable
   floor keeps `demotableBy: []`, and no contract, consent, learned, or self-improvement source can reach it. Nothing
   in this policy weakens the inviolable tier.
5. **Secure-by-default must NOT mean nag-by-default (binding constraint, P1/P2).** Enforcement halts only at genuine
   red lines. Granted scopes are never re-prompted. If enabling enforcement on a floor would produce repeated prompts
   or stops inside legitimately granted scopes, that floor has FAILED its graduation gate regardless of its FP rate —
   the friction signal (SCOPE §19 #15, if adopted) counts against graduation exactly like a false positive.

## Prerequisites for any flip (hard ordering)

- **Replay-posture hardening first** (SCOPE §19 #14): `decide()` reads the posture flags from ambient env and the
  replay harness does not pin them — before any default changes, pin all three flags in
  `scripts/replay-decisions.js` and require a posture-matrix replay (corpus green under both postures). A default flip
  without this silently breaks the byte-identical-replay invariant.
- **Phase-1 eval slices exist and are calibrated on real runs** (SCOPE §19 #3; PLAN Phase 1) — budgets are committed,
  and measurement happened under the declared flags-on posture (at current defaults the F28/F29 slices are inert and
  any "measurement" would be degenerate).
- **Mechanism design at first flip:** `LILARA_ENFORCE` is a single global flag today. A per-tier default ("enforce the
  catastrophic inviolable floors, warn elsewhere") needs a tiered-enforcement mechanism — designed in the first flip's
  ADR, not here. Constraint: the mechanism must be expressible as pinned input/env so replay stays deterministic.

## Consequences

- SCOPE G12 (default-posture honesty) gets a closure path: the gap closes flip by flip, with evidence attached.
- The out-of-the-box story becomes: *catastrophic red lines stop by default; heuristic detectors arrive as they prove
  themselves; nothing nags; everything can be dialed.*
- The release gate suite grows one gate per flip (the floor's eval slice at its committed budget).

## Non-goals

- This ADR changes no runtime behavior, no lattice entry, no `demotableBy`, no replay corpus.
- It does not decide consent-gate (`LILARA_CONSENT`) defaults — the consent transport default is a UX decision tied
  to the L5 shell work and P2, taken up with the relevant phase.
