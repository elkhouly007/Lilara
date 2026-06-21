# ADR-054 — Content enforcement seam and T1: the deterministic attachment surface for point (b)

**Status:** Accepted (owner decision) — ADR published 2026-06-21; **T1 build awaiting** (separately human-approved).
This ADR records the *seam* decision and its binding constraints; it ships **no** runtime wiring. It is the design
that closes the long-standing "point (b) is doc-only / G2 wiring remaining" gap left open by ADR-051 (and re-affirmed
by SCOPE §25.5.6 and `CONTENT-CONTRACT.md`'s "not wired into any harness" disclaimer).
**Date:** 2026-06-21
**Scope:** a specification decision describing **where** and **how** enforcement point (b) (the model content layer,
`CONTENT-CONTRACT.md`) attaches to a real harness surface — the **content seam** — and the **T1** first build task it
gates. Documentation only: it adds **no** runtime floor, touches **no** `decide()` path, changes **no** replay/lattice
baseline, and introduces **no** new bracket-tag vocabulary. The seam build (T1) and everything downstream remain
separate, human-approved PRs.

---

## Context

ADR-051 elevated the content red lines to the absolute tier and was explicit that they live at **enforcement point
(b)** — the model content layer — and **must not** be added to the content-blind Node guard's L1 deterministic
hard-exception list (layer purity). `CONTENT-CONTRACT.md` is the versioned, testable artifact for point (b), but it
carries a standing disclaimer: **"It is not wired into any harness."** Installing the §9 instruction template onto a
real surface — and giving point (b) a deterministic, regression-guardable **attachment seam** — was deferred as "G2
wiring."

This ADR specifies that seam. The guiding principle (owner) is unchanged: **never make a promise or a rule that hinges
on something the system cannot establish** — neither a *layer* that cannot enforce it nor a *fact* it cannot verify.
The seam is therefore **deterministic and content-judgment-free at the mechanism level**: it is plumbing that decides
*where the contract is consulted and what happens to the bytes*, not a model that decides *whether content is harmful*.
The content judgment itself stays where it belongs — inside the generation layer instructed by the §9 template — while
the seam guarantees that judgment is consulted at the right boundary, fails safe, and cannot be laundered into an
allow.

## Decision

Adopt a **content enforcement seam** with two deterministic attachment points, mirroring the two directions content
crosses the trust boundary. Both are mechanical gates around the content layer; neither performs content
classification.

1. **Output-before-emit gate (egress of generated content).** The model's generated output is consulted against point
   (b) **before it is emitted** to the user or handed to any tool/transport. The gate sits structurally *between
   generation and emission*: there is no path by which generated content reaches an external surface without having
   passed the seam. The content decision (refuse / allow / decoy per `CONTENT-CONTRACT.md` §4/§6/§7) is produced by the
   instructed generation layer; the seam's job is to make that decision **load-bearing** — an "absolute-refuse" verdict
   structurally prevents emission, it is never advisory.

2. **PostToolUse tool-output gate (ingress of tool results).** Content returning *from* a tool is consulted at the
   **PostToolUse** boundary — the same boundary the existing `F23b` MCP-result-injection signal already occupies
   (`runtime/post-adapter-factory.js` / `claude/hooks/output-sanitizer.js`). This catches forbidden content (and
   injected content) arriving via a tool result, at the symmetric seam to the output-before-emit gate. Reusing the
   established PostToolUse surface keeps the seam content-blind-to-ownership and avoids a second, divergent inspection
   path.

**T1** is the first build task this ADR gates: stand up the **seam plumbing only** — the two attachment points above,
the §9 template install onto the chosen surface, and the conformance/regression harness that proves the contract is
consulted at both boundaries. T1 does **not** add any content classifier, model, or heuristic; it wires the existing
contract to the existing surfaces deterministically.

## Binding rules (the seam's invariants)

- **Layer purity — the entire point.** The seam does **not** add any content judgment to the deterministic Node guard
  or the L1 hard-exception list; doing so would falsely imply the content-blind guard enforces content (LOCKED
  SCOPE §5). L1 = deterministic data/deletion/egress stops; point (b) = content refusal. The seam is the *boundary
  between* them, not a merge of them. `decide()` stays pure and content-blind.

- **Determinism requirement.** The seam mechanism is fully deterministic: which boundary is consulted, what the
  fail-safe is, and how a refuse verdict is enforced are fixed functions of position, never of a probabilistic score.
  No replay/lattice baseline moves because the seam adds **no** lattice floor; any conformance corpus it introduces is
  **additive** (new entries, never mutations of existing ones).

- **Output-before-emit gate is structural, not advisory.** A content refusal must be enforced by **construction** at
  the emit boundary — the absence of an emit path around the seam is an engineering invariant, exactly as the
  "auto-apply path must not exist structurally" invariant in SCOPE §25.5.5. The verdict cannot be downgraded between
  decision and emission.

- **PostToolUse tool-output gate reuses the established surface.** Tool-result inspection attaches at the existing
  PostToolUse `reasonCode` surface (F23b lineage), not a new bespoke path; it stays a signal/refusal at that boundary
  and does not become a new precedence lattice entry.

- **No-refuse/allow mismatch rule.** The content decision and the action decision must never disagree in the unsafe
  direction. If point (b) refuses, no other layer may emit or act on that content; an "allow" from the deterministic
  action layer can **never override** a content "refuse," and a content "refuse" can **never be silently relaxed** into
  an allow downstream. The seam fails toward the **more restrictive** of the two verdicts. (The converse — a content
  allow does not manufacture an action consent; the action layer's floors/consent still apply.)

- **F27 anti-injection destination naming.** Where the seam surfaces a destination string for approval — notably the
  F27 secret-egress Level-3 "name the destination every new destination" flow (SCOPE §25.5.1) — the destination name is
  **neutralized before it is shown to the human**, so a crafted/injected destination string cannot itself carry an
  injection or a misleading frame into the approval prompt. The destination is named for the human's decision; it is
  never rendered as trusted instruction text.

- **No-TTY fail-closed.** Any seam decision that requires human approval and finds **no controlling TTY** fails
  **closed** (block), consistent with the consent transport seam (`LILARA_CONSENT ∈ {interactive, block, off}`:
  deny / no-TTY → exit 2; SCOPE §0/§13). The seam never self-approves and never falls open when the approval channel
  is absent.

## Explicit red lines (what the seam must never become)

- **No classifier.** The seam adds no learned/statistical content classifier at the mechanism level.
- **No embedding.** No vector/embedding similarity is used to decide content harm.
- **No probabilistic content judgment.** The seam never gates on a confidence score or threshold over content meaning.

The content judgment that *does* happen lives in the instructed generation layer (the §9 template), which the seam
consults — it is not relocated into, nor re-implemented as, a probabilistic component on the deterministic side. This
keeps the guiding principle intact: the deterministic layers never claim to judge content they cannot deterministically
judge.

## Scope boundaries (what the seam covers — and pointedly does not)

- **In scope (the absolute / content-harm tier only):** Red Line A (sexual/nude/explicit content, `CONTENT-CONTRACT.md`
  §7.2), Red Line B (fabricated/manipulated depiction of a real specific person — the deception+harm discrimination
  rule, §7.3), CSAM (§7.1), and suicide/self-harm **method** markers (§7.4). These are the behaviors point (b) owns.

- **Explicitly out of scope:**
  - **Contextual / unstructured PII** (a name in free prose) — remains a point-(b) content concern handled by the
    contract's content categories, **not** by this seam's deterministic plumbing, and **never** by a classifier.
  - **Bulk structured PII** (emails / phones / national-residence IDs / cards / IBANs in volume) — owned by the
    **deterministic bulk structured-PII egress floor** (ADR-053, Phase 3.5), which keys on *shape + volume → external
    host* at the action boundary. That is a separate, deterministic L1-side floor; the content seam does not duplicate
    or pre-empt it.

  The two exclusions keep the seam narrow and honest: it is the attachment surface for the content-harm absolute tier,
  not a general PII or data-egress mechanism.

## ADR-only build sequencing

- **This ADR publishes the decision; it builds nothing.** No surface is wired, no template installed, no harness
  changed by this PR. The diff is docs-only.
- **T1 is the next, separately human-approved step.** T1 stands up the seam plumbing + §9 template install +
  conformance harness, under the binding rules above. It must land as its own reviewed PR.
- **Downstream tasks** (broadening the conformance corpus, calibrating any human-approval prompts, the F27 Level-3
  reclassification flow) sequence after T1, each with its own owner sign-off — consistent with SCOPE §25.5.6's encoding
  roadmap and the Phase-3 graduation rules (one ADR + owner sign-off per flip; never nag-by-default).
- **No default flip here.** Publishing the seam ADR does not graduate any default posture; the content red lines reach
  the on-at-install definitional tier only "once point (b) is wired" (SCOPE G12 / PLAN Phase 3 item 4(a)) — i.e. only
  after T1 and its downstream work land.

## Consequences

- The "point (b) is doc-only / G2 wiring remaining" gap now has a **named, regression-guardable seam** and a concrete
  first build task (T1), rather than an open hand-wave.
- The seam is loophole-resistant by construction for the tool-output ingress path and for honoring a produced
  refusal: layer purity is preserved, the output-before-emit and PostToolUse gates are structural, the no-refuse/allow-
  mismatch rule forbids unsafe downgrades, and the no-TTY fail-closed rule forbids fall-open.
- It adds **no** classifier, embedding, or probabilistic content judgment — the deterministic core stays content-blind
  and the content judgment stays in the instructed generation layer.
- `decide()`, the replay corpus, and `artifacts/lattice-baseline.sha256` are untouched. `CONTENT-CONTRACT.md`'s
  normative content is unchanged by this ADR; only its "not wired into any harness" status is now scheduled to change
  via T1.

## Residual limitation

Residual limitation: The output-before-emit gate makes a model-produced refuse verdict load-bearing and fail-safe; it does not manufacture a refusal the generation layer failed to produce. A subverted or prompt-injected model that emits forbidden content without a refuse verdict gives the content-blind seam nothing to enforce, and per F.9 the seam may not classify content itself to catch it. That residual model-subversion path is bounded by the deterministic L1 action floors (F27/egress/deletion catch the exfil regardless of content), not by the content seam. The seam is loophole-resistant for the tool-output ingress path; for the output path it guarantees a produced refusal is honored, not that every forbidden generation is caught.

## Non-goals / open questions (fixed in the T1 design PR)

- The exact harness surface for the output-before-emit gate, and the precise template-install mechanism.
- The conformance-corpus shape proving both gates are consulted (additive entries only).
- The F27 Level-3 destination-naming UX and its anti-injection neutralization implementation.
- Status stays **Accepted (ADR published)**; the **T1 build** is **awaiting** owner-approved scheduling.
