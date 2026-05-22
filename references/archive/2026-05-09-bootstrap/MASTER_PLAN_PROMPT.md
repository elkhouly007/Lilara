# Mission: Design the Complete Evolution Plan for Agent Runtime Guard → [New Brand]

> **Execution hint:** Use subagents for parallel research — spawn one agent per capability area to fetch and evaluate repos simultaneously. Use plan mode for architecture decisions. This prompt is at `MASTER_PLAN_PROMPT.md` in the project root — reference it if context gets compacted.
>
> **Installed tools available to you:**
> - **claude-mem** — persistent memory across sessions. Your observations and decisions survive session breaks. Use `/mem-search` to query past context.
> - **superpowers** — structured development methodology with TDD, debugging, task decomposition, and review workflows.
> - **GSD (Get Shit Done)** — phase-based workflow management with context monitoring, scope drift detection, and parallel execution.
> - **ui-ux-pro-max-skill** — UI/UX design intelligence, design system patterns, accessibility audits, and visual evaluation frameworks.
> Use these tools actively — they make your planning work better.

## IMPORTANT: What This Project IS and IS NOT

**This is an ADD-ON / enhancement layer** that installs ON TOP OF existing AI coding agent harnesses. It is NOT a standalone system. The host tools already exist — we add capabilities, security, intelligence, and structure to them.

**Supported host harnesses:**
- Claude Code
- OpenClaw
- ClawCode
- Antegravity
- OpenCode
- Any future harness that supports hooks, rules, agents, and skills

**What we provide as an add-on:**
- Security runtime (decision engine, risk scoring, contracts, guardrails)
- Agent library (specialist agents the host harness dispatches)
- Skill library (workflow skills the host harness activates)
- Rule library (coding standards and patterns the host harness enforces)
- Hook system (lifecycle hooks the host harness executes)
- Scripts (CLI, verification, audit, installation, wiring, payload tools)
- Modules (capability packs with policy definitions)
- Runtime core (decision engine, policy store, session context, journal, workflow router)
- Memory layer (persistent context the host harness can query)
- Self-evolution (assisted improvement within security boundaries)
- Smart capability selection (so the right pieces activate for the right project)
- Workflows (development methodology, testing, deployment patterns)

**What we do NOT build:**
- Our own LLM runtime or inference
- Our own chat interface or IDE
- Our own code execution sandbox
- Anything that replaces the host harness — we enhance it

Think of us like **a turbocharger for an engine** — the engine (Claude Code, OpenClaw, etc.) already runs. We make it faster, smarter, safer, and more capable. Maybe later we build the whole car, but NOW we build the best turbocharger on the market.

Every design decision must respect this: we operate within the host harness's extension points. We cannot assume capabilities the host doesn't expose.

---

## CORE UX PRINCIPLES: How The Add-On Interacts With The User

### Principle 1: User Chooses Their Execution Flow
At the start of any work session, the add-on asks the user HOW they want to work:
- **Guided mode:** Add-on analyzes → proposes a plan → user reviews → user approves → add-on executes. Best for new users, risky operations, or unfamiliar projects.
- **Autonomous mode:** Add-on analyzes → executes within the pre-agreed security contract → reports results. Best for experienced users on established projects.
- **Hybrid mode:** Add-on executes routine/safe operations automatically, pauses for approval only on operations that exceed the security contract. Best for most users.
- The user can switch modes mid-session.
- The mode choice is remembered per project (via memory system).

Design the plan to support all three modes. The security contract defines what's "safe enough" for autonomous execution in each mode.

### Principle 2: Learning Has Two Tiers
NOT everything requires approval to learn. The system has two learning tiers:

**Tier 1 — Auto-Learn (silent, no approval needed):**
- Project stack detection (this is a React project, this uses PostgreSQL, etc.)
- User's coding patterns (naming conventions, file organization, preferred frameworks)
- Command frequency (which tools the user runs most)
- Error patterns (what goes wrong repeatedly)
- Capability usage (which agents/skills the user actually uses)
- Performance metrics (what's fast, what's slow)
- User feedback signals (when the user says "that was wrong" or "good job" or accepts/rejects a change — record the outcome for calibration)
- Error patterns (what the agent got wrong and how it was fixed — for future confidence calibration)
- Anything that is OBSERVATION-ONLY — the system watches and remembers, but doesn't change behavior

**Tier 2 — Assisted-Learn (requires user approval):**
- Creating new agents, skills, rules, or hooks
- Modifying existing security rules or policies
- Changing the security contract
- Adopting upstream changes
- Anything that CHANGES THE SYSTEM'S BEHAVIOR — the system proposes, user approves

**The boundary is clear:** observing = automatic, acting on observations = needs approval. The system should NEVER block or slow down the user to ask "can I remember that you use tabs instead of spaces?" — it just remembers.

### Principle 3: Security Contract — Agree Once, Execute Freely
The security contract is agreed ONCE at project setup, not renegotiated on every action. This is the #1 architectural change from the current system.

**The flow:**
1. **Setup/First run:** The add-on scans the project (stack, structure, git config, existing patterns)
2. **Analysis:** It builds a proposed security contract based on what it found (what's safe to allow, what needs review, what's blocked)
3. **Presentation:** It shows the user: "Based on my analysis, here's what I propose to allow/block/review. Here's why for each decision."
4. **One-time approval:** The user reviews, adjusts if needed, approves. This is the ONLY time the user deals with security configuration.
5. **Execution:** From now on, the add-on enforces the contract silently. No interruptions during work. Operations within the contract proceed. Operations outside the contract are blocked with a clear explanation (not a question — the user already decided).
6. **Contract evolution:** If the project changes significantly (new dependencies, new team members, new deployment targets), the add-on proposes contract amendments — but this is rare, not every session.

**The key insight:** The current system asks "is this OK?" on every risky action. This is wrong. The user should define what "OK" means ONCE, and the system should enforce it without asking again. The v2 rewrite plan's upfront contract mechanism (Section 4 of `references/v2-rewrite-plan-rev2.md`) is the right architecture for this — make sure it's fully absorbed.

---

## CRITICAL: Research & Evaluation Rules

### Rule 1: The links below are STARTING POINTS, not answers
I am giving you URLs to repos I found. They may or may not be the best in their category. For EVERY capability area in this plan, you MUST:
- Search for alternatives beyond what I linked (use web search)
- Compare at least 2-3 options per capability area
- Pick the best inspiration source based on actual quality, not star count or marketing
- If you find something better than what I linked, use that instead
- If nothing external is good enough, design from scratch

### Rule 2: Do NOT trust any link blindly
Before recommending adoption from any repo (mine or ones you find):
- Verify it has REAL working code, not just a pretty README
- Check: does it actually do what it claims? Many repos are vaporware
- Check: is it maintained? Last commit date? Open issues vs fixes?
- Check: license compatibility (no AGPL/viral in our core)
- Check: code quality — is it production-grade or a weekend hack?
- Rate each source honestly: real/promising/vaporware/abandoned
- If a repo is 90% marketing and 10% substance, say so and skip it

### Rule 3: When overlap exists with what we already built, THINK
For every capability area, compare:
- What we already have (read our actual code, not just docs)
- What the external source offers
- Then decide ONE of:
  a) **Keep ours** — if ours is better or equivalent
  b) **Adopt theirs** — if theirs is clearly superior (rewrite in our style)
  c) **Hybrid** — take the best ideas from both, design something new
  d) **Neither** — if both are weak, design from scratch using first principles
  e) **Something else entirely** — if your research found a better third option
- Document the reasoning for each decision in the plan

### Rule 4: Search for what I DON'T know about
I gave you links I found. But there are surely capabilities, patterns, and tools I haven't seen. Actively search for:
- State-of-the-art agent orchestration patterns (2025-2026)
- Best persistent memory implementations for coding agents
- Best code intelligence / knowledge graph tools
- Best self-improving agent architectures
- Best capability selection / recommendation systems
- Best security contract / policy-as-code frameworks
- Best add-on / plugin architectures for AI agent tools
- Any breakthrough approach I haven't thought of
- If you find something game-changing that doesn't fit my categories, ADD a new section for it

---

## Context: Where We Are Now

Read the full project at `tools/ecc-safe-plus/`. Key facts:

- **Version:** 1.6.0 (681 files)
- **Current inventory:** 50 agents, 92 rules, 200 skills, 12 runtime JS files (1,289 LOC), 12 hooks (1,312 LOC), 44 scripts, 55 modules, 122 fixtures
- **Runtime core:** Real working decision engine (decision-engine.js, risk-score.js, policy-store.js, session-context.js, decision-journal.js, promotion-guidance.js, workflow-router.js, action-planner.js, context-discovery.js, state-paths.js, project-policy.js)
- **Zero external dependencies** in runtime — Node.js builtins only
- **Existing v2 rewrite plan:** `references/v2-rewrite-plan-rev2.md` — addresses 14 structural weaknesses (W1-W14), plans upfront security contract. Phase 0 (v1.6.0) partially shipped. Phase 1-4 not started. **This plan is architecturally sound — absorb it, don't discard it.**

### 14 Known Weaknesses (from the v2 plan)
- W1: Decision logic triplicated across 3 hooks/adapters
- W2: No real session boundary
- W3: No upfront security contract
- W4: Kill switch covers only 5/12 hooks
- W5: Secret scanning Claude-only
- W6: ✅ Fixed (journal rotation)
- W7: ✅ Fixed (corruption backup)
- W8: ⚠️ Partial (state-paths.js exists, not fully adopted)
- W9: Config has no schema
- W10: decisionKey too coarse
- W11: High-risk-non-destructive can't be pre-approved
- W12: Adapter enforce coverage weak
- W13: No cross-harness equivalence test
- W14: ⚠️ Partial (docs drift)

### Current Rating: 7.3/10
Strong foundations, real code, but: execution gap on v2 plan, 107 uncommitted files, docs/reality drift.

---

## Product Strategy: Two-Layer Model

This add-on has two distinct layers. The plan must keep them separate:

### Layer 1 — Core (Commercial Value)
The security and intelligence engine — what makes this worth paying for:
- Decision engine, risk scoring, policy store, session context
- Upfront security contracts
- Memory system (persistent learning)
- Smart capability selector
- Self-evolution engine (assisted, not autonomous)
- Observability
- Host harness adapters

### Layer 2 — Library (Community / Open)
The content that attracts users to the platform:
- Agent library
- Skill library
- Rule library
- Workflow templates
- Module/capability packs

Core pulls users in with free library content → they pay for the security and intelligence engine.

---

## What The Plan Must Achieve

### A. Full Rebranding
- Remove ALL references to "ecc", "ecc-safe-plus", "Claude Code" as product names throughout the entire codebase
- We cannot keep naming our add-on after any specific host tool — we support MANY host tools
- Propose 2-3 brand name options that are: ours, sellable, vendor-neutral, professional
- All file names, variables, env vars (HORUS_*), config keys, CLI commands, docs must reflect the new name
- This is a commercial add-on we may sell — branding must be clean and independent of any host harness

### B. Absorb the v2 Rewrite Plan (W1-W14)
- The existing plan in `references/v2-rewrite-plan-rev2.md` is architecturally sound
- Absorb its Phase 1-4 into this master plan as foundational work
- The upfront security contract, pretool-gate consolidation, and cross-harness equivalence are non-negotiable deliverables
- **Security contract design reference:** Study https://github.com/cedar-policy/cedar (AWS's policy language — simpler than OPA, designed for exactly this kind of scope-based permission model. May inspire our contract schema design. Verify it's actually relevant.)

### C. Persistent Memory System (Second Brain)
**Starting points to evaluate:**
- https://github.com/thedotmack/claude-mem (session capture + web viewer)
- https://github.com/mem0ai/mem0 (leading agent memory framework — user/agent/session memory separation, hybrid search, production-grade — likely stronger than claude-mem, verify)
**Your job:** Search for other memory systems beyond these two. Compare approaches. We already have basic memory in our hooks (session-start, session-end, instinct-utils.js, memory-load.js). What's the ideal architecture for an ADD-ON memory layer that works across multiple host harnesses?

Requirements for our memory layer:
- Captures session context, decisions, patterns, and learnings automatically
- Local storage with search capability (evaluate: SQLite+FTS vs vector DB vs something simpler)
- Progressive disclosure (summary → details → raw)
- Integrates with Obsidian (https://obsidian.md/) as a "Second Brain" — the agent can read/write/search an Obsidian vault, create linked notes, use backlinks for knowledge graphs
- Privacy-first: all data stays local
- Memory informs runtime decisions: the system learns project patterns over time
- Must work WITHOUT external services — no mandatory Chroma, no mandatory Python dependencies
- Must work across host harnesses — memory collected in Claude Code should be available when using OpenClaw on the same project

**Critical sub-problems the memory system MUST solve:**

1. **Session Continuity** — This is the #1 problem. When a session ends or context gets compacted, the agent loses everything. The memory layer must capture:
   - What was the agent working on?
   - What decisions were made and why?
   - What problems were encountered?
   - What files were modified and what's still incomplete?
   - What's left to do?
   So the NEXT session can pick up where the last one left off — not start from scratch.

2. **Error Learning** — When the agent makes a mistake (wrong edit, bad assumption, broke a test), the memory silently records: what went wrong, what the context was, what the fix was. Next time a similar situation arises, the system provides a confidence signal: "In this project, this type of change failed 3 times before — consider X instead." This is Tier 1 auto-learn — no approval needed.

3. **Confidence Calibration** — Different from security (which is about permission). This is about correctness. The memory tracks: which types of changes succeed vs fail in this project. The agent can then calibrate: "I'm confident about this change" vs "I'm uncertain — I should verify first." This makes the agent genuinely better over time, not just safer.

4. **Context-Aware Compaction** — When the host harness compacts/summarizes context, the add-on should influence what information survives. Critical decisions, active task state, and unfinished work must be preserved. Routine tool outputs can be dropped.

5. **Decision Cache** — When the security contract allows or blocks an operation, cache that decision. Don't re-evaluate "is rm -rf build/ allowed?" every time — the contract already answered this. This directly improves performance and reduces noise.

6. **Capability Composition Memory** — Track which combinations of agents/skills work well together for specific task types. Next time a similar task comes up, suggest the proven combination, not individual capabilities.

### D. UI/UX Design Intelligence
**Starting point to evaluate:** https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
**Your job:** Is this actually good? Search for alternatives. We have zero UI/UX capability currently — what's the best way to add it as skills/agents that host harnesses can invoke? Maybe there's a better approach than a massive style library?

### E. Development Methodology & Workflows
**Starting point to evaluate:** https://github.com/obra/superpowers
**Also evaluate:** https://github.com/gsd-build/get-shit-done
**Your job:** We already have development-workflow rules, git-workflow rules, and testing rules. Compare what we have vs what these offer. Maybe ours is already sufficient in some areas. Maybe theirs is better in others. Research if there are newer/better workflow frameworks. Design the best hybrid — remembering we deliver these as RULES, SKILLS, and WORKFLOWS that the host harness applies.

### F. Expanded Agent Library
**Starting points to evaluate:**
- https://github.com/msitarzewski/agency-agents (claims 112+ agents)
- https://github.com/VoltAgent/awesome-claude-code-subagents (claims 130+ subagents)
- https://github.com/ashishpatel26/500-AI-Agents-Projects (500 use cases)
**Your job:** We have 50 agents already. Don't just blindly add 100 more. For each category:
- Do we already cover it? If yes, is ours better or worse?
- Is the external agent actually useful or just a template with a fancy name?
- What GAPS do we genuinely have? (likely: sales, marketing, business strategy, spatial computing, orchestration)
- Quality over quantity — 80 excellent agents beats 200 mediocre ones
- Target: identify the real gaps, fill them with well-designed agents
- Remember: these agents run INSIDE the host harness — design them to work with any supported host

### G. Marketing & Growth Skills
**Starting point to evaluate:** https://github.com/coreyhaines31/marketingskills
**Your job:** We have zero marketing capabilities. Is this repo actually good? Search for alternatives. Design the right scope — what marketing skills would users of our add-on actually use?

### H. Code Intelligence
**Starting points to evaluate:**
- https://github.com/tirth8205/code-review-graph (Tree-sitter based knowledge graph, 8x token reduction)
- https://github.com/ast-grep/ast-grep (structural code search — simpler than full Tree-sitter, might solve 80% of the problem at 20% complexity. Verify.)
**Your job:** We have code-review rules and agents already. Does a graph-based approach add real value as an enhancement layer? Compare Tree-sitter vs ast-grep vs other approaches. Evaluate honestly whether this is worth the complexity for an add-on.

### I. Self-Evolution Engine (Two-Tier: Auto-Learn + Assisted-Act)
**Starting point to evaluate:** https://github.com/stanfordnlp/dspy (Stanford's framework for self-optimizing LLM programs — has real patterns for how an agent evaluates its own performance and proposes improvements. Verify relevance.)
Also search for other self-improving agent architectures and learn from them.

**Critical design decision:** Self-evolution follows the two-tier model from the Core UX Principles:

**Tier 1 — Auto-Learn (no approval, no interruption):**
- Observe and store project patterns, user preferences, command frequency
- Track which capabilities are used/unused
- Detect project stack changes
- Log performance and error patterns
- Build internal knowledge about this project over time
- This tier NEVER changes the system's behavior — it only collects intelligence

**Tier 2 — Assisted-Act (requires user approval):**
- **Propose** new agents, skills, rules, hooks based on Tier 1 observations
- **Propose** improvements to existing components when better approaches are detected
- **Track upstream repos** — maintain a local registry (stored OUTSIDE the project repo), check for updates, evaluate relevance, propose adoptions
- **Self-test** — when it creates or modifies a component, it generates and runs verification
- **Version its own changes** — every generated component gets a provenance trail

**Boundaries (both tiers):**
- Evolution CANNOT lower security floors or modify the security contract
- Every generated component must pass the same quality bar as hand-written ones
- Generated components must work across all supported host harnesses
- Tier 1 data is never sent anywhere — local only
- Tier 2 proposals include clear reasoning: "I noticed X pattern over N sessions, proposing Y because Z"

### J. Smart Capability Selector
This is CRITICAL — a powerful add-on nobody can use is worthless:
1. **Profile-based activation** — user declares their role and only relevant capabilities activate
2. **Project-aware filtering** — detect the project stack and auto-enable matching skills/agents/rules
3. **Host-harness-aware** — only activate capabilities that the current host harness supports
4. **Progressive unlocking** — start minimal, suggest capabilities as the user hits use cases
5. **Searchable capability catalog** — natural language search across all components
6. **Dependency-aware** — some skills need others; the selector handles this
7. **Usage analytics** — track what's used, suggest removing unused, promote frequently needed
8. **Onboarding experience** — first-run should feel simple, not overwhelming

### K. Offline Upstream Tracking
- Local database (outside project repo) of upstream source repos worth monitoring
- Periodic diff for new features, skills, patterns
- Automatic relevance and quality evaluation
- Propose cherry-picks with diff previews — never auto-merge
- Track adoption history: what we took, skipped, and why

### L. Extension & Pack API
**Design reference to study:** https://github.com/backstage/backstage (Spotify's developer platform — one of the best plugin architectures for developer tools. Study how they handle plugin discovery, installation, dependency management, and sandboxing. Verify relevance.)

Users and teams may want to extend our add-on with custom capability packs. Design:
- Standard format for custom agents, skills, rules, hooks
- Capability pack bundling (related components packaged together)
- Pack dependency declarations
- Automatic security review (schema validation + sandbox constraints)
- Pack registry (local-first, optional shared registry later)
- This turns our add-on into a PLATFORM other people build on

### M. Observability
The host harness does its thing — but what is OUR ADD-ON doing? Users need to see:
- Decision history: what was allowed/blocked/escalated and why
- Memory state browser: what the add-on remembers about this project
- Capability usage heatmap: which agents/skills are active vs dormant
- Security posture summary: contract status, risk trends, floor activations
- Session timeline: what happened in each session, searchable
- Deliver through whatever mechanism the host harness supports (CLI output, generated reports, local web view, or Obsidian notes)

### N. Host Harness Compatibility Layer
Since we're an add-on supporting multiple hosts, design:
- **Adapter pattern** — thin adapter per host harness that maps our components to the host's extension format
- **Capability detection** — automatically discover what the host harness supports
- **Graceful degradation** — if the host doesn't support a feature, disable that part cleanly
- **Installation per host** — one-command install that auto-detects which host is present
- **Testing per host** — verify our add-on works on every supported host after each change
- **New host onboarding** — documented process for adding support for a new host harness

### O. Documentation (English-only for docs that humans read)
- **Quickstart guide** — installed and working in under 5 minutes on any supported host
- **Per-host setup guides** — specific instructions for each supported harness
- **User guide** — complete reference for all features
- **API reference** — for the extension/pack API
- **Security whitepaper** — for enterprise buyers
- **Migration guide** — from vanilla host harness to our enhanced version
- Docs must be generated/validated from actual code — no drift allowed
- Arabic documentation as a secondary language (our home language)

### P. Cross-Session Task Handoff
The biggest pain point for AI agents today: **multi-session work is broken.** If a task takes 3 sessions, each session starts from scratch. Design a task handoff system:
- At session end (or compaction), automatically save: active task, progress, remaining steps, relevant file states, decisions made
- At session start, automatically load the handoff and present: "Last session you were working on X. You completed A, B. Remaining: C, D. Files modified: [list]. Want to continue?"
- This is NOT just memory — it's structured task state. Memory stores knowledge, handoff stores work-in-progress.
- The handoff must work across different host harnesses (started in Claude Code, continue in OpenClaw)
- Research if any existing tool solves this well, or design from scratch

### Q. Whatever You Discover
If your research surfaces a capability category I haven't thought of — add it with justification. Think especially about:
- What do users of AI coding agents complain about most?
- What capabilities do enterprise buyers ask for?
- What's missing in the agent tooling ecosystem?

---

## Language & Translation Policy

**This is an AI agent add-on. The AI models read our files as instructions. All component files MUST stay in English.** Mixing languages inside rule/agent/skill files causes AI models to misunderstand or partially apply instructions.

### What stays English ONLY (forever):
- Rule files (`.md` in `rules/`) — AI reads these as instructions
- Agent files (`.md` in `agents/`) — AI reads these as instructions
- Skill files (`.md` in `skills/`) — AI reads these as instructions
- Hook source code (`.js` in `claude/hooks/`, adapters)
- Runtime source code (`.js` in `runtime/`)
- Scripts (`.sh` in `scripts/`)
- Module definitions (`.json` in `modules/`)
- Workflow files
- Config keys, env var names, CLI command names
- Code comments, variable names, function names
- Fixture/test files

### What gets translated (human-facing content only):
- Documentation (README, guides, tutorials, whitepaper)
- CLI output messages shown to the user (via i18n message files, NOT inline)
- Dashboard/observability UI text (via i18n message files)
- Error messages shown to the user
- Installation wizard user-facing text

### Translation languages:
- **English** — primary, complete
- **Arabic** — secondary, our home language (RTL support for UI/dashboard)
- More languages added ONLY when there is real user demand — not preemptively

### i18n implementation:
- Separate message files per language (e.g., `i18n/en.json`, `i18n/ar.json`)
- Never inline translations inside component files
- CLI and dashboard load the right message file based on locale
- English is always the fallback

---

## Architecture Constraints

1. **Add-on architecture:**
   - We are a layer ON TOP of host harnesses — we use their extension points
   - We do NOT modify, fork, or patch host harness code
   - We install through each host's standard mechanism
   - Our runtime logic lives in hooks and scripts that the host harness calls
   - Our state lives in a well-defined local directory separate from the host's state
2. **Layered dependency model:**
   - **Core runtime** — MUST stay zero-dep (Node.js builtins only). Non-negotiable.
   - **Enhancement layers** (memory, code graph, vector search) — MAY use optional dependencies with graceful degradation. Core must always work with zero dependencies.
3. **Security floors never demotable** — hard floors are permanent. Self-evolution cannot modify them. No contract can override them.
4. **Local-first** — all data on user's machine. No cloud required.
5. **Cross-harness consistency** — same contract, same engine, same rules → same outcomes regardless of host.
6. **Commercially licensable** — no AGPL/viral-license code in core. Study and rewrite, never fork.
7. **Modular** — every capability installable/removable independently.
8. **Backward migration** — existing installations migrate with one command. No data loss.
9. **Performance budget** — startup hook <500ms. Decision call <50ms. Memory search <200ms. Selector <100ms.
10. **Generative architecture** — the add-on must CREATE any component type from natural language. Generated output must match hand-written quality, pass validation, work on all hosts.
11. **Dry-run support** — every major operation supports --dry-run.
12. **Rollback** — every change is reversible.
13. **Host supremacy on conflicts** — if our add-on allows something but the host harness blocks it, the HOST WINS. We can only restrict further, never override the host's own safety. If the host allows something but our contract blocks it, WE WIN. The stricter rule always prevails. This must be explicit in the architecture.

---

## Deliverable Format

Produce a single plan document called `MASTER_PLAN.md` at the project root with:

1. **Vision Statement** — one paragraph: what this add-on becomes, who it's for, why it's worth paying for
2. **Product Identity** — what we are (add-on), what we are NOT (standalone system), supported hosts, two-layer model (Core paid + Library open)
3. **Research Findings** — for each capability area:
   - Sources evaluated (including ones you found beyond my links)
   - Honest rating of each source (real/promising/vaporware/abandoned)
   - Decision: keep ours / adopt theirs / hybrid / design from scratch / use alternative
   - Reasoning
4. **Rebranding Specification** — 2-3 name proposals with rationale, full rename mapping
5. **Architecture Overview** — add-on layer model, data flow, module system, host adapter pattern
6. **Phase Plan** — sequential phases with:
   - Phase number, name, version
   - Concrete deliverables (actual file names to create/modify)
   - Which W1-W14 weaknesses resolved
   - Which new capabilities added
   - Verification criteria (including per-host testing)
   - Dependencies on prior phases
   - Estimated complexity (S/M/L/XL per deliverable)
   - Do NOT include time estimates — all work is done by AI agents with minimal human intervention, so time is not a useful metric. Use complexity and dependency ordering instead.
7. **Component Inventory** — current count → target count per type, with justification
8. **Host Compatibility Matrix** — which features work on which host, what each adapter needs
9. **Upstream Source Registry Design**
10. **Self-Evolution Rules** — two-tier model: what auto-learns silently vs what proposes and needs approval
11. **Smart Selector Design** — filtering logic, onboarding flow, host-awareness
12. **Extension API Design** — how users/teams build and share packs
13. **Observability Design** — what's visualized, delivery mechanism per host
14. **Language Policy** — what stays English, what gets translated, how i18n works (per the policy above)
15. **Risk Assessment** — what could go wrong (include: host breaking changes, dependency on host APIs)
16. **Non-Goals** — explicit: we do NOT build a standalone system in this plan
17. **Decision Log** — every "ours vs theirs vs hybrid" decision with reasoning
18. **Competitive Analysis** — what other add-ons exist for AI coding agents? Our unique value?
19. **Execution Flow Design** — the three modes (guided/autonomous/hybrid), how the user chooses, how mode affects every system component
20. **Security Contract UX** — the one-time agree flow: scan → analyze → present → approve → enforce. How amendments work. How this replaces per-action approval.

**CRITICAL: Phase 1 must fix current problems BEFORE any new capabilities.**
The project currently has:
- 107 modified files + 11 untracked files not committed
- 10 out of 14 structural weaknesses (W1-W14) still unfixed
- Docs/reality drift
- Rating: 7.3/10

Phase 1 must commit all uncommitted work, fix W1-W14, and rebrand. NO new capability work until the foundation is solid. Building new features on a 7.3/10 foundation creates a worse product, not a better one.

**Phase ordering guidance** (challenge this if you have better reasoning):
- Phase 1: Commit uncommitted work + Rebrand + Fix W1-W14 (FOUNDATION — nothing else until this is done)
- Host compatibility layer early (everything needs cross-host support)
- Security contract before self-evolution (self-evolution needs boundaries)
- Smart selector before capability explosion (prevents unusability)
- Memory system early (other capabilities benefit from persistent context)
- Extension API before ecosystem push
- After Phase 2, do a soft launch to early users for real feedback

**Important:** After Phase 2 soft launch, the plan should have a checkpoint where the remaining phases may be re-prioritized based on real user feedback. Don't assume we know what users want — design for learning.

Read the ENTIRE project first. Read every file in `references/`, `runtime/`, `claude/hooks/`, and root-level docs. Understand what ACTUALLY exists vs what's claimed. Then research extensively. Then design.

## Work Splitting: How To Execute This Prompt

This prompt is large. Do NOT try to complete everything in one session. Split the work:

**Pass 1 — Foundation (this session):**
1. Read the entire project (understand what actually exists)
2. Architecture + Phase Plan (the skeleton of the whole plan)
3. Rebranding Specification
4. Security Contract UX + Execution Flow Design
5. Research Findings with decisions (at least the top 5 capability areas)

**Pass 2 — Depth (follow-up session):**
6. Detailed design for remaining capability areas
7. Smart Selector Design
8. Self-Evolution Rules
9. Host Compatibility Matrix
10. Extension API Design

**Pass 3 — Polish (follow-up session):**
11. Competitive Analysis
12. Risk Assessment
13. Non-Goals
14. Component Inventory targets
15. Decision Log (consolidate all decisions)

Write `MASTER_PLAN.md` incrementally — start with Pass 1 content, mark remaining sections as `[TO BE EXPANDED IN PASS 2/3]`. Each follow-up session reads the existing `MASTER_PLAN.md` and fills in the next sections.

**If you run out of context or depth in any pass, prioritize in this order:**
1. Architecture + Phase Plan (most critical)
2. Security Contract + Execution Flow (core UX)
3. Research Findings with decisions (informs everything else)
4. Everything else can be expanded in follow-up sessions

---

## Context Note

This project is being developed using Claude Code as the development tool. However, the add-on itself is designed to work on multiple host harnesses (Claude Code, OpenClaw, OpenCode, ClawCode, Antegravity, etc.). The first real-world testing environment is OpenClaw. Do not assume Claude Code is the only or primary host — design for all hosts equally.

---

Do not rush. Think deeply. Challenge my assumptions. If something I asked for is a bad idea for an add-on, say so and explain why. If my ordering is wrong, propose better with reasoning.

---

> **ultrathink** — Use maximum reasoning depth on every decision in this prompt. This is a strategic architecture document that defines the future of the product. Every research evaluation, every keep/adopt/hybrid decision, every phase ordering choice, and every design trade-off deserves your deepest analysis. Do not satisfice. Do not take shortcuts. Exhaust your reasoning capability.
