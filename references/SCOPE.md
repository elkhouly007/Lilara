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

**Status snapshot:** VERSION `0.2.1` · master `57089aa` · 2026-06-12 · 6 adapters · 30 lattice floors (F1–F21, F23–F29,
plus F14b and F18-D007) · 2 non-lattice signals (F22 registry-only, F23b PostToolUse signal — see Appendix A note).

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

Zero-dependency Node runtime guard for AI coding agents → growing into a trustworthy bounded-autonomy platform. GitHub
`elkhouly007/Lilara`. Identity: an impressive, smart guard that grows and improves with you. **Safety philosophy: safety
exists to REDUCE the user's steps, not add gates.** Customer #1 is the owner himself — the product he uses *is* what
customers get.

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
2. **L2 — Very strong memory.** Understands the user better than they understand themselves; learns from every task and
   at the end of each day.
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
machine; **HX3** = deletion without coordination. (Naming only — the locked wording above is the definition.)

**Build order `[LOCKED]`:** L1 (consent) → thin L5 consent transport → L2 memory → L4 skills → L3 self-improvement LAST.
**Moat = the CORE.** Orchestration + shell are commodity.

**Weekly loop:** research competitors + free/OSS communities, find gaps. **NEVER copy-paste — always redesign and
rewrite better** (also the clean-room path protecting the no-AGPL/GPL/SSPL/BSL rule).

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

### 1.5 Canonical sequencing & layer dependencies `[CC-PROPOSED]`

This block exists because the document previously said "sequenced LAST" about three different things (§1: L3; §13: L4;
§14: guest→host inversion) and §15 orders full L5 between L4 and L3. **One reading reconciles all four** — recorded here
as the single canonical statement; §13/§14/§15 point here instead of carrying their own ordering claims. *It interprets,
but does not change, the `[LOCKED]` build order in §1; owner confirmation is requested as Q1 in §24.*

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
  during a task inside the project root; such a write is governed only by the general file-write floors. → see
  `[CC-PROPOSED][OPEN]` #1 in §19.

---

## 4. Enforcement model — who the victim is `[LOCKED]`

- **HARM_OTHERS → hard block,** non-demotable even by signed contract. Fires ONLY when the victim is *established*, via
  (a) definitional to the action class, or (b) deterministic detection (another person's secrets/PII/credentials in
  payload). The user is sovereign over himself and has NO authority to consent away a third party's rights.
- **HARM_SELF → warn + persuade ONCE** (no nagging, no manipulation), then obey. The contract stays sovereign over the
  user's own domain.
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
only as the credential-egress subset. See §19 #4 for a `[CC-PROPOSED][OPEN]` reconciliation of hard-exception #1's
detectability.

---

## 5. Three enforcement points (the Node guard is honestly BLIND to content) `[LOCKED]`

1. **Deterministic action guard (Node, zero-dep)** — stops ACTIONS with a signature (exfil, unauthorized access,
   malware-execution behavior, deletion).
2. **Model content contract (generation layer)** — model instructed to REFUSE forbidden content; the Node guard is
   structurally blind here.
3. **Action-gating + fail-closed advisory classifier** — gates irreversible external actions (publish/upload/deploy);
   can only escalate-to-human or block, NEVER auto-allow, never weaken a floor.

**Status:**

| Point | Status | Evidence |
|---|---|---|
| (a) Deterministic action guard | **BUILT** | All floors fire in `runtime/decision-engine.js`; signatures for exfil (F19/F27/F28), unauthorized access (F17), MCP danger (F25/F26), deletion (F29). |
| (b) Model content contract | **NOT-YET / GAP** | **No artifact exists in the repo** — no prompt template, content-policy file, or documented model instruction enforcing refusal. The whole content-harm surface (§6, plus CSAM and suicide-method refusal from §7) has no representation. See §19 #2. |
| (c) Action-gating + fail-closed advisory | **BUILT** | The lattice + consent gate gate irreversible external actions and can only `block` or route to `consent-required` (`enforcementFor()` in `runtime/decision-lattice.js`); `runtime/floor-consent.js` fails closed and **never auto-allows** (default route = block; any error = block). *Naming delta:* there is no separate named "advisory classifier" component — the role is filled by the lattice precedence + consent gate (whether to rename the vision bullet or keep the name for a future component is raised as Q3 in §24). |

---

## 6. Content-harm categories + decoy policy `[LOCKED]`

Categories (enforced at **generation + action-gating**, NOT as deterministic Node floors): `WEAPONS_FABRICATION`,
`CBRN_HAZMAT_SYNTHESIS`, `MALWARE_CREATION`, `SEXUAL_CONTENT_GENERATION`, `FACILITATE_PERSECUTION_OF_GROUP`,
`ILLICIT_DRUG_SYNTHESIS`.

- **Direct request →** clean refusal + brief reason + legitimate alternative.
- **Fiction/pretext frame →** emit content that *appears* real but is reliably NON-FUNCTIONAL. **HARD CONSTRAINT: fake
  all the way down — ZERO real dangerous specifics.** Decoy scope = functional-harm categories ONLY. **Sexual content is
  NOT decoy-eligible** (clean refusal regardless of framing).

**Status — NOT-YET / GAP-vs-vision.** None of these categories, and no "decoy"/"non-functional" mechanism, exist anywhere
in the repo (code, templates, schemas). This is *correct* for the Node guard (it is content-blind by design — the action
`curl https://x` reveals nothing about content), but it is a **GAP** because enforcement point (b) — the layer that is
*supposed* to own these — has **no artifact at all** (see §5(b), §19 #2). The sexual-content carve-out and the
"fake-all-the-way-down" constraint are likewise unrepresented. Until (b) exists, the content-harm surface is governed
only by whatever the underlying model does on its own, with nothing checked into Lilara.

---

## 7. The closed floor list `[LOCKED]`

**Absolute (never decoy-eligible, never demotable):** CSAM (separate top-priority, likely legal mandatory-report);
`TAMPER_WITH_SAFETY_CORE`; Suicide/self-harm methods (EXCEPTION to the HARM_SELF "warn then obey" rule — refuse method
info + surface crisis resources, do NOT obey).

**HARM_OTHERS group (victim definitional or deterministically detected):** `EXFIL_PERSONAL_DATA_OF_OTHERS`,
`PUBLISH_PRIVATE_DATA_OF_OTHERS`, `PUBLISH_INTIMATE_IMAGERY_OF_REAL_PEOPLE`, `COVERT_SURVEILLANCE`,
`UNAUTHORIZED_ACCESS`, `FRAUD_DECEPTION`, `FORGERY_IMPERSONATION`, `DOS_OR_CRITICAL_INFRA_ATTACK`
(esp. hospital/power/water), `STALK_LOCATE_PERSON`.

**License rule** (AGPL/GPL/SSPL/BSL no-copy) is **NOT** a harm-floor — it is clean-room process discipline tracked
separately.

**Status — vision item → real floor mapping:**

| Vision floor | Real floor in code | Status |
|---|---|---|
| CSAM (top-priority, mandatory-report) | — | **NOT-YET / GAP** (content-layer; belongs to enforcement point (b), which has no artifact). |
| `TAMPER_WITH_SAFETY_CORE` | inviolable-tier *property* (no runtime floor of this name) | **PARTIAL / GAP** — property enforced at CI/build-time + structurally; no runtime floor. See §3, §19 #1. |
| Suicide/self-harm methods (+ crisis resources) | — | **NOT-YET / GAP** (content-layer; no artifact). |
| `EXFIL_PERSONAL_DATA_OF_OTHERS` | F27 `secret-egress-external` (single-call), F28 `taint-egress-consent` (cross-call) | **PARTIAL** — only the credential/key-class subset; general personal data is not detectable at the boundary. |
| `PUBLISH_PRIVATE_DATA_OF_OTHERS` | — | **NOT-YET** (no floor distinguishes "publish" content). |
| `PUBLISH_INTIMATE_IMAGERY_OF_REAL_PEOPLE` | — | **NOT-YET** (content-layer). |
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

"Understands the user better than they understand themselves." **Privacy ARCHITECTURAL, not a promise** — only abstract
enums/counts may leave, never raw content; local-only structured memory, zero cloud deps; no product analytics until the
memory model is proven. **Named threat:** memory-privacy leak via "just a little context for debugging" — needs
typed/by-construction boundaries.

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
`[CC-PROPOSED]` *Sequencing note:* "sequenced LAST" above reads per the canonical statement in §1.5 — after L2, before
L3 (only L3 is absolutely last); owner confirmation requested as Q1 (§24).

---

## 14. L5 — Shell

Manage live tools from one place; **fast-reply AND long-running** modes; reachable via channels. **Architectural pivot
`[ADVISORY]`:** do NOT build another CLI shell — position as an invisible proxy/middleware ("build the thing those tools
plug into"). **Inbound channels (Telegram/WhatsApp approval) DEFERRED** until approver-authentication is designed;
one-way notify ships first. **Guest→host inversion** (Lilara launches/wraps tools vs. being a hook inside them) = the
largest architectural decision, sequenced LAST.

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

`[CC-PROPOSED]` **Standing constraint — dashboard stays read-only until §23.A's real build.** The existing dashboard may
*observe* and may only ever *narrow* authority; it gains no mutating endpoint (launch, approve, grant) before the
control-plane build that §23 sequences after the safety core, and any mutating endpoint then added sits behind the
approver-authentication design that inbound channels already require. This is the constraint that keeps today's shipped
UI from pre-empting the deferred-`[LOCKED]` inbound-approval decision. Whether this dashboard is the *seed* of §23.A or
stays observability-only is raised as Q6 (§24).

---

## 15. Roadmap / versions

**0.2.0 = lock the safety core. 0.3.0 = memory layer (L2) begins. Later = L4 → L5 → L3 (suggestion-only first).** Inbound
channels deferred; guest→host inversion last.

**Status — sequencing honored to date.** Current VERSION is `0.2.1` (a hardening point release on top of the 0.2.0
safety-core lock). The sequencing matches the build order in §1. 0.3.0 (L2) has not started. The single carried-over
0.2.0 item is DoD #5 (Hermes + real-run validation, §10). `[CC-PROPOSED]` *Note:* the "Later = L4 → L5 → L3" prose above
and §1's "thin L5" early slice are reconciled by the canonical statement in §1.5 (thin L5 shipped with L1; *full* L5
lands between L4 and L3); owner confirmation requested as Q1 (§24).

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
- **Telemetry `[ADVISORY, strong]`:** NONE by default; opt-in aggregate only (floor-trigger counts, NO payloads/paths);
  publish the schema. → **Status: PARTIAL (wording drift, spirit honored).** `runtime/telemetry.js` writes **local-only**
  internal events (corruption/migration), **on by default** (`LILARA_TELEMETRY !== "0"`), **never** records
  payloads/commands/paths/secrets, and **never egresses**. Nothing leaves the machine — but a *local log on by default*
  is not literally "NONE by default." See §19 #8.
- **Licensing / business model `[OPEN]`:** MIT vs Apache-2.0 vs open-core — must be consistent with no-copyleft, NOT
  decided. → **Status: OPEN, confirmed.** No `LICENSE` file exists at repo root; DECISIONS.md D23 (trademark clearance
  for "Lilara") is an open pre-launch blocker.
- **Multi-harness `[OPEN]`:** deepen one then fan out vs. polyglot day one. Existing adapters: claude, codex, openclaw,
  clawcode, opencode, antegravity; **Hermes NOT built** (in-scope 0.2.0). → **Status: OPEN.** Six adapters present
  (§17); Hermes absent.
- **Competitive stance `[LOCKED]`:** Lilara will eventually COMPETE with OpenClaw/Hermes — beachhead/dogfood, not a
  permanent dependency. → preserved.
- **Decision-debt (observed):** the ADR set has two number collisions — ADR-021 (bench-baseline-strategy *and*
  canonical-json-depth-cap) and ADR-022 (check-no-horus-bare-token *and* fail-closed-floor-recovery) — a backlog of
  `Proposed`/`Open` ADRs (019, 022A, 022B, 023, 024, 025, 028, 029, **048**), and **ADR-032 uniquely "Partially
  Implemented"** (envelope HIGH finding merged; consumer sweep traced in CHANGELOG but the header never closed). Some
  `Proposed` headers may lag shipped behavior (e.g. ADR-024/028 state-dir conventions appear in CHANGELOG entries) —
  header reconciliation is a hygiene task, see §19 #7 and Appendix B.

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
operator turns on enforce/consent and the per-floor posture flags. That is a deliberate adoption posture (warn-first,
fail-safe), but it must be stated honestly: two of the three hard exceptions (HX1 cross-call half, HX3) are inert at
defaults. Recorded as **G12** in §20; the graduation roadmap (which defaults flip, when, gated on measured FP/FN
budgets) is owner-decided — raised as Q2 in §24.

---

## 19. `[CC-PROPOSED]` additions

Additions introduced by this document. Each **extends** the agreed scope and is individually reviewable. Where an
addition would touch a `[LOCKED]` item, it is raised as `[OPEN]` (never as a change to the locked decision).

1. **`[CC-PROPOSED][OPEN]` — Make `TAMPER_WITH_SAFETY_CORE` a real runtime artifact, not only a property.** The vision
   names it as an absolute floor; the code enforces the *property* (hash baseline + structural unreachability + CI gate)
   but has **no runtime floor** that fires when an agent attempts to modify the safety-core source itself
   (`runtime/decision-lattice.js`, `runtime/floor-codes.js`, `runtime/floor-*.js`,
   `artifacts/lattice-baseline.sha256`). *Open question (touches LOCKED §3/§8):* should a runtime floor guard writes/
   edits to those paths, so tampering is stopped *at the moment it is attempted* rather than only failing CI later?
   Rationale: a long-running unattended agent can edit core source between CI runs; the build-time gate does not stop the
   action in-session.
2. **`[CC-PROPOSED]` — Check in a model content contract artifact for enforcement point (b).** Point (b) is `[LOCKED]`
   in concept but has **zero artifact** in the repo, which is why the entire content-harm surface (§6 categories + decoy,
   plus CSAM and suicide-method refusal/crisis-resources from §7) is unrepresented. Propose a versioned, reviewable,
   testable artifact (e.g. `references/CONTENT-CONTRACT.md` + a prompt/instruction template) that encodes the clean-
   refusal, the fake-all-the-way-down decoy constraint, the sexual-content carve-out, and the crisis-resource behavior —
   so (b) is a real thing the project owns and can red-team, not an unwritten assumption about the underlying model.
   *Extends; does not revisit the locked three-points.*
3. **`[CC-PROPOSED]` — A "hard-exceptions benchmark" with explicit false-stop / false-allow budgets.** 0.2.0 DoD #5
   requires measuring FP/FN at the three hard exceptions on real runs; the eval corpus exists but ADR-019 (corpus shape
   coverage) is still *Proposed* and the gate runs at loose defaults. Propose a named eval slice that exercises each hard
   exception (HX1, HX2, HX3 — §1 naming; today deterministically detectable as the credential/secret subset per #4) with
   committed FP/FN budgets, run as a release gate, **measured under a declared flags-on posture** (at defaults F28/F29
   are inert — §18 Default posture — so default-posture measurement would be degenerate). *Supports the locked DoD; adds
   instrumentation only.*
4. **`[CC-PROPOSED][OPEN]` — Reconcile hard-exception #1 with what is deterministically detectable.** The vision's
   hard-exception #1 ("personal data leaving to an external party = no") is realized today only for the credential/key-
   class subset (F27/F28); general third-party personal data is byte-identical to the user's own at the tool boundary
   (ADR-036's "no ownership signal"). *Open question (touches LOCKED §4):* state the deterministic guarantee precisely
   (credential/secret egress) and route the remainder of "personal data of others" to enforcement point (b), rather than
   implying the Node guard already covers all personal-data egress. Rationale: avoid a false sense of coverage; make the
   real boundary explicit.
5. **`[CC-PROPOSED]` — Specify L2's privacy-by-construction egress boundary now.** The vision requires privacy to be
   ARCHITECTURAL ("we physically can't send your content"). Propose adopting a typed, allowlist-only serializer as the
   *only* path by which anything derived from memory can leave a process boundary — the existing `KEEP_KEYS` scrubber in
   `runtime/notify.js` is a working proof-of-pattern (it drops every field except an enum allowlist). Locking this
   boundary before L2 code lands makes "only abstract enums/counts may leave, never raw content" true by construction.
   *Honors the locked L2 privacy requirement; does not change L2's 0.3.0 sequencing.*
6. **`[CC-PROPOSED]` — Elevate "policy-laundering" and "self-modification-poisoning" to standing regression gates before
   L3.** Both are named L3 threats. `inviolable-selfmod-unreachability.test.js` is the seed. Propose a permanent gate
   that (a) proves no self-improvement source can ever appear in any inviolable floor's `demotableBy`, and (b) detects
   *gradual* weakening of the guard across versions (e.g. a monotonic check that the inviolable set and lattice hash only
   change via reviewed baseline updates). *Additive discipline for the locked-LAST layer; lands before any L3 code.*
7. **`[CC-PROPOSED]` — Track ADR decision-debt as an explicit hygiene item.** Two ADR-number collisions (021 ×2, 022 ×2)
   and a `Proposed`/`Open` backlog (019, 022A, 022B, 023, 024, 025, 028, 029, **048**) should be closed-or-superseded
   before 0.3.0, and the collisions renumbered, so the ADR set stays a reliable index. *Meta-process; no scope change.*
8. **`[CC-PROPOSED]` — Reconcile the telemetry wording with reality.** Either (a) document the true posture — "no
   telemetry leaves the machine by default; a local internal-event log (no payloads, no paths, no commands) is on by
   default and disabled with `LILARA_TELEMETRY=0`" — or (b) flip local logging to opt-in to literally match the
   `[ADVISORY]` "NONE by default." Recommend (a): the local log is genuinely useful for diagnosing corruption/migration
   and never egresses. *Telemetry is `[ADVISORY]`, so this clarifies rather than revisits.*
9. **`[CC-PROPOSED][OPEN]` — Decide F23 kill-chain default posture at a future milestone.** F23 (multi-step kill-chain
   detection) runs **observe-only** unless `LILARA_KILL_CHAIN_ENFORCE=1`. *Open question:* should staged kill-chain
   detection graduate to consent/enforce by default once the eval false-positive rate is measured and acceptable
   (depends on #3)? Rationale: observe-only means the detector exists but does not protect by default.
10. **`[CC-PROPOSED]` — Tag-integrity gate (landed with this revision).** The decision-tag system ([LOCKED]/[ADVISORY]/
    [OPEN]/[CC-PROPOSED]) was load-bearing but enforced only by human discipline — no gate existed. This revision adds
    `scripts/check-scope-tags.sh`: only legend tags may appear in this file; every line carrying `[LOCKED]` is hashed
    against a committed baseline (`artifacts/scope-locked-baseline.sha256`) so any edit or deletion of locked text fails
    CI unless the baseline is updated in the same reviewed diff; locked-tag count cannot silently decrease. *Meta-process;
    protects the tag semantics this document depends on.*
11. **`[CC-PROPOSED]` — Data-retention policy for `~/.lilara` state (stub).** The state dir accumulates
    `decision-journal.jsonl` (rotated), consent grants, operator tokens, session context, snapshots, telemetry — with no
    stated retention/pruning/audit-deletion policy. Propose: journal = long-term auditable record with redaction tooling
    (ADR-041/045 already exist); grants/tokens = operator-managed revocation, no silent expiry; snapshots/telemetry =
    age-bounded pruning via an explicit CLI command, never automatic deletion of audit material. Full policy to be
    drafted in PLAN.md Phase 4 (L2) where memory raises the privacy stakes. *Extends §11's architectural-privacy stance.*
12. **`[CC-PROPOSED]` — Floor versioning & deprecation policy (stub).** "Get the safety core right once" (§18) needs a
    growth rule: floor predicates may strengthen (fewer false-negatives) but never weaken under the same ID; adding/
    removing/reordering floors = lattice-hash rebaseline through the reviewed-baseline gate (#10, §19 #6); floors are
    deprecated (kept as no-op for one release cycle, noted in CHANGELOG + Appendix A) and never silently removed; replay
    corpus only ever extends, entries are never mutated. *Codifies practice already implied by §3/§18.*
13. **`[CC-PROPOSED]` — Support matrix.** CI gates run on Node 20 (`.github/workflows/check.yml`); bench/perf baselines
    are committed for Node 20 and 24 across Linux/macOS/Windows (incl. Windows slow-fs variants); six harness adapters
    are parity-gated. Propose stating this as the supported matrix: **Node ≥ 20 (CI-proven on 20 and 24), three OSes,
    six harnesses** — so "works on my machine" has a defined boundary. *Disclosure; no new commitment until owner adopts.*
14. **`[CC-PROPOSED]` — Posture flags become injected input to `decide()`.** `decide()` reads `LILARA_TAINT_EGRESS`,
    `LILARA_DELETE_COORD`, and `LILARA_KILL_CHAIN_ENFORCE` from ambient `process.env` (decision-engine.js), and the
    replay harness (`scripts/replay-decisions.js`) does not pin them — purity currently holds *modulo unpinned env*
    (§18 replay note). Propose migrating posture into the `decide()` input object exactly as ADR-046 did for the taint
    window (`input.provenanceWindow`): loaded at the impure boundary (`pretool-gate.js`), injected, journaled, replayed.
    Until then: pin all three flags in the replay harness, and require a posture-matrix replay (corpus green under both
    postures) before any default flip. *Hardens the locked byte-identical-replay invariant; prerequisite for §19 #9 / Q2
    graduations.*

---

## 20. GAP register (quick scan)

| # | Item | Vision says | Reality | Severity |
|---|---|---|---|---|
| G1 | Victim-aware enforcement (§4) | HARM_OTHERS hard-block vs HARM_SELF warn-then-obey | Not in code; only credential-egress (F27/F28) touches multi-party harm; content-blind | **High** |
| G2 | Model content contract (§5b, §6) | Generation-layer refusal + decoy artifact | No artifact in repo at all | **High** |
| G3 | Content/identity harm floors (§7) | CSAM, suicide-method refusal, publish-private-data, intimate-imagery, surveillance, fraud, forgery, stalk | NOT-YET (depend on G2) | **High** |
| G4 | Hard-exception #1 coverage (§4, §7) | "Personal data to an external party = no" | Only credential/secret subset enforced | **Med-High** |
| G5 | 0.2.0 DoD #5 (§10, §17) | Hermes adapter + real-run FP/FN at hard exceptions | Hermes absent; no measured error rates | **Med-High** |
| G6 | `TAMPER_WITH_SAFETY_CORE` (§3, §7, §8) | Named absolute floor | Property enforced at CI/build-time + structurally; no runtime floor of that name | **Med** |
| G7 | Auto-update (§16) | Background check + `lilara upgrade` | NOT-YET | **Low** |
| G8 | Telemetry wording (§16) | NONE by default | Local-only log on by default (no payloads, no egress) | **Low** |
| G9 | ADR decision-debt (§16) | Clean decision index | 2 number collisions + 9 open/proposed ADRs | **Low** |
| G10 | L4 orchestration capabilities (§1, §13) | Auto-select + multi-skill merge/compose + auto-create skill/agent + cheap routing + learn-from-results | Only single-lane static routing built; merge/compose, auto-create, and learning loop all NOT-YET (depends on L2; sequenced last) | **Low** (planned layer) |
| G11 | Hook/adapter auto-creation (§13) | May propose, but NEVER auto-apply — manual / human-approved always | Gated-to-manual: no auto-apply path exists — intended end state, not a gap | **n/a (control)** |
| G12 | Default posture (§18 table) `[CC-PROPOSED]` | L1 "fail-closed" guard protecting unattended runs | Out of the box nothing halts: `LILARA_ENFORCE=0`, consent `off`, F28/F29 inert, F23 observe-only — warn-first by design but previously undisclosed as a whole | **High** |
| G13 | License file (§16) `[CC-PROPOSED]` | Licensing decided consistently with no-copyleft | No `LICENSE` file at repo root; licensing/business model `[OPEN]`; pre-launch blocker alongside D23 | **Med** |
| G14 | ADR decision-debt (§16, App. B) `[CC-PROPOSED]` | Reliable decision index | 2 number collisions, 9 Proposed/Open ADRs, ADR-032 half-closed, some headers lag shipped behavior | **Low** |

---

## 21. Design limitations & non-goals `[CC-PROPOSED]`

Distinct from the §20 GAP register. **GAP = "agreed in the vision but not built yet"** (closed by implementation).
**Non-goal = "the guard will NOT catch this even when fully built, by design"** — a deliberate boundary of what a
deterministic, content-blind, host-resident action guard *can* be. Every item below is `[CC-PROPOSED]` (consolidated from
coverage bounds already noted across the status blocks); promote to `[LOCKED]` if the owner adopts them as stated
non-goals.

- **Content-blindness `[CC-PROPOSED]`.** The deterministic Node action-guard inspects **command/tool actions** (the
  canonical Action-IR), **not model-generated natural-language content**. Persuasive, deceptive, or otherwise harmful
  *text* a model emits is outside its view. Enforcement-point-(b) (the model content contract, §5b) is a **separate,
  unbuilt layer**; until it exists, semantic harm in generated content is out of scope — by design, not a bug in the
  guard.
- **Egress channel coverage is enumerated, not universal `[CC-PROPOSED]`.** F27/F28 (§7, §9) cover the **known**
  external-egress sinks (the modeled network/exfil channels). Transports not yet modeled — e.g. `scp` / `rsync`,
  arbitrary user binaries, a novel side channel — are **blind spots until each is added** to the sink set. Coverage
  grows by enumeration; there is no catch-all "any byte leaving by any means" floor.
- **General third-party PII `[CC-PROPOSED]`.** Only the **credential/secret subset** (F27/F28) is enforced as egress
  harm. **Arbitrary personal data** of another person passed to an external party is **not detected as such** — at the
  tool boundary it is byte-identical to the user's own data (no ownership signal; ADR-036). This is the design root of
  GAP G4; closing it requires enforcement-point-(b), not another deterministic floor.
- **Semantic prompt-injection is not "detected" by meaning — intentionally `[CC-PROPOSED]`.** Lilara does **not** read
  untrusted text and judge whether it is an injection. Defense is **structural**: taint-tracking (F10, F23) marks
  untrusted-sourced data, and action-gating (floors + consent) caps what any agent — injected or not — may *do*.
  Injection can change intent but cannot widen authority (§9). The absence of a semantic injection classifier is a
  **deliberate design choice**, not a gap to close — a content-understanding detector is exactly the non-deterministic
  trap the first-law generator avoids (§2).
- **Host-trust assumption `[CC-PROPOSED]`.** The guard **trusts the host it runs on.** A compromised host, a tampered
  `runtime/` source tree, or altered baseline files (`artifacts/lattice-baseline.sha256`, `artifacts/*/baseline.json`)
  are **outside the runtime threat model.** They are mitigated by **hash baselines + CI** at build/review time (§3, §18),
  not by anything `decide()` can check at runtime — a process that has already subverted the host can subvert the guard
  with it. (See §19 #1 for the open question of a runtime floor over safety-core writes.)

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

> Owner-raised (Khouly) forward directions. These are **directions, not yet committed milestones** — the *intent* is
> owner-set, the **design is `[OPEN]`** until sequenced. They **extend** the build order (§1) and the L5 shell (§14)
> without changing any `[LOCKED]` decision. Inline `[LOCKED]` markers flag guardrails that are already settled and that
> bind these directions.

### 23.A — Lilara as a control plane / orchestration hub `[OPEN]`

**Intent.** The user **registers** the external tools he wants (e.g. Claude Code, Antigravity, Hermes, OpenClaw) into
Lilara, then either runs them *from* Lilara or has Lilara **run/launch** them on his behalf — while still seeing the live
**task/queue**. Lilara becomes the **single surface** to control and leverage all his agents, with the **guard always in
front of every wrapped tool's actions**.

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

## 24. R2 review — questions to the owner `[CC-PROPOSED]`

> Raised by the 2026-06-12 review revision. Each touches a `[LOCKED]` or `[OPEN]` item and is therefore **asked, not
> changed** — per the tag rules, locked content moves only by owner decision. Answering these closes the question; the
> answer is then folded into the relevant section by a normal reviewed edit.

| Q | Touches | Question |
|---|---|---|
| **Q1** | `[LOCKED]` §1 vs §13/§14/§15 | Confirm the canonical sequencing in §1.5: thin L5 with L1 (done) → L2 → L4 → full L5 (guest→host) → L3 absolutely last → §23.A UI after all. If confirmed, §13's "sequenced LAST" and §15's "Later = L4 → L5 → L3" wordings are aligned to point at §1.5. |
| **Q2** | `[LOCKED]` §18 ("require-review = WARN class") | Default-posture graduation roadmap (G12): which of F28 / F29 / F23 / enforce-mode flip on-by-default, at which milestone, gated on the §19 #3 measured FP/FN budgets? Proposal: one ADR + owner sign-off per flip; §19 #14 replay hardening is a prerequisite for any flip. |
| **Q3** | `[LOCKED]` §5 | The vision's enforcement point (c) names a "fail-closed advisory classifier"; in code the role is filled by lattice precedence + the consent gate. Rename the vision bullet to match reality, or keep the name as a future separate component? |
| **Q4** | repo hygiene | `ROADMAP.md` at the repo root is pre-rebrand-stale (v3.1.0 era, "Eighteen engine-baked floors (F1–F18)") and contradicts this document. Archive it to `references/archive/` with a pointer here? |
| **Q5** | §0 / §11 prose (optional) | "an impressive, smart guard" (§0) and "understands the user better than they understand themselves" (§11) are aspirational vision prose, not violations of the neutral-language mandate — keep as owner voice, or add falsifiable restatements alongside? |
| **Q6** | §14 / §23.A | Is the existing read-only dashboard (`scripts/dashboard-server.js`) the **seed** of the §23.A control plane (grows mutating endpoints behind approver-auth at build time), or permanently observability-only with §23.A built as a separate surface? |
| **Q7** | §7 ("absolute") + §19 #1 | The proposed runtime `TAMPER_WITH_SAFETY_CORE` floor has a dogfood trap: an inviolable floor on writes to `runtime/floor-*.js` / `decision-lattice.js` fires on every legitimate dev edit of Lilara itself (owner is customer #1). Options: (a) scope the floor to the **installed** guard under `~/.lilara`, not the dev checkout; (b) make it consent-demotable — contradicts §7 "absolute"; (c) keep tamper-protection CI/build-time only (status quo). Decide as part of the §19 #1 packet. |

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

ADR-001..006 are recorded as decisions D1–D6 in `DECISIONS.md` (not separate files). ADR-007..048 live in `references/`
as **44 files** (two number collisions). Status is read live from each ADR's header (re-derived 2026-06-12; the previous
revision of this index omitted 17 of them). **Collisions:** ADR-021 and ADR-022 each exist as two different files,
disambiguated here as (A)/(B) — frozen, not renumbered, because ADR numbers are cited in code comments, lattice notes,
and CHANGELOG entries.

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
| 019 | Eval-corpus shape coverage + eval-dynamic-exec FP surface | **Proposed** |
| 020 | MCP bypass pattern parity | Implemented |
| 021 (A) | Bench-perf-regression baseline strategy | Implemented |
| 021 (B) | Bounded recursion for canonical-json (depth cap) | Implemented |
| 022 (A) | Strengthen `check-no-horus.sh` for bare lowercase token | **Proposed** |
| 022 (B) | Fail-closed F25/F26 floor recovery | **Proposed** |
| 023 | Unified command classification gateway | **Proposed** |
| 024 | State-dir permission validation | **Proposed** |
| 025 | Caller-level fail-open cascade in `decide()` | **Proposed** |
| 026 | Receipt commandClass/irHash rebaseline | Accepted |
| 027 | Decision-key raw-only classification | Accepted |
| 028 | State-dir validation: remaining consumers | **Proposed** |
| 029 | Pin-store corruption = silent full reset | **Proposed** |
| 030 | Unguarded advisory calls in `decide()` | Implemented |
| 031 | Load-bearing pre-floor input reads | Implemented |
| 032 | State-dir consumers full sweep | **Partially Implemented** |
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

**Decision-debt to close before 0.3.0** (§16, §19 #7, G14): the 8 bold **Proposed** rows above plus ADR-032's
half-closed status and ADR-048's open design question. Caveat: some Proposed headers may lag shipped behavior (ADR-024/
028 state-dir conventions are visible in CHANGELOG implementation entries) — closing means *reconciling header against
reality with evidence*, not bulk-flipping statuses.

---

*End of authoritative scope. Status blocks reflect master `57089aa` (VERSION 0.2.1) as of 2026-06-12 (R2 review
revision: status corrections verified against code; `[CC-PROPOSED]` additions in §1.5, §18, §19 #10–#14, §20 G12–G14,
§24; owner questions in §24). When code changes, update the relevant Status block and the GAP register; the rendered
vision (and its `[LOCKED]` tags) changes only by owner decision — enforced by `scripts/check-scope-tags.sh`.*
