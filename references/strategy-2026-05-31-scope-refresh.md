# Lilara — Strategy & Scope Refresh 2026-05-31
**Status:** For review. No implementation without Khouly approval.
**Companion doc:** [strategy-2026-05-31-market-scan.md](strategy-2026-05-31-market-scan.md)

---

## 1. Lilara Fit — Honest Assessment

### Where Lilara Is Genuinely Strong (with evidence)

**1. Structural immunity to supply-chain dependency attacks.**
Lilara is zero-dep Node 20 — no npm, no pip, no external package manager. On 2026-05-11, `guardrails-ai 0.10.1` was trojaned via a dropper in `__init__.py` as part of the "Shai-Hulud" supply-chain wave (CVE-2026-45758 / GHSA-xmpw-2vmm-p4p6), hitting 170+ npm/PyPI packages in a coordinated campaign. Lilara was structurally immune to this entire attack class by construction. No other tool in this space that runs pattern analysis or ML inference achieves this. This is a dated, citable, evidence-backed differentiator that became real within days of this research.

**2. Fail-closed precedence lattice with named floors.**
F1–F26 in `runtime/decision-lattice.js` apply in strict rung order, enforced by `assertOrdered()` + byte-identical CI replay gate. Every floor declares name/rung/action/source/demotability in one explicit table. `LILARA_KILL_SWITCH=1` short-circuits to block before any other logic. In the entire Claude Code / Cursor / Aider plugin landscape surveyed, **no other guardrail plugin implements a named precedence lattice** — dwarvesf is fail-open regex; rulebricks is fail-configurable but SaaS-dependent. DefenseClaw (Cisco, Apache-2.0, direct competitor) hooks Claude Code but has no documented equivalent of a rung-ordered lattice.

**3. Tamper-evident HMAC hash-chained receipt journal.**
`runtime/journal-chain.js` provides cryptographic tamper-evidence over every tool decision. Drives degraded-mode — when chain integrity fails, open allows demote to require-review. This directly answers the #1 unmet enterprise demand (GitHub issue #21794: "zero governance or accountability infrastructure"; Anthropic closed this as "not planned"). 2/3 of organizations cannot distinguish human from AI actions after the fact; Lilara provides a verifiable, machine-parseable trail that native harnesses do not.

**4. OWASP ASI01–10 explicit coverage mapping.**
`references/owasp-agentic-coverage.md` provides a named, source-traced mapping for each of the 10 agentic security items. 6 COVERED, 4 PARTIAL (with bounded, documented scope decisions). No other open-source tool in the surveyed landscape provides this mapping. The OWASP Top 10 for Agentic Applications was released 2025-12 and is now cited in 67% of organizations running agentic AI — Lilara's existing mapping is a credibility asset.

**5. Multi-harness coverage across 6 coding agents.**
Claude Code (reference, fully verified), OpenCode, OpenClaw, Codex, ClawCode, Antegravity — via the PreToolUse/PostToolUse adapter spine. Parity enforced by CI (`check-post-adapter-parity.sh`). DefenseClaw also spans Claude Code/Codex/Cursor/Windsurf/Gemini CLI — the first peer found with genuinely multi-harness ambition. Lilara's Codex/ClawCode/Antegravity live-E2E coverage is still open (see §4 follow-ups).

**6. Eval/replay determinism as an assurance claim.**
Byte-identical replay gate over `tests/fixtures/replay-corpus/*.jsonl` means behavioral drift fails CI. Eval corpus at `tests/eval-corpus.json` with stated 0/0 FP/FN bar. This is the engineering discipline that makes Lilara's floor claims credible rather than aspirational. No other open guardrail tool in the landscape provides a comparable replay-determinism assurance.

---

### Where Lilara Is Weak / Behind / Missing

**1. Learning mechanism is monotonic/additive-only — no trust decay or revocation (structural gap).**
Timestamps (`lastApprovedAt`, `acceptedAt`, `eligibleAt`) are written to `policy-store.js` but **never read for enforcement**. A learned allow granted on day 1 persists indefinitely. No TTL, no anomaly-driven revocation, no trust downgrade. This is not unique to Lilara — DeerFlow, NeMo, and Guardrails AI all share this gap — but the market is raising this as a pain point ("permission creep...after 90 days the agent can do more than initially intended") and it's the highest-leverage improvement area. See §3.

**2. Global fineKey — no project scoping.**
`computeFineKey()` in `decision-key.js` produces `tool|commandClass|pathBucket|branchBucket|payloadClass` with no project or session component. An approval granted in a toy project silently applies in a production project if the command class and path bucket match. This is a documented, exploitable behavior gap that requires a breaking schema migration to fix. Should be fixed before the user base grows.

**3. OpenClaw harness wiring is aspirational, not verified.**
Research confirmed OpenClaw has NO PreToolUse/PostToolUse external hook or programmable per-call approve/deny callback. Lilara's `openclaw/` manifest has `verifiedAt=null`. Lilara's WIRING_PLAN also incorrectly states "OpenClaw is an OpenCode fork" — it is the Clawdbot/Moltbot lineage, entirely independent. An operator who deploys Lilara believing it is enforcing on OpenClaw may have **zero actual runtime enforcement**. This needs correction or honest documentation before any public statement about 6-harness coverage.

**4. Rug-pull pin is observe-only and self-silencing.**
`mcp-pin.js` re-pins on first drift — so a rug-pull that executes once becomes invisible from the second call on. The advisory `mcpToolDrift` field in receipts fires once then goes silent. Additionally, Lilara pins only **runtime arg-shape** — it cannot detect rug-pull via **description/manifest change** (the attack vector mcp-scan/mcphound are purpose-built for). ADR-018 already proposes the fix (rug-pull-pin-driven escalation) — awaiting Khouly approval.

**5. Eval corpus doesn't exercise the MCP shapes the floors were built for.**
ADR-019 (proposed) documents that the "0/0 FP/FN bar" doesn't cover bulk benign payloads, nested-object MCP args, alt arg-containers (`params`/`input`/`arguments`), or dual-use-on-trusted-server cases. Also: CI eval gate was running at loose defaults (10% FP / 20% FN, not 0/0 — PR #86 is the fix) and `tests/runtime/*.test.js` coverage is partial in CI (files off the explicit list can be red without failing). These undermine Lilara's central assurance claim.

**6. `decision-engine.js` monolith — 2,253 lines.**
Flagged in audit-2026-05-30.md as a maintainability signal. Currently unactioned, but it is the largest single risk to the codebase's long-term maintainability and to correctness during floor additions.

**7. D23 trademark clearance for "Lilara" is an OPEN pre-launch blocker.**
From `DECISIONS.md`: "a trademark clearance search must be conducted. This is a pre-launch blocker, not a post-launch best-effort item" — blocks any public v3.x launch, marketplace listing, or press mention. This is critical path and cannot be skipped.

---

### Where Lilara Is Genuinely Differentiated — and Whether It Resonates

**Differentiated and resonating (evidence from demand signals):**
- Zero-dep + local-first design: ccusage (15k stars, zero-cloud) demonstrates users reward local-first, no-egress tooling. The Shai-Hulud supply-chain wave made this structural advantage real and citable.
- Tamper-evident audit journal: GitHub issue #21794 (enterprise team explicitly asking for cryptographic audit trails, Anthropic closed it as "not planned") is direct validation that Lilara's journal fills a stated, unmet enterprise need.
- Fail-closed precedence lattice: the PocketOS and DataTalks.Club incidents (production databases wiped by agents ignoring CLAUDE.md) are exactly the threat Lilara's F-series floors prevent structurally, not advisorily.

**Differentiated but not yet resonating (need go-to-market work):**
- OWASP ASI01–10 explicit coverage mapping — security professionals know this matters; general developers do not yet.
- Receipt-grade audit quality — the distinction between "logs" (what native harnesses provide) and "tamper-evident audit with provenance chain" (what Lilara provides) needs clearer messaging.

**Not differentiated (market has other answers):**
- Content classification (PII, toxicity) — Guardrails AI, LLM Guard are the market answer; Lilara correctly does not attempt this.
- Multi-agent orchestration — DeerFlow, ruflo are the market answer; Lilara correctly stays at the guard layer.

---

## 2. Hard Truths

### Hard Truth A — Features Users Clearly Want That Lilara Does NOT Offer

1. **Agent-level sandbox / container isolation**: Docker sandbox, devcontainer, Seatbelt/bubblewrap — the DeerFlow/Hermes/Anthropic answer to "blast radius." Lilara operates at the hook boundary without controlling the execution environment. Users experiencing rm -rf incidents want both — hook gate AND sandbox.
2. **Cross-session behavioral reputation / "trust history"**: Users want "agent X has been reliable for 30 days, give it more latitude." No current tool offers this either, but the pain point is explicitly raised in multiple demand signals.
3. **Description/manifest-level MCP rug-pull detection**: mcp-scan/mcphound pin tool *descriptions* (the attack surface for prompt injection via MCP). Lilara only pins *runtime arg-shapes*. Users dealing with MCP supply-chain attacks need both.
4. **Dashboard / operator UI for trust state visibility**: Users want to see "what has been learned, what was approved when, what is stale" without reading JSON files. Hermes provides `hermes curator status`; Lilara has CLI commands but no proactive surfacing.
5. **Team/org-level policy distribution without redeploy**: rulebricks (69 stars but praised for this) lets teams update policy via external API without git pull/restart. Lilara's contract + policy-store model is per-developer-machine today.

### Hard Truth B — Hyped Features Lilara Should NOT Chase

1. **LLM-in-the-loop / NLP-level injection detection**: NeMo's 72.54% ASR evasion in independent tests, Guardrails AI's NOOP-default validators, Lakera's black-box probabilistic verdicts — none of these are reliable enough to be Lilara's primary enforcement layer. The `<1ms hook` constraint (stated in owasp-agentic-coverage.md) is the right design decision. Do not add LLM calls to the critical decision path.
2. **Content validation (PII / toxicity / hallucination)**: Guardrails AI has 60-65 validators; LLM Guard has 35 scanners. Lilara correctly does not compete on this axis. These tools sit at the LLM I/O layer; Lilara sits at the tool-execution boundary. Stay in lane.
3. **Heavy orchestration / sub-agent spawning / persistent cross-session memory**: DeerFlow (70k stars) and ruflo (57k stars) own this category. Lilara's identity is a *guard*, not an *executor*. D22 in DECISIONS.md correctly frames Lilara as "an intelligent, safety-bounded operating layer" — the emphasis is on *bounded*, not on *orchestration*.
4. **"AI red-teaming" / offensive scanner**: Garak (8k stars, NVIDIA-maintained) is the de-facto standard. Lilara's eval corpus and replay suite are defensive tooling. Use Garak to red-team Lilara's floors; do not rebuild Garak.

---

## 3. Learning-Mechanism Improvement Options

*Grounded in 4 surfaces: `policy-store.js` / `session-context.js` / `decision-engine.js` / `mcp-pin.js`+`journal-chain.js`*

### 3.1 Current State of the 4 Surfaces (Problems Being Solved)

| Surface | Known weakness | Source |
|---|---|---|
| `policy-store.js` learnedAllow | Timestamps written, never read → no TTL/decay; global fineKey → cross-project bleed; learned-policy.json NOT in hash chain | policy-store.js:113-117, decision-key.js:88-105, journal-chain.js |
| `session-context.js` trajectory | Purely escalatory (good behavior never rebuilds trust); no cross-session reputation; random session ID resets pressure | session-context.js:163-174 |
| `decision-engine.js` | No path that lowers STORED trust on drift/taint/anomaly; learned-allow demotes only destructive-delete case | decision-engine.js:1735-1751 |
| `mcp-pin.js` + `journal-chain.js` | Rug-pull pin observe-only and self-silencing (re-pins on first drift → second call drift=false); learned-policy store not in hash chain | mcp-pin.js:65-89, journal-chain.js |

### 3.2 Concrete Improvement Options (Lilara-shaped, zero-dep, operator-visible, fail-safe)

Each option maps to one surface, carries size S/M/L and risk level. All are **Proposed** — require Khouly approval before implementation. They are ordered by risk-weighted value (biggest structural gap closed / lowest risk first).

---

**Option L1 — TTL read on `isLearnedAllowed()`**
*Surface: policy-store | Size: S | Risk: LOW*

Add a TTL check in `isLearnedAllowed()` (policy-store.js:113-117): if `suggestions[key].acceptedAt` is older than `LILARA_LEARNED_TTL_DAYS` (default 90), demote the entry to `status:'expired'` rather than deleting it. The operator sees it in `listSuggestions()` and can re-accept. `acceptedAt` is already written by `acceptSuggestion()` — this is a pure read-path change.

*Fail-safe:* If `acceptedAt` is missing (legacy entries), skip TTL check (backward-compatible, fail-open for TTL only). Floors F1–F26 still apply after any demotion. Worst case: a valid pattern gets demoted to PENDING and the operator sees a suggestion — exactly the intended behavior.
*Why:* Addresses "timestamps written but never read." Directly mirrors Hermes Curator's time-based stale@30d / archive@90d lifecycle. Closes the "monotonic-additive-only" gap with zero new deps.

---

**Option L2 — Journal-bind learned-policy mutations**
*Surface: rug-pull-pin/journal | Size: S-M | Risk: LOW*

In `setLearnedAllow()`, `acceptSuggestion()`, and `dismissSuggestion()` (policy-store.js:144-154, 175-185), call `journal-chain.js appendEntry()` with a `policy.mutation` event carrying `{action, fineKey, status, operator:true, ts}`. No raw command content — only the fineKey string and lifecycle metadata already present in the suggestion object.

*Fail-safe:* Best-effort (try/catch matching existing journal-append pattern). If write fails, emit a telemetry event but do not block the mutation. A journal-write failure means the chain can detect the gap at verify time.
*Why:* The learned-policy store is currently completely outside the tamper-evident chain. This is confirmed as the #1 integrity gap by three independent research threads (agentsystems.ai, nono.sh, IETF draft-sharif-agent-audit-trail). Closes it with one `require()` + one `appendEntry()` call. Also satisfies NIST AG-GV.2 "delegation accountability" requirement.

---

**Option L3 — Anomaly-triggered learnedAllow suspension**
*Surface: decision-engine + policy-store | Size: S | Risk: LOW-MEDIUM*

In `decide()`, when taint (F10) or data-flow kill-chain (F23) fires for a call whose fineKey has a `learnedAllows[key]=true` entry, call a new `suspendLearnedAllow(fineKey, reason)` in policy-store.js that sets `learnedAllows[key]=false` and writes `suggestions[key].status='suspended'` with `suspendedAt + suspendReason`. On next hit, the entry appears in `listSuggestions()` as `'suspended'` — operator must explicitly re-accept. Never auto-re-promotes. Emits `learned-allow-suspended` telemetry event.

*Fail-safe:* Suspension makes the action MORE restricted, never less. F10/F23 would already block the *current* call independently; the suspension only affects *future* calls via the same learned key. Risk: a false positive on taint could suspend a valid learned allow — mitigated because the threshold is F10/F23 (high-confidence anomaly signals), not all blocks.
*Why:* No peer system has automated trust downgrade on anomaly (confirmed across Hermes, DeerFlow, NeMo, Guardrails AI). This closes the "nothing lowers STORED trust on drift/taint" gap. Mirrors SPIFFE AI plugin pattern (anomalous SVID requests lower trust score dynamically) without requiring any external system.

---

**Option L4 — Quarantine-then-confirm for mcp-pin.js drift**
*Surface: rug-pull-pin/journal | Size: S | Risk: LOW-MEDIUM*

Change `checkArgShapeDrift()` (mcp-pin.js:65-89): on first drift, set pin `status:'quarantined'`, preserve both old hash and `quarantineHash` (new hash), increment `changeCount`, but **do NOT re-pin**. Return `drift:true` on every subsequent call with the new hash until operator calls `confirmArgShapeChange(server, tool)` (a new CLI command). Only after N identical post-drift calls (`LILARA_MCP_PIN_CONFIRM_AFTER`, default 2) or explicit operator confirmation does the shape stabilize.

*Fail-safe:* Advisory-only on the decision-action — unchanged until the graduated ratchet in Option L5 is implemented. Quarantine state written to existing `pins.json` via atomic write. No new deps.
*Why:* The current re-pin-on-first-drift is self-silencing: an adversary who mutates an MCP arg shape once gets permanent silence on subsequent calls. This converts the one-shot fire-and-forget into a persistent alarm, directly addressing the documented rug-pull detection gap. DeerFlow RFC 1865 proposed a similar "confirm before stabilize" pattern for skill writes.

---

**Option L5 — Graduated decision-engine response to mcp-pin changeCount**
*Surface: rug-pull-pin/journal + decision-engine | Size: M | Risk: MEDIUM*

Wire `drift.changeCount` (currently computed by mcp-pin.js but ignored by decision-engine.js) into the engine: `changeCount===1` → add `mcpPinDriftWarning` receipt field only (no action change); `changeCount===2` → demote any learnedAllow for that server to require-review for this call (matching existing destructive-delete demotion pattern); `changeCount>=3` → trigger Option L3 suspension for learnedAllows keyed to that server.

*Risk:* A server that legitimately evolves its schema will trigger graduated escalation. Operators can reset pins via a new `pin-reset` CLI command or contract version bump. Fail-safe: changeCount=1 is receipt-only; no action changes until changeCount=2.
*Why:* ADR-018 already proposes converting rug-pull drift into require-review for the dual-use case. This option generalizes that to all cases where drift persists. SPIFFE AI plugin pattern (anomaly frequency lowers trust score progressively) and CAEP (condition changes trigger immediate signals) both validate graduated escalation over one-shot alerting.

---

**Option L6 — Project-scope dimension in fineKey**
*Surface: policy-store + decision-key | Size: M | Risk: MEDIUM*

Extend `computeFineKey()` in `decision-key.js` to include an optional 5th segment: `sha256(canonicalProjectRoot).slice(0,8)` (`projectHash`). Gate behind `LILARA_LEARNED_SCOPE=project` (default off to preserve backward compatibility). When enabled, existing global learnedAllows remain active under the old key format; only new approvals are scoped to the project. Provide `scripts/migrate-policy-scope.js` to rewrite existing keys (same pattern as existing `migrateV1ToV2.js`).

*Risk:* On enable, operators get gradual isolation (old global keys still match; new approvals are scoped). Risk of confusion during transition — mitigated by clear flag documentation. Breaking if migration runs before operator is ready — mitigated by making migration opt-in/manual.
*Why:* An approval for `rm -rf build/` in a toy project silently applies to a production project if the command class and path bucket match. No peer system has solved this cleanly (Hermes command_allowlist has the same global-scope gap). Cedar/Zanzibar both show approval persistence must be scoped to originating context.

---

**Option L7 — Per-session good-behavior credit in trajectory**
*Surface: session-trajectory | Size: S | Risk: LOW*

Add `recentCleanRuns` counter to `getSessionTrajectory()` (session-context.js:163-174): actions with `riskLevel=low` and `action=allow` increment a credit bucket (cap 5). In `decision-engine.js`, if `recentCleanRuns>=3` and `recentEscalations<2`, suppress one rung of trajectory escalation. Makes the 30-minute window bidirectional — good behavior can partially rebuild trust within a session.

*Fail-safe:* Only applies within the 30-minute window; floors F1–F26 unaffected. Worst case: slightly fewer escalation prompts for an agent that had a clean run. Cross-session attacker still cannot exploit (random session ID, window resets).
*Why:* The trajectory ratchet is purely escalatory — documented weakness. CAEP (probabilistic confidence scoring degrades gracefully on anomaly) and DeerFlow's reactivation (stale→active on use) both show bidirectional signals are better. Zero new deps; only requires reading the existing `riskLevel` field already written by `recordDecision()`.

---

**Option L8 — LILARA_LEARNED_AUDIT_MODE: proactive visibility of fired learnedAllows**
*Surface: policy-store | Size: S | Risk: LOW*

When `LILARA_LEARNED_AUDIT_MODE=1`, every `isLearnedAllowed()` match emits a telemetry event and writes a human-readable entry to `learned-policy-audit.log` (append-only, rotated at 1MB, single `.1` backup). Fields: `{ts, fineKey, tool, commandClass, projectBucket}`. Operators and CI pipelines can tail this log to see exactly which learned patterns fired and how often, without parsing the full journal.

*Fail-safe:* Purely observational; does not change enforcement. I/O errors are best-effort and must never block `decide()`. Hard cap at 1MB prevents unbounded growth.
*Why:* Currently no built-in way for an operator to see which learnedAllows are actively firing in production. Hermes surfaces this via `hermes curator status` + `REPORT.md`. `summarizePolicy()` exists in Lilara but is not rendered anywhere automatically. This makes the learned policy visible at runtime without requiring a separate CLI invocation.

---

**Option L9 — Permanence-deny list (declarative never-approvable patterns)**
*Surface: policy-store | Size: S | Risk: LOW*

Add an optional `permanentDeny` section to `learned-policy.json` where operators can list fineKey patterns that can never receive a learnedAllow regardless of approval count. `isLearnedAllowed()` checks `permanentDeny` before `approvalCounts`. Writeable only via CLI (`lilara-cli policy deny <key>`); CLI writes append a journal entry (Option L2). Any runtime write attempt is rejected by the `LILARA_READONLY_CONTRACT` guard already in `savePolicy()`.

*Fail-safe:* Purely additive field; existing files without it behave identically. The check is a single `Set.has()`. Operator-visible by construction (in `learned-policy.json` and journaled).
*Why:* NeMo's key architectural strength is that its declarative policy is 100% human-controlled and cannot be overridden at runtime. Lilara's `learnedAllows` lack an equivalent "this pattern is NEVER approvable" escape hatch. `permanentDeny` gives operators the NeMo-style unconditional guarantee for high-risk fineKeys (e.g., `Bash|destructive-delete|sensitive-target|*`) while preserving learning for lower-risk patterns.

---

### 3.3 Prioritized Implementation Order

| Priority | Option | Surface | Size | Risk | Evidence |
|---|---|---|---|---|---|
| 🔴 P1 | L2: Journal-bind mutations | journal | S-M | LOW | Biggest integrity gap; NIST AG-GV.2 requirement |
| 🔴 P1 | L1: TTL read | policy-store | S | LOW | Most-cited pain point; timestamps already exist |
| 🔴 P1 | L4: Quarantine mcp-pin | rug-pull-pin | S | LOW-MED | ADR-018 companion; self-silencing is the documented gap |
| 🟡 P2 | L3: Anomaly suspension | decision-engine | S | LOW-MED | No peer has this; closes the "nothing lowers stored trust" gap |
| 🟡 P2 | L9: Permanence-deny list | policy-store | S | LOW | NeMo-style unconditional guarantee; zero risk |
| 🟡 P2 | L8: LILARA_LEARNED_AUDIT_MODE | policy-store | S | LOW | Operator visibility gap |
| 🟡 P2 | L7: Bidirectional trajectory | trajectory | S | LOW | Closes purely-escalatory gap |
| 🟠 P3 | L5: Graduated mcp-pin ratchet | rug-pull-pin | M | MED | Requires L4 as prerequisite |
| 🟠 P3 | L6: Project-scoped fineKey | policy-store | M | MED | Breaking change; fix while user base is small |
| ⚫ Later | Cross-session reputation tier | trajectory | M | MED | Valuable but requires SessionStop hook in all harnesses |

---

## 4. Scope / Roadmap Refresh

### 4.1 Short-Term (~3 months): 5–10 Prioritized Capabilities

**Priority determined by:** evidence of user demand, size of gap vs. peers, risk to eval/assurance, alignment to Lilara's identity.

| # | Capability | Evidence | Size | Risk | Notes |
|---|---|---|---|---|---|
| ST-1 | **Learning mechanism: L1+L2+L4 (TTL read, journal-bind mutations, mcp-pin quarantine)** | §3 above; NIST AG-GV.2; rug-pull demand signals | S | LOW | These three together close the most critical trust-evolution gaps. Require ADR approval. |
| ST-2 | **ADR-018: rug-pull-pin-driven escalation** (trusted-server dual-use → require-review on drift+gated-review) | ADR-018 fully designed; awaiting approval only. Closes explicit MCP-security gap. | S | LOW | Decision: approve or decline. Eval: 0 FP by construction. |
| ST-3 | **ADR-019: eval corpus shape coverage** (add MCP floor shapes + document eval-dynamic-exec FP surface) | ADR-019 designed; "0/0" bar is only as strong as corpus shapes. PR #86 (eval gate defaults) must land first. | S | LOW | Assurance credibility. Part (1) is zero-risk coverage; part (2) is a decision. |
| ST-4 | **ADR-020: MCP bypass pattern parity** (narrow: base64-pipe-exec + process-substitution to MCP arg path) | Audit 2026-05-30 verified empirically: MCP `base64|sh` routes at risk 4; Bash equivalent blocks at risk 10. Gap actively exploitable. | M | MED | Conservative option only: limit to patterns with near-zero legitimate-data FP surface. |
| ST-5 | **ADR-021 + ADR-022** (canonical-JSON depth cap + rebrand-drift gate hardening) | ADR-021: latent hardening (V8 stack overflow at depth 5000, confirmed). ADR-022: process hygiene (gate missed 9 residues including one behavior-affecting instance). | S | LOW | Zero eval impact confirmed. Land after PR #85 closes. |
| ST-6 | **Live-E2E verification for Codex/ClawCode/Antegravity** | `result-injection-live-e2e-residual.md` documents the open gap. OWASP ASI05 coverage is "source-traced only" for these three. | M | LOW | Closes the "6 harnesses" story truthfully. Requires access to installed binaries. |
| ST-7 | **OpenClaw harness truthiness correction** | Research confirmed: OpenClaw has no PreToolUse/PostToolUse external hook. Lilara's WIRING_PLAN.md "OpenCode fork" claim is wrong. | S | LOW | Either find/build a real hook path OR mark `verifiedAt=null` in the manifest and document the gap honestly. Do NOT claim 6-harness coverage that includes OpenClaw as verified. |
| ST-8 | **D23: Trademark clearance for "Lilara"** | DECISIONS.md: pre-launch blocker. Blocks any marketplace listing, press mention, or public v3.x launch. | — | CRITICAL | Must happen before any go-to-market action. |
| ST-9 | **decision-engine.js decomposition (begin)** | Audit flagged 2,253 lines as maintainability risk. Not a blocker today but adding floors (ST-1 through ST-5 all add code paths) will make it harder over time. | L | MED | Even a shallow decomposition (extract floor implementations to named modules) would be a meaningful improvement. |

---

### 4.2 Mid-Term (~6 months): 2–3 Bigger Bets

**MT-1 [Proposed] — DefenseClaw parity narrative + operator-visible dashboard**
Cisco's DefenseClaw (Apache-2.0, released March 2026) directly overlaps on the multi-harness coding-agent runtime-guard category and names Claude Code as a supported target. Its weakness vs. Lilara: heavyweight (Go+Python+Node sidecar), no named-floor precedence lattice, no cryptographically chained audit journal, unproven adoption. Lilara's gap vs. DefenseClaw: zero community-facing adoption story and no operator visibility UI. A lightweight CLI dashboard (`lilara-cli dashboard`) that renders learned-policy state, recent escalations, floor coverage, and trajectory in a human-readable view would close the UX gap and give Lilara a visible surface that DefenseClaw's Cisco-backed Splunk integration competes with.

**MT-2 [Proposed] — Compliance packaging for enterprise blocker removal**
GitHub issue #21794 ("HIPAA requires audit trails. Cannot deploy. Not planned.") is the clearest enterprise-buyer blocker. With L2 (journal-bind mutations), ADR-014 audit-grade receipts, and the existing HMAC hash-chain, Lilara already has most of the technical foundation for a SOC 2 / HIPAA / EU AI Act compliance story. The missing piece is packaging: (a) a formal compliance guide mapping Lilara's controls to SOC 2 TSC, EU AI Act Art. 12, and NIST AG-GV.2/AG-MS.1; (b) a `lilara-cli export-compliance-bundle` command producing a signed, date-stamped audit export. This doesn't require new floors — it requires documentation and a CLI command.

**MT-3 [Proposed] — MCP-manifest rug-pull detection (complement to mcp-pin arg-shape)**
Lilara currently pins *runtime arg-shape*; mcp-scan/mcphound pin *tool descriptions at scan time*. Neither covers both. Adding description/manifest hashing at MCP registration time (wired to F26 mcp-registration-write) would make Lilara the only tool that catches *both* halves of rug-pull (manifest drift + runtime arg drift). This is a true gap in the ecosystem and a strong differentiator from DefenseClaw, which has no documented rug-pull detection at all.

---

### 4.3 Anti-Roadmap: 5 Things NOT to Do

1. **Do NOT add LLM calls to the critical decision path.** NeMo's 72.54% ASR evasion and the `<1ms hook` constraint both confirm this. Any feature that requires an LLM inference call at PreToolUse time breaks the determinism, fail-safe, and latency guarantees that are Lilara's core architectural promise.

2. **Do NOT pivot toward content validation (PII / toxicity / hallucination).** Guardrails AI, LLM Guard, and Lakera all do this better than Lilara ever could with zero deps and deterministic rules. Attempting to compete here dilutes Lilara's identity and will fail on feature breadth.

3. **Do NOT claim 6-harness coverage until OpenClaw (and Codex/ClawCode/Antegravity live-E2E) is verified.** Overclaiming coverage is the fastest way to lose trust with the exact audience (security-conscious developers) who would care most about verification. Mark aspirational harnesses honestly.

4. **Do NOT adopt Hermes's Curator model for Lilara's learning mechanism.** The Curator is quality/bloat management — a frequently-used poisoned skill gets reinforced. Lilara needs TTL and anomaly-driven revocation as *security controls bound to the hash chain*, not as bloat management. The borrowable patterns are TTL timestamps-already-written + reversible archival design (Options L1, L2) — not the LLM-mediated consolidation pass.

5. **Do NOT chase DeerFlow-style cross-session persistent memory / capability accumulation.** DeerFlow (70k stars) and ruflo own the "autonomous learner" category. Lilara's identity is a *guard* — D22 in DECISIONS.md correctly says "security floors remain non-negotiable and engine-baked." Cross-session reputation is a valid goal (Option L7/L cross-session tier) but only in the form of behavioral trajectory, never in the form of capability accumulation.

---

### 4.4 Re-Prioritization of Open Follow-Ups

| Follow-up | Previous priority | New priority | Rationale |
|---|---|---|---|
| **ADR-018 rug-pull-pin escalation** | Proposed/awaiting | 🔴 APPROVE NOW | MCP supply-chain demand is real and growing (MCPTox 60%+ ASR). The ADR is fully designed. Decision cost is low; gap cost is high. |
| **ADR-019 eval corpus coverage** | Proposed/awaiting | 🔴 Part 1 now / Part 2 is a decision | Part 1 (add corpus entries) is zero-risk and closes the "0/0 doesn't cover what it claims" gap. Part 2 (eval-dynamic-exec FP) requires a separate decision. |
| **ADR-020 MCP bypass parity** | Proposed/awaiting | 🟡 Narrow option only | The gap is confirmed exploitable. Conservative scope (base64-pipe + process-sub only) has near-zero FP surface. Hold on broader bypass patterns. |
| **ADR-021 canonical-JSON depth cap** | Proposed/awaiting | 🟡 Land with ADR-022 | Latent hardening, zero eval impact. Small but right. |
| **ADR-022 rebrand-drift gate** | Proposed/awaiting | 🟡 Land after PR #85 | Process hygiene; the missed behavior-affecting residue makes this non-trivial. |
| **Live-E2E Codex/ClawCode/Antegravity** | Open | 🟡 Before any "6 harnesses" marketing claim | ASI05 PARTIAL status for these three is a credibility risk if public. |
| **decision-engine.js decomposition** | Deferred | 🟠 Begin scope in ~3 months | 2,253 lines + ST-1 through ST-5 all add code paths. Start before it becomes a blocker. |
| **D23 trademark clearance** | OPEN | 🔴 CRITICAL BLOCKER | Cannot be scheduled alongside other work — must be sequenced. Every PR in this list is pre-launch; trademark clearance is still missing. |
| **L1+L2+L4 learning mechanism** | (new items) | 🔴 P1 | See §3. These close the most critical trust-evolution gaps with low risk. |

---

## 5. Strategic Decisions Required from Khouly

**Decision 1 — ADR-018: Approve or decline.**
Approve: rug-pull-pin drift + GATED_REVIEW dual-use class triggers require-review instead of allow. Zero eval FP by construction. The one-shot self-healing gate turns the currently-wasted `mcpToolDrift` advisory field into enforcement. Decline: documented gap stays; mcp-pin signal continues to be wasted.

**Decision 2 — Global vs. project-scoped fineKey: fix now or later.**
Fix now (Option L6): breaking schema migration while user base is small. Fix later: every approval granted by early adopters is over-scoped across all their projects — a fact that requires disclosure in public docs. Waiting also means the migration pain grows with adoption.

**Decision 3 — ADR-020 scope: conservative narrow or hold.**
Confirmed exploitable gap (MCP `base64|sh` routes at risk 4; Bash equivalent hard-blocks). Conservative Option 2 (base64-pipe + process-substitution only) has near-zero FP on legitimate data args. Broader option risks legitimate SQL/shell-template MCP data.

---

*Document ends. See [strategy-2026-05-31-market-scan.md](strategy-2026-05-31-market-scan.md) for peer analysis, demand signals, and compliance coverage.*
