# ADR-050 — Runtime tamper floor: scoped to the installed guard, inviolable

**Status:** Accepted (design decision) — owner (Khouly) decision Q7, 2026-06-12
**Date:** 2026-06-12
**Scope:** design decision only — implementation lands in PLAN Phase 3 (after the §19 #6 policy-laundering gates), as
its own reviewed PR with lattice rebaseline, tests, and replay-corpus extension

---

## Context

SCOPE §3/§7 name `TAMPER_WITH_SAFETY_CORE` as an absolute floor, but the codebase enforces the *property* (the safety
core cannot be weakened) only at build/review time: the hash-pinned lattice baseline
(`artifacts/lattice-baseline.sha256`), structural unreachability (`demotableBy: []` + `assertOrdered()`), and the CI
gate `scripts/check-inviolable-tier.sh`. There is **no runtime floor** that fires when an agent attempts to modify the
safety-core itself during a session (SCOPE §19 #1, GAP G6). The rationale for wanting one is real: a long-running
unattended agent can edit core source *between* CI runs — the build-time gate does not stop the action in-session.

The blocker was the **dogfood trap** (SCOPE §24 Q7): the owner is customer #1 and develops Lilara *with* Lilara. A
runtime floor over writes to `runtime/floor-*.js` / `runtime/decision-lattice.js` in the **dev checkout** would fire on
every legitimate edit of Lilara's own source.

## Decision

1. **Scope: the INSTALLED guard footprint under `~/.lilara` — NOT the dev checkout.** The floor guards the files the
   *running* guard actually loads and trusts (installed runtime modules, baselines, state the guard's integrity
   depends on). The development repository remains editable like any project; the owner can work on Lilara's source
   freely. The exact protected path-set is enumerated at implementation time from what the installed guard loads —
   defined in the Phase-3 implementation ADR/PR, not guessed here.
2. **Tier: INVIOLABLE — explicitly NOT consent-demotable.** `tier: "inviolable"`, `demotableBy: []`. A demotion path
   on the tamper floor is precisely what an attacker would target, and it would void §7's "absolute" property. No
   contract, consent, learned, or operator-token source can demote it. (Legitimate updates of the installed guard go
   through the installer/upgrade path, which is the operator acting on the host outside an agent session — the
   host-trust boundary, SCOPE §21 — not through an agent-session demotion.)
3. **CI hash-baseline stays — defense-in-depth.** The source-repo gate (`check-inviolable-tier.sh` + lattice baseline)
   continues to protect the *source of truth* at review time; the runtime floor protects the *installed instance*
   in-session. Two layers, different failure modes.

## Implementation constraints (binding on the Phase-3 PR)

- **Ordering:** lands AFTER the §19 #6 policy-laundering/monotonic-baseline gates, so the floor's own lattice-hash
  rebaseline is the first baseline change exercised *under* the new gate (PLAN Phase 3 ordering).
- **Purity + replay:** the floor decides on the canonical Action-IR's file targets (pure inputs), like every other
  floor; replay corpus is **extended** with new entries (existing entries are never mutated); all pre-existing
  `irHash` values stay byte-identical; bench gate green (hot-path cost is bounded).
- **Unreachability tests extended** to cover the new floor (no source class can demote it).
- **Naming:** the floor code/name is assigned at implementation (next free floor number); SCOPE Appendix A and the
  lattice note cite this ADR.
- **P1/P2 check (SCOPE §0.1):** the floor must not create friction for normal work — it fires only on writes to the
  installed-guard footprint, which no legitimate coding task touches; a legitimate guard upgrade goes through the
  installer. If real-run calibration shows it firing on legitimate work, the protected path-set is wrong and gets
  fixed — the floor's tier does not.

## Consequences

- SCOPE G6 gets a closure path; §19 #1's open question is resolved; the §22 row (e) residual shrinks once built.
- Until Phase 3 lands, the interim control from PLAN Phase 2 applies: lattice-hash bookend verification at the start
  and end of multi-day measurement runs.
