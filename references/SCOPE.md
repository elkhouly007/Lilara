# Lilara — Authoritative Project Scope

> **This is the single source of truth for *what Lilara is meant to be*.** It consolidates and supersedes the scope
> material previously scattered across `references/strategy-2026-05-31-scope-refresh.md`,
> `references/lilara-contract.md`, `references/full-power-roadmap.md`, `ROADMAP.md`, `DECISIONS.md`, and the ADR set.
> The **agreed vision leads**; the per-item **Status** blocks are the reality check against the current codebase. Where
> code and vision disagree, the delta is recorded as a **GAP** — the vision is *not* bent to match the code.
>
> **Neutral-language mandate (binding on this file):** the safety philosophy is expressed only as universal behavior —
> "no ultimate harm," harm-to-others vs. harm-to-self. There are **no religious or ideological labels anywhere** in this
> document or in the code. Values generate the enumerated floor list; code and docs express only behavior.

**Status snapshot:** VERSION `0.2.1` · master `c85e0d3` · 2026-06-13 · 6 adapters · 30 lattice floors (F1–F21, F23–F29,
plus F14b and F18-D007) · 2 non-lattice signals (F22 registry-only, F23b PostToolUse signal — see Appendix A note).
*(R3 re-verification 2026-06-13 — §25; no new floors built this revision, so the count is unchanged.)*

---

## Legend

**Implementation status** (one per major element):

| Label | Meaning |
|---|---|
| **BUILT** | Implemented in code, wired end-to-end, and gated/tested. |
| **PARTIAL** | Some of the element exists; a named piece is missing or not wired. |
| **NOT-YET** | Intentionally not built yet (scheduled for a later layer/version). |
| **GAP-vs-vision** | The code's reality diverges from what the vision asks for. Recorded as a delta, not reconciled away. |

**Decision tags** (preserved exactly from the agreed scope; never silently promoted/demoted):

| Tag | Meaning |
|---|---|
| `[LOCKED]` | Owner-decided. Settled. Not re-litigated here. |
| `[ADVISORY]` | A strong recommendation, not yet a hard decision. |
| `[OPEN]` | Undecided. Still a question. |
| `[CC-PROPOSED]` | An addition introduced by this document (Claude Code). **Extends** the agreed scope; reviewable and accept/reject-able individually. Never overrides a `[LOCKED]` item — where a proposal would touch one, it is raised as `[OPEN]` with reasoning. |

**GAP-register severity scale `[CC-PROPOSED]`** (used in §20; previously undefined):

| Severity | Meaning |
|---|---|
| **High** | The vision promises a protection or behavior a user might rely on that exists in no form. |
| **Med-High** | Partially exists; the missing part is user-visible or required by a committed DoD. |
| **Med** | The property holds by other means; the named artifact or mechanism is absent. |
| **Low** | Hygiene / process debt; no protection gap. |
| **n/a (control)** | Not a gap — a verified control recorded for completeness. |

---

## 0. What Lilara is

**Mission `[LOCKED]` (owner-set 2026-06-12; re-verified and amended 2026-06-13): Lilara exists to make its users MORE
PRODUCTIVE and to keep them SAFE — powerfully, as one promise.** It is not a guard that limits; it is a productivity
multiplier whose safety is what lets the user move fast without fear. **Productivity and security are CO-EQUAL: a Lilara
that slows real work down has failed, and a Lilara that lets the user be harmed has failed — neither is in service of
the other.** Every design decision is judged by one test: *does this make a real user get more done, safely?*
**Tie-breaker at a genuine conflict:** security wins ONLY when an action crosses into something the user did **not**
consent to — above all leaking his data to a party he did not approve, or destroying data beyond what he authorized.
Inside a granted scope, productivity rules: the agent runs freely and is never nagged.

**Why Lilara exists.** Powerful agent repos, skills, and tools appear constantly, and users install them **blindly** —
running unknown code with broad authority and no idea what leaves their machine. Lilara collects those capabilities,
**redesigns and rewrites them clean-room**, and delivers them in a place that is safe by construction: **full power AND
safety, never a trade-off between them.** The user's #1 fear is the real one — *data exfiltrated without him knowing.*
So the central guarantee is concrete: **the user's data stays local; it leaves only to destinations he has approved;
every change is surfaced for review; and a weekly reminder re-confirms the approved-destination list.** Prompt-injection
defense is load-bearing precisely because injection is the attack that would break that contract (§9, §14).

Zero-dependency Node runtime guard for AI coding agents → growing into a trustworthy bounded-autonomy platform. GitHub
`elkhouly007/Lilara`. Name: **Lilara / ليلارا**. Identity: an impressive, smart guard that grows and improves with you.
**Safety philosophy: safety exists to REDUCE the user's steps, not add gates.** Customer #1 is the owner himself — the
product he uses *is* what customers get.

### 0.1 First-order design tenets `[LOCKED]` (owner-set 2026-06-12)

Principles 1 and 2 exist to serve Principle 0. Every section of this document, every ADR, and every phase of
`references/PLAN.md` is bound by these three:

- **P0 — The mission.** Make the user more productive AND keep him safe — **co-equal halves of one promise.** A safety
  mechanism that reduces real productivity without preventing a genuine harm is **wrong and must be redesigned**;
  equally, a productivity gain that exposes the user to a harm he did not accept is **wrong**. Neither half is
  subordinate to the other. The only tie-breaker is the **consent boundary**: security wins when, and only when, an
  action crosses into territory the user did not authorize (above all, his data leaving to an unapproved party, or
  destruction beyond what he authorized — never his own in-scope work).
- **P1 — Security must ENABLE work, not block it.** A guard that is safe but slows the agent down or blocks legitimate
  work is a **failure**. Optimize for "approve-once, then run freely," never for friction.
- **P2 — The consent contract (anti-nag).** A granted scope is a contract: inside it the agent works FREELY and is
  **never** re-asked for approval. Re-prompting inside an already-granted scope is a **defect, not a safety feature**.
  The agent halts only at genuine hard exceptions (the inviolable tier). Mechanism: ADR-035's one-time scoped grant /
  pre-authorized-scope model — grant once, run within bounds, stop only at real red lines (§8).

**Status — BUILT (guard core).** Zero external dependencies confirmed: there is no root `package.json`; every runtime
module uses Node built-ins only (`fs`, `path`, `crypto`, `https`, `net`, `tls`). The deterministic guard
(`runtime/decision-engine.js`, the lattice in `runtime/decision-lattice.js`, the floor set in `runtime/floor-codes.js`)
is real and shipping at 0.2.1. The "bounded-autonomy platform" beyond the guard core (memory, skills, self-improvement,
shell) is **NOT-YET** — see §11–14.

---

## 1. North-star — five layers on one strong core `[LOCKED]`

1. **L1 — Security core (the contract).** Bounded-authority runtime guard, fail-closed. User pre-approves
   action-classes that run WITHOUT returning to them, except fixed hard exceptions (personal data leaving to an external
   party = no; personal data leaving the machine = no; deletion without coordination = no).
2. **L2 — Very strong memory.** Learns the user's patterns deeply from every task and at the end of each day, so that
   **over time it comes to know the user better than he knows himself** — anticipating what he would choose before he
   asks. That ambition is the goal (earned over time, not claimed on day one), and it **coexists** with an
   unconditional user-sovereignty guarantee: memory is local, inspectable, and erasable, and the user is always
   sovereign over what is remembered. *(Ambition restored by owner decision 2026-06-13, reversing the 2026-06-12 Q5
   softening that had read it as overreach — see §24/§25.)*
3. **L3 — Self-improvement.** After each task + end-of-day, reviews "could this have been done better?" then modifies
   itself. HIGHEST-RISK surface → built LAST, suggestion-only first, must pass through the guard, can never weaken its
   own constraints.
4. **L4 — Autonomous skill orchestration.** From a cheap catalog: auto-**SELECT** the right existing skill for a task;
   auto-select **MULTIPLE** skills and **MERGE/compose** them into ONE to accomplish a single task; auto-**CREATE** a new
   skill when none fits; auto-**CREATE a new agent** when needed; decide all of this **CHEAPLY** (low-token deterministic
   routing, never a big model per route); and always **LEARN** from each task's result (outcome feedback into the
   catalog). Every auto-created or auto-merged skill/agent is an **UNTRUSTED proposal that must pass through the guard**
   before it runs. **Hooks/adapters are the lower-trust exception:** the system may *propose* them but **never
   auto-applies** them — they are safety-boundary code and stay manual / human-approved (see §13). Depends on L2;
   sequenced LAST.
5. **L5 — The shell.** Manages live tools (Claude Code, Codex, OpenCode, Antegravity, Hermes, OpenClaw, etc.) from one
   place. Two run modes: fast-reply AND long-running (hours/days chasing a goal). Reachable via channels.

`[CC-PROPOSED]` **Hard-exception naming.** The three fixed hard exceptions in L1 above are referred to elsewhere in this
document by stable IDs: **HX1** = personal data leaving to an external party; **HX2** = personal data leaving the
machine; **HX3** = deletion without coordination. (Naming only — the locked wording above is the definition.) HX1–HX3
are the content-blind Node guard's deterministic **mechanical** stops — *not* the product's ethical red lines. The
guard's deterministic egress guarantee covers two structured subsets: the **credential/secret subset (F27/F28)** and a
near-term **bulk structured-PII subset** — emails, phone numbers, national/residence IDs, credit-card numbers, and
IBANs above a threshold (a NEW deterministic floor reusing the F27/F28 egress mechanism; owner decision 2026-06-13,
scheduled in PLAN, not yet built). Only **unstructured / contextual** PII (a name in free prose) is routed to
enforcement point (b) (the content layer), not covered by the content-blind guard. Under the default-deny egress model
(§8 approved-destinations contract, §21), the **destination gate is primary** and these structured-PII / credential
floors are **defense-in-depth**. The product's inviolable *content* red lines live at point (b) (§7), never in this L1
list. (Owner decisions 2026-06-13 — ADR-051 §19 #4 reconciliation + the structured-PII split, §19 #4 amended.)

**Build order `[LOCKED]`:** L1 (consent) → thin L5 consent transport → L2 memory → L4 skills → L3 self-improvement LAST.
**Moat = the CORE.** Orchestration + shell are commodity.

**Weekly loop:** two strands of the one improvement engine (§12/§13) — (1) research competitors + free/OSS communities
to find capability gaps, and (2) learn on the **user's own interests**. Both feed self-improvement. **NEVER copy-paste —
always redesign and rewrite better** (also the clean-room path protecting the no-AGPL/GPL/SSPL/BSL rule).

**Data ethic:** only collect data that improves the product; never steal customer data. Privacy must be ARCHITECTURAL
("we physically can't send your content"), not a promise.

**Status by layer:**

| Layer | Status | Evidence |
|---|---|---|
| L1 Security core | **BUILT** | Consent gate (ADR-035) + lattice + 29 floors live at 0.2.1. |
| L5 Shell | **PARTIAL** (outbound only) | `runtime/notify/*.js` one-way notify shipped; inbound channels deferred; guest→host inversion not started. |
| L2 Memory | **PARTIAL** (framework, not wired) | `runtime/session-memory.js`, `runtime/memory-search.js` exist; not integrated into `decide()`. Scheduled 0.3.0. |
| L4 Skills | **PARTIAL** (static routing only) | `runtime/intent-classifier.js`, `runtime/route-resolver.js`, `runtime/skill-scorer.js` (audit-only); no auto-merge/create. |
| L3 Self-improvement | **NOT-YET** | No reflection/self-modify code (by design — built LAST). |

Build-order is being honored: L1 is done and the L5 *consent transport* slice shipped with it; L2 is next.

### 1.5 Canonical sequencing & layer dependencies `[LOCKED]` (owner-confirmed Q1, 2026-06-12)

This block exists because the document previously said "sequenced LAST" about three different things (§1: L3; §13: L4;
§14: guest→host inversion) and §15 orders full L5 between L4 and L3. **One reading reconciles all four** — recorded here
as the single canonical statement; §13/§14/§15 point here instead of carrying their own ordering claims. *Owner-confirmed
as canonical (Q1, 2026-06-12): L1 (done) → L2 → L4 → full L5 (guest→host) → L3 absolutely last → §23.A UI after all.*

```
L1 security core ──► thin L5 (consent transport only) ──► L2 memory ──► L4 skills ──► full L5 shell ──► L3 (LAST)
                                                                                                          │
                                §23.A control-plane UI real build comes after all of the above ◄──────────┘
```

Dependencies (the load-bearing constraints, previously implicit):

- **L4 → L2:** context-driven skill selection needs the memory layer's task/outcome history.
- **L5 inbound channels → approver-authentication design:** no remote approval before the §8 invariants are re-proven
  over a remote transport (anti-replay, anti-forgery).
- **Full L5 guest→host inversion → safety-core integrity hardening:** per §23.A's design flag, Lilara-as-launcher widens
  the host-trust boundary, so baseline tamper-resistance work precedes it.
- **L3 → standing regression gates:** the §19 #6 policy-laundering / gradual-weakening gates must be live *before* the
  first L3 code lands — and they are load-bearing earlier than L3: L4's outcome-feedback learning already introduces a
  learned source, which is the exact surface the self-mod unreachability test exists for.

"Sequenced LAST" in §13 and §14 reads as "late in the order, after L2" — only **L3 is absolutely last** among the
layers, and the §23.A control-plane real build comes after the safety core entirely.

---

## 2. The inviolable first-law `[LOCKED]`

**First, do no ultimate harm, no matter the goal.** Ranks above everything. It **GENERATES** the enumerated floor list —
it is NOT itself a runtime "do no harm" judgment call by a model (that would be non-deterministic). No
ideological/religious labels anywhere in code; values generate the list, code expresses only behavior.

**Status — BUILT (as a generator), correctly realized.** The codebase contains *no* runtime model-judgment "harm check."
Harm is enforced only through the closed, enumerated floor set (`runtime/floor-codes.js`) evaluated deterministically in
`runtime/decision-engine.js`. This matches the vision: the first-law is a *design principle that produced the list*, not
a runtime classifier. Neutral-language requirement is met in code — the floor names describe behavior
(`secret-egress-external`, `destructive-delete-coord`, …), not values.

---

## 3. Two-tier safety `[LOCKED]`

- **Tier (a) — the contract:** user-configurable scoped-consent grant.
- **Tier (b) — inviolable core:** a closed, ENUMERATED, hash-verified, code-resident hard-stop list. Refuses even if the
  user authorizes; NOT configurable; NOT reachable by self-improvement. Protected by `TAMPER_WITH_SAFETY_CORE`.

**Status — BUILT, with one naming/coverage GAP.**

- **Tier (a):** BUILT. The contract (`runtime/contract.js`, `CONTRACT.md`) plus the scope-based consent gate (ADR-035,
  `runtime/consent/`, `runtime/floor-consent.js`) implement the user-configurable grant. See §8.
- **Tier (b):** BUILT. The inviolable tier is real and provably closed in `runtime/decision-lattice.js`: every inviolable
  floor carries `tier:"inviolable"` with `demotableBy:[]`; `assertOrdered()` throws if an inviolable floor ever gains a
  demotion source; `computeLatticeHash()` pins the whole lattice against `artifacts/lattice-baseline.sha256`; CI gate
  `scripts/check-inviolable-tier.sh` enforces the baseline; and two unreachability tests prove no contract/learned/
  consent/operator source can reach an inviolable floor
  (`tests/decision-lattice/inviolable-contract-unreachability.test.js`,
  `tests/decision-lattice/inviolable-selfmod-unreachability.test.js`).
- **GAP-vs-vision — `TAMPER_WITH_SAFETY_CORE` is a property, not a floor.** A repo-wide search for the literal
  `TAMPER_WITH_SAFETY_CORE` returns **no match**. The *property* the name promises (the core cannot be weakened) is
  enforced — but by **build/CI-time hashing + structural unreachability**, not by a **runtime action floor**. There is no
  runtime floor that fires when an agent attempts to *modify the safety-core source itself* (e.g. editing
  `runtime/decision-lattice.js`, `runtime/floor-codes.js`, `runtime/floor-*.js`, or `artifacts/lattice-baseline.sha256`)
  during a task inside the project root; such a write is governed only by the general file-write floors. → §19 #1.
  **Scoping decided (Q7, 2026-06-12 — ADR-050):** runtime floor over the *installed* guard under `~/.lilara` (not the
  dev checkout), inviolable, never consent-demotable; CI hash-baseline stays as defense-in-depth. This floor is also the
  **runtime enforcement of the self-improvement absolute limit** (§12, decision 7, 2026-06-13): a self-improving agent
  structurally cannot modify the installed guard.

---

## 4. Enforcement model — who the victim is `[LOCKED]`

- **HARM_OTHERS → hard block,** non-demotable even by signed contract. Fires ONLY when the victim is *established*, via
  (a) definitional to the action class, or (b) deterministic detection (another person's secrets/PII/credentials in
  payload). The user is sovereign over himself and has NO authority to consent away a third party's rights.
- **HARM_SELF → warn + persuade ONCE** (no nagging, no manipulation), then obey — the contract stays sovereign over the
  user's own domain. **Two carve-outs:** (a) suicide / self-harm *methods* → full refusal + crisis resources (the §7
  absolute exception; do NOT obey); (b) **wholesale or irreversible wipe of the user's OWN data** → **not a block and
  not a red line** — take a recoverability **snapshot + ONE confirmation** (reusing the existing **F29**
  deletion-coordination mechanism), then **execute**. Carve-out (b) is a HARM_SELF confirmation step, not a floor —
  §7's absolute tier is untouched, and at default posture F29 is flag-gated off (§18), so this protection is active
  only once delete-coordination is enabled (tracked honestly in §20). *(Owner decision 2026-06-13.)*
- **"No block on suspicion" rule:** the core NEVER blocks on *suspicion* of a victim. If harm-to-others is not
  established (definitional or deterministic), there is no presumed victim and no block — fall back to the contract.
  Verifying a self-affecting action is allowed; conjecturing a victim is forbidden (the model-as-harm-judge trap,
  rejected).

**Status — GAP-vs-vision (largest single delta).** The HARM_OTHERS / HARM_SELF *enforcement model is not represented in
code.* A repo-wide search for `HARM_OTHERS` / `HARM_SELF` / victim-classification returns **no match**. What exists:

- The *only* hard-stop that touches multi-party harm is credential/key-class **egress** — F27 single-call
  (`runtime/floor-secret-egress.js`) and F28 cross-call (`runtime/floor-taint-egress.js`). These are **content-blind**:
  at the deterministic tool boundary a third party's data is byte-identical to the user's own, so they key on *"credential
  material → external host,"* not on *whose* data it is. ADR-036 states this scope limit explicitly and **defers the
  broader third-party-harm ("Pillar-B") detection to a future content-inspection seam.**
- The HARM_SELF behavior — "warn + persuade once, then obey" — has **no implementation**. The engine has warn/escalate
  classes but no "persuade-once-then-obey-the-user-over-his-own-domain" path distinct from the general lattice.
- The "no block on suspicion" rule is honored *implicitly* (every floor is definitional or deterministic; nothing blocks
  on model-inferred intent) — but there is no explicit victim-establishment predicate, because there is no
  victim-classification layer at all.

The vision is preserved verbatim above; the code reality is that **victim-aware enforcement is doc-only**, realized today
only as the credential-egress subset. **Honest scope (owner decisions 2026-06-13 — ADR-051 closing §19 #4, plus the
structured-PII split):** the deterministic egress guarantee is the **credential/secret subset (F27/F28)** today, and a
near-term **bulk structured-PII floor** (emails / phone numbers / national-residence IDs / credit cards / IBANs above a
threshold — same egress mechanism, scheduled in PLAN, not yet built). HX1/HX2/HX3 are the content-blind guard's
deterministic *mechanical* stops, not the product's ethical red lines. Only **unstructured / contextual** third-party
PII carries no ownership signal at the tool boundary and is **routed to enforcement point (b)** (`CONTENT-CONTRACT.md`),
never implied as covered by the content-blind guard. Under default-deny egress (§8/§21) the destination gate is primary
and these floors are defense-in-depth. The product's inviolable *content* red lines live at point (b)'s absolute tier
(§7), not in this L1 model.

---

## 5. Three enforcement points (the Node guard is honestly BLIND to content) `[LOCKED]`

1. **Deterministic action guard (Node, zero-dep)** — stops ACTIONS with a signature (exfil, unauthorized access,
   malware-execution behavior, deletion).
2. **Model content contract (generation layer)** — model instructed to REFUSE forbidden content; the Node guard is
   structurally blind here.
3. **Action-gating: deterministic lattice precedence + consent gate (fail-closed)** — gates irreversible external
   actions (publish/upload/deploy); can only escalate-to-human or block, NEVER auto-allow, never weaken a floor.
   *(Renamed from "fail-closed advisory classifier" by owner decision Q3, 2026-06-12. Determinism is hereby a design
   principle: deterministic = replayable = auditable — a probabilistic classifier here would break byte-identical
   replay and add false positives. The rename does NOT close enforcement point (b): the model content contract remains
   genuinely unbuilt and stays tracked as G2.)*

**Status:**

| Point | Status | Evidence |
|---|---|---|
| (a) Deterministic action guard | **BUILT** | All floors fire in `runtime/decision-engine.js`; signatures for exfil (F19/F27/F28), unauthorized access (F17), MCP danger (F25/F26), deletion (F29). |
| (b) Model content contract | **PARTIAL** | **Artifact exists:** `references/CONTENT-CONTRACT.md` (v2.0.0, 2026-06-13) encodes the clean-refusal shape, the **disclosed** decoy (fake-all-the-way-down + explicit fiction disclosure; CBRN/weapons narrative-only), and the **absolute-refusal tier** — CSAM; **sexual/nude/explicit content** (flat refusal, any subject real or fictional, no carve-out — Red Line A); suicide-method refusal + generic crisis-support — plus **Red Line B** (fabricated depiction of a real person — *reversed 2026-06-13* to a deception+harm rule, not blanket: benign edits allowed, deceptive fabrication/deepfakes + B-text defamation refused), a canonical instruction template, and a red-team checklist. **Wiring NOT-YET** — the template is not installed on any harness surface (safety-boundary change; human-approved, separate PR). See §19 #2/#4. |
| (c) Action-gating: deterministic lattice precedence + consent gate | **BUILT** | The lattice + consent gate gate irreversible external actions and can only `block` or route to `consent-required` (`enforcementFor()` in `runtime/decision-lattice.js`); `runtime/floor-consent.js` fails closed and **never auto-allows** (default route = block; any error = block). Vision naming aligned to code by owner decision Q3 (2026-06-12); the former "advisory classifier" name is retired. |

---

## 6. Content-harm categories + decoy policy `[LOCKED]`

Categories (enforced at **generation + action-gating**, NOT as deterministic Node floors): `WEAPONS_FABRICATION`,
`CBRN_HAZMAT_SYNTHESIS`, `MALWARE_CREATION`, `FACILITATE_PERSECUTION_OF_GROUP`, `ILLICIT_DRUG_SYNTHESIS`. (Sexual
content is **not** a decoy category — it is an absolute-tier refusal, §7 Red Line A; the prior
`SEXUAL_CONTENT_GENERATION` category was removed in CONTENT-CONTRACT v1.1.0.)

- **Direct request →** clean refusal + brief reason + legitimate alternative.
- **Fiction/pretext frame →** help the story, but the decoy is **disclosed, not silent** (owner decision 2026-06-13):
  (i) emit content that serves the narrative as a deliberately **NON-FUNCTIONAL plot device** — **HARD CONSTRAINT: fake
  all the way down, ZERO real dangerous specifics**; AND (ii) **explicitly tell the user it is fictional and will not
  work.** For **CBRN / weapons** in fiction, stay **narrative-only — no procedural skeleton at all** (no quantities,
  steps, or real substance names). Decoy scope = functional-harm categories ONLY. **Sexual content is NOT
  decoy-eligible** (flat refusal regardless of framing, §7 Red Line A).

**Status — PARTIAL (specified, not enforced).** The categories, the **disclosed** decoy mechanism (non-functional plot
device + explicit fiction disclosure; CBRN/weapons narrative-only), **sexual/explicit content elevated to the absolute
tier (Red Line A; the prior carve-out is removed)**, and the "fake-all-the-way-down" hard constraint are now
**specified** in `references/CONTENT-CONTRACT.md` (v2.0.0, with a canonical instruction template and red-team checklist)
— enforcement point (b) finally has an artifact (§5(b), §19 #2/#4). The Node guard remains
content-blind by design — correct and unchanged. **Generation-layer enforcement is still NOT-YET:** the template is not
installed on any harness surface, so at runtime the content-harm surface is still governed by whatever the underlying
model does on its own. Remaining delta: the wiring (G2) + dependent floors (G3).

---

## 7. The closed floor list `[LOCKED]`

**Absolute (never decoy-eligible, never demotable):** CSAM (separate top-priority, likely legal mandatory-report);
`TAMPER_WITH_SAFETY_CORE`; Suicide/self-harm methods (EXCEPTION to the HARM_SELF "warn then obey" rule — refuse method
info + surface crisis resources, do NOT obey).

**Sexual/nude/explicit content `[LOCKED]`** (enforcement point (b), absolute tier — Red Line A): not generated — flat refusal for any subject (real or fictional), in any medium; no carve-out and no medical/clinical exception; never decoy-eligible, never demotable. Enforced entirely at the content layer (`CONTENT-CONTRACT.md` §7.2), never as an L1 deterministic floor.
**Fabricated depiction of a real specific person `[LOCKED]`** (enforcement point (b) — Red Line B; *reversed 2026-06-13 from the prior blanket encoding*): the test is **output deception + harm, NOT the consent claim** — a content-blind system cannot verify "it's my photo / they consented," so that assertion is never a free pass. **REFUSE** (even when consent is asserted): sexual/intimate imagery of a real person (already Red Line A + the intimate-imagery concern); placing a real person in a **false situation that appears real** (defamation/fabrication); photorealistic **deepfakes meant to deceive**. **ALLOW** non-deceptive edits whose **output is benign** — editing the user's own photo, background swap, retouch, style. **B-text (separate rule):** refuse fabricated/defamatory **written** claims about an identifiable real person **presented as real**; allow **clearly-labelled fiction/satire**. A generic, non-identifiable person is general policy, not this red line. Enforced entirely at the content layer (`CONTENT-CONTRACT.md` §7.3, incl. its B-text sub-part), never as an L1 deterministic floor.

**HARM_OTHERS group (victim definitional or deterministically detected):** `EXFIL_PERSONAL_DATA_OF_OTHERS`,
`PUBLISH_PRIVATE_DATA_OF_OTHERS`, `PUBLISH_INTIMATE_IMAGERY_OF_REAL_PEOPLE`, `COVERT_SURVEILLANCE`,
`UNAUTHORIZED_ACCESS`, `FRAUD_DECEPTION`, `FORGERY_IMPERSONATION`, `DOS_OR_CRITICAL_INFRA_ATTACK`
(esp. hospital/power/water), `STALK_LOCATE_PERSON`.

**License rule** (AGPL/GPL/SSPL/BSL no-copy) is **NOT** a harm-floor — it is clean-room process discipline tracked
separately.

**Status — vision item → real floor mapping:**

| Vision floor | Real floor in code | Status |
|---|---|---|
| CSAM (top-priority, mandatory-report) | — | **PARTIAL / specified-only** (content-layer; absolute-refusal-only behavior specified in `CONTENT-CONTRACT.md` §7.1 — the contract encodes refusal exclusively; reporting stays an out-of-band, jurisdiction-dependent legal matter, never a Lilara egress path; no generation-layer wiring yet). |
| `TAMPER_WITH_SAFETY_CORE` | inviolable-tier *property* (no runtime floor of this name) | **PARTIAL / GAP** — property enforced at CI/build-time + structurally; no runtime floor. See §3, §19 #1. |
| Suicide/self-harm methods (+ crisis resources) | — | **PARTIAL / specified-only** (content-layer; refuse-methods + generic, non-region-specific crisis-support behavior specified in `CONTENT-CONTRACT.md` §7.4; no generation-layer wiring yet). |
| Sexual/nude/explicit content (Red Line A) | — | **PARTIAL / specified-only** (content-layer; point (b) absolute tier, `CONTENT-CONTRACT.md` §7.2 — flat refusal, prior carve-out removed; no generation-layer wiring yet). |
| Fabricated depiction of a real specific person (Red Line B) | — | **PARTIAL / specified-only** (content-layer; point (b), `CONTENT-CONTRACT.md` §7.3 — *reversed 2026-06-13:* deception+harm discrimination rule, not blanket; benign edits allowed, deceptive fabrication/deepfakes + B-text defamation refused; no generation-layer wiring yet). |
| `EXFIL_PERSONAL_DATA_OF_OTHERS` | F27 `secret-egress-external` (single-call), F28 `taint-egress-consent` (cross-call) | **PARTIAL** — only the credential/key-class subset; general personal data is not detectable at the boundary. |
| `PUBLISH_PRIVATE_DATA_OF_OTHERS` | — | **NOT-YET** (no floor distinguishes "publish" content). |
| `PUBLISH_INTIMATE_IMAGERY_OF_REAL_PEOPLE` | — | **PARTIAL / specified-only** — the sexual/intimate case is Red Line A (absolute, §7.2); the deceptive-fabrication case is Red Line B (§7.3); no generation-layer wiring yet. |
| `COVERT_SURVEILLANCE` | — | **NOT-YET**. |
| `UNAUTHORIZED_ACCESS` | F17 `cross-agent-lock` | **PARTIAL** — only the cross-agent-lock dimension; no general access-control floor. |
| `FRAUD_DECEPTION` | — | **NOT-YET**. |
| `FORGERY_IMPERSONATION` | — | **NOT-YET**. |
| `DOS_OR_CRITICAL_INFRA_ATTACK` | F3 `critical-risk` (catastrophic-command signatures) | **PARTIAL** — signature-based catastrophic ops; not network-DoS / infra-specific. |
| `STALK_LOCATE_PERSON` | — | **NOT-YET**. |

**Read:** the deterministic guard covers the *action-signature* harms it can actually see (credential egress, deletion,
cross-agent access, catastrophic commands). The *content/identity-dependent* harms in this list — the majority — are
**NOT-YET**, because they require enforcement point (b), which is unbuilt. The vision's list stands; the delta is the
unbuilt content layer.

---

## 8. Consent gate — scoped-consent model `[LOCKED]` (Phase-0 Task 1)

- **ONE-TIME SCOPED GRANT,** not per-action prompting. Task starts → agent declares action-classes + resource scope →
  user approves the SCOPE once. Inside scope runs silently. The gate stops ONLY when an action EXCEEDS scope or hits a
  floor.
- Enforced **DETERMINISTICALLY** — the agent can't declare "just edit files" then do more. Doubles as injection defense.
- **UNSPOOFABLE, four invariants:** (1) decision derived from REAL action args, not agent narrative; (2) NO agent
  self-approve path — only a human answers; (3) approval transport AUTHENTICATED; (4) tamper-proof via
  `TAMPER_WITH_SAFETY_CORE`.
- **Three impact bands `[LOCKED]` (owner decision 2026-06-13):** every consent-requiring action falls into one of three
  bands — **(1) inviolable** → always block (mode-independent; no setting or bypass crosses it); **(2)
  high-impact-but-authorizable** → asks for approval **even in high-autonomy modes**; **(3) routine non-red** → proceeds
  on **silence/timeout** (proceed-with-recommendation). **"Silence = consent" applies to band 3 ONLY.** Within a task,
  gather **ALL** consent-requiring actions **UPFRONT, grouped by band, and ask once**, then run freely — re-prompting
  inside a granted scope is a P2 defect (§0.1).
- **Inviolable red lines are MODE-INDEPENDENT `[LOCKED]`:** no autonomy setting, dial position, or bypass can cross a
  band-1 inviolable red line — they are not in the user's hands.
- **Approved-destinations contract `[LOCKED]` (owner decision 2026-06-13 — default-deny egress, §14, §21):** outbound to
  an external destination is **denied by default**; the user approves a destination list once. An approved destination
  inside the contract runs **freely** (anti-nag); a **non-approved destination stops-and-asks or blocks**. A **weekly
  reminder re-confirms** the approved-destination list. The gate is on **where data goes**, backed by taint-tracking so
  an injected agent structurally cannot reach a non-approved destination.
- **Autonomy as a risk-calibrated dial `[ADVISORY]` (improvable during implementation):** model autonomy as a
  **risk-calibrated dial**, deliberately **redesigned best-in-class** (NOT a copy of Claude Code's discrete
  Ask/Plan/Auto/Bypass modes); **earned, scope-specific trust** that auto-raises thresholds for repeated non-red
  actions; the **plan as a transparency toggle**; **time-boxed non-blocking asks** for band 3; and **constant
  after-the-fact accountability** (journal + snapshots). The band model above is the locked part; this dial design is
  the open, improvable part.
- **Transport `[LOCKED]`** (recorded at decision time as "option (c)" of the transport alternatives; the option list
  itself predates this document — the locked content is exactly what follows): pluggable seam; ship interactive
  transport + fail-closed-block for unattended; one-way `notify/` for notification only; defer channel-based approval
  until authentication is designed.
- **Keystone problem this fixes:** historically `escalate`/`require-review` only wrote stderr + exited 0; only `block`
  under `LILARA_ENFORCE=1` halted. Consent *plumbing*, not detection, was the missing piece — detectors already existed.

**Status — BUILT (ADR-035, "Implemented"), the strongest section.**

- **One-time scoped grant:** BUILT. Session-scoped grants persist to `~/.lilara/consent-grants.jsonl`
  (`runtime/consent/grant-store.js`); inside-scope actions are demoted to `allow` silently; out-of-scope or floor hits
  route to `consent-required` (`enforcementFor()` in `runtime/decision-lattice.js`).
- **Four invariants:**
  1. *Real-args decision* — BUILT. `buildConsentPrompt()` in `runtime/consent/transport.js` reads only real decision
     fields (`decision.networkEgress.hostname`, `decision.command`, `decision.floorFired`, injected `fileTargets`),
     never agent narrative/`notes`.
  2. *No self-approve* — BUILT. `openTTY()` reads the controlling terminal (`/dev/tty` / `\\.\CONIN$`), **never fd 0**
     (the agent's stdin payload pipe), so the agent cannot answer its own prompt.
  3. *Authenticated transport* — BUILT (for the shipped transports). Approval comes only from the physical controlling
     TTY; remote/channel approval is deliberately deferred until approver-auth is designed.
  4. *Tamper-proof via `TAMPER_WITH_SAFETY_CORE`* — **PARTIAL / GAP.** The grant store is guarded by the state-dir
     safety checks (`ensureBaseDirSafe`), and the consent floor is itself in the hash-pinned inviolable lattice — but
     there is **no floor literally named `TAMPER_WITH_SAFETY_CORE`** (same drift as §3). The property holds; the named
     artifact does not.
- **Transport seam:** BUILT. `LILARA_CONSENT ∈ {interactive, block, off}` selects interactive-TTY, fail-closed-block, or
  off; one-way notify (`runtime/notify/`) is separate.
- **Keystone fix:** BUILT. Exit-code behavior is corrected in `runtime/pretool-gate.js` (consent-required +
  interactive → stop & ask; deny/no-TTY → exit 2) and the latent early-review hardcode is fixed in
  `runtime/early-receipt-builder.js`. `require-review` on a consent-eligible floor now routes to `consent-required`,
  not a silent stderr+exit-0.

---

## 9. Prompt-injection defense — first-class `[LOCKED]`

- The action-guard model IS the defense — it guards **ACTIONS not INSTRUCTIONS.** An injected agent that "decides" to
  exfiltrate still hits the floors + consent. Injection changes *intent* but CANNOT widen *authority.* We do NOT detect
  injection text semantically.
- **Two wires 0.2.0 must close (both reuse existing code):** (1) **taint→sink** — untrusted-source data into a sensitive
  sink (egress/exec/delete) elevates to consent/block. (2) **deterministic consent prompt** — built from real action
  args, never the agent's self-description.

**Status — BUILT.**

- **Authority-not-instructions model:** BUILT by construction — the engine decides on the canonical Action-IR
  (`runtime/action-ir.js`) and real args, never on agent narrative; there is no semantic injection-text detector (as
  intended).
- **Wire 1 — taint→sink:** BUILT. F10 (`runtime/taint.js` `correlateCommandPure`) elevates when a command overlaps
  recently-read external content; F27/F28 close the credential-egress sink. ADR-045 redacts the taint window at rest;
  ADR-046 made `decide()` cross-call-pure (the F10 disk read was removed; the window is injected via
  `input.provenanceWindow`), so replay stays byte-identical.
- **Wire 2 — deterministic consent prompt:** BUILT (same `buildConsentPrompt()` as §8, real args only).

---

## 10. 0.2.0 — definition-of-done `[LOCKED]`

0.2.0 is **ADDITIVE** — wire + lock what's built. Memory (L2) is OUT → starts 0.3.0. Ships when all six hold:

| # | DoD criterion | Status | Evidence / delta |
|---|---|---|---|
| 1 | Scope-based consent gate works end-to-end on a real unattended task (stop→ask→wait→obey, deterministic prompt, no self-approve). | **BUILT** | ADR-035; `runtime/consent/*`, `runtime/pretool-gate.js`; CI gate `scripts/check-consent-gate.sh`. |
| 2 | Action floors + `TAMPER_WITH_SAFETY_CORE` + taint→sink coded AND inviolable-tier unreachability test passes. | **BUILT** | Floors live; taint→sink = F10 + F27 always-on, **F28 cross-call sink gated by `LILARA_TAINT_EGRESS=1` (default off)**; unreachability tests pass; lattice hash-pinned. *Naming nuance:* `TAMPER_WITH_SAFETY_CORE` is a property, not a named floor (§3). |
| 3 | Distribution fixed (install bundles `runtime/`). | **BUILT** | `scripts/install-local.sh` bundles 80 `runtime/*.js` (incl. `consent/`, `notify/`) + `schemas/`; smoke gate `scripts/check-install-smoke.sh`; verified 3-OS. |
| 4 | Deletion-coordination wired (snapshot + scope). | **BUILT** | ADR-038 F29 + `runtime/snapshot.js` recoverability snapshot, visible-but-fail-open. **Active only when `LILARA_DELETE_COORD=1` (default off)** — see Default posture, §18. |
| 5 | Validated on two reference integrations — OpenClaw (adapter exists) + Hermes (new adapter in-scope) — measuring false-stop / false-allow at the hard exceptions on REAL runs. | **PARTIAL / GAP** | OpenClaw adapter present; **Hermes adapter absent**; no measured false-stop/false-allow at hard exceptions on real runs (ADR-019 eval-corpus coverage still *Proposed*; gate at loose defaults). |
| 6 | Red-team is a RELEASE GATE not a phase. Full CI + adversarial pass. | **BUILT** | Adversarial replay corpus (zero drift), nightly adversarial track + stress harness, CI gate suite, `lilara-cli.sh pre-push`. |

**Net:** five of six BUILT; **#5 is the open closure item** (Hermes + real-run hard-exception measurement). Criterion #2
is satisfied in substance with the `TAMPER_WITH_SAFETY_CORE` naming caveat.

---

## 11. L2 — Memory `[0.3.0]`

"Learns the user deeply — over time, better than he knows himself — anticipating what he would choose, while the user
stays sovereign: memory is local, inspectable, and erasable." *(Ambition restored per owner decision 2026-06-13,
reversing the 2026-06-12 Q5 softening — see §1 L2, §24/§25.)* **Privacy ARCHITECTURAL, not a promise** — only abstract
enums/counts of the user's own data may leave, never raw content; local-only structured memory, zero cloud deps; no
product analytics on user data. The user's memory/data leaves only to **approved destinations** (the §8 contract,
default-deny egress); the product-improvement **artifact-sharing** channel (§16) carries only **scrubbed system
artifacts**, never memory or user content. **Named threat:** memory-privacy leak via "just a little context for
debugging" — needs typed/by-construction boundaries (§19 #5, the enabler for default-deny egress and scrubbed sharing).

**Status — PARTIAL (framework present, not integrated) / NOT-YET as a product layer.** `runtime/session-memory.js`
(append-only facts JSONL + index) and `runtime/memory-search.js` (keyword search with recency boost) exist, plus
per-session state in `runtime/session-context.js`. But memory is **not wired into `decide()`** for context-aware routing;
it is display/session plumbing today. Nothing leaves the machine. The "understands you better than yourself" product
capability is NOT-YET (correctly — scheduled for 0.3.0). See §19 #5 for a `[CC-PROPOSED]` privacy-by-construction
boundary to build L2 against.

---

## 12. L3 — Self-improvement `[LAST]`

Reviews each task + end-of-day, modifies itself. **Constraints:** must pass THROUGH the guard; can NEVER weaken its own
constraints; UNREACHABLE from the inviolable tier. **Suggestion-only first;** restrict to prompts/config/memory-weights —
core code mutations strictly MANUAL. **Named threats:** "policy laundering" (slowly weakening the guard without editing
safety code) + "self-modification poisoning" (attacker-controlled content steering the reflection loop).

**The improvement engine — four sources `[LOCKED]` (owner decision 2026-06-13).** L3 improves *how tasks get done*,
drawing on four sources: (1) **memory / learned decisions** (L2); (2) **better methods** discovered while working;
(3) **creating new capabilities** — skills, hooks, adapters, agents, and sub-agents; and (4) **weekly learning on the
user's interests** (the §1 weekly loop). §1's weekly loop, §12, and §13 are facets of **one improvement engine**, not
separate systems. **One absolute limit:** the engine can *never* change or bypass the guard's red lines. **Tier-(a)**
red lines may be crossed **only with explicit user approval, never autonomously**; **tier-(b) inviolable** red lines are
**never** crossable, even with approval. **Create freely, apply through a gate:** the engine may *create*
skills/agents/hooks/adapters freely, but applying them is gated — **hooks/adapters require human approval ALWAYS (never
auto-applied)** because they are safety-boundary code, and **created skills/agents pass through the guard as untrusted
proposals** before they run (§13). At runtime this absolute limit is enforced by the **installed-core tamper floor**
(ADR-050, §3): self-improvement structurally cannot modify the installed guard.

**The auto-improve loop (explicit), tied to L4 `[LOCKED]`:** when a task completes — and again at end-of-day — the
self-improvement loop **MAY PROPOSE** new, merged, or improved skills and routing-weight updates for L4 (§13), plus
prompt/config refinements to itself. Every such output is **suggestion-only and routed through the guard**, applied only
after it clears the same floors any other action must. It **never automatically touches safety-core code or
hooks/adapters** — those remain manual and human-approved (§13). That manual red-line is the structural defense against
the two threats named above: a loop that could auto-write **and** auto-apply its own guard-wiring would be precisely
"policy-laundering" / "self-modification poisoning."

**Status — NOT-YET (by design — built LAST).** No reflection/self-modify code exists. The *guardrail* that L3 will need
already has a seed: `tests/decision-lattice/inviolable-selfmod-unreachability.test.js` proves a `learned-allow`
source can never demote an inviolable floor. See §19 #6 to elevate the two named threats to standing regression gates
*before* any L3 code lands.

---

## 13. L4 — Skill orchestration

**Capability set `[LOCKED]`** — from a cheap catalog, the orchestrator will:
- auto-**SELECT** the right existing skill for a task;
- auto-select **MULTIPLE** skills and **MERGE/compose** them into ONE to accomplish a single task;
- auto-**CREATE** a new skill when no suitable one exists;
- auto-**CREATE a new agent** when one is needed;
- decide all of the above **CHEAPLY** — low-token deterministic routing, **never a big model per route**;
- always **LEARN** from each task's result — outcome feedback folded back into the catalog.

**Guard discipline `[LOCKED]`:** every auto-created or auto-merged skill/agent is an **UNTRUSTED proposal that must pass
through the guard** before it runs. L4 **depends on L2** and is **sequenced LAST** in the build order (§1).

**Hooks/adapters — separate, lower-trust case `[LOCKED]` red-line:** the system **MAY PROPOSE** hooks/adapters, but
**auto-created hooks are NEVER auto-applied.** Hooks and adapters are *safety-boundary code* — they wire the guard into
the host tools — so their creation stays **manual / suggestion-only, human-approved ALWAYS**, consistent with the locked
invariant that **core code mutations remain strictly MANUAL** (§12) and with the `TAMPER_WITH_SAFETY_CORE` concern (§3,
§19 #1). *Rationale:* if the system could auto-write **and** auto-apply its own hooks, it could write its way around its
own guard — exactly the named "policy-laundering" / "self-modification poisoning" threats in §12.

**Status — PARTIAL (static routing only).** Deterministic, low-token routing exists — `runtime/intent-classifier.js`
(8-intent classifier, pattern-based, no LLM), `runtime/route-resolver.js` (intent→lane), `runtime/workflow-router.js`,
and `runtime/skill-scorer.js` (scores skill files for audit/display only). Of the locked capability set above, **only
single-lane routing is built**: there is **no** context-driven auto-select, **no** multi-skill merge/compose, **no**
auto-creation of skills or agents, and **no** outcome-feedback learning loop — all **NOT-YET**. The "untrusted proposals
through the guard" model is likewise unbuilt (depends on L2). Hook/adapter auto-creation is **gated to manual** today —
there is no auto-apply path, which is the intended end state, not a gap. Correctly NOT-YET as a product layer.
*Sequencing note (owner-confirmed Q1, 2026-06-12):* "sequenced LAST" above reads per the canonical statement in §1.5 —
after L2, before L3; only L3 is absolutely last.

---

## 14. L5 — Shell

Manage live tools from one place; **fast-reply AND long-running** modes; reachable via channels. **Architectural pivot
`[ADVISORY]`:** do NOT build another CLI shell — position as an invisible proxy/middleware ("build the thing those tools
plug into"). **Inbound channels (Telegram/WhatsApp approval) DEFERRED** until approver-authentication is designed;
one-way notify ships first. **Guest→host inversion** (Lilara launches/wraps tools vs. being a hook inside them) = the
largest architectural decision, sequenced LAST.

**Three product forms `[LOCKED]` (owner decision 2026-06-13).** Lilara ships in three forms: **(1) a plugin** into the
user's existing tool — and the plugin is **NOT security-only**: it delivers the **full value stack** (skills + agents +
hooks + memory improvement + guard), so the user feels the value of adding it; **(2) a standalone tool/agent** (like
Hermes/OpenClaw — Lilara itself does the task); and **(3) a desktop control-plane** that **registers other tools** into
Lilara and controls them from one place (§23.A). **Live-visibility:** when Lilara runs a task on a wrapped tool, the
user **SEES it happen** — never in the background. The preferred control surface is a **web dashboard** (built on the
existing read-only `dashboard-server.js` substrate; §23.A, §24 Q6).

**Status — PARTIAL (outbound + read-only observability).** Outbound one-way notify is BUILT: `runtime/notify.js` +
`runtime/notify/*.js` (Discord/Slack/email, zero-dep, allowlist-only `KEEP_KEYS` scrubber, default disabled, TLS floor
per ADR-039). **A read-only observability dashboard is also BUILT and was previously unregistered in this document:**
`scripts/dashboard-server.js` (`lilara-cli.sh dashboard`, default port 7917, binds 127.0.0.1 only, zero-dep, serves
`/api/summary`, `/api/decisions`, `/api/coverage`, `/api/kill-chains`, `/api/sessions`; all journal data passes the
receipt-export redaction layer, fail-closed if the redactor is unavailable; CI gate `scripts/check-dashboard.sh`). The
unified CLI (`scripts/lilara-cli.sh`, 35 subcommands incl. `status`, `journal`, `receipts`, `session`, `memory`,
`dashboard`) is the other existing operator surface. Inbound approval channels are **NOT-YET** (deferred, as the vision
requires). Guest→host inversion is **NOT-YET** (sequenced after L4 per §1.5). The "manage tools from one place" shell
experience is realized today only as the per-harness adapter set (§17) plus this read-only dashboard — consistent with
the `[ADVISORY]` "be middleware, not a CLI" pivot, which is not yet acted on. Owner direction **23.A** extends the
guest→host inversion into a full control-plane / task-dashboard surface (§23 `[OPEN]`).

`[LOCKED]` **Standing constraint (owner-decided Q6, 2026-06-12) — the dashboard IS the seed of §23.A, and it stays
read-only until §23.A's real build.** The §23.A control plane will be built **on** `scripts/dashboard-server.js`
(reusing the audited zero-dep, redaction-fail-closed substrate), not as a separate surface. Until that build (PLAN
Phase 8): the dashboard may *observe* and may only ever *narrow* authority (revoke, stop, kill); it gains **no
mutating endpoint** (launch, approve, grant). Mutating endpoints are added ONLY in Phase 8, behind the Phase-6
approver-authentication design — no approve/grant control exists on a network surface before authentication exists.
This read/write split is the standing constraint that keeps today's shipped UI from pre-empting the
deferred-`[LOCKED]` inbound-approval decision.

---

## 15. Roadmap / versions

**0.2.0 = lock the safety core. 0.3.0 = memory layer (L2) begins. Later = L4 → L5 → L3 (suggestion-only first).** Inbound
channels deferred; guest→host inversion last.

**Status — sequencing honored to date.** Current VERSION is `0.2.1` (a hardening point release on top of the 0.2.0
safety-core lock). The sequencing matches the build order in §1. 0.3.0 (L2) has not started. The single carried-over
0.2.0 item is DoD #5 (Hermes + real-run validation, §10). *Note (owner-confirmed Q1, 2026-06-12):* the "Later = L4 → L5 → L3" prose above
and §1's "thin L5" early slice are reconciled by the canonical statement in §1.5 (thin L5 shipped with L1; *full* L5
lands between L4 and L3).

**Owner-raised forward directions** (control-plane / orchestration hub; study-and-rewrite best-in-class components) are
tracked in **§23 `[OPEN]`** — the intent is owner-set; the design is open until sequenced.

---

## 16. Strategic layer `[mostly ADVISORY / OPEN]`

- **Distribution `[ADVISORY]`:** lean centralized `~/.lilara` + thin CLI installer (`npm install -g lilara`) over a
  per-project self-contained copy; today's breakage was a symptom (install copied hooks but NOT the engine).
  → **Status: BUILT (the breakage is fixed).** `scripts/install-local.sh` now bundles `runtime/` + `schemas/`; the
  `npm install -g lilara` packaging form remains `[ADVISORY]` and is not the current install path. The thin-CLI half
  already exists beyond install: `scripts/lilara-cli.sh` exposes 35 subcommands (see §14).
- **Auto-update `[ADVISORY]`:** background check writes `update-cache.json` (≤24h), one-line stderr warning, user runs
  `lilara upgrade`. → **Status: NOT-YET** (no `update-cache.json`, no upgrade command).
- **Telemetry & product-improvement sharing `[LOCKED]` (owner decision 2026-06-13 — supersedes the prior "NONE by
  default" framing and §19 #8).** Three distinct channels, kept separate:
  1. **Local-only internal-event log** (`runtime/telemetry.js`): corruption/migration events, on by default
     (`LILARA_TELEMETRY !== "0"`), **never** records payloads/commands/paths/secrets, **never egresses**.
  2. **Friction telemetry** (§19 #15): local-only anti-nag metrics, **zero egress**.
  3. **Product-improvement artifact-sharing — the one sanctioned default-on EGRESS:** what is shared is the system's
     **OWN generated artifacts** (skills, hooks, adapters, applied self-improvements) — **NOT user data, NOT content,
     NOT PII**. Because it is not user data it is **EXEMPT from default-deny egress** (§14/§21), stays **DEFAULT-ON**,
     and is **not surfaced in onboarding** (nothing sensitive). A **universal opt-out** always exists — **privacy is
     never paywalled** (a right for all users, free and paid). Shared artifacts MUST be **generalized + scrubbed of
     user-specifics** (a skill built for one user can embed his endpoints/internal names) **before** sharing — made
     true by construction via the §19 #5 typed allowlist-only serializer. → **Status: NOT-YET** (the sharing channel is
     a later layer; the local-only logs above are BUILT).
- **Licensing / business model `[OPEN]` (owner note 2026-06-13 — DEFERRED).** **Build the full best product FIRST;
  decide free-vs-paid and the legal license AFTER. Do NOT tier features now.** Binding constraints that remain:
  **privacy is NOT a paywall** (the opt-out and all privacy controls are free for everyone — decision 15);
  **no-copyleft consumption**; **moat = the core**; **repo private, no `LICENSE` file, license `[OPEN]`.** → **Status:
  OPEN, confirmed.** No `LICENSE` file exists at repo root; DECISIONS.md D23 (trademark clearance for "Lilara") is an
  open pre-launch blocker.
- **Multi-harness `[OPEN]`:** deepen one then fan out vs. polyglot day one. Existing adapters: claude, codex, openclaw,
  clawcode, opencode, antegravity; **Hermes NOT built** (in-scope 0.2.0). → **Status: OPEN.** Six adapters present
  (§17); Hermes absent.
- **Competitive stance `[LOCKED]`:** Lilara will eventually COMPETE with OpenClaw/Hermes — beachhead/dogfood, not a
  permanent dependency. → preserved.
- **Decision-debt (headers reconciled 2026-06-12):** the ADR set has two number collisions — ADR-021
  (bench-baseline-strategy *and* canonical-json-depth-cap) and ADR-022 (check-no-horus-bare-token *and*
  fail-closed-floor-recovery) — frozen as A/B (renumbering would break citations). The Phase-0 evidence-based ledger
  reconciliation flipped 022B/023/024/025/028/029 to Implemented and closed ADR-032 (both its PRs had shipped
  2026-06-03), each header citing its implementing commit. Genuinely open now: **ADR-019** (scheduled PLAN Phase 1),
  **ADR-022A** (gate strengthening), and **ADR-048** (owner queue). See §19 #7 and Appendix B.

---

## 17. Reference integrations `[LOCKED]`

Validated against real dogfooding:

- **OpenClaw (adapter exists)** — unattended actions → consent gate; injection → taint→sink + deterministic prompt;
  egress → floors + consent.
- **Hermes (no adapter yet)** — multi-day unattended → fail-closed-block at hard exceptions + one-way notify; irreversible
  mid-run actions → snapshot + deletion-coordination.

Bounded-vs-multi-day resolution: the agent runs its PRE-AUTHORIZED scope freely and only stops at genuine hard
exceptions.

**Status:**

| Integration | Status | Evidence / delta |
|---|---|---|
| OpenClaw | **BUILT (adapter)** | `openclaw/hooks/adapter.js` + `post-adapter.js`; manifest verified. |
| Hermes | **NOT-YET / GAP** | No `hermes/` adapter anywhere; this is the open half of 0.2.0 DoD #5. |
| Real-run false-stop / false-allow at hard exceptions | **NOT-YET / GAP** | Measured FP/FN at the three hard exceptions on real runs is not in place (eval gate at loose defaults; ADR-019 *Proposed*). See §19 #3. |

Other adapters present (beyond the two named reference integrations): `claude`, `codex`, `opencode`, `clawcode`,
`antegravity` — each with a manifest. `codex`, `opencode`, `clawcode`, and `antegravity` follow the
`hooks/adapter.js` + `hooks/post-adapter.js` pattern; **`claude` is modularized** (per-concern hook modules under
`claude/hooks/` driven by `hooks.json`; its PostToolUse parity surface is `claude/hooks/output-sanitizer.js`). Parity
across all six is enforced by `scripts/check-post-adapter-parity.sh`.

---

## 18. Architectural invariants `[LOCKED]`

Zero external deps; ASCII fast-path preserves byte-identical replay; `require-review` = WARN class; fail-safe direction
always; one-PR-per-coherent-change; verify-and-merge cycle; clean-room rewrite (reimplement without looking at source) —
protects no-copyleft AND quality; get the safety core definitively right once, never re-litigate.

**Status — BUILT / verified across the board:**

| Invariant | Status | Evidence |
|---|---|---|
| Zero external deps | **BUILT** | No root `package.json`; Node built-ins only. |
| Byte-identical replay (ASCII fast-path) | **BUILT** | 119-entry replay corpus (`tests/fixtures/replay-corpus/`), zero-drift gate `scripts/check-replay-corpus.sh`; `irHash` deterministic; ADR-046 kept `decide()` cross-call-pure. *Precision note:* replay is byte-identical **given pinned env** — `decide()` reads the three posture flags (`LILARA_TAINT_EGRESS`, `LILARA_DELETE_COORD`, `LILARA_KILL_CHAIN_ENFORCE`) from ambient env and the replay harness does not yet pin them; inert-when-off keeps today's corpus stable, but the guarantee inverts if a default ever flips — see §19 #14. |
| `require-review` = WARN class | **BUILT** | Default `LILARA_ENFORCE=0` warns; `=1` enforces (exit 2); consent-required is the new third state via `enforcementFor()`. |
| Fail-safe direction | **BUILT** | Kill-switch (F1); degraded-mode → restrictive; consent floor fails closed; null-input guards. |
| One-PR-per-coherent-change | **BUILT** *(process discipline, not code)* | CHANGELOG groups by PR/ADR; CI gate suite + pre-push. |
| Clean-room rewrite | **BUILT** *(process discipline, not code)* | Zero upstream code; bootstrap history frozen in `references/archive/`. |
| Safety core "right once, never re-litigate" | **BUILT** | Inviolable tier hash-pinned + unreachability tests (§3). |

**Performance / overhead budget `[CC-PROPOSED]` (intent).** The guard sits in the **hot path of every tool call** — each
PreToolUse decision runs `decide()` synchronously before the host tool proceeds — so low, bounded overhead is a design
invariant, not an afterthought. The enforcement mechanism already exists (**BUILT**): the committed **bench gate**
(`runtime/bench-gate.js`, `scripts/bench-runtime-decision.sh`) applies a **p50 relative regression gate at 1.5× the
committed per-platform baseline** (`artifacts/bench/baseline.json`, `artifacts/perf/baseline.json` — a genuine 2×
slowdown doubles p50 on every run and fails), backed by an always-on **absolute p99 ceiling ladder of 10 / 200 / 500 ms**
per platform (overridable via `LILARA_BENCH_P99_MS`), measured **best-of-K** to suppress shared-runner tail jitter
(ADR-040, ADR-044). Committed medians today: **p50 0.5–0.7 ms (Linux/macOS — bench baseline 0.5/0.6 ms, perf baseline
0.6/0.7 ms) and 1.2–1.7 ms (Windows, incl. slow-fs variants)** per decision — those numbers are repo facts
(`artifacts/bench/baseline.json`, `artifacts/perf/baseline.json`), not targets. The standing **SLO target is the `[CC-PROPOSED]` part**: hold the per-call
median **≤ 1 ms on Linux/macOS and low-single-digit ms on Windows**, so guard overhead stays negligible against real
tool/LLM latency. If the owner adopts that target, promote it from `[CC-PROPOSED]` to `[LOCKED]`.

**Default posture — what protects a user with zero configuration `[CC-PROPOSED]` (disclosure).** Scattered status
blocks each note their own flag; nowhere did the document state the combined out-of-the-box posture plainly. It is:

| Control | Env switch | Default | Out-of-the-box effect |
|---|---|---|---|
| Enforce mode | `LILARA_ENFORCE` | `0` (off) | **No floor halts execution** — `block` decisions warn on stderr and exit 0 (`pretool-gate.js`). |
| Consent gate | `LILARA_CONSENT` | `off` | No interactive stop-and-ask; consent-eligible floors do not prompt. |
| F28 cross-call taint egress | `LILARA_TAINT_EGRESS` | unset (off) | Staged cross-call credential exfil (HX1's cross-call half) is **not evaluated**. |
| F29 delete coordination | `LILARA_DELETE_COORD` | unset (off) | Deletion-coordination (HX3) is **not evaluated**; no pre-delete snapshot. |
| F23 kill-chain | `LILARA_KILL_CHAIN_ENFORCE` | unset (observe) | Multi-step kill-chain detection journals but never blocks. |
| Notifications | `notifications.enabled` (contract) | `false` | No outbound notify. |
| Telemetry (local-only) | `LILARA_TELEMETRY` | on | Local `telemetry.jsonl` internal events; never egresses (§16). |

In plain terms: **out of the box, Lilara observes, journals, warns, and snapshots — it stops nothing** until the
operator turns on enforce/consent and the per-floor posture flags. That is the current posture, stated honestly: two of
the three hard exceptions (HX1 cross-call half, HX3) are inert at defaults. Recorded as **G12** in §20. *Forward note
(decision 15, §16):* the only egress that will ever be **on by default** is the product-improvement **artifact-sharing**
channel (scrubbed system artifacts, never user data, universal opt-out) — NOT-YET built; until it lands, nothing
egresses at defaults, so the "never egresses" rows above hold today.

**Graduation policy `[LOCKED]` (owner-decided Q2, 2026-06-12; sharpened 2026-06-13 — full policy in ADR-049, as
amended).** A fresh install **enforces immediately** — secure-by-default is the committed end-state, evidence-gated,
one ADR + owner sign-off per flip, env override always retained. (Note: this "definitional tier" is a *subset* of the
code's `tier:"inviolable"` set, not all of it — several code-inviolable floors are heuristic-leaning and sit in bucket
(b).) Floors fall into **three buckets**:
- **(a) Definitional tier — ON at install, UNCONDITIONALLY (no FP-budget excuse, because they are definitional):**
  catastrophic-command signatures (**F3**), credential/secret single-call egress (**F27**, inviolable), the
  installed-core **tamper floor** (ADR-050), and — *once enforcement point (b) is wired (G2/G3, still NOT-YET)* — the
  **content red lines** (sexual content Red Line A, CSAM, suicide methods; Red Line B's deception+harm rule). These do
  not wait on calibration. **F28 is NOT here** — it is demotable (consent) and sits in bucket (c).
- **(b) Calibration-gated inviolable floors:** the heuristic-leaning inviolable floors — taint (**F10**), duration /
  budget (**F14 / F14b**) — flip to enforce once Phase-1 real-run calibration shows near-zero false positives (this is
  the **amended ADR-049 first wave**; F3/F27 moved up to bucket (a)).
- **(c) Opt-in until each meets its own FP budget:** the demotable heuristic floors — **F28** taint-egress, **F29**
  delete-coordination, **F23** kill-chain — stay opt-in, then flip one at a time by their own ADR + owner sign-off.
The env override always remains, so operators can dial down. Binding constraint (P1/P2, §0.1): **secure-by-default must
NOT mean nag-by-default** — enforcement halts only at genuine red lines, and granted scopes are never re-prompted.
Prerequisite for any flip: §19 #14 replay-posture pinning + posture-matrix replay.

---

## 19. `[CC-PROPOSED]` additions

Additions introduced by this document. Each **extends** the agreed scope and is individually reviewable. Where an
addition would touch a `[LOCKED]` item, it is raised as `[OPEN]` (never as a change to the locked decision).

**Owner batch resolution (2026-06-13) — recorded in §25.** Dispositions: **#1** RESOLVED (decision 11 / ADR-050);
**#2** landed; **#3 / #6 / #7 / #14** ACCEPTED → `[LOCKED]`; **#4** AMENDED (structured-PII split — no longer "route all
the remainder to (b)"); **#5** ACCEPTED as a near-term *enabler* for decisions 14/15; **#8** DROPPED (superseded by
decision 15); **#9** decided (decision 12); **#10** landed; **#11** PRINCIPLE LOCKED (full policy still deferred to
Phase 4); **#12 / #13** accepted as principles (implementation deferred); **#15** already `[LOCKED]`.

1. **`[CC-PROPOSED]` — Make `TAMPER_WITH_SAFETY_CORE` a real runtime artifact, not only a property. RESOLVED (decision
   11, 2026-06-13 — re-affirms Q7 / ADR-050; runtime enforcement of the §12 self-improvement limit).** The vision
   names it as an absolute floor; the code enforces the *property* (hash baseline + structural unreachability + CI gate)
   but has **no runtime floor** that fires when an agent attempts to modify the safety-core source itself
   (`runtime/decision-lattice.js`, `runtime/floor-codes.js`, `runtime/floor-*.js`,
   `artifacts/lattice-baseline.sha256`). *Open question (touches LOCKED §3/§8):* should a runtime floor guard writes/
   edits to those paths, so tampering is stopped *at the moment it is attempted* rather than only failing CI later?
   Rationale: a long-running unattended agent can edit core source between CI runs; the build-time gate does not stop the
   action in-session.
   **Decided (Q7, 2026-06-12 — ADR-050):** yes — scoped to the **INSTALLED guard under `~/.lilara`**, NOT the dev
   checkout (the owner is customer #1 and must be able to edit Lilara's own source). The floor **stays inviolable** —
   explicitly NOT consent-demotable (a demotion path is exactly what an attacker would target and would void §7's
   "absolute" property). The CI hash-baseline check on the source repo remains as defense-in-depth. Implementation:
   PLAN Phase 3, after the §19 #6 laundering gates.
2. **`[CC-PROPOSED]` — Check in a model content contract artifact for enforcement point (b).** Point (b) is `[LOCKED]`
   in concept but has **zero artifact** in the repo, which is why the entire content-harm surface (§6 categories + decoy,
   plus CSAM and suicide-method refusal/crisis-resources from §7) is unrepresented. Propose a versioned, reviewable,
   testable artifact (e.g. `references/CONTENT-CONTRACT.md` + a prompt/instruction template) that encodes the clean-
   refusal, the fake-all-the-way-down decoy constraint, the sexual-content carve-out, and the crisis-resource behavior —
   so (b) is a real thing the project owns and can red-team, not an unwritten assumption about the underlying model.
   *Extends; does not revisit the locked three-points.* **Landed (2026-06-12):** `references/CONTENT-CONTRACT.md` v1.0.0 — clean-refusal shape, decoy fake-all-the-way-down hard constraint, sexual-content carve-out, absolute tier (CSAM absolute-refusal-only with an explicit no-reporting-mechanics non-goal; suicide-method refusal + generic crisis-support behavior), canonical instruction template, red-team checklist. The third-party-harm remainder appears only as a PROPOSED section pending #4; wiring the template into a harness surface remains open (G2 → Med-High).
3. **`[LOCKED]` (accepted from `[CC-PROPOSED]` by owner, 2026-06-13) — A "hard-exceptions benchmark" with explicit
   false-stop / false-allow budgets, run as a release gate.** 0.2.0 DoD #5
   requires measuring FP/FN at the three hard exceptions on real runs; the eval corpus exists but ADR-019 (corpus shape
   coverage) is still *Proposed* and the gate runs at loose defaults. Propose a named eval slice that exercises each hard
   exception (HX1, HX2, HX3 — §1 naming; today deterministically detectable as the credential/secret subset per #4) with
   committed FP/FN budgets, run as a release gate, **measured under a declared flags-on posture** (at defaults F28/F29
   are inert — §18 Default posture — so default-posture measurement would be degenerate). *Supports the locked DoD; adds
   instrumentation only.*
4. **`[CC-PROPOSED]` — Reconcile hard-exception #1 with what is deterministically detectable.** The vision's
   hard-exception #1 ("personal data leaving to an external party = no") is realized today only for the credential/key-
   class subset (F27/F28); general third-party personal data is byte-identical to the user's own at the tool boundary
   (ADR-036's "no ownership signal"). *Open question (touches LOCKED §4):* state the deterministic guarantee precisely
   (credential/secret egress) and route the remainder of "personal data of others" to enforcement point (b), rather than
   implying the Node guard already covers all personal-data egress. Rationale: avoid a false sense of coverage; make the
   real boundary explicit.
   **Resolved (owner decision, 2026-06-13 — ADR-051) and AMENDED (decision 6, 2026-06-13 — structured-PII split):** the
   deterministic egress guarantee is stated precisely as **two structured subsets** — the **credential/secret subset
   (F27/F28)** and a near-term **bulk structured-PII floor** (emails / phones / national-residence IDs / cards / IBANs
   above a threshold, same egress mechanism, scheduled in PLAN). HX1/HX2/HX3 are reframed as the content-blind Node
   guard's deterministic **mechanical** stops (§1, §4) — *not* the product's ethical red lines. Only **unstructured /
   contextual** third-party PII has no ownership signal at the tool boundary and is **routed to enforcement point (b)**
   (`CONTENT-CONTRACT.md` §5/§9) — this item **no longer routes "all the remainder" to (b)**. Under default-deny egress
   (§8/§21) the destination gate is primary and these floors are defense-in-depth. The product's inviolable *content*
   red lines (sexual/explicit content, Red Line A) live at point (b)'s absolute tier (§7); Red Line B is a point-(b)
   **deception+harm** rule (reversed 2026-06-13) — none are added to the L1 deterministic hard-exception list (that
   would falsely imply the content-blind guard enforces them). Generation-layer wiring remains open as G2/G3.
5. **`[LOCKED]` (accepted from `[CC-PROPOSED]` by owner, 2026-06-13 — a NEAR-TERM ENABLER, not just hygiene) — the typed
   allowlist-only egress serializer.** Adopt a typed, allowlist-only serializer as the *only* path by which anything
   derived from memory or from generated artifacts can leave a process boundary — the existing `KEEP_KEYS` scrubber in
   `runtime/notify.js` is the proof-of-pattern (drops every field except an enum allowlist). This serializer is the
   **mechanism that makes default-deny egress (decision 14) and scrubbed product-improvement artifact-sharing (decision
   15) true BY CONSTRUCTION** — "only abstract enums/counts of the user's data may leave; shared artifacts are scrubbed
   of user-specifics." *Honors the locked L2 privacy requirement; lands with L2 (PLAN Phase 4).*
6. **`[LOCKED]` (accepted from `[CC-PROPOSED]` by owner, 2026-06-13) — Elevate "policy-laundering" and
   "self-modification-poisoning" to standing regression gates that land BEFORE any L3 code.** Both are named L3 threats. `inviolable-selfmod-unreachability.test.js` is the seed. Propose a permanent gate
   that (a) proves no self-improvement source can ever appear in any inviolable floor's `demotableBy`, and (b) detects
   *gradual* weakening of the guard across versions (e.g. a monotonic check that the inviolable set and lattice hash only
   change via reviewed baseline updates). *Additive discipline for the locked-LAST layer; lands before any L3 code.*
7. **`[LOCKED]` (accepted from `[CC-PROPOSED]` by owner, 2026-06-13) — Track ADR decision-debt as an explicit hygiene
   item.** Two ADR-number collisions (021 ×2, 022 ×2)
   stay frozen as A/B (renumbering breaks citations). Headers reconciled with commit-cited evidence 2026-06-12 (Phase-0):
   backlog reduced to 019, 022A, **048** — so the ADR set stays a reliable index. *Meta-process; no scope change.*
8. **`[CC-PROPOSED]` — DROPPED / SUPERSEDED (owner, 2026-06-13).** This item proposed reconciling the old "NONE by
   default / opt-in aggregate" telemetry wording. It is **superseded by decision 15** (§16), which replaces that framing
   entirely with the three-channel model (local-only internal log; local-only friction telemetry; default-on, opt-out,
   scrubbed product-improvement artifact-sharing). Do not use the old framing.
9. **`[CC-PROPOSED]` — F23 kill-chain default posture. Decided (Q2, 2026-06-12 — ADR-049):** F23 stays **opt-in**
   until it meets its own measured FP budget (per #3's eval slices), then flips by its own ADR with owner sign-off,
   per the graduation policy in §18. Observe-only-by-default is acknowledged: the detector exists but does not protect
   by default until its evidence gate is met.
10. **`[CC-PROPOSED]` — Tag-integrity gate (landed with this revision).** The decision-tag system ([LOCKED]/[ADVISORY]/
    [OPEN]/[CC-PROPOSED]) was load-bearing but enforced only by human discipline — no gate existed. This revision adds
    `scripts/check-scope-tags.sh`: only legend tags may appear in this file; every line carrying `[LOCKED]` is hashed
    against a committed baseline (`artifacts/scope-locked-baseline.sha256`) so any edit or deletion of locked text fails
    CI unless the baseline is updated in the same reviewed diff; locked-tag count cannot silently decrease. *Meta-process;
    protects the tag semantics this document depends on.*
11. **`[LOCKED]` PRINCIPLE (accepted from `[CC-PROPOSED]` by owner, 2026-06-13) + deferred full policy — Data-retention
    for `~/.lilara` state.** **Committed principle now (a privacy promise):** audit material is **NEVER auto-deleted**;
    pruning happens **only via an explicit user command**; journal redaction tooling already exists (ADR-041/045).
    Grants/tokens = operator-managed revocation, no silent expiry. **The full retention policy is still DEFERRED** —
    drafted in PLAN Phase 4 (L2) where memory raises the privacy stakes, then put to the owner. *Extends §11's
    architectural-privacy stance.*
12. **`[LOCKED]` PRINCIPLE (accepted by owner, 2026-06-13; implementation deferred) — Floor versioning & deprecation.**
    "Get the safety core right once" (§18) growth rule: floor predicates may **strengthen (fewer false-negatives) but
    never weaken** under the same ID; adding/removing/reordering floors = lattice-hash rebaseline through the
    reviewed-baseline gate (#10, §19 #6); floors are deprecated (kept as no-op for one release cycle, noted in CHANGELOG
    + Appendix A) and **never silently removed**; replay corpus only ever extends, entries are never mutated.
    *Codifies practice already implied by §3/§18; mechanism deferred.*
13. **`[LOCKED]` PRINCIPLE (accepted by owner, 2026-06-13; implementation deferred) — Support matrix.** CI gates run on
    Node 20 (`.github/workflows/check.yml`); bench/perf baselines are committed for Node 20 and 24 across
    Linux/macOS/Windows (incl. Windows slow-fs variants); six harness adapters are parity-gated. The supported matrix is
    **Node ≥ 20 (CI-proven on 20 and 24), three OSes, six harnesses** — so "works on my machine" has a defined boundary.
    *Disclosure accepted as a principle; any guarantee tightening is deferred.*
14. **`[LOCKED]` (accepted from `[CC-PROPOSED]` by owner, 2026-06-13) — Posture flags become injected input to
    `decide()`.** `decide()` reads `LILARA_TAINT_EGRESS`,
    `LILARA_DELETE_COORD`, and `LILARA_KILL_CHAIN_ENFORCE` from ambient `process.env` (decision-engine.js), and the
    replay harness (`scripts/replay-decisions.js`) does not pin them — purity currently holds *modulo unpinned env*
    (§18 replay note). Propose migrating posture into the `decide()` input object exactly as ADR-046 did for the taint
    window (`input.provenanceWindow`): loaded at the impure boundary (`pretool-gate.js`), injected, journaled, replayed.
    Until then: pin all three flags in the replay harness, and require a posture-matrix replay (corpus green under both
    postures) before any default flip. *Hardens the locked byte-identical-replay invariant; prerequisite for §19 #9 / Q2
    graduations.*
15. **`[LOCKED]` (accepted from `[CC-PROPOSED]` by owner, 2026-06-12) — Friction telemetry: make the anti-nag contract
    (P2) measurable, and feed it to the learning loop.** P0–P2 (§0.1) declare that friction is a defect — so measure it
    like one. **LOCAL-ONLY, zero egress** (same posture as `runtime/telemetry.js`: never egresses; must pass the §19 #5
    typed egress-serializer allowlist once L2 lands): (a) consent prompts per task; (b) **re-prompts inside an
    already-granted scope — counted as a DEFECT (P2 violation), target ZERO**; (c) time from grant to first autonomous
    action; (d) operator-marked false stops ("this block was wrong"). These become first-class quality signals next to
    FP/FN, wired to BOTH consumers: (1) the **ADR-049 graduation gates** — a floor whose enforcement would nag fails
    its graduation gate even at zero FP; (2) the **L2/L4/L3 loop** — each friction event becomes a concrete,
    **guard-routed improvement PROPOSAL (suggestion-only, never auto-applied)**, e.g. a better-shaped scope template,
    so the product learns to get out of the user's way wherever it is safe to. Delivery: harness-level counts in PLAN
    Phase 1 calibration reports; durable counters land with L2 (PLAN Phase 4); consumed by L4/L3 (Phases 5/7).
    *Serves P0 directly; instrumentation only; no floor or replay surface touched.*

---

## 20. GAP register (quick scan)

| # | Item | Vision says | Reality | Severity |
|---|---|---|---|---|
| G1 | Victim-aware enforcement (§4) | HARM_OTHERS hard-block vs HARM_SELF warn-then-obey | Not in code; only credential-egress (F27/F28) touches multi-party harm; content-blind. Honest-scoped (ADR-051, §19 #4) + structured-PII split (decision 6): credential/secret subset enforced today, a near-term **bulk structured-PII floor** scheduled; only **unstructured/contextual** PII routed to point (b); HX1–HX3 reframed as the guard's deterministic mechanical stops | **High** |
| G2 | Model content contract (§5b, §6) | Generation-layer refusal + decoy artifact | Artifact landed (`references/CONTENT-CONTRACT.md` v1.0.0: refusal shape, decoy hard constraint, carve-out, absolute tier, instruction template, red-team checklist); instruction wiring into harness surfaces NOT-YET | **Med-High** |
| G3 | Content/identity harm floors (§7) | CSAM, suicide-method refusal, sexual/explicit, fabricated-real-person, publish-private-data, intimate-imagery, surveillance, fraud, forgery, stalk | Specified in CONTENT-CONTRACT.md v2.0.0 (CSAM + suicide + sexual/explicit Red Line A at the absolute tier; Red Line B *reversed 2026-06-13* to a deception+harm rule, §7.3; third-party set merged on §19 #4 sign-off); no generation-layer enforcement yet (depends on G2 wiring) | **High** |
| G4 | Hard-exception #1 coverage (§4, §7) | "Personal data to an external party = no" | **Reconciled (ADR-051, §19 #4) + amended (decision 6):** deterministic guarantee = credential/secret subset (F27/F28) today + a near-term **bulk structured-PII floor** (emails/phones/IDs/cards/IBANs above threshold); only **unstructured/contextual** PII routed to point (b); under default-deny egress (decision 14) the destination gate is primary and these floors are defense-in-depth | **Med-High** |
| G5 | 0.2.0 DoD #5 (§10, §17) | Hermes adapter + real-run FP/FN at hard exceptions | Hermes absent; no measured error rates | **Med-High** |
| G6 | `TAMPER_WITH_SAFETY_CORE` (§3, §7, §8) | Named absolute floor | Property enforced at CI/build-time + structurally; no runtime floor of that name. Scoping decided (Q7, ADR-050): inviolable runtime floor over the installed guard under `~/.lilara`; build in PLAN Phase 3 | **Med** |
| G7 | Auto-update (§16) | Background check + `lilara upgrade` | NOT-YET | **Low** |
| G8 | Telemetry wording (§16) | NONE by default | Local-only log on by default (no payloads, no egress) | **Low** |
| G9 | ADR decision-debt (§16) | Clean decision index | 2 number collisions (frozen as A/B) + 3 genuinely open ADRs (019, 022A, 048) after the 2026-06-12 header reconciliation | **Low** |
| G10 | L4 orchestration capabilities (§1, §13) | Auto-select + multi-skill merge/compose + auto-create skill/agent + cheap routing + learn-from-results | Only single-lane static routing built; merge/compose, auto-create, and learning loop all NOT-YET (depends on L2; sequenced last) | **Low** (planned layer) |
| G11 | Hook/adapter auto-creation (§13) | May propose, but NEVER auto-apply — manual / human-approved always | Gated-to-manual: no auto-apply path exists — intended end state, not a gap | **n/a (control)** |
| G12 | Default posture (§18 table) `[CC-PROPOSED]` | L1 "fail-closed" guard protecting unattended runs | Out of the box nothing halts today: `LILARA_ENFORCE=0`, consent `off`, F28/F29 inert (so decision 2's own-wipe snapshot+confirm is inert until `LILARA_DELETE_COORD` is on), F23 observe-only. **Target (decision 12, ADR-049 amended):** secure-by-default is the end-state — the **definitional tier ships ON at install immediately** (F3, F27, tamper-floor; content red lines once point (b) is wired); heuristic floors graduate behind their FP budget. Gap = the definitional-tier-on work + per-flip graduations | **High** |
| G13 | License file (§16) `[CC-PROPOSED]` | Licensing decided consistently with no-copyleft | No `LICENSE` file at repo root; licensing/business model `[OPEN]`; pre-launch blocker alongside D23 | **Med** |
| G14 | ADR decision-debt (§16, App. B) `[CC-PROPOSED]` | Reliable decision index | Headers reconciled with commit-cited evidence 2026-06-12: 022B/023/024/025/028/029 flipped to Implemented, ADR-032 closed; remaining open 019, 022A, 048; collisions frozen as A/B | **Low** |
| G15 | Default-deny egress + network backstop (§14, §21) `[CC-PROPOSED]` | Deny all outbound except user-approved destinations, backed by a network-level egress control | NOT-YET — decision 14 (2026-06-13) committed the model and deleted the old "enumerated egress" non-goal, but today's coverage is still the enumerated F27/F28 + (scheduled) structured-PII floor; the approved-destinations contract, the destination-gate flip, and the firewall/egress-proxy backstop are scheduled in PLAN, not built | **High** |

---

## 21. Design limitations & non-goals

Distinct from the §20 GAP register. **GAP = "agreed in the vision but not built yet"** (closed by implementation).
**Non-goal = "the guard will NOT catch this even when fully built, by design"** — a deliberate boundary of what a
deterministic, content-blind, host-resident action guard *can* be. **Owner adopted #1/#3/#4/#5 below as `[LOCKED]`
non-goals (2026-06-13); the former "egress channel coverage is enumerated, not universal" non-goal was DELETED —
superseded by the default-deny egress model (decision 14).**

- **Content-blindness `[LOCKED]`.** The deterministic Node action-guard inspects **command/tool actions** (the canonical
  Action-IR), **not model-generated natural-language content**. This is **no longer a coverage weakness**: under
  default-deny egress (§8, §14) the guard gates on **where data goes**, not on what the content means, so content the
  model writes cannot reach a non-approved destination regardless of meaning. Semantic harm in generated *content* is
  owned by enforcement-point-(b) (the model content contract, §5b), a separate layer (G2/G3).
- **General UNSTRUCTURED / contextual third-party PII `[LOCKED]` (amended 2026-06-13 per the structured-PII split).**
  The deterministic guard enforces two structured egress subsets — the **credential/secret subset** (F27/F28) and a
  near-term **bulk structured-PII floor** (emails / phones / national-residence IDs / cards / IBANs above a threshold).
  What remains a non-goal is **unstructured / contextual** third-party PII (a name in free prose): at the tool boundary
  it is byte-identical to the user's own data (no ownership signal; ADR-036), so it is owned by enforcement-point-(b),
  not by another deterministic floor. Under default-deny egress this is **defense-in-depth** behind the destination gate.
- **Semantic prompt-injection is not "detected" by meaning — intentionally `[LOCKED]`.** Lilara does **not** read
  untrusted text and judge whether it is an injection. Defense is **structural**: taint-tracking (F10, F23) marks
  untrusted-sourced data, and action-gating (floors + consent + default-deny destination) caps what any agent — injected
  or not — may *do* and *where it may send*. Injection can change intent but cannot widen authority (§9). The absence of
  a semantic injection classifier is a **deliberate design choice**, not a gap to close — a content-understanding
  detector is exactly the non-deterministic trap the first-law generator avoids (§2).
- **Host-trust assumption `[LOCKED]` (narrowed 2026-06-13).** The guard **trusts the host it runs on.** A compromised
  host, a tampered dev `runtime/` source tree, or altered baseline files (`artifacts/lattice-baseline.sha256`,
  `artifacts/*/baseline.json`) are **outside the runtime threat model** — mitigated by **hash baselines + CI** at
  build/review time (§3, §18). **Narrowing:** the installed-guard **tamper floor** (ADR-050, §3) IS a committed
  *runtime* mitigation for one specific vector — modification of the installed guard under `~/.lilara` during a task —
  so that vector is no longer fully out-of-model. Broad host compromise (a process that has already subverted the host)
  remains out of the runtime model. (See §19 #1.)

---

## 22. Threat model / adversaries `[CC-PROPOSED]`

The adversaries the design reasons about, and how each is addressed (or explicitly not). This makes the full set explicit
— several were implicit across §9 (injected agent) and §12 (self-modifying loop). The whole section is `[CC-PROPOSED]`;
one line per adversary: **vector → responding floor/mechanism → residual gap.**

| Adversary | Vector | Responds | Residual gap |
|---|---|---|---|
| (a) Malicious or careless **user** | Authorizes a harmful/destructive action within his own domain | Contract + consent gate (scoped grant, deterministic prompt); inviolable floors no contract can demote (F27, F3, …); deletion-coordination snapshot (F29) | Sovereign over himself by design — harm-to-self is "warn once, then obey" (§4); the HARM_SELF persuasion path itself is NOT-YET in code (G1) |
| (b) Prompt-**injected / manipulated agent** | Agent intent hijacked to exfiltrate / destroy / exceed scope | Action-gating: floors + consent cap *authority* regardless of intent; injection cannot widen what the agent may DO (§9) | Only modeled sinks are covered (§21); content the agent is steered to *write* is content-blind (§21) |
| (c) **Injected external content** (taint source) | Untrusted file/tool output carries an instruction or a staged secret | Taint-tracking F10 (read→command correlation) + F23 kill-chain + F28 staged cross-call exfil; window redacted at rest (ADR-045) | F23 enforce is opt-in (`LILARA_KILL_CHAIN_ENFORCE=1`, §19 #9); taint sinks are enumerated (§21) |
| (d) **Misbehaving / self-modifying agent loop** | L3 loop tries to weaken the guard gradually ("policy-laundering") or is steered by poisoned content | Inviolable tier unreachable by `learned-allow` (unreachability tests, §3, §12); self-improvement is suggestion-only, through the guard; hooks/adapters never auto-applied (§13) | L3 is NOT-YET (no code); the gradual-weakening regression gate is proposed, not built (§19 #6) |
| (e) **Compromised host / tampered safety-core** | Attacker edits `runtime/` source or baseline files on the host | Out of the **runtime** model by design (§21 host-trust); mitigated by hash baselines (`lattice-baseline.sha256`) + CI gate `check-inviolable-tier.sh` at build/review time | No runtime floor fires on safety-core writes (G6; open question §19 #1) |
| (f) **Supply chain** | A malicious dependency or upstream copy injects code | **Zero external dependencies** (no `package.json`; Node built-ins only, §18) removes the dependency attack surface; clean-room rewrite avoids upstream code | Tampering of Lilara's own committed source is row (e), not this; an npm-distribution package (if adopted, §16) would reintroduce a channel to secure |

---

## 23. Roadmap directions (owner-raised) `[OPEN]`

> Owner-raised (Khouly) forward directions. **23.A's direction is now a committed `[LOCKED]` decision (2026-06-13) —
> only its design/timing stay `[OPEN]`;** 23.B remains a direction. The *intent* is owner-set; designs stay `[OPEN]`
> until sequenced. They **extend** the build order (§1) and the L5 shell (§14) without weakening any `[LOCKED]`
> decision. Inline `[LOCKED]` markers flag guardrails that are already settled and that bind these directions.

### 23.A — Lilara as a control plane / orchestration hub `[LOCKED]` direction (design `[OPEN]`)

**Direction `[LOCKED]` (owner decision 2026-06-13; design/timing remain `[OPEN]`, sequenced LAST per §1.5).** The user
**registers** the external tools he wants (e.g. Claude Code, Antigravity, Hermes, OpenClaw) into Lilara, then either runs
them *from* Lilara or has Lilara **run/launch** them on his behalf — while still seeing the live **task/queue**. Lilara
becomes the **single surface** to control and leverage all his agents, with the **guard always in front of every wrapped
tool's actions**. This is the **desktop control-plane** — one of the **three product forms** (§14, alongside the plugin
and the standalone tool/agent). **Live-visibility** is required: when Lilara runs a task on a wrapped tool the user
**SEES it happen**, never in the background. **Preferred control surface: a web dashboard**, built on the existing
read-only `dashboard-server.js` substrate (§14, §24 Q6).

**How it builds on what exists.**
- It is the **"guest→host inversion"** already named as the largest architectural decision, sequenced LAST (§14) — this
  direction **extends** it from a wrapping mechanism into a full **control / task-dashboard surface**.
- The **multi-harness adapter set** (§16, §17: claude, codex, openclaw, opencode, clawcode, antegravity) is the
  **substrate** — registration and launch reuse the same per-harness adapters that already put the guard in front of
  each tool.
- Consistent with the **competitive stance `[LOCKED]`** (§16): Lilara is a control plane **over** OpenClaw/Hermes, not
  subordinate to them — beachhead/dogfood now, control surface later.
- Ties to the **L5 shell + inbound-channel work** (§14): a control plane the user drives needs the inbound approval
  channel currently **DEFERRED** until approver-authentication is designed.

**Design flag to record (not resolve) `[OPEN]`.** When Lilara **launches** other agents it stops being only a hook
*inside* a host tool and becomes an **execution surface** itself. That **widens the host-trust / privilege boundary**
(§21 host-trust non-goal; §22 row (e)) and makes **Lilara itself a higher-value target**. The direction is **on-mission**
— everything then flows *behind* the guard, which is exactly the point — but it must be designed **deliberately**: the
larger the surface Lilara runs, the more its own integrity (host-trust, baseline tamper-resistance, inbound-approval
authentication) has to be hardened first. Recorded here as an open design constraint, not a resolved approach.

### 23.B — Study strong existing repos → rewrite + redesign best-in-class components `[OPEN]`

**Intent.** Survey powerful existing repositories and **reimplement best-in-class** hooks, skills, agents, runtime, and a
**Hermes** layer, so Lilara becomes a tool people *want* — matching or exceeding the strongest prior art on capability
while keeping the safety core intact.

**License guardrail `[LOCKED]` (first-order, non-negotiable).** This direction MUST run through the **clean-room rewrite
invariant** (§18) and the **no-AGPL/GPL/SSPL/BSL rule**:
- **Read what a repo *does*, then reimplement WITHOUT looking at its source.** Behavior in, original code out.
- **Check each source repo's license BEFORE drawing from it.** Any copyleft / BSL / source-available license is
  **flagged before any code is touched, not after**.
- **Quality-and-license, never copy.** The clean-room path protects *both* the no-copyleft rule *and* code quality — it
  is a hard gate on this entire direction, not a guideline.

This guardrail is already `[LOCKED]` in §1 (weekly loop: "NEVER copy-paste — always redesign and rewrite better") and
§18 (clean-room rewrite); it is restated here because 23.B is precisely the activity that rule exists to govern. The
Hermes layer named here is also the open half of 0.2.0 DoD #5 (§10, §17) — building it satisfies that carried-over item
under the same clean-room gate.

---

## 24. R2 review questions — owner decisions `[LOCKED]` (decided 2026-06-12)

> Raised by the 2026-06-12 review revision; **all seven answered by the owner on 2026-06-12** and folded into the
> sections they touch. This table is the decision record. Policy ADRs created: **ADR-049** (default-posture
> graduation, Q2) and **ADR-050** (tamper-floor scoping, Q7). Also decided in the same memo: the first-order design
> tenets **P0–P2** (§0.1). Recorded as **D50** in `DECISIONS.md`.
> **Follow-up acceptance (owner, 2026-06-12, on review of this revision):** §19 #15 friction telemetry promoted
> `[CC-PROPOSED]` → `[LOCKED]` (local-only / zero egress, suggestion-only into the learning loop); §19 #11–#13 marked
> as DEFERRED PROPOSALS (placeholders, not commitments).

| Q | Touched | Decision (owner, 2026-06-12) |
|---|---|---|
| **Q1** | §1 vs §13/§14/§15 | **Confirmed:** §1.5 is canonical — L1 (done) → L2 → L4 → full L5 (guest→host) → L3 absolutely last → §23.A UI after all. §13/§15 now point at §1.5. |
| **Q2** | §18 posture | **Secure-by-default, evidence-gated, one ADR + owner sign-off per flip** (ADR-049). First wave: `LILARA_ENFORCE=1` default for the catastrophic inviolable floors (F3, F14, F10, F27) once Phase-1 calibration shows near-zero false positives. F28/F29/F23 stay opt-in until each meets its own FP budget, then flip one at a time. Env override always retained. Secure-by-default must NOT mean nag-by-default (P1/P2). |
| **Q3** | §5 | **Renamed:** enforcement point (c) is "deterministic lattice precedence + consent gate"; determinism committed as a design principle (deterministic = replayable = auditable). The rename does not hide point (b) — the model content contract stays a tracked gap (G2). |
| **Q4** | repo hygiene | **Archive** `ROADMAP.md` to `references/archive/` (keep history, don't delete); root stub points at this document as the single source of truth. |
| **Q5** | §0 / §11 prose | **Keep the capable-guard voice; reword** the "understands the user better than themselves" line toward user-sovereignty (done in §1 and §11) — it read as overreach to a control-conscious security audience. **REVERSED 2026-06-13 (decision 8, §25):** the ambitious framing ("over time, better than he knows himself") is RESTORED as the owner's intent; user-sovereignty coexists as a separate guarantee. |
| **Q6** | §14 / §23.A | **The existing dashboard IS the seed of §23.A.** Build the control plane on `dashboard-server.js` (audited zero-dep, redaction-fail-closed substrate). Mutating endpoints only in Phase 8, behind Phase-6 approver-auth; until then the web surface may only NARROW authority. Read/write split recorded as the §14 standing constraint. |
| **Q7** | §7 + §19 #1 | **Scope the runtime tamper floor to the INSTALLED guard under `~/.lilara`** (not the dev checkout — owner is customer #1 and must be able to edit Lilara's own source). It **stays inviolable** — NOT consent-demotable (a demotion path is what an attacker would target; it would void §7's "absolute"). CI hash-baseline on the source repo stays as defense-in-depth (ADR-050). |

---

## 25. 2026-06-13 scope re-verification — owner decisions `[LOCKED]`

> A one-question-at-a-time re-verification of this document against owner INTENT (the §19 #4 lesson: a `[LOCKED]` tag
> means "owner decided," not "owner re-verified the wording still means what he intended"). All 16 decisions below were
> owner-confirmed 2026-06-13 and folded into the sections they touch; this table is the decision record. Several
> **correct drift** in previously-locked text — noted as REVERSALS. ADRs: amended **ADR-049** (definitional-tier
> on-at-install) and **ADR-051** (Red Line B deception+harm); new Proposed ADRs for default-deny egress and the
> structured-PII floor. Recorded as **D52** in `DECISIONS.md`.

| # | Touched | Decision (owner, 2026-06-13) |
|---|---|---|
| 1 | §0, §0.1 | Productivity & security are **CO-EQUAL** (drop "security in service of productivity"). Tie-breaker: security wins only when an action crosses into non-consented territory (data leak / deletion beyond authorization); inside granted scope productivity rules, no nagging. *(Reverses the 2026-06-12 subordination wording.)* |
| 2 | §4 | HARM_SELF gains carve-out (b): wholesale/irreversible wipe of the user's **own** data → snapshot + one confirm (reuse F29), then execute — **not a red line**. "No block on suspicion" reaffirmed. |
| 3 | §6, CONTENT-CONTRACT | Decoy is **disclosed, not silent** (explicit "fictional / won't work"); CBRN/weapons in fiction = narrative-only, no procedural skeleton. |
| 4 | §7, CONTENT-CONTRACT §7.2 | Red Line A (sexual/explicit) **re-verified verbatim** — flat refusal, any subject, no medical exception, never demotable. No change. |
| 5 | §7, CONTENT-CONTRACT §7.3 | Red Line B **REVERSED** from blanket → **deception+harm** test (never the consent claim). Allow benign edits (own photo, background swap, retouch, style) because the output is benign; refuse deceptive deepfakes / false-situations / intimate-of-real-person even when consent is asserted. New **B-text** rule (defamatory-as-real refused; labelled fiction/satire allowed). Amends ADR-051; CONTENT-CONTRACT → v2.0.0. |
| 6 | §1, §4, §20, §21 | HX1–HX3 = mechanical stops (kept). **Bulk structured PII** (emails/phones/IDs/cards/IBANs above threshold) → external host = NEW near-term deterministic floor (reuse F27/F28 mechanism); only unstructured/contextual PII → point (b). |
| 7 | §1, §12, §13 | Self-improvement = **one engine, four sources** (memory; better methods; creating skills/hooks/adapters/agents; weekly learning on user interests). One absolute limit: never touch the guard's red lines. Tier-(a) crossable only with explicit approval; tier-(b) never. Hooks/adapters human-approved always; created skills/agents pass the guard as untrusted. |
| 8 | §1 L2, §11 | Memory ambition **RESTORED** ("over time, better than he knows himself"). *(Reverses the 2026-06-12 Q5 softening; user-sovereignty coexists.)* |
| 9 | §8, §11 | Consent: task = grant; gather all consent upfront, grouped by impact band, ask once; inviolable red lines mode-independent; **three impact bands** (silence=consent for band 3 only). Autonomy as a redesigned risk-calibrated dial recorded `[ADVISORY]`. |
| 10 | §0, §14, §23.A | Control-plane direction **promoted `[OPEN]` → `[LOCKED]`** (design open). **Three product forms** (plugin — full value stack; standalone; desktop control-plane). Live-visibility; web dashboard preferred. Name: Lilara / ليلارا. |
| 11 | §3, §12 | Installed-core **tamper runtime floor** (ADR-050) = runtime enforcement of #7's absolute limit. |
| 12 | §18, §20 | **Secure-by-default**: definitional tier ON at install unconditionally (F3, F27, tamper; content red lines once point (b) is wired); heuristic floors graduate behind FP budget. **Amends ADR-049.** |
| 13 | §0, §1 | Core thesis "**why Lilara exists**": collect powerful capabilities, clean-room rewrite, full power AND safety; #1 fear = silent exfiltration; data stays local, leaves only to approved destinations, weekly re-confirm. |
| 14 | §8, §11, §20, §21 | Egress model **flipped to DEFAULT-DENY ALLOWLIST**; non-goal #2 **deleted**; approved-destinations contract + weekly re-confirm; network-level backstop; promote §21 non-goals #1/#3/#4/#5 to `[LOCKED]`. |
| 15 | §16, §11 | Product-improvement **artifact-sharing**: share the system's own scrubbed/generalized artifacts (NOT user data) — exempt from default-deny, default-ON, opt-out always, privacy never paywalled. Supersedes the old telemetry framing + §19 #8. |
| 16 | §16 | Business model / licensing **DEFERRED** — build the full product first, decide later; don't tier features now; privacy not a paywall; repo private, license `[OPEN]`. |

**§19 batch dispositions (2026-06-13):** #1 RESOLVED · #2 landed · #3/#6/#7/#14 ACCEPTED → `[LOCKED]` · #4 AMENDED ·
#5 ACCEPTED (enabler for 14/15) · #8 DROPPED · #9 decided (via 12) · #10 landed · #11 PRINCIPLE LOCKED ·
#12/#13 accepted principles (impl deferred) · #15 already `[LOCKED]`.

---

## Appendix A — Floor inventory (current code)

Source: `runtime/floor-codes.js`, `runtime/decision-lattice.js`, `runtime/decision-engine.js`, and the `runtime/floor-*.js`
modules. "Inviolable" = `tier:"inviolable"`, `demotableBy:[]` (never demotable, hash-pinned).

**Lattice note (status-corrected 2026-06-12):** the precedence lattice (`runtime/decision-lattice.js`) contains
**exactly 30 floor entries** (F1–F21, F23–F29, plus F14b and F18-D007); its tier vocabulary is **only**
`inviolable` | `demotable` — other tier-like words in this table are descriptive shorthand. Two rows below are **not
lattice floors**: **F22** exists only as a code-registry entry (`floor-codes.js`) and is never evaluated in `decide()`;
**F23b** is a PostToolUse `reasonCode` signal emitted by `post-adapter-factory.js`, not a precedence entry. They remain
listed for code-registry completeness with their real shape stated.

| Floor | Name | Primary file | Tier | Status |
|---|---|---|---|---|
| F1 | kill-switch | `runtime/decision-engine.js` | inviolable | BUILT |
| F2 | contract-hash-mismatch | `runtime/decision-engine.js` | inviolable | BUILT |
| F3 | critical-risk | `runtime/decision-engine.js` (+ `runtime/risk-score.js`) | inviolable | BUILT |
| F4 | secret-class-C | `runtime/decision-engine.js`, `runtime/secret-scan.js` | demotable (operator-token; consent neutralized for scan-detected, ADR-047) | BUILT |
| F5 | strict-gated-no-cover | `runtime/decision-engine.js` | inviolable | BUILT |
| F6 | posture-strict-no-cover | `runtime/decision-engine.js` | inviolable | BUILT |
| F7 | intent-unknown-strict | `runtime/decision-engine.js` | inviolable | BUILT |
| F8 | protected-branch | `runtime/decision-engine.js` | inviolable | BUILT |
| F9 | session-risk-floor | `runtime/decision-engine.js` | demotable (contract-allow) | BUILT |
| F10 | taint-floor | `runtime/taint.js` | inviolable | BUILT (ADR-046 pure) |
| F11 | validity-window | `runtime/decision-engine.js` | inviolable | BUILT |
| F12 | mcp-deny | `runtime/decision-engine.js` | inviolable | BUILT |
| F13 | skill-deny | `runtime/decision-engine.js` | inviolable | BUILT |
| F14 | budget-exceeded | `runtime/decision-engine.js` | inviolable | BUILT |
| F14b | session-over-duration | `runtime/decision-engine.js` | inviolable | BUILT |
| F15 | execution-envelope | `runtime/envelope.js`, `runtime/decision-engine.js` | inviolable | BUILT |
| F16 | ambient-authority | `runtime/floor-ambient-authority.js` | inviolable | BUILT |
| F17 | cross-agent-lock | `runtime/floor-cross-agent-lock-eval.js` | inviolable | BUILT |
| F18 | network-egress | `runtime/network-egress.js` | demotable (consent) | BUILT |
| F18-D007 | plaintext-target-blocked | `runtime/network-egress.js` | inviolable | BUILT |
| F19 | output-channel-exfiltration | `runtime/output-exfil.js` | demotable (operator-token suspicious; consent) | BUILT |
| F20 | change-intent-drift | `runtime/change-intent.js` | demotable (operator-token medium; consent) | BUILT |
| F21 | compaction-survival | `runtime/compaction-survival.js` | inviolable | BUILT |
| F22 | commit-format-violation | `runtime/floor-codes.js` | n/a — **not a lattice floor** (code-registry entry only; never evaluated in `decide()`) | registry-only |
| F23 | data-flow-kill-chain | `runtime/floor-f23.js`, `runtime/provenance-graph.js` | inviolable | BUILT (observe-only unless `LILARA_KILL_CHAIN_ENFORCE=1`) |
| F23b | mcp-result-injection | `runtime/post-adapter-factory.js` (PostToolUse) | n/a — **not a lattice floor** (PostToolUse `reasonCode` signal feeding F23) | BUILT (signal) |
| F24 | credential-persistence-write | `runtime/floor-credential-persist.js` | demotable (`scopes.files.allow`) | BUILT |
| F25 | mcp-arg-danger | `runtime/floor-mcp.js` | inviolable | BUILT |
| F26 | mcp-registration-write | `runtime/floor-mcp.js` | demotable (`scopes.files.allow`) | BUILT |
| F27 | secret-egress-external | `runtime/floor-secret-egress.js` | **inviolable** | BUILT (single-call) |
| F28 | taint-egress-consent | `runtime/floor-taint-egress.js` | demotable (consent) | BUILT (cross-call; active when `LILARA_TAINT_EGRESS=1`) |
| F29 | destructive-delete-coord | `runtime/decision-lattice.js`, `runtime/snapshot.js`, `runtime/pretool-gate.js` | demotable (consent) | BUILT (active when `LILARA_DELETE_COORD=1`) |

Floors that *do not* exist (vision items with no runtime floor): `TAMPER_WITH_SAFETY_CORE` (property only — G6), CSAM,
suicide/self-harm-methods, publish-private-data-of-others, publish-intimate-imagery, covert-surveillance,
fraud-deception, forgery-impersonation, stalk-locate-person, and a generic personal-data (non-credential) egress floor.

The L4 **hook/adapter auto-apply red-line** (§13, G11) is likewise **a manual/process control, not a runtime floor** —
the same shape as the `TAMPER_WITH_SAFETY_CORE` property (G6). The system has no auto-apply path for self-written
hooks/adapters; that red-line is held by review discipline (human-approved always), not by an action floor.

---

## Appendix B — ADR index & decision-debt

ADR-001..006 are recorded as decisions D1–D6 in `DECISIONS.md` (not separate files). ADR-007..053 live in `references/`
as **49 files** (two number collisions; count corrected 2026-06-13 from a stale "46" — ADR-051 had been added without
updating this index, and ADR-052/053 land with this revision). Status is read live from each ADR's header. **Collisions:** ADR-021 and ADR-022 each exist as two different files,
disambiguated here as (A)/(B) — frozen, not renumbered, because ADR numbers are cited in code comments, lattice notes,
and CHANGELOG entries. (For the same reason, the 2026-06-12 default-posture graduation policy takes **ADR-049** — the
owner's memo referenced "ADR-048" for it, but that number was already allocated to the F4 demotion design.)

**Complete index:**

| ADR | Title | Header status |
|---|---|---|
| 007 | Canonical Action-IR + lattice | Accepted |
| 008 | Unicode & precedence defense | Accepted |
| 009 | Ambient-authority classifier (F16) | Accepted |
| 010 | Output-channel exfiltration (F19) | Accepted |
| 011 | State portability | Accepted |
| 012 | Change-intent drift (F20) | Accepted |
| 013 | Auto-snapshot | Accepted |
| 014 | Audit-grade receipts | Accepted |
| 015 | Notifications | Accepted |
| 016 | Coachable floors (F21) | Accepted |
| 017 | Provenance graph (F23) | Implemented |
| 018 | Trusted-server dual-use detection | Implemented |
| 019 | Eval-corpus shape coverage + eval-dynamic-exec FP surface | **Proposed** (re-affirmed 2026-06-12; scheduled PLAN Phase 1) |
| 020 | MCP bypass pattern parity | Implemented |
| 021 (A) | Bench-perf-regression baseline strategy | Implemented |
| 021 (B) | Bounded recursion for canonical-json (depth cap) | Implemented |
| 022 (A) | Strengthen `check-no-horus.sh` for bare lowercase token | **Proposed** (re-affirmed 2026-06-12) |
| 022 (B) | Fail-closed F25/F26 floor recovery | Implemented (reconciled 2026-06-12; commit 40784ca, PR #106) |
| 023 | Unified command classification gateway | Implemented (reconciled 2026-06-12; all four call sites dual-path, re-baseline via ADR-026 commit 24bf251) |
| 024 | State-dir permission validation | Implemented (reconciled 2026-06-12; `state-dir.js` helpers + consumer rollout via ADR-028/032) |
| 025 | Caller-level fail-open cascade in `decide()` | Implemented (reconciled 2026-06-12; commit 7618e0d + 40784ca) |
| 026 | Receipt commandClass/irHash rebaseline | Accepted |
| 027 | Decision-key raw-only classification | Accepted |
| 028 | State-dir validation: remaining consumers | Implemented (reconciled 2026-06-12; commit 095c2ba) |
| 029 | Pin-store corruption = silent full reset | Implemented (reconciled 2026-06-12; commit acb524f) |
| 030 | Unguarded advisory calls in `decide()` | Implemented |
| 031 | Load-bearing pre-floor input reads | Implemented |
| 032 | State-dir consumers full sweep | Implemented (closed 2026-06-12; PRs #119/#120 had both shipped 2026-06-03) |
| 033 | MCP-pin stateDir fallback | Implemented |
| 034 | MCP inbound response inspection | Implemented |
| 035 | Consent gate (§8) | Implemented |
| 036 | Inviolable protected tier (§3) | Implemented |
| 037 | Staged-exfil taint (F28) | Implemented |
| 038 | Delete-coordination (F29) | Implemented |
| 039 | Notify TLS floor | Implemented |
| 040 | Bench tail-jitter robustness | Implemented |
| 041 | Journal command redaction | Implemented |
| 042 | Branch-override grant guard | Implemented |
| 043 | Provenance test coverage | Implemented |
| 044 | Bench baseline architecture | Implemented |
| 045 | Taint-window redaction | Implemented |
| 046 | Taint-window injection (cross-call purity, F10) | Implemented |
| 047 | F4 consent payloadClass propagation | Implemented |
| 048 | F4 demotion path design | **Proposed (open design question)** |
| 049 | Default-posture graduation policy (Q2) | Accepted (policy) |
| 050 | Tamper-floor scoping — installed guard only (Q7) | Accepted (design decision) |
| 051 | Content red lines (A & B) + L1 hard-exception reframe (§19 #4) | Accepted; **amended 2026-06-13** (Red Line B → deception+harm rule; B-text rule added) |
| 052 | Default-deny egress allowlist + approved-destinations contract + network backstop | **Proposed** (decision 14, 2026-06-13) |
| 053 | Bulk structured-PII egress floor (emails/phones/national-residence IDs/cards/IBANs) | **Proposed** (decision 6, 2026-06-13) |

**Decision-debt status (reconciled 2026-06-12** — §16, §19 #7, G14): the Phase-0 evidence-based reconciliation flipped
022B/023/024/025/028/029 to Implemented (each ADR header cites its implementing commit) and closed ADR-032 (PRs
#119/#120 had both shipped 2026-06-03). Remaining open before 0.3.0: ADR-019 (PLAN Phase 1 implements it), ADR-022A
(gate strengthening, owner decision), ADR-048 (F4 demotion design — owner queue), and the two new Proposed ADRs from the
2026-06-13 re-verification: **ADR-052** (default-deny egress) and **ADR-053** (structured-PII floor). Collisions stay
frozen as A/B.

---

*End of authoritative scope. Status blocks reflect master `57089aa` (VERSION 0.2.1) as of 2026-06-12 (R2 review
revision: status corrections verified against code; `[CC-PROPOSED]` additions in §18, §19 #10–#14, §20 G12–G14. R2.1:
owner decisions Q1–Q7 encoded 2026-06-12 — tenets P0–P2 added as §0.1 `[LOCKED]`, §1.5 confirmed canonical, §24 is the
decision record, ADR-049/ADR-050 created, ROADMAP.md archived; §19 #15 friction telemetry accepted → `[LOCKED]`;
§19 #11–#13 marked DEFERRED PROPOSALS). **R3 (2026-06-13):** full intent re-verification — 16 owner decisions + the §19
batch encoded (§25 is the decision record); decisions 1 and 8 **reverse** prior locked wording (productivity-
subordination; memory-ambition softening); §21 non-goals #1/#3/#4/#5 promoted to `[LOCKED]` and #2 deleted (default-deny
egress, decision 14); §19 #3/#5/#6/#7/#11/#12/#13/#14 accepted → `[LOCKED]`, #8 dropped; ADR-049/ADR-051 amended,
ADR-052/053 proposed; CONTENT-CONTRACT → v2.0.0; locked-line baseline rebaselined in the same diff. When code changes,
update the relevant Status block and the GAP register; the rendered vision (and its `[LOCKED]` tags) changes only by
owner decision — enforced by `scripts/check-scope-tags.sh`.*
