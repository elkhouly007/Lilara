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
| 3 | L1 completeness: laundering gates → tamper floor → posture graduation | 0.2.4 | P1 budgets; owner Q2/Q7 |
| 4 | L2 memory (privacy-by-construction first) | 0.3.x | P3 gates standing |
| 5 | L4 orchestration | 0.4.x | P4 (L4 depends on L2) |
| 6 | L5 full shell: approver-auth → inbound → guest→host inversion | 0.5.x | P3 integrity hardening |
| 7 | L3 self-improvement (suggestion-only) — LAST layer | 0.6.x | P3 gates + P4 wiring |
| 8 | §23.A control-plane UI real build (web + TUI) | after core | P6 approver-auth; owner go |

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
5. **Owner-decision packet** (one review session): ADR-048 (F4 demotion), LICENSE choice (G13), D23 trademark, SCOPE
   §19 #4 (what HX1/HX2 deterministically mean — **blocks Phase 1 slice definitions**), §19 #9 (F23 posture), Q1
   (canonical sequencing), Q2 (posture graduation roadmap), Q3 (advisory-classifier naming), Q6 (dashboard as §23.A
   seed?), Q7 (tamper-floor scoping vs the dogfood trap).

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

**Preconditions:** owner answer to §19 #4 (the deterministic guarantee is the credential/secret subset; remainder owned
by enforcement point (b)) — without it HX1/HX2 slices are unfalsifiable.

**Work items**
1. Implement ADR-019 (eval-corpus shape coverage) — closes its Proposed status.
2. Named slices: `hx1-secret-egress` (F27 single-call + F28 cross-call), `hx2-machine-egress` (modeled sinks), 
   `hx3-delete-coord` (F29 + snapshot evidence). Each slice declares the **flags-on measurement posture**
   (`LILARA_TAINT_EGRESS=1`, `LILARA_DELETE_COORD=1`, consent transport in fail-closed-block) — at defaults two of the
   three exceptions are inert and measurement would be degenerate.
3. Provisional FP/FN budgets committed as a versioned artifact (under `evals/` or `artifacts/`), wired into
   `lilara-cli.sh pre-push` as an advisory gate first.
4. OpenClaw real-run calibration pass (the adapter exists — do not serialize this behind Hermes): unattended runs with
   seeded hard-exception probes; separate duration-class floor stops (F11/F14b) from hard-exception counts.
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
2. **Then the runtime safety-core-write floor** (if owner approves §19 #1 per Q7 scoping): landing it second means the
   floor's own lattice-hash rebaseline is the first baseline change exercised *under* the new gate. New floor =
   additive replay-corpus entries (never mutations), inviolable-tier tests extended, bench gate green (hot-path cost).
3. **Replay-posture hardening before any default flip** (SCOPE §19 #14): pin `LILARA_TAINT_EGRESS`,
   `LILARA_DELETE_COORD`, `LILARA_KILL_CHAIN_ENFORCE` in `scripts/replay-decisions.js`; add a posture-matrix replay
   (corpus green under both postures); optionally migrate posture into `decide()` input per the ADR-046 pattern.
4. **Default-posture graduation** (Q2): one ADR + owner sign-off **per flip** (each touches the §18 `[LOCKED]`
   warn-class invariant's operational meaning), gated on Phase 1/2 measured budgets.

**Risks:** the tamper floor's dogfood trap (Q7) — do not pre-commit to "inviolable runtime floor" before the owner
resolves scoping; a wrongly-scoped floor would fire on every legitimate dev edit of Lilara itself.

**Definition of done**
- Laundering gate green across the very baseline update that lands the new floor.
- Posture-matrix replay green; replay harness pins all three flags.
- Each flipped default has its own ADR with owner sign-off recorded.
- Unreachability tests extended to any new source class; bench gate green.

**Est. 4–5 PRs.**

---

## Phase 4 — L2 memory (0.3.x)

**Goal:** the memory layer lands with privacy architectural from day one — the boundary exists before the data does.

**Ordering inside the phase:** serializer → egress inventory → wiring → product features.

**Work items**
1. **Typed allowlist-only egress serializer first** (SCOPE §19 #5, generalizing the `KEEP_KEYS` pattern): the *only*
   path by which anything memory-derived crosses a process boundary; fail-closed property test — no field outside the
   allowlist can serialize.
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
6. Retention policy implementation (SCOPE §19 #11): journal = auditable long-term record (redaction tooling exists:
   ADR-041/045); grants/tokens = operator-managed revocation; snapshots/telemetry = explicit CLI pruning, never
   automatic deletion of audit material.
7. Product features (task/outcome history, end-of-day summary) — only after 1–6.

**Definition of done**
- All pre-existing corpus `irHash` values byte-identical.
- Serializer fail-closed property test green; egress inventory committed with per-path serializer coverage.
- Memory-source unreachability test green; memory entries carry provenance tags.
- Nothing memory-derived leaves the machine (verified by the inventory + serializer tests).

**Est. 5–6 PRs.**

---

## Phase 5 — L4 orchestration (0.4.x)

**Goal:** the locked capability set (§13): cheap deterministic auto-select, multi-skill merge/compose, auto-create
skill/agent — every product an UNTRUSTED proposal through the guard.

**Work items**
1. Skill-catalog format + deterministic, low-token auto-select (extends intent-classifier/route-resolver lineage).
2. Merge/compose of multiple skills into one task plan; auto-create skill/agent when none fits — all emitted as
   **untrusted proposals that pass the floors + consent before running**.
3. Outcome-feedback learning: weights are mutable state → **injected inputs** to any routing decision that is
   journaled/replayed (same replay-safety pattern as Phase 4).
4. Hooks/adapters: propose-only forever — the auto-apply path must not exist structurally.

**Definition of done**
- Negative test: **no model call exists in the routing path** (§13 `[LOCKED]` "never a big model per route").
- Negative test: **no auto-apply path for hooks/adapters exists** (G11 stays a verified control).
- Routing decisions replay byte-identical with weights injected.
- A created/merged skill demonstrably passes through the guard before first execution.

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

**Goal:** the reflection loop, suggestion-only, structurally unable to weaken the guard.

**Work items**
1. Post-task + end-of-day reflection producing proposals only (skills/routing-weights/prompt-config refinements per
   §12's auto-improve loop).
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

**Goal:** the registered-tools / launch / live-queue control surface per `references/UI-DESIGN.md`.

**Preconditions:** Phase 6 approver-auth (mutating endpoints are a different security class from the read-only
dashboard); owner Q6 answer (dashboard-as-seed vs separate surface); explicit owner go (the user's standing
instruction: UI real build waits for it).

**Work items:** per UI-DESIGN.md — web surface (narrow-only until auth, then approve behind auth), TUI (consent on the
controlling TTY), tools registry + adapter-wrapped launch, live queue from journal/session state.

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
- **Standing constraint:** the existing dashboard stays **read-only** until Phase 8.

## Consolidated owner-decision queue

| When | Decision | Blocks |
|---|---|---|
| P0 | ADR-048 F4 demotion design | F4 posture work |
| P0 | LICENSE + D23 trademark | public launch |
| P0 | §19 #4 — HX1/HX2 deterministic meaning | Phase 1 slices |
| P0 | Q1 canonical sequencing | doc alignment |
| P0 | Q6 dashboard-as-seed | Phase 8 shape |
| P0 | Q7 tamper-floor scoping | Phase 3 item 2 |
| P1→P3 | Q2 / §19 #9 — per-flip posture graduations | each default flip |
| P3 | §19 #14 posture-as-input migration | replay hardening approach |
| P8 | UI real-build go | Phase 8 start |

*End of plan. Sequenced per SCOPE §1/§1.5; nothing here relaxes a `[LOCKED]` decision — where a phase touches one, the
work item is the owner question, not the change.*
