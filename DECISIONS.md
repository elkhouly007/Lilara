# Decisions

## D1: Safe-Power Is The Default

The toolkit should preserve useful capability, including reviewed external tools and trusted agents, while removing silent trust expansion.

## D2: High-Risk Approval Is Narrow And Explicit

The user only needs to approve truly high-risk actions: deletion, destructive overwrite, personal or confidential data leaving the machine, elevated privileges, and major permanent global configuration changes.

## D3: External Use Requires Payload Review, Not Blanket Blocking

Trusted external prompts, agents, MCP, and browser tools are allowed when the exact outbound payload is reviewed first and does not include personal or confidential data.

## D4: OpenCode Starts Minimal But May Grow Behind Policy

`opencode/opencode.safe.jsonc` stays compact for now, but MCP, plugins, shell, and helper roles can be added later when each module is documented and classified against the approval policy.

## D5: Hooks Have Two Modes: Warn (default) and Enforce (opt-in)

Gate-class hooks (dangerous-command-gate, secret-warning, git-push-reminder) print reminders and echo stdin unchanged by default (`HORUS_ENFORCE=0`). When `HORUS_ENFORCE=1`, these hooks exit 2 to block the tool call. Informational hooks (session-start, session-end, quality-gate, strategic-compact, output-sanitizer) always exit 0 regardless of enforce mode. The two-mode design preserves a safe non-disruptive default while enabling active enforcement when the operator opts in via their harness config.

## D6: Installer Copies, It Does Not Configure

`install-local.sh` creates a local target directory and copies files. It does not install packages, modify shell profiles, edit global harness settings, or write to home unless the user explicitly passes such a path.

## D7: Prompt-Injection Resistance Is Part Of The Operating Model

The agent must reject instructions that try to override safety rules, conceal payloads, or smuggle destructive or exfiltration behavior behind unrelated tasks.

## D8: Source References Remain Separate

The `source-*` files are retained as references. They are not installed by the safe-plus installer.

## D9: Bounded Autonomy Is The Next Runtime Goal

The next cycle should push the project toward autonomous operation only inside bounded trust zones. Low-risk repetitive work should become automatic after one-time setup or repeated local approval, while high-risk actions remain explicitly human-gated.

## D10: Runtime Learning Must Stay Local-First

Decision journals, learned allows, and policy suggestions should be stored and derived locally by default. The system should improve from observed behavior without requiring hidden external telemetry.

## D11: Learned Allows Are Bounded To Low/Medium Risk

A learned allow may relax repeated low-risk or medium-risk actions in a known local context, but it must never override critical or high-risk decisions. High-risk outcomes still escalate, and critical outcomes still block.

## D12: Session Risk Can Tighten Decisions

Repeated risky actions inside a short local session should raise caution for the next decision. Session awareness is allowed to tighten routing or escalation behavior, but should stay lightweight and explainable.

## D13: Repeated Approval Should Produce A Visible Suggestion

When the same low/medium-risk pattern is approved repeatedly, the runtime should surface a visible local suggestion that can be accepted or dismissed. Promotion to a learned allow should be inspectable, not silent.

## D14: Runtime Decisions Should Be Explainable

Decision output should include a compact explanation with action, risk, source, and relevant reason codes. Local operators should be able to inspect why a command routed, escalated, blocked, or matched a learned allow.

## D15: Runtime Policy Should Be Project-Aware

Local learned policy is useful, but final runtime behavior should also honor per-project configuration. Trust posture, protected branch names, and sensitive path patterns belong in `horus.config.json` so different repositories can operate under different safety assumptions without forking the runtime.

## D16: Context Discovery Should Be Automatic Where Safe

The runtime should auto-discover project root and current git branch from local context whenever possible. Operators may still override fields explicitly, but the default path should reduce manual wiring.

## D17: Runtime Actions May Include Bounded Workflow Requirements

The decision layer is allowed to emit workflow-shaped actions such as `require-review`, `require-tests`, or `modify` when that is more helpful than a generic route/escalate result. These are bounded orchestration signals, not silent execution rights.

## D18: Workflow Actions Should Carry Usable Next Steps

A workflow-shaped action is more useful when it includes a compact action plan. If the runtime asks for tests, review, or safer modification, it should also surface suggested commands, review type, or narrowing hints instead of emitting a bare label only.

## D19: Action Plans May Adapt To Safe Repetition

When the same bounded workflow keeps repeating safely, the runtime may strengthen its action-plan guidance using local approval and suggestion history. This can recommend promoting a repeated verification or narrowed workflow into a reviewed local default, without silently expanding trust.

## D20: Promotion Guidance Should Be Explicit And Lifecycle-Aware

Every runtime decision should carry structured promotion guidance that tells the operator exactly where a pattern stands in the learned-allow lifecycle: new, approaching, eligible, promoted, dismissed, or ineligible. The guidance should include remaining approval counts, concrete CLI commands for the next step, and a clear reason when promotion is not possible. This surfaces in hook output, CLI explain, and runtime state so operators always know how to act on repeated safe patterns.

## D21: Lifecycle History Should Stay Auditable And Compact

Promotion lifecycle data is useful only if operators can inspect it quickly. The runtime should therefore preserve raw timestamps for creation, eligibility, acceptance, dismissal, and latest approval, while also emitting a compact lifecycle summary on each explained decision. This keeps audits readable without throwing away the underlying evidence.

## D22: ARG Is An Operating Layer, Not Just A Guard

ECC — the upfront-contract model — is the foundation, not the whole destination. The project's longer-term direction is an intelligent, safety-bounded operating layer that decides which agent capabilities should run, when, and how; learns reviewed local defaults from operator-approved patterns; routes intent to the right skill, agent, rule, or check; and improves over time. Security floors remain non-negotiable and engine-baked. The framing shift matters because it shapes which capabilities get built: operational intelligence, context-aware routing, and amplification of what agents can do well are first-class goals alongside enforcement.

## D23: Trademark Check For "Horus Agentic Power" Is Required Before Public Launch

**Status: OPEN — manual action required by Khouly.**

Before any public announcement, press release, or marketplace listing under the brand "Horus Agentic Power" / "HAP" / "horus-cli" / "horusagentic", a trademark clearance search must be conducted. This is a pre-launch blocker, not a post-launch best-effort item.

**Scope of check:**
- USPTO TESS for "Horus", "Horus Agentic", "Horus Agentic Power" in classes 42 (software services) and 9 (software products)
- EUIPO for the same terms
- WIPO Madrid Protocol for international coverage
- Domain availability: `horusagentic.dev`, `horusagentic.com`, `horusai.dev`

**Owner:** Khouly (project owner)
**Blocker for:** any public v3.x launch, marketplace listing, or press mention

Record the outcome here (cleared / conflict found / adjusted brand) when complete.

## D24: MASTER_PLAN.md Pass-2 Stubs — Fill Sections 7 And 8 Before Phase 3 Work Begins

**Status: CLOSED — resolved 2026-05-07 via Wave-1 item E1 (branch `feat/e1-master-plan-7-8`).**

MASTER_PLAN.md §7 (Component Inventory) and §8 (Host Compatibility Matrix) are now authored and substantive. Phase 3 (Three-Mode UX) planning is unblocked. Sections 9–13 and 18 remain deferred to Pass-3.

## D25: F3 Risk-Score Threshold — ARCHITECTURE.md Table Reads "score === 10", Code Uses ">= 8"

**Status: OPEN — doc-only fix, out of scope for Wave 1.**

The ARCHITECTURE.md precedence-matrix table labels F3 as `critical-risk (score === 10)`. The implementation in `runtime/risk-score.js:149` is `if (value >= 8) level = "critical"`. The threshold is `>= 8`, not `=== 10`. Fix is one word in the table row — no behavior change, no fixture impact.

**Owner:** Khouly (or any Wave-2 doc cleanup pass)
**Blocker for:** nothing.

## D26: F4/F6/F7 — Documented as Floors in ARCHITECTURE.md, Not Implemented in Code

**Status: OPEN — decide whether to implement or relabel after Wave 1.**

Three items in the ARCHITECTURE.md ladder table are marked `Floor-bound? = yes` but are not code floors in the current engine:

- **F4 (secret-class-C payload):** `pretool-gate.js` upgrades `payloadClass` to C on a secret hit; `risk-score.js` adds +4 to the score. It is a risk modifier — can drive F3 if combined with other patterns — but there is no `buildEarlyBlock` or action lock for payloadClass=C alone. A medium-scoring class-C payload is demotable by contract-allow.
- **F6 (scope-violation):** When `scopeMatch` returns false, `contractAllow` stays false and the baseline risk-score action stands. No escalation floor fires on scope mismatch.
- **F7 (novel-command-class):** Ungated command classes bypass the F5 strict-mode gate but receive no escalation floor of their own.

Options: (a) implement F4/F6/F7 as `buildEarlyBlock` / `decision-engine.js` code floors, or (b) relabel them in the table as "aspirational / not yet implemented."

**Owner:** Khouly (or dedicated Wave-2 item)
**Blocker for:** nothing — no active security regression; aspirational architecture gap only.

---

## D31: bench-runtime-decision.sh — Win32 Machine-Load Noise At p99

**Status: RESOLVED by documentation. No code change needed.**

On 2026-05-08, `bench-runtime-decision.sh` produced two consecutive p99 readings of ~102ms and ~104ms against the 85ms cap (1.5× of 56.831ms baseline), causing the gate to fail. The same failure occurred on clean master with no A-series changes applied. A systematic 5-run diagnostic the same night showed p99 values of 53.8, 54.8, 66.9, 55.3, 53.8ms on master — all within the 1.5× cap — confirming the earlier failures were transient Windows machine-load spikes (likely background indexing or antivirus scan).

**A5 bench (5 runs immediately after master):** 54.3, 53.9, 54.0, 53.5, 54.8ms — tightly clustered, zero regression vs master. The A5 change (`hook-utils.js`) does not touch `decision-engine.js:decide()` — the bench hot path — so A5 cannot regress the bench.

**Resolution:** The scoped-baseline approach (each run compares against the previous run's p99) already self-corrects for persistent load shifts. For isolated spikes, re-running the bench gate is sufficient. No baseline recapture or bench-tool change required.

**Recommended action:** if bench fails in CI on any single run, re-run once before treating it as a hard stop. A second consecutive failure is a real regression. Document this in `SECURITY_MODEL.md` or bench runner header as a known Win32 behaviour.
**Priority:** low — monitoring only.
