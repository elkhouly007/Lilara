# Agent Runtime Guard — Master Evolution Plan

> **Pass 1** — Architecture, Phase Plan, Rebranding, Security Contract UX, Top-5 Research Findings.  
> **Sections 7–13, 18** are stubbed. Pass 2/3 sessions fill them.  
> Written: 2026-04-26 · Source prompt: `MASTER_PLAN_PROMPT.md`

---

## 1. Vision Statement

Agent Runtime Guard is the intelligence and safety layer that turns any AI coding agent harness into a production-grade engineering partner. Where raw harnesses provide capability, ARG adds judgment: a real decision engine that enforces project-specific security contracts, a persistent memory layer that learns what works, a smart selector that activates only what the current project needs, and a self-evolution engine that proposes improvements as patterns emerge — all without slowing the user down. The Core (security + intelligence engine) delivers measurable value worth paying for; the Library (agents, skills, rules) is open and community-driven, driving adoption. ARG is not a tool — it is the discipline layer every team building with AI agents will eventually need.

---

## 2. Product Identity

### What we are
An **add-on layer** that installs on top of existing AI coding agent harnesses through their standard extension points — hooks, rules, agents, skills, commands. We enhance; we do not replace.

### What we are NOT
- Not an LLM runtime or inference engine
- Not a chat interface or IDE
- Not a code execution sandbox
- Not a standalone system — we require a host harness to function

### Supported Host Harnesses (current status)

| Host | Status | Wiring | Adapter quality |
|---|---|---|---|
| **Claude Code** | ✅ Substantive | `claude/hooks/*.js` (13 hooks) + `claude/WIRING_PLAN.md` | Production |
| **OpenClaw** | ✅ Substantive | `openclaw/hooks/adapter.js` + `openclaw/WIRING_PLAN.md` | Production |
| **OpenCode** | ✅ Substantive | `opencode/hooks/adapter.js` + `opencode/WIRING_PLAN.md` + per-harness commands | Production |
| **ClawCode** | ⚠️ Stub | `clawcode/hooks/adapter.js` (shim only) | Needs Phase 2 |
| **Antegravity** | ⚠️ Stub | `antegravity/hooks/adapter.js` (shim only) | Needs Phase 2 |
| **Codex** | ⚠️ Stub | `codex/hooks/adapter.js` (shim only) | Needs Phase 2 |

### Two-Layer Model

```
┌─────────────────────────────────────────────────────────┐
│  Layer 2 — Library (Community / Open)                   │
│  49 agents · 80 rules · 22 skills · 55 modules          │
│  Attracts users; freely available                        │
├─────────────────────────────────────────────────────────┤
│  Layer 1 — Core (Commercial Value)                       │
│  Decision engine · Risk scoring · Policy store           │
│  Security contracts · Memory layer · Smart selector      │
│  Self-evolution · Observability · Host adapters          │
│  Worth paying for                                        │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Research Findings

> **Scope for Pass 1:** Top-5 capability areas per the prompt's prioritization. Areas F, G, J–P are stubbed for Pass 2.

### Research Methodology
For each area: searched for 2–3 options, verified source quality against actual code (not README marketing), compared to what we already have, then chose: **keep / adopt / hybrid / scratch / alternative**.

---

### 3A. Persistent Memory / Second Brain

**Sources evaluated:**

| Source | Stars | Last active | Rating | Notes |
|---|---|---|---|---|
| `thedotmack/claude-mem` | 67.7k | April 2026 (v12.4.7) | **Real** | SQLite+FTS5 + Chroma vector DB; session capture + web viewer; TypeScript |
| `mem0ai/mem0` | ~20k+ | Active 2026 | **Real** | User/agent/session memory separation; hybrid semantic+keyword search; Python |
| **Our current state** | — | April 2026 | Scaffolding | `memory-load.js` reads one markdown index; `session-end.js` captures tool name metadata only; no retrieval; no persistence of reasoning |

**Decision: Hybrid — design from scratch, inspired by claude-mem + mem0's architecture**

**Reasoning:**
- claude-mem is real and mature but requires Chroma (violates our zero-dep core constraint). Its session-capture pattern and SQLite+FTS5 approach are exactly what we need.
- mem0's user/agent/session memory *separation* model is the right architectural insight — different memory types have different TTLs and retrieval patterns.
- Our current scaffolding is genuinely empty: we capture only `tool_name` and `event_type` at session end. Starting from this is not "building on a foundation" — it's greenfield.
- Implementation: SQLite+FTS5 as an **optional dependency** (graceful degradation to flat-file markdown when SQLite unavailable). No Chroma, no Python. Node.js only.

**What we build (Phase 4):**
1. `runtime/memory-store.js` — SQLite+FTS5 local store; schema: `sessions`, `decisions`, `patterns`, `tasks`
2. `runtime/task-handoff.js` — structured WIP state: active task, decisions made, files modified, remaining steps
3. Three memory tiers: Session (volatile, in-memory), Project (durable, SQLite), User (cross-project, `~/.{brand}/memory/`)
4. Obsidian bridge: optional export of project memory as linked markdown notes (write-only; Obsidian handles rendering)
5. Hook integration: `session-start.js` loads relevant context; `session-end.js` writes structured handoff + pattern updates

---

### 3B. Development Methodology & Workflows

**Sources evaluated:**

| Source | Stars | Last active | Rating | Notes |
|---|---|---|---|---|
| `obra/superpowers` | — | Active (installed in this harness) | **Real** | TDD, debugging, task decomposition, plan/execute disciplines. Rigid process skills. |
| `gsd-build/get-shit-done` (GSD) | — | Active (installed in this harness) | **Real** | Phase-based workflow management, scope drift detection, parallel execution |
| **Our current rules** | — | April 2026 | **Real, mature** | 80 rules across 16 language domains; `rules/common/` covers development-workflow, git-workflow, testing, code-review, security |

**Decision: Keep ours + cherry-pick superpowers' skill-level discipline**

**Reasoning:**
- Our rule library is the deepest layer: 80+ markdown files covering coding style, patterns, security, testing, hooks, and workflow for 16 languages. Neither superpowers nor GSD match this breadth for code-quality standards.
- superpowers has excellent *process discipline skills* (TDD enforcement, systematic debugging, writing plans, executing plans, dispatching parallel agents) that we do NOT have in `skills/`. These are genuinely additive.
- GSD offers structured phase management — relevant to complex multi-session projects. However, GSD works better as an *installed* workflow tool on top of our add-on rather than something we absorb into our library.
- Gap: `skills/` only has 22 files, heavily skewed toward configuration and debugging. Missing: TDD discipline, plan-writing, parallel-agent dispatch, systematic debugging.

**What we build (Phase 7):**
- Add `skills/tdd-cycle.md`, `skills/debug-systematic.md`, `skills/write-plan.md`, `skills/execute-plan.md` — modeled on superpowers patterns, rewritten in ARG style for host-neutrality
- Update `rules/common/testing.md` with TDD-first mandate (currently present but not enforced as a skill)

---

### 3C. UI/UX Design Intelligence

**Sources evaluated:**

| Source | Stars | Last active | Rating | Notes |
|---|---|---|---|---|
| `nextlevelbuilder/ui-ux-pro-max-skill` | 70.7k | March 2026 (v2.5.0) | **Real** | 161 industry-specific reasoning rules, 67 UI styles, 57 font pairings, CLI installer. Supports 15+ tech stacks. Active dev, 64 open issues. |
| **Our current state** | — | — | Near-zero | 1 accessibility agent (`a11y-architect.md`), 1 design-quality rule file (`rules/web/design-quality.md`). Nothing else. |

**Decision: Adopt selectively — bridge, don't rewrite**

**Reasoning:**
- ui-ux-pro-max-skill is substantive: 161 reasoning rules + 57 font pairings + 67 styles is real engineering, not a README. Installing it gives immediate value we couldn't match in one pass.
- We do NOT want to copy 161 rules into our library — that's duplication and maintenance overhead.
- The right pattern: add a `skills/ui-ux-review.md` ARG skill that *orchestrates* the installed ui-ux-pro-max capability as a specialized sub-skill, plus one `agents/ui-ux-architect.md` agent that handles project-level design system decisions.
- We supplement with: `agents/design-system-auditor.md` (our own, for verifying design-system consistency within code), keeping `agents/a11y-architect.md` as-is.

**What we build (Phase 7):**
- `skills/ui-ux-review.md` — orchestrator skill that routes to ui-ux-pro-max when available
- `agents/ui-ux-architect.md` — design system decisions + tech-stack-specific guidance
- `agents/design-system-auditor.md` — code-review for design-system violations

---

### 3D. Code Intelligence

**Sources evaluated:**

| Source | Stars | Last active | Rating | Notes |
|---|---|---|---|---|
| `tirth8205/code-review-graph` | 13.2k | April 2026 | **Promising** | Tree-sitter knowledge graph + MCP integration. 8.2x avg token reduction (but 0.7x on trivial edits; 0.35 search quality MRR). Requires Python + PyPI. |
| `ast-grep/ast-grep` | — | Active 2026 | **Real** | Rust-based structural code search. 23 language support. CLI + API. Fast. Simple. No Python dependency. |
| **Our current state** | — | — | None | Code review is agent-based (agents read files directly). No structural search layer. |

**Decision: ast-grep as foundational layer; code-review-graph deferred to Phase 8+**

**Reasoning:**
- code-review-graph's MCP approach is compelling for token reduction but introduces Python + PyPI + Chroma dependencies, violating our zero-dep core rule. Variable results (8x average hides 0.7x on trivial cases). Defer to Phase 8 when we have an optional-dep extension API and can offer it as a pack.
- ast-grep is simpler: a Rust binary with no runtime dependencies, CLI-first, supports structural pattern matching across 23 languages. Our agents can invoke it via Bash; our hooks can use it for pre-commit analysis without complex setup.
- For an ADD-ON, simpler external tools (CLI-invocable) are safer than complex Python pipelines. If ast-grep isn't installed, agents fall back to grep-based search — graceful degradation.

**What we build (Phase 7):**
- `scripts/code-intel-check.sh` — wrapper around `ast-grep` with fallback to `grep` if not installed
- Update `agents/code-reviewer.md` to optionally invoke structural search for impact analysis
- `rules/common/code-intelligence.md` — guidance on when to use structural vs text search

---

### 3E. Self-Evolution Engine

**Sources evaluated:**

| Source | Stars | Last active | Rating | Notes |
|---|---|---|---|---|
| `stanfordnlp/dspy` | ~20k+ | Active 2026 | **Real** | Python framework for self-optimizing LLM programs. Signature/module system, evaluation metrics, optimization loops. Production-grade. |
| **Our Tier-1/2 model** (designed from prompt) | — | — | Design | Two-tier: Tier-1 auto-learns silently; Tier-2 proposes + needs approval. |

**Decision: Design from scratch — use DSPy's structural insight, not its implementation**

**Reasoning:**
- DSPy is real and powerful but is a Python framework for *inference-time* optimization (optimizing prompts/few-shots for a given metric). Our self-evolution problem is different: we need *file-system evolution* (generating and modifying agents/skills/rules) based on observed project patterns — not optimizing inference.
- DSPy's most valuable insight for us: the separation between the *signature* (what a component does: input → output) and the *optimizer* (how it improves). Our Tier-2 engine should follow this: each proposed change has a declared intent + a measurable evaluation criterion.
- We already have `runtime/decision-journal.js` (append-only JSONL decision log) and `runtime/policy-store.js` (learned-allow store). These are the raw data sources for Tier-1 learning. The infrastructure exists.
- Implementation is Node.js (respects zero-dep core); any LLM inference in Tier-2 is delegated to the host harness's native capability (not a direct API call from our runtime).

**What we build (Phase 6):**
- `runtime/evolution-observer.js` — Tier-1: reads decision-journal + policy-store, computes pattern summaries (error rates, command frequency, capability usage, confidence trends)
- `runtime/evolution-proposer.js` — Tier-2: translates pattern summaries into structured proposals with: component type, current state, proposed change, evaluation criterion, reasoning chain
- `scripts/evolution-review.sh` — CLI for reviewing and approving/dismissing proposals
- Guard: evolution engine cannot modify `runtime/` files or lower security floors (enforced by component-type allowlist)

---

### 3F–3P. Remaining Capability Areas

> **[TO BE EXPANDED IN PASS 2]**

| Area | Prompt reference | Pass-2 priority |
|---|---|---|
| F — Expanded Agent Library | Sections F | HIGH — 49 agents with clear gaps (business, UI, infra) |
| G — Marketing & Growth Skills | Section G | MEDIUM — genuine gap but lower priority than core |
| J — Smart Capability Selector | Section J | HIGH — prerequisite for good onboarding |
| K — Offline Upstream Tracking | Section K | MEDIUM — useful for self-evolution |
| L — Extension & Pack API | Section L | HIGH — enables ecosystem growth |
| M — Observability | Section M | MEDIUM — CLI output first; dashboard later |
| N — Host Harness Compatibility | Section N | HIGH — Phase 2 work |
| P — Cross-Session Task Handoff | Section P | HIGH — bundled with memory (Phase 4) |
| Q — Discovered capabilities | Section Q | MEDIUM — review after user feedback |

---

## 4. Rebranding Specification

### Problem
The current brand `ecc` / `ecc-safe-plus` ties the add-on to its Claude Code origins. As a multi-host add-on targeting commercial adoption, the name must be vendor-neutral, sellable, and ours.

### Rename Surface (verified counts)

| Pattern | Files affected | Examples |
|---|---|---|
| `HORUS_*` env-var prefix | ~80 | `HORUS_ENFORCE`, `HORUS_KILL_SWITCH`, `HORUS_DRY_RUN`, `HORUS_STATE_DIR` |
| `horus.config.json` / `horus.contract.json` | ~50 | config file names, schema IDs, CLI references |
| `horus-cli.sh` (CLI binary name) | ~20 | CLI entry point + all doc references |
| `ecc-safe-plus` (product name) | 2 | `CHANGELOG.md`, `MASTER_PLAN_PROMPT.md` |
| `schemas/ecc.*.schema.json` | 2 | both schema files |
| "Claude Code" as product name in docs | ~40 | `README.md`, `ROADMAP.md`, `MODULES.md`, `CHANGELOG.md` (legitimate host refs in `claude/` dir are fine) |
| `.horus/` legacy path | 1 | `state-paths.js:hookStateDir()` |

**Already on new brand:** `~/.horus/` is the current state path in `runtime/state-paths.js`. The repo name itself is `agent-runtime-guard`. The CLI new-brand path just needs the rest of the codebase to catch up.

### ✅ Brand: Horus Agentic Power (HAP)

Selected by the project owner on 2026-04-26.

| Attribute | Value |
|---|---|
| **Full name** | Horus Agentic Power |
| **Acronym** | HAP |
| **Tagline** | "The full agentic power layer" |
| **Inspiration** | Horus: Egyptian god of protection, kingship, and the sky. "Agentic" = modern AI term for autonomous systems. "Power" = what we add to any agentic stack. |
| **Env var prefix** | `HORUS_` (e.g., `HORUS_ENFORCE`, `HORUS_KILL_SWITCH`, `HORUS_DRY_RUN`, `HORUS_STATE_DIR`) |
| **Config files** | `horus.config.json` / `horus.contract.json` |
| **CLI binary** | `horus-cli` |
| **Schema files** | `horus.config.schema.json` / `horus.contract.schema.json` |
| **State directory** | `~/.horus/` |
| **Domain candidates** | `horusagentic.dev` / `horusai.dev` |

**Why Horus:** Not just a guard — Horus is a king and a full-power entity. "Agentic Power" positions this as a complete platform (agents, skills, workflows, scripts, security, memory) not merely a security layer. The Egyptian mythology angle is distinctive and memorable in the AI tooling space.

### Full Rename Mapping

| Current | New (Horus Agentic Power) |
|---|---|
| `HORUS_*` env vars | `HORUS_*` env vars |
| `horus.config.json` | `horus.config.json` |
| `horus.contract.json` | `horus.contract.json` |
| `horus.contract.json.draft` | `horus.contract.json.draft` |
| `scripts/horus-cli.sh` | `scripts/horus-cli.sh` |
| `scripts/horus-diff-decisions.sh` | `scripts/horus-diff-decisions.sh` |
| `schemas/horus.config.schema.json` | `schemas/horus.config.schema.json` |
| `schemas/horus.contract.schema.json` | `schemas/horus.contract.schema.json` |
| `skills/configure-ecc.md` | `skills/configure-horus.md` |
| `CLAUDE_CODE_HANDOFF.md` | `AGENT_HANDOFF.md` |
| `.horus/` (hookStateDir) | `.horus/` (unified with stateDir) |
| CLI command prefix `ecc` | `horus` |
| Schema `contractId` prefix `arg-` | `hap-` (Horus Agentic Power) |
| Docs: "Claude Code security layer" | "Horus Agentic Power on Claude Code" |
| `agent-runtime-guard` (repo name) | Keep as-is (repo name, not product name) |

### Rename Implementation

A single script `scripts/rebrand.sh` that:
1. Takes `--from=ECC --to=ARG` (or brand-specific tokens)
2. Performs safe sed-replace across file-extension allowlist (`.sh`, `.js`, `.json`, `.md`, `.jsonc`, `.yaml`)
3. Renames files (ecc.* → arg.*)
4. Runs `scripts/run-fixtures.sh` to confirm nothing broke
5. Produces a git diff for review before committing

This script is itself a Phase 1 deliverable.

---

## 5. Architecture Overview

### Add-On Layer Model

```
┌────────────────────────────────────────────────────────────────┐
│  Host Harness (Claude Code / OpenClaw / OpenCode / …)          │
│  [Runs LLM inference, manages conversation, IDE integration]   │
│                                                                │
│  Extension Points: hooks (PreToolUse/PostToolUse/SessionStart/ │
│  SessionEnd/Stop), rules, agents, skills, commands             │
└────────────────────────┬───────────────────────────────────────┘
                         │ calls via standard extension API
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  ARG Host Adapter (per-harness shim, 15-25 LOC)               │
│  e.g., claude/hooks/dangerous-command-gate.js                  │
│  → calls createAdapter({ harness:"claude" })  (hook-utils.js)  │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  ARG Runtime Core (23 JS files / 3,454 LOC / zero-dep)        │
│                                                                │
│  pretool-gate.js                                               │
│    └─ decision-engine.js [15-rung precedence matrix]           │
│         ├─ contract.js          [load/verify/scopeMatch]       │
│         ├─ risk-score.js        [12 pattern classes, 0-10]     │
│         ├─ policy-store.js      [learned-allows, auto-allows]  │
│         ├─ session-context.js   [per-session risk window]      │
│         ├─ intent-classifier.js [8-intent classification]      │
│         ├─ route-resolver.js    [intent → lane routing]        │
│         ├─ workflow-router.js   [action → CI/PR/review lanes]  │
│         ├─ action-planner.js    [concrete step plans]          │
│         ├─ promotion-guidance.js[6-stage lifecycle]            │
│         └─ decision-journal.js  [JSONL audit log, 5MB rotation]│
│                                                                │
│  contract.js ←── horus.contract.json (per-project)             │
│  policy-store.js ←── learned-policy.json (~/.horus/…)           │
│  state-paths.js ←── single source of truth for all paths      │
└────────────────────────┬───────────────────────────────────────┘
                         │ writes to
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  ARG State Directory (~/.horus/)        │
│  accepted-contracts.json · learned-policy.json                 │
│  session-context.json · decision-journal.jsonl                 │
│  instincts/pending.json · instincts/confident.json             │
│  memory/ (Phase 4) · handoff.json (Phase 4)                   │
└────────────────────────────────────────────────────────────────┘
```

### Data Flow: PreToolUse Decision

```
Host fires PreToolUse → Adapter shim (15 LOC) → pretool-gate.js
  → secret-scan.js          [W5: cross-harness secret check]
  → decision-engine.js      [15 rungs]:
      Step 1:  kill-switch check (HORUS_KILL_SWITCH / ARG_KILL_SWITCH)
      Step 2:  context discovery (git branch, project stack)
      Step 3:  contract load + hash verify (strict mode)
      Step 4:  harness scope check (is this host in harnessScope?)
      Step 5:  risk score (0-10, 12 pattern classes)
      Step 6:  hard floor: critical commands (always block)
      Step 7:  hard floor: protected-branch mutations
      Step 8:  hard floor: destructive-delete scope check
      Step 9:  session-risk trajectory nudge (W11 partial)
      Step 10: contract scope-allow demotion
      Step 11: auto-allow-once token + learned-allow check
              → intent-classifier (8 intents: read/write/exec/…)
              → route-resolver  (intent → direct/verification/review)
  ← returns: { action, riskLevel, reasonCodes, decisionSource,
                policyKey, actionPlan, workflowRoute, … }
  → decision-journal.js     [JSONL append]
  → pretool-gate.js         [exit 0=allow, exit 2=block, exit 1=review]
```

### Host Supremacy Rule
> *If the host harness blocks something our contract allows — the HOST WINS.*  
> *If our contract blocks something the host allows — ARG WINS.*  
> The stricter rule always prevails. ARG can only restrict further, never override host safety.

### Module System
Modules are **policy documents** (JSON + markdown) that describe capability categories:
- `modules/phase{1,2,3}/` — per-phase shell/MCP/agent policy registries
- `modules/{mcp,wrapper,plugin,browser,notification,daemon}-pack/` — per-capability-class policies
- Each module has: class (local/external/read-only/write-gated/supervised), default policy, allowed use, approval boundary

Modules feed into `horus.config.json` capability selection and inform the Smart Capability Selector (Phase 5).

---

## 6. Phase Plan

> Complexity: S=Small, M=Medium, L=Large, XL=Extra-Large (for an AI agent executor)  
> No time estimates — all phases are executed by AI agents; complexity+dependencies are the right ordering metric.  
> **Host testing required** for every phase that modifies runtime, hooks, or adapters.

### Phase 1 — Foundation: Commit, Rebrand, Close Partials
**Complexity: XL · Prerequisite for everything**

Before any new capability work, the foundation must be solid. This phase ships zero new features.

**Deliverables:**

| # | Deliverable | Files created / modified | W resolved | Complexity |
|---|---|---|---|---|
| 1.1 | Land intent-classifier + route-resolver | Commit `runtime/intent-classifier.js`, `runtime/route-resolver.js`; add fixtures; update `ARCHITECTURE.md`, `MODULES.md`; close CHANGELOG entry | — | S |
| 1.2 | Gitignore ephemeral files | `.gitignore` — add: `ann*.json`, `jobs*.json`, `artifacts/bench/`, `ubuntu_log.txt`, `.claude/scheduled_tasks.lock`, `.claude/worktrees/` | — | S |
| 1.3 | Write `references/v2-rewrite-plan-rev3.md` | New file consolidating W1–W14 intent, actual status, and resolution path | W14 partial | M |
| 1.4 | Complete W2 — real session boundary | Verify `session-context.js` `startSession()` is called in ALL hook paths (not just claude adapter); add session-boundary fixtures | W2 | S |
| 1.5 | Complete W4 — kill-switch coverage | Extend `ARG_KILL_SWITCH` check to all 13 hooks (currently in dangerous-command-gate + a subset); add kill-switch fixture per-hook | W4 | M |
| 1.6 | Complete W8 — state-paths adoption | Audit all hooks + scripts for hardcoded `~/.openclaw/…` paths; replace all with `state-paths.js` exports; verify no hardcoded paths remain | W8 | M |
| 1.7 | Resolve W11 — high-risk-non-destructive pre-approval | Design: add `perToolAllow` (already in contract v2 schema) to the pretool-gate check; add fixtures for pre-approved high-risk-non-destructive patterns | W11 | M |
| 1.8 | Close W14 — docs/reality drift | Update `ARCHITECTURE.md` (add 3 missing runtime files), `MODULES.md` (add new runtime modules), `DECISIONS.md` (D5 is stale — hooks do enforce), root docs skill/agent counts | W14 | M |
| 1.9 | Rebrand: write `scripts/rebrand.sh` | New script; test on codebase with `--dry-run`; confirm fixtures still pass | — | M |
| 1.10 | Execute rebrand: `HORUS_*` → `ARG_*`, file renames | All ~80 HORUS_* files, 2 schema files, CLI script, config filenames, docs | — | L |
| 1.11 | Verify all fixtures pass post-rebrand | Run full fixture suite; fix any broken references | — | S |
| 1.12 | Commit and tag v3.0.0 | Clean commit of all Phase 1 work | — | S |

**Verification criteria:**
- `scripts/run-fixtures.sh` passes all 180+ fixtures
- `scripts/check-cross-harness-equivalence.sh` passes for claude/openclaw/opencode
- `grep -r "HORUS_" . --include="*.js" --include="*.sh"` returns zero hits (except inside rebrand.sh itself and historical CHANGELOG entries)
- `references/v2-rewrite-plan-rev3.md` exists and lists each W with status + resolution path
- `git status` shows clean working tree

**W-status after Phase 1:** All 14 weaknesses resolved or formally documented.

---

### Phase 2 — Host Compatibility Layer
**Complexity: L · Depends on Phase 1**

Promotes ClawCode, Antegravity, and Codex from stubs to production adapters. Establishes the cross-harness testing foundation for all future phases.

**Deliverables:**
- Define host capability API spec: what each host must expose for our adapter to work (hook event types, stdin format, exit code semantics)
- Build `clawcode/hooks/adapter.js` → production (model after openclaw adapter)
- Build `antegravity/hooks/adapter.js` → production
- Build `codex/hooks/adapter.js` → production
- Per-host: `WIRING_PLAN.md`, `COMPATIBILITY_STRATEGY.md`, `APPLY_CHECKLIST.md`
- Extend `scripts/check-cross-harness-equivalence.sh` to all 6 hosts
- Write Host Compatibility Matrix (Section 8 of this document)

**Verification:** Equivalence test passes for all 6 hosts on the same input set.

---

### Phase 2.5 — Soft Launch + Feedback Checkpoint
**Complexity: S · Depends on Phase 2**

Ship Phase 1+2 to early users (OpenClaw first, per project context). This is not a code phase — it's a learning phase.

- Release v3.0.0 externally
- Gather: which features users actually use, what breaks in real projects, what's missing
- **Re-prioritize Phases 3–9** based on feedback. Phases below may be reordered, merged, or replaced.
- User feedback signal overrides any assumption in Phases 3–9.

---

### Phase 3 — Security Contract v3 + Three-Mode UX
**Complexity: M · Depends on Phase 1**

The contract is already built (`runtime/contract.js`, 496 LOC, schema v2). This phase evolves it.

**Deliverables:**
- Contract v3 schema: add `mode` field (guided/autonomous/hybrid), `learningTier1` settings
- Update `runtime/contract.js` to load and enforce mode
- Update decision-engine to respect mode (guided: always review; autonomous: enforce-only; hybrid: silent for in-contract, review for out-of-contract)
- Update `horus-cli.sh contract init/amend` UX to present mode choice
- Mode persistence: stored in `horus.contract.json` (per-project)
- Section 20 (Security Contract UX) fully implemented

---

### Phase 4 — Memory + Task Handoff
**Complexity: XL · Depends on Phase 3**

The genuine second brain. Zero currently exists; this is greenfield.

**Deliverables:**
- `runtime/memory-store.js` — SQLite+FTS5 local store (optional dep; graceful degradation to flat-file)
- `runtime/task-handoff.js` — structured WIP state
- Updated `claude/hooks/session-start.js` — load handoff + relevant memory context
- Updated `claude/hooks/session-end.js` — write structured handoff + pattern updates
- Cross-harness: memory dir uses `state-paths.js`; same store accessed from any host
- Obsidian bridge: `scripts/memory-to-obsidian.sh` (optional export)
- Decision cache: cache contract decisions for repeated commands (avoids re-evaluation)

---

### Phase 5 — Smart Capability Selector
**Complexity: L · Depends on Phase 4 (memory informs usage patterns)**

**Deliverables:**
- `runtime/capability-selector.js` — profile-based activation + project-stack detection
- Profile templates: developer / architect / devops / security
- Stack detection: reuse `runtime/context-discovery.js` stack markers
- Progressive unlocking: capability suggestions at session-start based on session history
- Searchable catalog: `scripts/horus-search.sh <query>` across all agents/skills/rules
- Integration: `horus-cli.sh select` (interactive onboarding wizard)

---

### Phase 6 — Self-Evolution Engine (Two-Tier)
**Complexity: XL · Depends on Phase 4 (memory data) + Phase 5 (capability catalog)**

**Deliverables:**
- `runtime/evolution-observer.js` — Tier-1 silent learning
- `runtime/evolution-proposer.js` — Tier-2 proposal generation
- `scripts/evolution-review.sh` — CLI proposal review/approval flow
- Upstream registry: `~/.horus/upstream-registry.json` — repos to monitor
- `scripts/check-upstream.sh` — diff monitoring + relevance scoring
- Guards: evolution cannot modify `runtime/` files or lower security floors

---

### Phase 7 — Library Expansion
**Complexity: M · Depends on Phase 5 (selector knows what's missing)**

Fill verified gaps from Research Findings (Section 3F onwards):
- UI/UX: `agents/ui-ux-architect.md`, `agents/design-system-auditor.md`, `skills/ui-ux-review.md`
- Business: `agents/product-manager.md`, `agents/business-analyst.md`, `agents/gtm-strategist.md`
- Infrastructure: `agents/kubernetes-reviewer.md`, `agents/terraform-reviewer.md`, `agents/aws-architect.md`
- Frontend depth: `agents/frontend-architect.md`, `agents/react-reviewer.md`, `agents/css-reviewer.md`
- Methodology skills: `skills/tdd-cycle.md`, `skills/debug-systematic.md`, `skills/write-plan.md`, `skills/execute-plan.md`
- Code intel: `scripts/code-intel-check.sh` (ast-grep wrapper)

Target: 49 → 80 agents; 22 → 60 skills; 80 rules → 100 rules.

---

### Phase 8 — Extension API + Pack Registry
**Complexity: L · Depends on Phase 7**

Enable external teams to build and share capability packs.

**Deliverables:**
- Pack format spec (JSON schema for a pack: agents + skills + rules + hooks + metadata)
- `scripts/horus-pack-install.sh` — install a pack from a local dir or git URL
- `scripts/horus-pack-validate.sh` — schema + security validation before install
- Local registry: `~/.horus/pack-registry.json`
- Security sandbox: packs cannot modify `runtime/` or security contracts

---

### Phase 9 — Observability
**Complexity: M · Depends on Phase 4 (memory data sources)**

**Deliverables:**
- `scripts/horus-history.sh` — decision history viewer (searchable by date/risk/action)
- `scripts/horus-memory-browser.sh` — memory state viewer
- `scripts/horus-capability-usage.sh` — capability heatmap (which agents/skills actually used)
- `scripts/horus-posture.sh` — security posture summary (contract status, risk trends)
- All outputs: CLI-first; optional Obsidian export; no mandatory web server

---

## 7. Component Inventory

> **[TO BE EXPANDED IN PASS 2]**

| Component type | Current (verified) | Target (Phase 9) | Notes |
|---|---|---|---|
| Runtime JS files | 23 / 3,454 LOC | ~32 | New: memory-store, task-handoff, capability-selector, evolution-observer, evolution-proposer |
| Hook files (claude/) | 13 / 1,316 LOC | 14–15 | Session continuity hooks |
| Host adapter shims | 5 (16-24 LOC each) | 6 | Codex shim → production |
| Agents | 49 | ~80 | Phase 7 gap fill |
| Rules | 80 | ~100 | Language coverage + methodology |
| Skills | 22 | ~60 | Major expansion |
| Modules | 55 | ~65 | Extension pack modules |
| Scripts | 63 | ~80 | New: rebrand, evolution, observability, pack tools |
| Fixtures | 180+ | 250+ | Cross-harness + memory + evolution tests |

Detailed per-type justification: **[TO BE EXPANDED IN PASS 2]**

---

## 8. Host Compatibility Matrix

> **[TO BE EXPANDED IN PASS 2]** — written after Phase 2 delivers the host capability API spec.

Skeleton:

| Feature | Claude Code | OpenClaw | OpenCode | ClawCode | Antegravity | Codex |
|---|---|---|---|---|---|---|
| PreToolUse hook | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| SessionStart hook | ✅ | ✅ | ✅ | ? | ? | ? |
| Secret scanning | ✅ | ✅ | ✅ | ? | ? | ? |
| Security contract | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Memory layer (Phase 4) | planned | planned | planned | planned | planned | planned |

Full matrix with capability-level detail: **[TO BE EXPANDED IN PASS 2]**

---

## 9. Upstream Source Registry Design

> **[TO BE EXPANDED IN PASS 2]**

Brief: local JSON database (`~/.horus/upstream-registry.json`) of repos to monitor for new capabilities, stored outside the project repo. Includes: source URL, category, last-checked date, last-seen-commit, adoption history (what we took, skipped, and why). Checked via `scripts/check-upstream.sh` on demand or via Phase 6 evolution engine.

---

## 10. Self-Evolution Rules

> **[TO BE EXPANDED IN PASS 2]** — detailed design after Phase 6 planning.

Brief (locked decisions):

**Tier-1 (auto-learn, no approval):**
- Project stack, user coding patterns, command frequency, error patterns, capability usage, session outcomes
- Observation only — no behavior changes

**Tier-2 (assisted-act, requires approval):**
- New agents, skills, rules, hooks
- Improvements to existing components
- Upstream adoption proposals
- Always: declared intent + evaluation criterion + reasoning chain

**Hard limits (both tiers):**
- Cannot lower security floors
- Cannot modify `runtime/` files
- Cannot modify `horus.contract.json` without user approval
- All proposals are reversible

---

## 11. Smart Selector Design

> **[TO BE EXPANDED IN PASS 2]** — detailed design after Phase 5 planning.

Brief:
- Profile-based activation (developer/architect/devops/security roles)
- Project stack detection via `context-discovery.js` (already detects node/python/golang/rust/java/kotlin)
- Progressive unlocking: start minimal, suggest capabilities as user hits use cases
- Searchable catalog via `horus-search.sh`
- Dependency-aware: skills that require other skills declare dependencies
- Host-aware: only show capabilities the current host supports

---

## 12. Extension API Design

> **[TO BE EXPANDED IN PASS 2]** — detailed design after Phase 8 planning.

Brief: Pack format is a directory with a `pack.json` manifest (name, version, components: agents/skills/rules/hooks, dependencies, security-policy: what the pack can and cannot do). Install via `horus-pack-install.sh`. Validate via schema + security allowlist before any execution. Packs cannot modify core runtime.

---

## 13. Observability Design

> **[TO BE EXPANDED IN PASS 2]** — detailed design after Phase 9 planning.

Brief: Five CLI surfaces (decision history, memory browser, capability heatmap, security posture, session timeline). Delivery mechanism adapts to host: Claude Code gets CLI output; Obsidian integration optional for all hosts; no mandatory web server. All data stays local.

---

## 14. Language Policy

### What stays English ONLY (AI reads these as instructions — mixing languages causes misapplication)
- All files in `rules/`, `agents/`, `skills/`, `templates/`
- All `runtime/*.js` (source + comments)
- All `claude/hooks/*.js` + adapter files
- All `scripts/*.sh`
- All `modules/*.json` + module markdown files
- All `schemas/*.json`
- All fixture + test files
- Config keys, env var names, CLI command names, code comments, variable names

### What gets translated (human-facing content only)
- Root documentation: `README.md`, quickstart guides, per-host setup guides, security whitepaper, migration guide
- CLI output messages shown to the user — via `i18n/{en,ar}.json` message files (NOT inline in hooks/scripts)
- Installation wizard user-facing text
- Error messages shown to the user

### Translation languages
- **English** — primary, always complete
- **Arabic** — secondary, home language, RTL support required for any dashboard/UI surface
- Additional languages: only when real user demand exists — not preemptively

### i18n Implementation
- Message files: `i18n/en.json`, `i18n/ar.json`
- Never inline translations inside component files
- CLI loads the right message file based on `LANG` / `ARG_LOCALE` env var
- English is always the fallback

---

## 15. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Host breaking changes** — a host harness updates its hook event format, stdin schema, or exit code semantics without notice, breaking our adapter | Medium | High | Adapter shims are intentionally thin (15-25 LOC); the parity-matrix test catches divergence immediately. Phase 2 adds per-host CI. |
| **Missing v2 rewrite plan** — the referenced `references/v2-rewrite-plan-rev2.md` does not exist; W1–W14 canonical source is now the prompt only | High (already happened) | Medium | Phase 1 deliverable 1.3 writes `references/v2-rewrite-plan-rev3.md` as the new authoritative source. W-status is grounded in code (most Ws are already fixed). |
| **Brand collision** — "Sentry Forge" collides with sentry.io; chosen brand may have trademark conflicts | Medium | High | Trademark check is a Phase 3/Pass 3 deliverable. ARG (Agent Runtime Guard) is the safer interim brand — descriptive, not trademarked in this space. |
| **Zero-dep constraint vs. capability depth** — memory layer (SQLite), code intelligence (ast-grep), Obsidian bridge all need optional deps; graceful degradation adds complexity | Medium | Medium | State-paths.js pattern: every optional dep has a zero-dep fallback. SQLite → flat-file markdown. ast-grep → grep. Obsidian → plain markdown export. |
| **Skill count off by 10x** — actual skills are 22 not 200; the gap creates a misleading capability impression | High (already happened) | Medium | Phase 1.8 updates all count references in docs. Target counts in Phase 7 are realistic: 22 → 60. |
| **Self-evolution security** — Tier-2 evolution proposes code changes; a malicious or poorly-evaluated proposal could degrade security | Low | Very high | Hard limit: evolution cannot touch `runtime/`, security floors, or contracts. All proposals require explicit user approval via CLI. Provenance trail on every generated component. |
| **Multi-host drift** — adapters diverge as hosts evolve independently, breaking cross-harness equivalence | Medium | High | `check-cross-harness-equivalence.sh` runs in CI. Phase 2 adds all-host coverage. |

---

## 16. Non-Goals

This plan explicitly does NOT include:

- **Building our own LLM runtime or inference.** We use the host harness's LLM capability. Always.
- **Building our own chat interface or IDE.** We are an add-on; the host provides the interface.
- **Building our own code execution sandbox.** Host execution environments handle this.
- **Replacing any supported host harness.** Enhancement only; the host engine runs independently of us.
- **Mandatory cloud dependencies.** All data stays local. No required API keys beyond the host's own LLM setup.
- **Autonomous self-modification without approval.** Tier-2 evolution always requires explicit user action. The system proposes; the user decides.
- **Lowering security floors.** Hard floors in `decision-engine.js` are permanent. No contract, no evolution proposal, no user setting can override them.
- **Time estimates.** All phases are executed by AI agents; complexity and dependencies are the relevant scheduling dimensions.
- **Forking host harness code.** We use extension points only; we never patch host source.
- **Supporting more than 2 i18n languages preemptively.** English + Arabic. More only if real user demand exists.

---

## 17. Decision Log

> Full consolidation in Pass 3. Core decisions logged here.

| # | Decision | Reasoning | Alternative rejected |
|---|---|---|---|
| D-M1 | **Memory: design from scratch** (SQLite+FTS5, no Chroma, no Python) | claude-mem requires Chroma (violates zero-dep core). mem0 requires Python. Our scaffolding is genuinely empty — no migration needed. | Adopt claude-mem directly |
| D-M2 | **Methodology: keep ours + cherry-pick superpowers skills** | Our rule library (80 rules, 16 languages) is deeper than either external source. superpowers' skill-level process discipline (TDD, debug, plan) fills a genuine gap in our 22-skill library. | Replace our rules with superpowers |
| D-M3 | **UI/UX: adopt ui-ux-pro-max selectively (bridge, don't copy)** | 161 industry rules + 67 styles is real value; rewriting it would be maintenance waste. The bridge pattern (ARG orchestrator skill → installed ui-ux-pro-max) is lower complexity and higher value. | Rewrite from scratch |
| D-M4 | **Code intel: ast-grep now, code-review-graph later** | ast-grep is zero-Python, CLI-first, 23-language support. code-review-graph's MCP approach is valuable but introduces Python + PyPI + variable performance. Defer to Phase 8 as an optional pack. | Adopt code-review-graph now |
| D-M5 | **Self-evolution: design from scratch using DSPy insights** | DSPy is inference-time optimization (Python); our problem is file-system evolution (Node.js). We adopt DSPy's signature/optimizer structural insight but not its implementation. | Adopt DSPy directly |
| D-B1 | **Brand: Horus Agentic Power (HAP), HORUS_ prefix** | Horus = Egyptian god of protection/kingship; "Agentic Power" conveys full-stack platform (agents + skills + workflows + security), not just a guard. Egyptian mythology angle is distinctive in AI tooling. HORUS_ prefix chosen for readability over abbreviation. | ARG (too restrictive), Sentry Forge (trademark risk), Tessera (unfamiliar), Thoth Code Engine, Ptah Agent Forge, Anubis Code Sentinel — all evaluated |
| D-P1 | **Phase 1 must land intent-classifier + route-resolver** | CHANGELOG documents these as a Phase-3 autonomous routing milestone. Reverting loses work. Adding fixtures + docs is cleaner than reverting. | Revert and re-plan |
| D-A1 | **Host supremacy rule is explicit architecture** | Critical for trust: users must know ARG can only tighten, never loosen, host safety. Prevents misuse as a host-override mechanism. | Implicit / undocumented |

---

## 18. Competitive Analysis

> **[TO BE EXPANDED IN PASS 3]**

Brief: The AI coding-agent add-on space is nascent. Known entrants:
- **Cursor Rules / .cursorrules** — rule-based only; no runtime decision engine; no security contracts
- **GitHub Copilot custom instructions** — lightweight; no enforcement
- **Cody (Sourcegraph)** — code search focus; no runtime security layer
- **Superpowers / GSD** — methodology-focused; no security runtime

ARG's unique value: the **only** add-on with a real runtime decision engine, cross-harness security contracts, and a two-tier learning system. Full analysis in Pass 3.

---

## 19. Execution Flow Design

### The Three Modes

Users choose once per project how they want ARG to operate. Choice persists in `horus.contract.json` (v3 schema `mode` field).

```
┌─────────────────────────────────────────────────────────────────┐
│  GUIDED MODE                                                     │
│  ARG analyzes → proposes a plan → user reviews → user approves  │
│  → ARG executes                                                  │
│                                                                  │
│  Every operation: ARG stops to explain what it will do and why  │
│  before doing it. Best for: new users, risky operations,        │
│  unfamiliar projects.                                            │
│                                                                  │
│  Decision engine behavior: ALL out-of-contract operations pause  │
│  for review. Even in-contract operations are surfaced as         │
│  "about to do X — is this correct?" for the first N occurrences │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  AUTONOMOUS MODE                                                  │
│  ARG analyzes → executes within the pre-agreed contract          │
│  → reports results                                               │
│                                                                  │
│  No interruptions during work. Operations within the contract    │
│  proceed silently. Operations outside the contract are BLOCKED   │
│  with a clear explanation (not a question — user already         │
│  decided). Best for: experienced users on established projects.  │
│                                                                  │
│  Decision engine behavior: contract-allow → proceed;            │
│  contract-deny → block with reason; out-of-contract → block;    │
│  hard floors → always block.                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  HYBRID MODE (recommended default)                               │
│  ARG executes routine/safe operations automatically.             │
│  Pauses only for operations that exceed the security contract.   │
│                                                                  │
│  "Agree once, execute freely, except where the contract says no" │
│  Best for: most users, most projects.                            │
│                                                                  │
│  Decision engine behavior: in-contract → proceed silently;      │
│  out-of-contract but safe → surface as informational;           │
│  out-of-contract and risky → pause for review.                  │
└─────────────────────────────────────────────────────────────────┘
```

### How Mode Affects Each System Component

| Component | Guided | Autonomous | Hybrid |
|---|---|---|---|
| **Decision engine** | All actions reviewed | Block-or-proceed silently | In-contract silent; out-of-contract blocks |
| **Security contract** | Present every scope before use | Enforce silently | Enforce silently; surface exceptions only |
| **Policy store** | Never auto-promote; show all candidates | Auto-promote at threshold | Auto-promote; inform user |
| **Session context** | Show risk level at each step | Log only | Log; surface trajectory nudge |
| **Memory** | Show context loaded at session start | Load silently | Load silently; show summary |
| **Capability selector** | Explain each activated capability | Silent | Silent on familiar; explain on new |
| **Self-evolution (Tier-2)** | Show all proposals immediately | Queue proposals; show at session end | Show proposals at session end |
| **Install wizard** | Step-by-step with explanations | One-command fast path | Guided for contract setup; autonomous after |

### Mode Switching
- User can switch mode at any time via `horus-cli.sh mode set guided|autonomous|hybrid`
- Mode change is written to `horus.contract.json` + logged to decision journal
- Mode is per-project (different projects can have different modes)

### Two-Tier Learning Integration

```
USER ACTION
    │
    ├─ OUTCOME: success → Tier-1 records (silent, always)
    │
    └─ OUTCOME: failure / user correction
           │
           ├─ Tier-1: record what went wrong, context, fix (silent)
           │
           └─ Tier-2 trigger: if pattern repeats N times
                      │
                      └─ Tier-2 proposes change to agent/skill/rule
                                 │
                                 └─ USER APPROVES or DISMISSES
```

---

## 20. Security Contract UX

### The Core Insight
The current system asks "is this OK?" on every risky action. This is wrong. Users should define what "OK" means **once**, and the system enforces it without asking again.

### The One-Time Agree Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: SCAN (automatic, first run)                            │
│  ARG scans: project stack, git config, file patterns,           │
│  existing scripts, dependencies, branch structure               │
│  → outputs: threat-surface assessment                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: ANALYZE (automatic)                                    │
│  ARG builds a proposed contract based on the scan:              │
│  "Your project uses Node.js, has protected branches main/dev,   │
│  deploys to AWS. I propose to: allow npm install, block         │
│  production deployments without review, require review for      │
│  force-push to any branch."                                     │
│  → outputs: horus.contract.json.draft                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: PRESENT (one user interaction)                         │
│  horus-cli.sh contract init                                       │
│  → Shows proposed contract in human-readable format             │
│  → Explains each scope decision with reasoning                  │
│  → User adjusts (optional): horus-cli.sh contract amend          │
│  → User approves: horus-cli.sh contract accept                    │
│  → ONE-TIME interaction: this is the ONLY time the user         │
│    deals with security configuration                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: ENFORCE (silent, ongoing)                              │
│  From this point: no more security questions during work.       │
│  Operations within the contract: proceed.                       │
│  Operations outside the contract: blocked with clear            │
│  explanation (not a question — the user already decided).       │
│  The explanation says: "This is blocked because your contract   │
│  disallows force-push to protected branches. You agreed this    │
│  on [date]. To change this: horus-cli.sh contract amend."         │
└────────────────────────────────────────────────────────────────┘
```

### Current Implementation vs. Target

The contract flow is **already built** in `runtime/contract.js` (496 LOC) and `schemas/horus.contract.schema.json` (v2). The CLI commands `init/accept/verify/show/amend` exist in `scripts/horus-cli.sh` (after rebrand). What Phase 3 adds:

| Currently exists | Phase 3 adds |
|---|---|
| Contract init/accept/amend CLI | Three-mode UX (guided/autonomous/hybrid) in contract |
| Hash verification (tamper detection) | Tier-1/2 learning model configuration in contract |
| Scope domains: filesystem, network, secrets, elevation, branches, shell, payloadClasses | Contract-scan integration (auto-propose from project analysis) |
| Per-tool allow (v2 schema) | Mode-aware enforcement in decision engine |
| Revision history | Amendment UX that explains WHAT changed and WHY |

### Amendment Flow (rare, not per-session)

Amendments are triggered by:
- Significant project change: new deployment target, new team member with different access needs, new dependency class
- NOT triggered by: routine operations, capability additions, preference changes

```
horus-cli.sh contract amend
  → ARG explains: "You've added a production deployment pipeline.
    Proposing to add a deployment scope. Here's what would change:
    [diff of old vs new contract]"
  → User approves or rejects the amendment
  → Amendment: revision number increments, hash recomputed, old revision archived
```

### Contract Schema (v2 → v3 evolution)

**v2 scopes (existing):** filesystem · network · secrets · elevation · branches · shell · payloadClasses · harnessScope · trustPosture

**v3 additions (Phase 3):** `mode` (guided/autonomous/hybrid) · `learningConfig.tier1.enabled` (bool) · `learningConfig.tier2.approvalRequired` (always true) · `projectContext.detectedStack` (auto-filled by scan) · `projectContext.firstAccepted` (timestamp)

---

## Appendix A: Verified Inventory Snapshot (Pass 1)

Taken from codebase on 2026-04-26. Use these numbers in all documents — the prompt's claims are outdated.

| Metric | Prompt claim | Verified reality |
|---|---|---|
| Version | 1.6.0 | **2.1.1** |
| Runtime JS files | 12 | **23** (+ 2 untracked) |
| Runtime LOC | 1,289 | **3,454** |
| External deps in runtime | zero | **zero** ✅ |
| Hook files (claude/) | 12 | **13** |
| Hook LOC (claude/) | 1,312 | **1,316** |
| Host adapter shims | — | **5** (16–24 LOC each) |
| Agents | 50 | **49** |
| Rules | 92 | **80** |
| Skills | 200 | **22** |
| Modules | 55 | **55** ✅ |
| Scripts | 44 | **63** |
| Fixtures passing | — | **180** |
| Uncommitted modified files | 107 | **5** |
| Uncommitted untracked entries | 11 | **11** ✅ |
| W1–W14 fixed | "2 fixed" | **~9 fixed, 3 partial, 2 unclear** |

---

*Pass 2 fills Sections 7–13 with full designs. Pass 3 fills Section 18, consolidates Section 17, and completes trademark/competitive analysis.*
