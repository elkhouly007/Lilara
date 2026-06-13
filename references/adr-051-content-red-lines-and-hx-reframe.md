# ADR-051 — Content red lines elevated to the absolute tier; L1 hard-exceptions reframed as deterministic mechanical stops (§19 #4 closed)

**Status:** Accepted (owner decision) — owner (Khouly) decision, 2026-06-13
**Date:** 2026-06-13
**Scope:** specification decision encoding intent at enforcement point (b) (the model content layer). It changes
documentation only — `references/SCOPE.md` (§1/§4/§5/§6/§7/§19 #4/§20) and `references/CONTENT-CONTRACT.md` (→ v1.1.0).
It adds **no** runtime floor, touches **no** `decide()` path, and changes **no** replay/lattice baseline. Generation-layer
wiring remains tracked as G2/G3 (separate, human-approved PRs).

---

## Context

The **guiding principle** (owner): never make a promise — or a rule — that hinges on something the system cannot
establish, whether a *layer* that cannot enforce it or a *fact* it cannot verify. This kills two loopholes by
construction: a rule must not condition on **consent** (unverifiable) or on **fame / public-figure** status
(irrelevant to the harm).

Two problems motivated this decision:

1. **Over-claim risk in §19 #4 (`[CC-PROPOSED][OPEN]`).** SCOPE §1's L1 hard exceptions ("personal data leaving to an
   external party = no", etc.) could be read as a guarantee that the **content-blind** Node guard already stops all
   third-party-PII egress. In reality the guard's deterministic egress guarantee is only the **credential/secret
   subset** (F27/F28); general third-party personal data is byte-identical to the user's own at the tool boundary
   (ADR-036, "no ownership signal"). The doc needed to state the real boundary instead of implying coverage it does
   not have.

2. **The product's real inviolable red line is improper *content*, not a data/deletion stop.** That red line lives at
   enforcement point (b) (the model content layer, `CONTENT-CONTRACT.md`), which the content-blind Node guard
   (LOCKED SCOPE §5) cannot and must not enforce. The v1.0.0 contract treated sexual content as an ordinary §5 category
   with a "carve-out," and left fabricated-person imagery only as a PROPOSED section pending this decision.

The owner's motivation is values-based, but the **artifact text stays neutral and universal** — behavioral,
harm-grounded language only, with **no religious or ideological label** anywhere (the project-wide neutral-language
mandate).

## Decision

**Part 1 — Reframe the L1 hard exceptions (honest scoping; closes §19 #4).** HX1 (personal-data→external),
HX2 (personal-data→off-machine), HX3 (deletion-without-coordination) **stay**, but are reframed as the content-blind
Node guard's deterministic **mechanical** stops — *not* the product's ethical red lines. The guard's deterministic
egress guarantee is stated precisely as the **credential/secret subset (F27/F28)**. General third-party personal data
has no ownership signal at the boundary and is **routed to enforcement point (b)**, never implied as covered by the
content-blind guard.

**Part 2 — Two inviolable content red lines, enforced entirely at point (b), at the ABSOLUTE tier** (alongside CSAM:
clean refusal, no decoy, no partial help):

- **Red Line A — sexual / nude / explicit content.** Flat refusal for any subject (real or fictional), any medium; **no
  carve-out and no medical/clinical exception.** This **removes** the v1.0.0 sexual-content carve-out.
- **Red Line B — fabricated / manipulated depiction of a real specific person.** **Blanket** refusal of any
  compositing, face-swap, deepfake, montage, or fabrication placing a real specific person in a scene/pose/situation
  that did not occur. Blanket by design: even benign-looking edits are refused, because separating "benign" from
  "harmful" needs intent the system cannot verify. The discriminator is **"fabricated depiction of a real specific
  person"**; defamation/scandal/harm is an **aggravator, not the trigger** (fires with no provable intent to harm).
  **Not** conditioned on consent or fame — "specific person" is famous *or* private alike, and the
  private-individual / harassment case is the **priority**. Trigger = a name, a likeness/photo, or an unambiguous
  real-world reference; a **generic, non-identifiable person** is general policy, not Red Line B.

## Implementation constraints (binding on this and any follow-on PR)

- **Layer purity — the entire point.** Neither content red line is added to the L1 deterministic hard-exception list;
  doing so would falsely imply the content-blind Node guard enforces it (LOCKED SCOPE §5). L1 = deterministic
  data/deletion stops; point (b) = content refusal.
- **No `decide()` / replay / lattice change.** This decision is documentation only. `decide()` stays pure and
  content-blind; the replay corpus and `artifacts/lattice-baseline.sha256` are untouched.
- **Tag integrity.** The two red lines are recorded in SCOPE §7 as **two new `[LOCKED]` lines** (locked count 43 → 45);
  every pre-existing `[LOCKED]` line text is byte-identical; `artifacts/scope-locked-baseline.sha256` is rebaselined to
  45 in the same diff. No `[LOCKED]` tag is dropped; no new bracket-tag vocabulary is introduced.
- **Neutral language.** All added text is behavioral/universal-harm; no religious or ideological label.
- **Honest status preserved.** Point (b) enforcement is doc-only today (G2/G3). Elevating these to inviolable is a
  binding statement of **intent**; wiring the §9 template onto a real harness surface is remaining, separately
  human-approved work — **not** done by this decision.
- **Contract discipline.** `CONTENT-CONTRACT.md` → v1.1.0 is **strengthen-only** (more refused, nothing relaxed) under
  major version 1.x; the former §8 third-party proposal merges into §5/§9 on this §19 #4 sign-off.

## Consequences

- **§19 #4 closed** (resolved, not a standing open question). §1/§4 no longer over-claim the content-blind guard's
  coverage; G4 (hard-exception #1 coverage) is **reconciled** and G1 (victim-aware enforcement) is **honest-scoped**
  with the general-PII remainder routed to point (b).
- **G3** narrows: CSAM + suicide + Red Line A + Red Line B are settled at the absolute tier; the third-party set is
  merged. Generation-layer **enforcement still depends on G2 wiring** — unchanged and tracked.
- Point (b) now has **red-teamable, regression-guardable** red lines (the §10 checklist gains R12/R13), which the
  follow-on conformance-corpus + propose-only template-install PR operationalizes.
- The decision is loophole-resistant by construction: nothing rests on consent (unverifiable) or fame (irrelevant).
