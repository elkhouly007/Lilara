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

**Status snapshot:** VERSION `0.2.1` · master `e5cd61c` · 2026-06-12 · 6 adapters · floors F1–F29 (+F14b, F18-D007, F22, F23b).

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
  (`runtime/tests/decision-lattice/inviolable-contract-unreachability.test.js`,
  `runtime/tests/decision-lattice/inviolable-selfmod-unreachability.test.js`).
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
| (c) Action-gating + fail-closed advisory | **BUILT** (PARTIAL framing) | The lattice + consent gate gate irreversible external actions and can only `block` or route to `consent-required` (`enforcementFor()` in `runtime/decision-lattice.js`); `runtime/floor-consent.js` fails closed and **never auto-allows** (default route = block; any error = block). There is no separate named "advisory classifier" component — the role is filled by the lattice precedence + consent gate. |

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
- **Transport `[LOCKED option c]`:** pluggable seam; ship interactive transport + fail-closed-block for unattended;
  one-way `notify/` for notification only; defer channel-based approval until authentication is designed.
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
| 2 | Action floors + `TAMPER_WITH_SAFETY_CORE` + taint→sink coded AND inviolable-tier unreachability test passes. | **BUILT** (naming nuance) | Floors live; F27/F28 taint→sink; unreachability tests pass; lattice hash-pinned. *Nuance:* `TAMPER_WITH_SAFETY_CORE` is a property, not a named floor (§3). |
| 3 | Distribution fixed (install bundles `runtime/`). | **BUILT** | `scripts/install-local.sh` bundles 78 `runtime/*.js` + `schemas/`; smoke gate `scripts/check-install-smoke.sh`; verified 3-OS. |
| 4 | Deletion-coordination wired (snapshot + scope). | **BUILT** | ADR-038 F29 + `runtime/snapshot.js` recoverability snapshot, visible-but-fail-open. |
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
already has a seed: `runtime/tests/decision-lattice/inviolable-selfmod-unreachability.test.js` proves a `learned-allow`
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

---

## 14. L5 — Shell

Manage live tools from one place; **fast-reply AND long-running** modes; reachable via channels. **Architectural pivot
`[ADVISORY]`:** do NOT build another CLI shell — position as an invisible proxy/middleware ("build the thing those tools
plug into"). **Inbound channels (Telegram/WhatsApp approval) DEFERRED** until approver-authentication is designed;
one-way notify ships first. **Guest→host inversion** (Lilara launches/wraps tools vs. being a hook inside them) = the
largest architectural decision, sequenced LAST.

**Status — PARTIAL (outbound only).** Outbound one-way notify is BUILT: `runtime/notify.js` + `runtime/notify/*.js`
(Discord/Slack/email, zero-dep, allowlist-only `KEEP_KEYS` scrubber, default disabled, TLS floor per ADR-039). Inbound
approval channels are **NOT-YET** (deferred, as the vision requires). Guest→host inversion is **NOT-YET** (sequenced
LAST). The "manage tools from one place" shell experience is realized today only as the per-harness adapter set (§17),
not a unifying proxy — consistent with the `[ADVISORY]` "be middleware, not a CLI" pivot, which is not yet acted on.

---

## 15. Roadmap / versions

**0.2.0 = lock the safety core. 0.3.0 = memory layer (L2) begins. Later = L4 → L5 → L3 (suggestion-only first).** Inbound
channels deferred; guest→host inversion last.

**Status — on track.** Current VERSION is `0.2.1` (a hardening point release on top of the 0.2.0 safety-core lock). The
sequencing matches the build order in §1. 0.3.0 (L2) has not started. The single carried-over 0.2.0 item is DoD #5
(Hermes + real-run validation, §10).

---

## 16. Strategic layer `[mostly ADVISORY / OPEN]`

- **Distribution `[ADVISORY]`:** lean centralized `~/.lilara` + thin CLI installer (`npm install -g lilara`) over a
  per-project self-contained copy; today's breakage was a symptom (install copied hooks but NOT the engine).
  → **Status: BUILT (the breakage is fixed).** `scripts/install-local.sh` now bundles `runtime/` + `schemas/`; the
  `npm install -g lilara` packaging form remains `[ADVISORY]` and is not the current install path.
- **Auto-update `[ADVISORY]`:** background check writes `update-cache.json` (≤24h), one-line stderr warning, user runs
  `lilara upgrade`. → **Status: NOT-YET** (no `update-cache.json`, no upgrade command).
- **Telemetry `[ADVISORY, strong]`:** NONE by default; opt-in aggregate only (floor-trigger counts, NO payloads/paths);
  publish the schema. → **Status: SPIRIT-ALIGNED, wording drift.** `runtime/telemetry.js` writes **local-only** internal
  events (corruption/migration), **on by default** (`LILARA_TELEMETRY !== "0"`), **never** records
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
  canonical-json-depth-cap) and ADR-022 (check-no-horus-bare-token *and* fail-closed-floor-recovery) — and a backlog of
  `Proposed`/`Open` ADRs (019, 022A, 022B, 023, 024, 025, 028, 029, **048**). See §19 #7 and Appendix B.

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
`antegravity` — all with `hooks/adapter.js` + `hooks/post-adapter.js` and a manifest; parity enforced by
`scripts/check-post-adapter-parity.sh`.

---

## 18. Architectural invariants `[LOCKED]`

Zero external deps; ASCII fast-path preserves byte-identical replay; `require-review` = WARN class; fail-safe direction
always; one-PR-per-coherent-change; verify-and-merge cycle; clean-room rewrite (reimplement without looking at source) —
protects no-copyleft AND quality; get the safety core definitively right once, never re-litigate.

**Status — BUILT / verified across the board:**

| Invariant | Status | Evidence |
|---|---|---|
| Zero external deps | **BUILT** | No root `package.json`; Node built-ins only. |
| Byte-identical replay (ASCII fast-path) | **BUILT** | 119-entry replay corpus, zero-drift gate; `irHash` deterministic; ADR-046 kept `decide()` cross-call-pure. |
| `require-review` = WARN class | **BUILT** | Default `LILARA_ENFORCE=0` warns; `=1` enforces (exit 2); consent-required is the new third state via `enforcementFor()`. |
| Fail-safe direction | **BUILT** | Kill-switch (F1); degraded-mode → restrictive; consent floor fails closed; null-input guards. |
| One-PR-per-coherent-change | **BUILT (process)** | CHANGELOG groups by PR/ADR; CI gate suite + pre-push. |
| Clean-room rewrite | **BUILT (process)** | Zero upstream code; bootstrap history frozen in `references/archive/`. |
| Safety core "right once, never re-litigate" | **BUILT** | Inviolable tier hash-pinned + unreachability tests (§3). |

**Performance / overhead budget `[CC-PROPOSED]` (intent).** The guard sits in the **hot path of every tool call** — each
PreToolUse decision runs `decide()` synchronously before the host tool proceeds — so low, bounded overhead is a design
invariant, not an afterthought. The enforcement mechanism already exists (**BUILT**): the committed **bench gate**
(`runtime/bench-gate.js`, `scripts/bench-runtime-decision.sh`) applies a **p50 relative regression gate at 1.5× the
committed per-platform baseline** (`artifacts/bench/baseline.json`, `artifacts/perf/baseline.json` — a genuine 2×
slowdown doubles p50 on every run and fails), backed by an always-on **absolute p99 ceiling ladder of 10 / 200 / 500 ms**
per platform (overridable via `LILARA_BENCH_P99_MS`), measured **best-of-K** to suppress shared-runner tail jitter
(ADR-040, ADR-044). Committed medians today: **p50 ≈ 0.5 ms (Linux/macOS) to ≈ 1.3–1.7 ms (Windows)** per decision —
those numbers are repo facts, not targets. The standing **SLO target is the `[CC-PROPOSED]` part**: hold the per-call
median **≤ 1 ms on Linux/macOS and low-single-digit ms on Windows**, so guard overhead stays negligible against real
tool/LLM latency. If the owner adopts that target, promote it from `[CC-PROPOSED]` to `[LOCKED]`.

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
   exception (secret→external party, any-egress-of-personal-data, delete-without-coordination) with committed FP/FN
   budgets, run as a release gate. *Supports the locked DoD; adds instrumentation only.*
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
| G11 | Hook/adapter auto-creation (§13) | May propose, but NEVER auto-apply — manual / human-approved always | Gated-to-manual: no auto-apply path exists — intended end state, not a gap | **Control ✓** |

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

## Appendix A — Floor inventory (current code)

Source: `runtime/floor-codes.js`, `runtime/decision-lattice.js`, `runtime/decision-engine.js`, and the `runtime/floor-*.js`
modules. "Inviolable" = `tier:"inviolable"`, `demotableBy:[]` (never demotable, hash-pinned).

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
| F22 | commit-format-violation | `runtime/decision-engine.js` | warn-class | BUILT |
| F23 | data-flow-kill-chain | `runtime/floor-f23.js`, `runtime/provenance-graph.js` | inviolable | BUILT (observe-only unless `LILARA_KILL_CHAIN_ENFORCE=1`) |
| F23b | mcp-result-injection | `runtime/post-adapter-factory.js` (PostToolUse) | observe-only sub-signal of F23 | BUILT |
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

ADR-001..006 are recorded as decisions D1–D6 in `DECISIONS.md` (not separate files). ADR-007..048 live in `references/`.
Status is read from each ADR's header. **Collisions:** ADR-021 and ADR-022 each exist as two different files.

**Open / Proposed (decision-debt to close before 0.3.0):**

| ADR | Title | Status |
|---|---|---|
| 019 | Eval-corpus shape coverage + eval-dynamic-exec FP surface | Proposed |
| 021 (A) | Bench-perf-regression baseline strategy | Implemented |
| 021 (B) | Bounded recursion for canonical-json (depth cap) | Implemented |
| 022 (A) | Strengthen `check-no-horus.sh` for bare lowercase token | Proposed |
| 022 (B) | Fail-closed F25/F26 floor recovery | Proposed |
| 023 | Unified command classification gateway | Proposed |
| 024 | State-dir permission validation | Proposed |
| 025 | Caller-level fail-open cascade in `decide()` | Proposed |
| 028 | State-dir validation: remaining consumers | Proposed |
| 029 | Pin-store corruption = silent full reset | Proposed |
| 048 | F4 demotion path design | **Proposed (OPEN)** |

**Accepted / Implemented (load-bearing for this scope):** 007 (canonical Action-IR + lattice), 009 (F16), 010 (F19),
012 (F20), 013 (auto-snapshot), 016 (coachable floors / F21), 017 (provenance graph / F23), 035 (consent gate / §8),
036 (inviolable protected tier / §3), 037 (staged-exfil taint / F28), 038 (delete-coordination / F29), 039 (notify TLS),
041 (journal redaction), 044 (bench baseline), 045 (taint-window redaction), 046 (cross-call purity / F10), 047 (F4
consent payloadClass propagation).

---

*End of authoritative scope. Status blocks reflect master `e5cd61c` (VERSION 0.2.1) as of 2026-06-12. When code changes,
update the relevant Status block and the GAP register; the rendered vision (and its `[LOCKED]` tags) changes only by
owner decision.*
