# Lilara — Implementation Plan (current state → scope)

> **Status:** PROPOSED — review artifact, not yet owner-accepted. Companion to `references/SCOPE.md` (R2 revision).
> Produced 2026-06-12 from a code-verified baseline (master `57089aa`, VERSION 0.2.1). Sequenced strictly per the
> `[LOCKED]` build order (SCOPE §1, canonicalized in §1.5): **L1 → thin L5 (done) → L2 → L4 → full L5 → L3 last**, with
> the §23.A control-plane UI real build after the safety core entirely.
>
> **How to read:** each phase has a goal, preconditions, work items, owner decision points, risks, and a *falsifiable*
> definition of done. Phases are PR-shaped: small, gate-verified, one coherent change per PR. Nothing in this plan
> relaxes the inviolable floors, `decide()` purity, byte-identical replay, neutral universal-harm language, the
> clean-room/no-copyleft rule, or the hooks/adapters-never-auto-applied red line.
>
> **Owner tenets bind every phase (SCOPE §0.1, set 2026-06-12):** P0 — Lilara exists to make its users more
> productive, powerfully and safely; P1 — security must ENABLE work ("approve-once, then run freely"); P2 — the
> consent contract is anti-nag: re-prompting inside a granted scope is a defect, halts happen only at genuine hard
> exceptions. A phase deliverable that adds friction without preventing a genuine harm fails its own DoD.
>
> **Decision update (2026-06-12):** the owner answered Q1–Q7 (SCOPE §24 decision record; DECISIONS.md D50; ADR-049
> default-posture graduation; ADR-050 tamper-floor scoping — encoded on the PR #164 branch). Affected items below are
> marked **DECIDED**.
>
> **Decision update (2026-06-13 — R3 intent re-verification, SCOPE §25):** 16 owner decisions + the §19 batch encoded.
> New scheduled work below: a **structured-PII egress floor** and the **default-deny egress model** (decisions 6/14 —
> new **Phase 3.5**, decimal-inserted so Phases 4–8 keep their numbers); the **four-source self-improvement engine** and
> **scrubbed artifact-sharing** (decisions 7/15) thread through Phases 4/5/7; the **three product forms** (decision 10)
> into Phase 8. ADR-049 + ADR-051 amended; ADR-052/053 proposed. **§19 #4 is now CLOSED.**

---

## 0. Verified starting point (what is actually true today)

- **L1 BUILT:** 30-floor precedence lattice, hash-pinned inviolable tier (`demotableBy:[]`, `assertOrdered()`,
  `computeLatticeHash()` vs `artifacts/lattice-baseline.sha256`), consent gate (ADR-035, four invariants), 119-entry
  replay corpus with zero-drift gate, `decide()` cross-call-pure (ADR-046).
- **Default posture is warn-only** (SCOPE §18 table): `LILARA_ENFORCE=0`, `LILARA_CONSENT=off`, F28/F29 flag-gated off,
  F23 observe-only. Out of the box Lilara observes/journals/warns; it stops nothing.
- **Purity is modulo env:** `decide()` reads three posture flags from `process.env`; the replay harness does not pin
  them (SCOPE §19 #14).
- **L5 slices shipped:** outbound notify (allowlist scrubber, TLS floor) + read-only dashboard
  (`scripts/dashboard-server.js`, localhost:7917, redaction fail-closed) + 35-subcommand CLI.
- **Open 0.2.0 item:** DoD #5 — Hermes adapter + measured false-stop/false-allow at the hard exceptions on real runs.
- **Decision-debt:** ADR collisions 021×2/022×2 (frozen as A/B), 8 Proposed ADRs, ADR-032 half-closed, ADR-048 open.
- **L2/L4 frameworks exist unwired** (session-memory, memory-search, intent-classifier 8-intent static routing); L3 not
  started (by design).

## Phase overview

| Phase | Theme | Target version | Hard dependency |
|---|---|---|---|
| 0 | Truth, hygiene & owner-decision packet | 0.2.2 | — |
| 1 | Hard-exception eval harness + OpenClaw calibration | 0.2.2–0.2.3 | P0 decision §19 #4 |
| 2 | Hermes adapter + dual-integration measurement (closes 0.2.0 DoD #5) | 0.2.3 | P1 harness |
| 3 | L1 completeness: laundering gates → tamper floor → **block-model secure-by-default posture (L1/L2/L3/L4 ladder; F27 reclassification to Level 3)** | 0.2.4 | P1 budgets; ADR-049/050 (Q2/Q7 DECIDED) |
| 3.5 | Egress model: default-deny allowlist + approved-destinations + structured-PII floor + network backstop | 0.2.5 | P3 gates; decisions 6/14 |
| 4 | L2 memory + **Memory Souls (smart-tag recall; first-class, owner elevation 2026-06-16)** | 0.3.x | P3.5 egress foundation + P3 gates |
| 5 | L4 orchestration | 0.4.x | P4 (L4 depends on L2) |
| 6 | L5 full shell: approver-auth → inbound → guest→host inversion → **Breath proactive-watch loop (first-class, owner elevation 2026-06-16)** | 0.5.x | P3 integrity hardening |
| 7 | L3 self-improvement (suggestion-only) — LAST layer | 0.6.x | P3 gates + P4 wiring |
| 8 | §23.A control-plane UI real build (web + TUI) | after core | P6 approver-auth; owner go |

**Owner refinement 2026-06-16 (recorded here so it is not re-litigated; full text in `references/SCOPE.md` §25.5 and
`HANDOVER-HERMES.md` §7):** the default posture is **the block ladder** (Level 1 proceeds; Level 2 resolvable block;
Level 3 mandatory manual approval — **F27 reclassified from absolute to Level 3, never silent, never absolute,
remembered per-destination**; Level 4 absolute block = harm-to-a-person only — the *only* absolute red line). **Breath
and Memory Souls are first-class scoped items** (Memory Souls at L2; Breath at L5). Red Line B = deception+harm test
(consent never a free pass); inviolable tier = never weakened, even with user approval (for the absolute tier); the
"propose AND act" question = reconciled (act freely inside the contract; only safety-code self-mod is suggestion-only).
Phase 3's block-model secure-by-default posture work is the encoding of these resolutions into the runtime default.

Cross-cutting tracks (§7 below) run alongside: §23.B study-and-rewrite, red-team release gates, perf SLO, weekly loop.

---

## Phase 0 — Truth, hygiene & owner-decision packet (0.2.2)

**Goal:** the paper record matches reality, and every decision that blocks later phases is queued to the owner in one
packet instead of ambushing the schedule mid-phase.

**Work items**
1. ADR ledger reconciliation: collisions stay **frozen as 021A/021B/022A/022B** (numbers are cited in lattice notes,
   CHANGELOG, DECISIONS.md — renumbering breaks cross-references). For each Proposed ADR, reconcile header against
   shipped reality *with evidence* (e.g. ADR-024/028 state-dir conventions appear in CHANGELOG implementation entries);
   close, supersede, or re-affirm as genuinely open. Finish-or-close ADR-032 (the 12-consumer sweep is in CHANGELOG;
   the header never flipped).
2. `references/CONTENT-CONTRACT.md` — the enforcement-point-(b) artifact (SCOPE §19 #2), pulled forward because it has
   zero code dependencies and addresses the only two High gaps (G2/G3): clean-refusal text, the decoy
   fake-all-the-way-down constraint, the carve-outs, crisis-resource behavior, all in neutral universal-harm language;
   plus a red-team checklist so the artifact is testable.
3. §19 #8 telemetry wording fix in SCOPE (recommendation (a): document the true local-only posture).
4. `install-local.sh` stale "78 js modules" comment → live count.
5. **Owner-decision packet** (one review session). **DECIDED 2026-06-12:** Q1 (sequencing — §1.5 canonical), Q2
   (graduation policy — ADR-049), Q3 (deterministic-lattice naming), Q6 (dashboard is the §23.A seed), Q7
   (tamper-floor scoped to installed guard — ADR-050), §19 #9 (F23 stays opt-in until its FP budget is met).
   **Still open:** ADR-048 (F4 demotion), LICENSE choice (G13), D23 trademark. (**SCOPE §19 #4 CLOSED 2026-06-13** —
   ADR-051 + the structured-PII split; Phase 1 slices are no longer blocked.)
6. **R3 intent re-verification (DONE 2026-06-13, SCOPE §25).** 16 owner decisions + the §19 batch encoded into
   SCOPE.md, PLAN.md, and CONTENT-CONTRACT.md (→ v2.0.0) + its conformance gate/corpus; ADR-049 (definitional-tier
   on-at-install) and ADR-051 (Red Line B → deception+harm) amended; ADR-052 (default-deny egress) + ADR-053
   (structured-PII floor) proposed; D52 recorded in DECISIONS.md; scope-locked baseline rebaselined (45 → 77 lines).

**Risks:** bulk-flipping ADR headers without evidence would corrupt the record — each flip needs a CHANGELOG/commit
citation in the ADR itself.

**Definition of done (falsifiable)**
- `grep` proof: zero dangling ADR references; every ADR header ∈ {Accepted, Implemented, Superseded, Rejected} or
  explicitly in the owner queue.
- CONTENT-CONTRACT.md exists, passes neutral-language + tag gates, and contains a red-team checklist.
- The decision packet has owner answers recorded in DECISIONS.md (or explicitly deferred with a date).
- Full gate suite green.

**Est. 3–4 PRs.**

---

## Phase 1 — Hard-exception eval harness + OpenClaw calibration (0.2.2–0.2.3)

**Goal:** the instrument exists before the measurement: named eval slices per hard exception (HX1/HX2/HX3), a declared
measurement posture, and budgets calibrated on a real integration that already exists (OpenClaw).

**Preconditions:** §19 #4 is **CLOSED** (2026-06-13 — ADR-051 + the structured-PII split): the deterministic guarantee
is the credential/secret subset (F27/F28) plus a near-term bulk structured-PII floor; only unstructured/contextual PII
is owned by enforcement point (b). HX slices are now falsifiable.

**Work items**
1. Implement ADR-019 (eval-corpus shape coverage) — closes its Proposed status.
2. Named slices: `hx1-secret-egress` (F27 single-call + F28 cross-call), `hx2-machine-egress` (modeled sinks),
   `hx3-delete-coord` (F29 + snapshot evidence), and a new **`hx1b-structured-pii-egress`** slice (bulk
   emails / phones / national-residence IDs / cards / IBANs above threshold — decision 6). Each slice declares the
   **flags-on measurement posture** (`LILARA_TAINT_EGRESS=1`, `LILARA_DELETE_COORD=1`, consent transport in
   fail-closed-block) — at defaults two of the three original exceptions are inert and measurement would be degenerate.
   **Note:** under the Phase-3.5 default-deny model (decision 14) these egress slices become *defense-in-depth* behind
   the destination gate — calibrate them as such.
3. Provisional FP/FN budgets committed as a versioned artifact (under `evals/` or `artifacts/`), wired into
   `lilara-cli.sh pre-push` as an advisory gate first.
4. OpenClaw real-run calibration pass (the adapter exists — do not serialize this behind Hermes): unattended runs with
   seeded hard-exception probes; separate duration-class floor stops (F11/F14b) from hard-exception counts.
   Calibration reports also include **harness-level friction counts** (prompts per task; any re-prompt inside a
   granted scope) per the ACCEPTED SCOPE §19 #15 — a floor that would nag fails its graduation gate even at zero FP
   (ADR-049).
5. Lock budgets as a release gate after one calibration round.

**Risks:** seeded probes leaking into the replay corpus (keep eval fixtures and replay corpus disjoint); budget
overfitting to OpenClaw's traffic shape (Hermes recalibration in Phase 2 is expected and allowed to adjust budgets
once, before locking).

**Definition of done**
- Slices + posture declaration + budgets exist as committed, versioned artifacts; the gate demonstrably flips red on a
  seeded regression and green on baseline.
- **The phase diff contains no lattice or floor changes** (measurement must not mutate the thing it measures).
- OpenClaw calibration report (per-exception FP/FN under declared posture) committed.

**Est. 3 PRs.**

---

## Phase 2 — Hermes adapter + dual-integration measurement (0.2.3) — closes 0.2.0 DoD #5

**Goal:** the second reference integration exists and both integrations have measured false-stop/false-allow at the
hard exceptions on real runs.

**Preconditions:** Phase 1 harness; license check **before any source contact**.

**Work items**
1. **License-check artifact first** (`references/hermes-license-check.md`, dated, committed before adapter work): the
   target's license identified; the clean-room boundary stated explicitly — reading interface/docs surface to integrate
   against is permitted, reading implementation is not; any copyleft/BSL/source-available finding flags the direction
   to the owner BEFORE code.
2. `hermes/` adapter (hooks/adapter.js + hooks/post-adapter.js + manifest), built clean-room from observed behavior.
3. Extend `scripts/check-post-adapter-parity.sh`, `scripts/install-local.sh`, and `scripts/check-install-smoke.sh` to
   the 7th harness (otherwise 0.2.0 DoD #3 silently regresses).
4. Real-run measurement on **both** OpenClaw and Hermes under the declared posture; multi-day Hermes runs get
   **lattice-hash bookend verification** (run `check-inviolable-tier.sh`'s hash comparison at session start and end) —
   an interim integrity control that buys the §19 #1 tamper-floor property where this phase needs it, without
   pre-empting the owner's Q7 decision.
5. Flip SCOPE §10 DoD #5 to BUILT with the measured numbers; release 0.2.3.

**Risks:** Hermes interface instability (pin the tested version in the manifest); duration-floor noise polluting
exception counts (separated per Phase 1 methodology); budget recalibration churn (allowed once, then locked).

**Definition of done**
- Parity, install, and smoke gates all cover `hermes/`.
- Dated license-check artifact predates the first adapter commit in git history.
- Per-exception FP/FN report for both integrations committed; SCOPE §10 #5 = BUILT; bookend hash verification log
  attached to the multi-day run report.

**Est. 3–4 PRs.**

---

## Phase 3 — L1 completeness: gates → tamper floor → posture graduation (0.2.4)

**Goal:** the safety core's *meta*-defenses stand before anything self-referential lands, and defaults graduate only
with evidence and owner sign-off.

**Ordering inside the phase (deliberate):**
1. **Policy-laundering / gradual-weakening regression gates first** (SCOPE §19 #6): (a) no self-improvement or learned
   source may appear in any inviolable floor's `demotableBy` (extends the existing unreachability tests); (b) a
   monotonic check that the inviolable set + lattice hash change only via reviewed baseline updates. These gates are
   load-bearing for Phase 5's learned routing source and Phase 7 — not just L3.
2. **Then the runtime safety-core-write floor — DECIDED (Q7, 2026-06-12, ADR-050):** scoped to the INSTALLED guard
   under `~/.lilara` (not the dev checkout); stays inviolable, NOT consent-demotable; CI hash-baseline remains as
   defense-in-depth. Landing it second means the floor's own lattice-hash rebaseline is the first baseline change
   exercised *under* the new gate. New floor = additive replay-corpus entries (never mutations), inviolable-tier tests
   extended, bench gate green (hot-path cost).
3. **Replay-posture hardening before any default flip** (SCOPE §19 #14): pin `LILARA_TAINT_EGRESS`,
   `LILARA_DELETE_COORD`, `LILARA_KILL_CHAIN_ENFORCE` in `scripts/replay-decisions.js`; add a posture-matrix replay
   (corpus green under both postures); optionally migrate posture into `decide()` input per the ADR-046 pattern.
4. **Default-posture graduation — policy DECIDED (Q2, 2026-06-12, ADR-049; SHARPENED 2026-06-13, decision 12):**
   secure-by-default, evidence-gated, re-partitioned into three buckets. **(a) ON at install, UNCONDITIONALLY**
   (definitional — no FP-budget gate): F3 (catastrophic commands), **F27 (secret egress — currently inviolable in the
   lattice; target per 2026-06-16 owner refinement: Level 3 mandatory manual approval; runtime reclassification is the
   Phase-3 build task)**, the installed-core
   tamper floor (ADR-050), and the content red lines once point (b) is wired (the **content seam** + its first build
   task **T1** are now ADR-published — ADR-054 — and **awaiting build**; the definitional-tier flip for the content red
   lines lands only after T1 and its downstream work). **(b) Calibration-gated** (heuristic
   inviolable): F10 taint, F14/F14b duration/budget — flip once Phase-1 calibration shows near-zero FP (the **amended
   ADR-049 first wave**; F3 moved up to (a) at install; F27 sits in (a) today (inviolable in code) but the target is
   Level 3 (Phase 3). **(c) Opt-in until own FP budget:** F28 (demotable — NOT in (a)),
   F29, F23 — flip one at a time, each by its own ADR + owner sign-off. Env override always retained; per P1/P2,
   secure-by-default must never become nag-by-default — a floor that would nag fails its graduation gate even at zero FP.

**Risks:** the tamper floor's dogfood trap is resolved by ADR-050's installed-guard scoping, but the residual risk
moves into the protected path-set definition — if it accidentally covers paths legitimate work touches, P1 is violated;
calibrate the path-set on real runs before the floor's flip, and fix the path-set (never the tier) if it fires on
legitimate work.

**Definition of done**
- Laundering gate green across the very baseline update that lands the new floor.
- Posture-matrix replay green; replay harness pins all three flags.
- Each flipped default has its own ADR with owner sign-off recorded.
- Unreachability tests extended to any new source class; bench gate green.

**Est. 4–5 PRs.**

---

## Phase 3.5 — Egress model: default-deny allowlist + approved-destinations + structured-PII floor + network backstop (0.2.5)

**Goal:** flip egress from denylist to **default-deny allowlist** (decision 14) and land the **bulk structured-PII
floor** (decision 6) as defense-in-depth — the load-bearing realization of the core thesis (data leaves only to
approved destinations, SCOPE §0/§13). Decimal-inserted between Phase 3 and Phase 4 so it sits on the hardened L1 core
and *before* L2 memory raises the data-at-rest stakes; Phases 4–8 keep their numbers.

**Preconditions:** Phase 3 laundering gates + tamper floor standing; the §19 #5 typed allowlist-only egress serializer
(built here, generalized further with L2 in Phase 4).

**Ordering inside the phase (deliberate):**
1. **Approved-destinations contract** (SCOPE §8/§11): deny ALL outbound to external destinations by default; the user
   approves a destination list once; an approved destination runs freely (anti-nag), a non-approved one stops-and-asks
   or blocks; a **weekly re-confirm** ritual. Taint-tracking binds the contract so an injected agent structurally
   cannot reach a non-approved destination. Gate on **where data goes**, not what is inside.
2. **Bulk structured-PII egress floor** (decision 6, ADR-053): emails / phones / national-residence IDs / cards /
   IBANs above a threshold → external host. Reuses the F27/F28 egress mechanism (additive replay-corpus entries, never
   mutations; inviolable-tier tests + bench gate green). Under default-deny it is **defense-in-depth** behind the
   destination gate, not the primary control.
3. **Network-level egress backstop** (decision 14): a firewall / egress-proxy layer so a novel transport OR a
   successful injection still cannot reach a non-approved destination even if the action-layer gate is bypassed. May be
   its own sprint (heavier; OS / proxy-level) — sequence it last in the phase.
4. **Default-posture flips** for the above follow the Phase-3 graduation rules (one ADR + owner sign-off per flip;
   never nag-by-default).

**Risks:** an over-broad default-deny list breaks legitimate work (P1 violation) — calibrate the starting
approved-destinations set on real runs; the network backstop must not double-prompt for already-approved destinations
(P2). Artifact-sharing (decision 15, §16) is **exempt** from default-deny (not user data) — keep it a distinct,
opt-out, scrubbed channel, never folded into the destination gate.

**Definition of done**
- ADR-052 (default-deny egress) + ADR-053 (structured-PII floor) accepted; approved-destinations contract + weekly
  re-confirm implemented; structured-PII floor live with additive replay entries; network backstop in place (or its
  own sprint scheduled); posture-matrix replay green; bench gate green. **No `decide()`/lattice purity or replay
  determinism weakened.**
- SCOPE GAP **G15** (default-deny + network backstop) flips toward closed as each piece lands.

**Est. 4–6 PRs.**

---

## Phase 4 — L2 memory (0.3.x)

**Goal:** the memory layer lands with privacy architectural from day one — the boundary exists before the data does.

**Ordering inside the phase:** serializer → egress inventory → wiring → product features.

**Work items**
1. **Typed allowlist-only egress serializer** (SCOPE §19 #5, generalizing the `KEEP_KEYS` pattern): the *only* path by
   which anything memory-derived crosses a process boundary; fail-closed property test — no field outside the allowlist
   can serialize. This is the **same serializer** that enables Phase-3.5 default-deny egress and **scrubbed
   artifact-sharing** (decision 15): it makes "only abstract enums/counts of user data leave; shared artifacts are
   scrubbed of user-specifics" true **by construction**.
2. **Egress-path inventory:** every process boundary enumerated — notify channels, dashboard endpoints, CLI
   subcommands, receipts export — with the serializer mandatory on each (the dashboard and 35-subcommand CLI are
   exactly the "just a little context for debugging" leak surface §11 names).
3. Memory wiring as **pure injected inputs** to `decide()` (the ADR-046 `provenanceWindow` pattern): loaded at the
   impure boundary, injected, journaled, replayed. **Memory-derived fields stay out of the canonical Action-IR** so
   every pre-existing corpus entry's `irHash` is unchanged.
4. If memory influences demotion at all, "memory" becomes a new `demotableBy` source class → extend the
   inviolable-tier unreachability tests **before** wiring, not after.
5. **Provenance tags on memory entries from day one** (tainted-content-derived memories are §12's
   "self-modification poisoning" arriving two layers early).
6. Retention policy (SCOPE §19 #11). The **principle is now LOCKED** (2026-06-13): audit material is **never
   auto-deleted**; pruning happens **only via an explicit user command**; journal redaction tooling exists
   (ADR-041/045). The **full policy is still drafted here** and put to the owner before implementation. (Journal =
   auditable long-term record; grants/tokens = operator-managed revocation; snapshots/telemetry = explicit CLI pruning,
   never automatic deletion of audit material.)
7. **Friction telemetry — durable counters (ACCEPTED SCOPE §19 #15 `[LOCKED]`; bound to P0/P1/P2):** implement the
   local-only counters in the L2 layer — prompts-per-task; **re-prompts inside an already-granted scope (P2 violation,
   target ZERO)**; grant-to-first-action time; operator-marked false stops. **Zero egress by construction:** counters
   are written only through the §19 #5 typed egress-serializer allowlist; covered by this phase's egress-path
   inventory. They feed the ADR-049 graduation gates and are exported (locally) for L4/L3 consumption in Phases 5/7.
8. Product features (task/outcome history, end-of-day summary) — only after 1–7.

**Definition of done**
- All pre-existing corpus `irHash` values byte-identical.
- Serializer fail-closed property test green; egress inventory committed with per-path serializer coverage —
  **including the friction-telemetry counters**.
- Memory-source unreachability test green; memory entries carry provenance tags.
- Friction counters live and local-only; the P2-violation counter (re-prompt inside granted scope) demonstrably
  increments on a seeded re-prompt and reads zero on a clean run.
- Nothing memory-derived leaves the machine (verified by the inventory + serializer tests).

**Est. 5–6 PRs.**

---

## Phase 5 — L4 orchestration (0.4.x)

**Goal:** the locked capability set (§13): cheap deterministic auto-select, multi-skill merge/compose, auto-create
skill/agent — every product an UNTRUSTED proposal through the guard. This is **source 3 of the one improvement engine**
(§12, decision 7): creating skills/hooks/adapters/agents/sub-agents.

**Work items**
1. Skill-catalog format + deterministic, low-token auto-select (extends intent-classifier/route-resolver lineage).
2. Merge/compose of multiple skills into one task plan; auto-create skill/agent when none fits — all emitted as
   **untrusted proposals that pass the floors + consent before running**.
3. Outcome-feedback learning: weights are mutable state → **injected inputs** to any routing decision that is
   journaled/replayed (same replay-safety pattern as Phase 4). The learning loop **ingests the Phase-4 friction
   telemetry** (ACCEPTED §19 #15): every friction event may generate an improvement proposal (e.g. a better-shaped
   scope template) — **guard-routed, suggestion-only, never auto-applied**.
4. Hooks/adapters: propose-only forever — the auto-apply path must not exist structurally.
5. **Product-improvement artifact-sharing (decision 15, §16):** the skills/agents/adapters this layer generates are the
   artifacts that may be **shared** for product improvement — **scrubbed + generalized** of user-specifics through the
   §19 #5 serializer, **default-on with a universal opt-out** (privacy never paywalled), **NOT user data**, and
   **exempt from the Phase-3.5 default-deny gate**. Nothing sensitive is surfaced in onboarding (there is nothing
   sensitive to surface).

**Definition of done**
- Negative test: **no model call exists in the routing path** (§13 `[LOCKED]` "never a big model per route").
- Negative test: **no auto-apply path for hooks/adapters exists** (G11 stays a verified control).
- Routing decisions replay byte-identical with weights injected.
- A created/merged skill demonstrably passes through the guard before first execution.
- Shared artifacts are scrubbed/generalized through the §19 #5 serializer; the opt-out is honored; **nothing
  user-specific egresses** (property test on the share path).

**Est. 5–6 PRs.**

---

## Phase 6 — L5 full shell (0.5.x)

**Goal:** inbound approval and guest→host inversion — Lilara launches/wraps tools instead of only hooking inside them.

**Ordering:** approver-auth ADR → inbound channels → inversion.

**Work items**
1. **Approver-authentication ADR accepted before any inbound code.** Named threats it must answer: anti-replay and
   anti-forgery (nonce + expiry per consent prompt), approver identity binding, and re-verification of all four §8
   invariants over a remote transport.
2. Inbound channels (the deferred half of §14) implementing that design.
3. Guest→host inversion: Lilara as launcher, every launched tool wrapped by its adapter — explicitly dependent on
   Phase 3's integrity hardening (§23.A design flag: a larger executed surface needs a hardened core first).

**Definition of done**
- The four §8 invariants re-proven over remote transport (tests).
- No inbound code path merged before the ADR's acceptance date (git history check).
- A launched tool's actions demonstrably route through its adapter + the guard.

**Est. 4–6 PRs.**

---

## Phase 7 — L3 self-improvement (0.6.x) — LAST layer

**Goal:** the reflection loop, suggestion-only, structurally unable to weaken the guard. It is the integrating face of
the **one improvement engine** (§12, decision 7): it draws on all four sources (memory, better methods, created
capabilities, weekly learning on the user's interests) under **one absolute limit — never change or bypass the guard's
red lines** (tier-(a) only with explicit user approval, never autonomously; tier-(b) never, even with approval),
enforced at runtime by the installed-core tamper floor (ADR-050, decision 11).

**Work items**
1. Post-task + end-of-day reflection producing proposals only (skills/routing-weights/prompt-config refinements per
   §12's auto-improve loop). Reflection **consumes the friction telemetry** (ACCEPTED §19 #15) alongside task
   outcomes: P2-violation events and operator-marked false stops are prime "could this have been done better?"
   inputs — and the resulting refinements remain suggestion-only, through the guard.
2. Mutable surface = **enumerated allowlist** (prompts / config / memory-weights, §12) enforced by test; core code and
   hooks/adapters are structurally out of reach — there is **no apply API**.
3. Every proposal passes the floors + consent like any other action; Phase 3's laundering gates already standing.

**Definition of done**
- Test: the mutable-surface allowlist is enforced (attempting to propose outside it is rejected structurally).
- Inviolable-tier unreachability green with the L3 source class added.
- No L3-originated change can merge without the same human review as any PR (process + structural check).

**Est. 4–5 PRs.**

---

## Phase 8 — §23.A control-plane UI real build (after the core; owner-gated)

**Goal:** the registered-tools / launch / live-queue control surface per `references/UI-DESIGN.md` — the **desktop
control-plane**, one of the **three product forms** (decision 10, §14/§23.A, now a `[LOCKED]` direction): (1) plugin
(the full value stack — skills + agents + hooks + memory improvement + guard), (2) standalone tool/agent, (3) this
control-plane that registers and runs other tools. **Live-visibility is required** — the user **SEES** a wrapped tool's
task happen, never in the background. **Web dashboard preferred.**

**Preconditions:** Phase 6 approver-auth (mutating endpoints are a different security class from the read-only
dashboard); **Q6 DECIDED (2026-06-12): the existing `dashboard-server.js` IS the seed** — the control plane builds on
its audited zero-dep, redaction-fail-closed substrate, read-only until this phase; explicit owner go (the standing
instruction: UI real build waits for it).

**Work items:** per UI-DESIGN.md — web surface (narrow-only until auth, then approve behind auth), TUI (consent on the
controlling TTY), tools registry + adapter-wrapped launch, **live queue with live-visibility** (the user watches each
wrapped-tool action as it happens) from journal/session state. The plugin and standalone forms (decision 10) reuse the
same adapter substrate + guard.

**Definition of done:** every mutating endpoint sits behind approver-auth; the narrow-only rule is enforced by tests;
the guard fronts 100% of launched-tool actions; UI-DESIGN.md's acceptance checklist green.

**Est. 6–8 PRs.**

---

## Cross-cutting tracks

- **§23.B study-and-rewrite:** for each studied repo — license identified and committed as a dated artifact BEFORE any
  source contact; copyleft/BSL/source-available → owner flag first; behavior in, original code out (clean-room). Feeds
  Phase 2 (Hermes) and Phase 5 (skills/agents prior art).
- **Red-team as release gate:** the adversarial corpus + nightly tracks stay release-blocking; every new floor or
  posture flip adds adversarial entries in the same PR.
- **Perf SLO:** bench gate green on every PR; the §18 `[CC-PROPOSED]` SLO (p50 ≤ 1 ms Linux/macOS) promotes to
  `[LOCKED]` if the owner adopts it.
- **Weekly competitive loop** (§1): research → gap-find → redesign-better, under the same clean-room rule.
- **Standing constraint (owner-decided Q6):** the existing dashboard stays **read-only** until Phase 8 — and it IS the
  seed the Phase-8 control plane builds on.
- **Friction telemetry (SCOPE §19 #15 — ACCEPTED `[LOCKED]` by owner 2026-06-12):** local-only / zero-egress anti-nag
  metrics — prompts per task, **re-prompts inside a granted scope (a P2 defect, target ZERO)**, grant-to-first-action
  time, operator-marked false stops. Delivery: harness-level counts in Phase-1 calibration reports → durable counters
  in Phase 4 (L2, through the §19 #5 egress-serializer allowlist) → consumed by Phase 5 (L4 outcome learning) and
  Phase 7 (L3 reflection), always as guard-routed suggestion-only proposals (never auto-applied). Feeds the ADR-049
  graduation gates: a floor that would nag fails graduation even at zero FP.
- **Approved-destinations contract & weekly re-confirm (decisions 13/14, §8/§11):** the default-deny egress contract is
  a standing surface — a weekly reminder re-confirms the approved-destination list; the ritual lands with Phase 3.5 and
  persists thereafter.
- **Artifact-sharing scrub (decision 15, §16):** every shared product-improvement artifact passes the §19 #5 serializer
  (scrubbed + generalized of user-specifics); default-on, universal opt-out, never user data.
- **Privacy is never paywalled (decision 16, binding):** all privacy controls (the artifact-sharing opt-out, retention
  pruning, destination approval) are free for every user, free and paid — never a feature tier.

## Consolidated owner-decision queue

| When | Decision | Blocks | Status |
|---|---|---|---|
| P0 | ADR-048 F4 demotion design | F4 posture work | open |
| P0 | LICENSE + D23 trademark | public launch | open |
| P0 | §19 #4 — HX1/HX2 deterministic meaning | Phase 1 slices | **DECIDED 2026-06-13** (ADR-051 + structured-PII split; §19 #4 CLOSED) |
| P0 | R3 intent re-verification (16 decisions + §19 batch) | SCOPE/PLAN/contract alignment | **DONE 2026-06-13** (SCOPE §25; ADR-049/051 amended; ADR-052/053 proposed; D52) |
| P3.5 | ADR-052 default-deny egress + ADR-053 structured-PII floor | Phase 3.5 build | **Proposed 2026-06-13** (decisions 6/14) |
| P3.0 | ADR-054 content seam + T1 (point (b) attachment surface) | content-red-line definitional-tier flip | **ADR-published 2026-06-21** (ADR-054) — awaiting T1 build |
| P0 | Q1 canonical sequencing | doc alignment | **DECIDED 2026-06-12** (§1.5 canonical) |
| P0 | Q6 dashboard-as-seed | Phase 8 shape | **DECIDED 2026-06-12** (dashboard is the seed) |
| P0 | Q7 tamper-floor scoping | Phase 3 item 2 | **DECIDED 2026-06-12** (ADR-050: installed guard, inviolable) |
| P0 | Q2 graduation policy (umbrella) | Phase 3 item 4 | **DECIDED 2026-06-12** (ADR-049) |
| P1→P3 | Per-flip posture graduations (under ADR-049; incl. §19 #9 F23) | each default flip | open — one ADR + owner sign-off per flip |
| P3 | §19 #14 posture-as-input migration | replay hardening approach | open |
| P8 | UI real-build go | Phase 8 start | open |

*End of plan. Sequenced per SCOPE §1/§1.5; nothing here relaxes a `[LOCKED]` decision — where a phase touches one, the
work item is the owner question, not the change.*
