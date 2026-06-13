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

Gate-class hooks (dangerous-command-gate, secret-warning, git-push-reminder) print reminders and echo stdin unchanged by default (`LILARA_ENFORCE=0`). When `LILARA_ENFORCE=1`, these hooks exit 2 to block the tool call. Informational hooks (session-start, session-end, quality-gate, strategic-compact, output-sanitizer) always exit 0 regardless of enforce mode. The two-mode design preserves a safe non-disruptive default while enabling active enforcement when the operator opts in via their harness config.

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

Local learned policy is useful, but final runtime behavior should also honor per-project configuration. Trust posture, protected branch names, and sensitive path patterns belong in `lilara.config.json` so different repositories can operate under different safety assumptions without forking the runtime.

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

## D23: Trademark Check For "Lilara" Is Required Before Public Launch

**Status: OPEN — manual action required by Khouly.**

Before any public announcement, press release, or marketplace listing under the brand "Lilara" / "Lilara" / "lilara-cli" / "horusagentic", a trademark clearance search must be conducted. This is a pre-launch blocker, not a post-launch best-effort item.

**Scope of check:**
- USPTO TESS for "Horus", "Horus Agentic", "Lilara" in classes 42 (software services) and 9 (software products)
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

**Status: CLOSED — fixed in ARCHITECTURE.md (commit 1, feat/wave2-cleanup).**

Table row updated from `score === 10` to `score >= 8`, matching `runtime/risk-score.js:182`.

**Owner:** Khouly (or any Wave-2 doc cleanup pass)
**Blocker for:** nothing.

## D26: F4/F6/F7 — Documented as Floors in ARCHITECTURE.md, Not Implemented in Code

**Status: CLOSED — implemented in `feat/wave2-cleanup` (Wave-2 pass).**

All three floors are now engine-baked in `runtime/decision-engine.js`. Locked semantics:

- **F4 (secret-class-C payload):** Fires when `enriched.payloadClass === "C"` OR `scanSecrets(input.command)` returns a match. Floor = block. Cannot be demoted by contract-allow. The schema only enumerates payloadClasses {A, B, C} — there is no class-D.
- **F6 (posture-strict-no-cover):** Fires when `enriched.trustPosture === "strict"` AND `isGated === true` AND `contractAllow === false`. Floor = block. Does NOT fire in balanced or relaxed posture. Locked trigger: strict + gated class + scopeMatch returned false + no operator bypass.
- **F7 (intent-unknown-strict):** Fires when `intentResult.intent === "unknown"` AND `enriched.trustPosture === "strict"`. Floor = block. Does NOT fire in balanced or relaxed posture. Uses `intent-classifier.js`'s "unknown" intent — narrowest blast radius.

Placement: F4 after risk-level block (rung 3.5 in execution, rung 4 in table); F6 and F7 after F9/session-risk and before Step 11 contract-allow (execution). All three are before contract-allow, ensuring they cannot be demoted.

Sample-journal replay: 0 divergences — all 12 entries are payloadClass=A, balanced posture, recognized intents.

**Blocker for:** nothing resolved — architectural completeness.

## D33: A2 Taint Correlator — Token-Overlap Algorithm

**Status: CLOSED — implemented in `feat/a2-taint-claude` (PR #12).**

`runtime/provenance-correlator.js:correlate()` checks whether shell command tokens appear verbatim in the provenance window (recent external reads). Exact-match first, then per-token. Token filter: `length >= minTokenLength && not a flag (-x / --foo)`.

**Minimum token length:** configurable via `lilara.config.json` key `taint.minTokenLength` (integer, range 4–32, default 6). Read by `project-policy.js:loadProjectPolicy()` and passed into `correlate()` via `taint.js:correlateCommandPure()` (ADR-046: the taint policy is threaded from decide()'s already-loaded `projectPolicy`, not re-loaded inside the taint path). Operators in high-FP token-overlap environments (e.g., reading package docs then installing that package) can raise this threshold without code changes.

**Recommended path:** set `"taint": { "minTokenLength": 10 }` in `lilara.config.json` to reduce false-positives in doc-heavy workflows.

**Known gap (D37):** tool-class gate not yet implemented — F10 fires on any tool, not just Bash/Edit/Write/WebFetch. Tracked as D37.

---

## D37: F10 Tool-Class Filter Missing

**Status: CLOSED — implemented in commit 3, feat/wave2-cleanup.**

`runtime/taint.js:correlateCommandPure()` accepts a `toolName` parameter. If the tool is in `taintSafeToolClasses` (default: `["Read","Grep","Glob","LS","NotebookRead"]`), it returns `{ tainted: false }` immediately. The safe-class list is configurable per-project via `taint.safeToolClasses` in `lilara.config.json`. `decision-engine.js` passes `input.tool` as the third argument. Fixtures: `taint:d37-grep-safe-class-no-f10` and `taint:d37-bash-write-class-f10-fires`. (ADR-046 renamed the disk-reading `correlateCommand` to the pure `correlateCommandPure`; the provenance window is injected via `input.provenanceWindow`.)

---

## D38: Post-Adapter Factory Refactor — DRY Violation Across 5 Adapters

**Status: CLOSED — implemented in commit 4, feat/wave2-cleanup.**

`runtime/post-adapter-factory.js` exports `createPostAdapter({ harnessName, rateLimitKey })`. All 6 adapters (including claude's `output-sanitizer.js`) are now ~5-line wrappers. Byte-identical output verified across all 6 harnesses for the same input. `check-post-adapter-parity.sh` gained a 5th assertion (must use `createPostAdapter`).

---

## D39: EXTERNAL_TOOLS Canonicalization — Codex "fetch" Divergence

**Status: CLOSED — resolved in D38 factory (commit 4, feat/wave2-cleanup).**

Canonical `EXTERNAL_TOOLS` in `runtime/post-adapter-factory.js` is the union of all 6 adapters' pre-refactor sets: `["WebFetch","web_fetch","fetch","mcp","curl","wget","browser_action","Browser"]`. Claude and OpenCode (which lacked `"fetch"`) now benefit from the superset. "WebSearch" and "Fetch" (capital-F) are included as forward-compat entries with inline comments.

---

## D40: Post-Adapter Behavioral Parity Fixtures

**Status: CLOSED — behavioral parity enforced via createPostAdapter factory (D38) + extended parity check.**

The factory refactor in D38 (commit 4 of feat/wave2-cleanup) provides stronger behavioral parity than per-harness fixtures: all 6 adapters share a single handler implementation in `runtime/post-adapter-factory.js`. Any behavioral bug or omission in the factory is a single fix that applies to all harnesses simultaneously. Per-harness behavioral fixtures would test the same code path six times; adding them would provide marginal additional coverage.

`check-post-adapter-parity.sh` now also asserts that every adapter calls `createPostAdapter` (5th check), catching future drift.

Behavioral byte-identity verified during D38 refactor: identical synthetic input produces identical stdout/stderr across all 6 adapters.

**Blocker for:** nothing resolved.

---

## D41: Atomic Write on Rate-Limit State File

**Status: CLOSED — implemented in commit 6, feat/wave2-cleanup.**

`rateLimitCheck()` both write sites now use tmp+rename: `fs.writeFileSync(stateFile + ".tmp", ...); fs.renameSync(...)`. The O_EXCL lock serializes callers; the rename ensures a process killed mid-write leaves the original file intact.

---

## D42: Document the 2000ms Stale-Lock Threshold

**Status: CLOSED — comment added in commit 6, feat/wave2-cleanup.**

Inline comment at the 2000ms check now reads: "2000 ms = worst-case PostToolUse handler runtime on Windows-fs."

---

## D43: consumeOperatorToken Fallback Defeats Atomicity

**Status: CLOSED — implemented in commit 2, feat/wave2-cleanup.**

`catch { writeFileSync }` fallback removed. On rename failure, `consumeOperatorToken()` returns `false`. Accept() throws on false — gate stays fail-closed.

---

## D44: Concurrent consumeOperatorToken Race

**Status: CLOSED — implemented in commit 2, feat/wave2-cleanup.**

O_EXCL lockfile wraps the full read-modify-write cycle of `consumeOperatorToken()`. Contention on a fresh lock returns `false` (second consumer denied). Stale lock (> 2000 ms) is stolen. Fixtures: `operator-token:d44-ocxl-contention`.

---

## D45: operator-token list and revoke Subcommands Missing

**Status: CLOSED — implemented in commit 2, feat/wave2-cleanup.**

`lilara-cli.sh operator-token list` prints id-prefix + label + status, never the full secret. `operator-token revoke <id>` atomically marks the token consumed (revokedAt field) via tmp+rename. Fixtures: `d45-list-shows-label-not-secret`, `d45-revoke-then-consume-false`.

---

## D27: secret-scan.js Encapsulation — getPatterns() vs redact(text)

**Status: CLOSED — implemented in commit 5, feat/wave2-cleanup.**

`runtime/secret-scan.js` now exports `redact(text)` and removes `getPatterns()` from exports. `decision-journal.js` imports `redact` directly. D29 per-pattern labels implemented in the same commit.

---

## D28: decision-journal.js Redaction Policy Comment

**Status: CLOSED — comment added in commit 5, feat/wave2-cleanup.**

Comment added above `const record = {`: "D28: redaction policy — only targetPath and notes pass through clean(). action, riskLevel, riskScore, reasonCodes, tool, branch, intent, scopeHit, floorFired, taintSource, taintReason are retained verbatim."

---

## D29: Journal Redaction Provenance Label — [REDACTED:class-C] vs [REDACTED:<name>]

**Status: CLOSED — implemented in commit 5, feat/wave2-cleanup.**

`redact()` in `secret-scan.js` slugifies each pattern name and produces `[REDACTED:<slug>]`, e.g. `[REDACTED:openai-api-key]`. jredact fixture updated to assert the new label format.

---

## D30: Fixture Pattern For One-Off Output-Inspection Tests

**Status: CLOSED (Wave-2 cleanup, 2026-05-08)**

**Resolution:** Option 3 — inline `node -e` in `scripts/run-fixtures.sh` is the standard pattern
for output-inspection tests (tests that validate runtime logic by exercising module APIs directly).
File-pair `.input` / `.expected_*` is the standard for stdin-driven hook fixture tests.

This distinction is already widespread across all Wave-1 and Wave-2 inline tests (D37, D38, D39,
D40, D41, D42, D43, D44, D45, D26 F4/F6/F7 floors, the E2E integration test). No code changes
needed — the pattern was already consistently applied before this decision was formally locked.

New tests added in Wave-2 that follow this pattern: 246 total inline inline-node assertions covering
decision-engine floors, operator-token CRUD, rate-limiter atomicity, taint tool-class filter, and
a full PreToolUse→PostToolUse→journal-write E2E cycle (see run-fixtures.sh: "E2E integration test
(D30)"). Adding new output-inspection tests: write them inline in run-fixtures.sh using the
`node - "$root" <<'NODEEOF' ... NODEEOF` heredoc pattern established throughout that file.

---

## D33: A2 Taint Correlator — Token Match Parameters

**Status: RESOLVED — implemented in `runtime/provenance-correlator.js` (Wave 1 A2, PR #12).**

**Date:** 2026-05-07

**Decision: `MIN_TOKEN_LENGTH=6`, flag-style args excluded from per-token matching, exact command match checked first.**

Three choices locked the taint correlator design:

1. **`MIN_TOKEN_LENGTH = 6`** — tokens shorter than 6 chars (e.g. `ls`, `cat`, `rm`) are ubiquitous in shell commands and are not diagnostic of injection. 6 chars catches meaningful tokens like filenames, URLs, and identifiers while excluding noise. Setting it lower (e.g. 3) produces too many false positives; higher (e.g. 10) misses short but significant tokens.

2. **Flag-style arg filter** (`/^-{1,2}[a-z]/i`) — command-line flags (`-f`, `--force`, `--rm`) also appear in external content and produce false positives. They are excluded from per-token matching; only non-flag tokens are tested.

3. **Exact command match first** — if the full command string (trimmed) appears verbatim inside any external read content, that is the strongest taint signal and is checked before the per-token loop. This catches injection where the payload includes the entire command.

**Alternatives considered:**
- Semantic similarity (embedding distance): rejected — requires LLM in the loop; too slow for a PreToolUse hook that must complete in <1 ms.
- Edit distance / fuzzy match: rejected — would require a dependency or >50 LOC; zero-dep invariant must be preserved.

**Owner:** Khouly

---

## D34: A2 Provenance Window — TTL, Cap, File Mode

**Status: RESOLVED — implemented in `runtime/session-context.js` (Wave 1 A2, PR #12).**

**Date:** 2026-05-07

**Decision: 5-minute TTL, max 20 entries, mode 0600, best-effort (never blocks).**

1. **5-minute TTL (`PROVENANCE_MAX_AGE_MS = 300_000`)** — the threat model is same-session injection: attacker-controlled content is fetched by a WebFetch or similar tool, then the agent is prompted to run a command using that content. 5 minutes covers most agentic loops without carrying stale data into unrelated sessions. The system clock comparison is per-read at the taint-check call site.

2. **20-entry cap** — prevents unbounded disk growth in long sessions with many external reads. Oldest entries are dropped when the cap is reached. 20 is large enough for a realistic agentic web-research session.

3. **Mode 0600** — provenance window is stored at `~/.lilara/provenance-window.json`. 0600 limits read access to the owner, consistent with all other Horus state files.

4. **Best-effort, never blocking** — the taint floor fires on `require-review` (not `block`). `correlateCommand` and `recordExternalRead` are wrapped in try/catch at every call site. A file I/O failure in the provenance window cannot break a PreToolUse hook call.

**Owner:** Khouly

---

## D35: A3 Post-Adapter Split — Why Claude Gets output-sanitizer.js, Others Get post-adapter.js

**Status: RESOLVED — implemented across all 6 harnesses (Wave 1 A3, PR #13).**

**Date:** 2026-05-07

**Decision: Claude harness extends the existing `claude/hooks/output-sanitizer.js`; OpenCode, OpenClaw, Codex, Clawcode, antegravity each get a new `<harness>/hooks/post-adapter.js`.**

Claude Code already had `output-sanitizer.js` (shipped in W8 — the initial PostToolUse implementation). The two choices were:

- **Option A: Replace output-sanitizer.js with a uniform post-adapter.js** — would require migrating existing Claude hook wiring, updating `hooks.json`, and regenerating the SHA-256 integrity baseline. Scope: large.
- **Option B: Extend output-sanitizer.js for Claude, add post-adapter.js for others** — Claude keeps its wiring intact; the new harnesses follow the same pattern as one another. Scope: minimal Claude change, uniform adapter files for new harnesses.

Option B was chosen. `output-sanitizer.js` gained the taint recording call (`recordExternalRead`) without changing its secret-scanning or hook-wiring contract. The other five harnesses received identical `post-adapter.js` files that do both secret scanning and taint recording from the start. This avoids a disruptive rename while achieving full functional parity.

**Owner:** Khouly

---

## D36: A4 Redaction Scope — Only targetPath and notes Fields Are Redacted

**Status: RESOLVED — implemented in `runtime/decision-journal.js:append()` (Wave 1 A4, PR #9, merged).**

**Date:** 2026-05-07

**Decision: `redactInJournal=true` applies redaction only to `targetPath` and `notes`; structural fields (action, riskLevel, riskScore, tool, branch, reasonCodes) are never redacted.**

Three considerations shaped this choice:

1. **Structural fields are not free-text and cannot carry secrets.** `action` is one of a small enum (allow, block, require-review, etc.); `riskLevel` is low/medium/high/critical; `riskScore` is a number; `tool` and `branch` are short identifiers controlled by the harness, not user content; `reasonCodes` are internal decision codes. None of these can embed a secret.

2. **`targetPath` and `notes` are free-text and can embed user-provided content.** `targetPath` is the path the agent is operating on — may include project-specific filenames or content. `notes` is the explanation field populated by the risk engine and can include command fragments. Both are the correct redaction targets.

3. **Redaction before the 256-char slice** — the slice is applied after redaction so a secret that begins within the 256-char window but spans its boundary is still caught. Order: `redactText(text).slice(0, 256)`.

**Why not redact all string fields?** Journal consumers (replay, analytics, dashboard) need structural fields to be stable and machine-readable. Redacting `tool` or `branch` would break JSONL replay assertions in `check-decision-replay.sh`.

**Owner:** Khouly

---

## D31: bench-runtime-decision.sh — Win32 Machine-Load Noise At p99

**Status: RESOLVED by documentation. No code change needed.**

On 2026-05-08, `bench-runtime-decision.sh` produced two consecutive p99 readings of ~102ms and ~104ms against the 85ms cap (1.5× of 56.831ms baseline), causing the gate to fail. The same failure occurred on clean master with no A-series changes applied. A systematic 5-run diagnostic the same night showed p99 values of 53.8, 54.8, 66.9, 55.3, 53.8ms on master — all within the 1.5× cap — confirming the earlier failures were transient Windows machine-load spikes (likely background indexing or antivirus scan).

**A5 bench (5 runs immediately after master):** 54.3, 53.9, 54.0, 53.5, 54.8ms — tightly clustered, zero regression vs master. The A5 change (`hook-utils.js`) does not touch `decision-engine.js:decide()` — the bench hot path — so A5 cannot regress the bench.

**Resolution:** The scoped-baseline approach (each run compares against the previous run's p99) already self-corrects for persistent load shifts. For isolated spikes, re-running the bench gate is sufficient. No baseline recapture or bench-tool change required.

**Recommended action:** if bench fails in CI on any single run, re-run once before treating it as a hard stop. A second consecutive failure is a real regression. Document this in `SECURITY_MODEL.md` or bench runner header as a known Win32 behaviour.
**Priority:** low — monitoring only.

**Wave 2 empirical validation (2026-05-08, 5 runs on master HEAD `dc9bb5d`):**

| Run | p50 | p95 | p99 |
|---|---|---|---|
| 1 | 39.312ms | 61.300ms | 68.919ms |
| 2 | 38.041ms | 59.830ms | 67.479ms |
| 3 | 36.959ms | 53.244ms | 60.116ms |
| 4 | 36.804ms | 53.091ms | 61.231ms |
| 5 | 36.585ms | 52.570ms | 60.161ms |

p99 spread: 60.116ms – 68.919ms (8.8ms range, 14.4% of median 61.231ms). Under 30% threshold → **accepted noise, no follow-up item**. Scoped-baseline self-correction is sufficient.

B3 branch bench (same session, `feat/b3-accept-gate-hardening`): p99=56.895ms — within cap (85.782ms). B3 does not touch `decision-engine.js:decide()` — not a hot-path regression.

---

## D32: contract.accept() — Invert Signal Model From Env-Var Allowlist To Positive Operator Token

**Status: RESOLVED — B3 implemented in `runtime/contract.js`, shipped in Wave 2 Track 1.**

**Date:** 2026-05-08

**Problem (Q2):** The old `accept()` guarded against non-interactive acceptance by checking that none of the known harness session env vars were present (e.g. `CLAUDE_CODE_ENTRYPOINT`, `OPENCODE_SESSION_ID`). This "defense by absence" has a structural flaw: any novel harness or automation context whose env var was not in the allowlist would bypass the gate silently. Adding new harnesses (A3) made the allowlist permanently incomplete.

**Decision:** Replace the env-var allowlist with a **positive operator signal**. Two paths are valid:
1. `stdin.isTTY` is true — caller is in an interactive terminal.
2. `LILARA_OPERATOR_TOKEN` is set to a valid unconsumed one-shot token from `~/.lilara/operator-tokens.jsonl`.

Any other caller (piped stdin, no token, or expired/consumed token) receives a hard error with remediation instructions.

**One-shot token semantics:** tokens are 32-byte random hex, stored as JSONL records `{token, label, createdAt, usedAt}`. `usedAt` is null until the first successful `accept()`. Second use is rejected. Tokens are minted via `lilara-cli.sh operator-token mint [label]`.

**Alternatives considered:**
- Keep and grow the allowlist — rejected; allowlist will always lag novel harnesses.
- Require a password/passphrase — rejected; adds friction without a meaningful security gain over TTY check.

**Impact:** breaking change for any automation that used `accept()` in a non-TTY context without `LILARA_OPERATOR_TOKEN`. Remediation: pre-mint a token and pass it. The `CHANGELOG.md` entry for B3 documents the migration path.

**Owner:** Khouly
**Blocker for:** nothing (no other item depends on the old allowlist).

---

## D46: MCP Server Name Extraction Regex (`mcp__<server>__<rest>`)

**Date:** 2026-05-08

**Context:** `scopes.mcp` (B2 Phase 2) maps server names to policies. The runtime needs to extract the server name from the tool name passed by the harness.

**Decision:** Use `^mcp__([^_]+(?:_[^_]+)*?)__` to extract the server name. If `input.mcpServer` is explicitly provided, that takes precedence. Absent `mcp__` prefix → F12 silently no-ops.

**Rationale:** The `mcp__<server>__<tool>` convention is stable across harnesses. The lazy quantifier prevents over-greedy matches when server names contain underscores (e.g. `mcp__my_server__tool` → server name `my_server`). The explicit `input.mcpServer` override is a clean escape hatch for harnesses that surface the server name separately.

**Owner:** Khouly
**Blocker for:** F12 mcp-deny floor.

---

## D47: `scopes.session.maxDurationMin` Escalates to `require-review` (Not Soft Annotation)

**Date:** 2026-05-08

**Context:** The operator sets `scopes.session.maxDurationMin` to declare "after N minutes, stop and ask me." The question was whether to: (a) set `action = "require-review"` + `source = "session-over-duration"`, or (b) attach only a `sessionDurationWarning` annotation with action unchanged.

**Decision:** (a) — change the action to `require-review`. The `sessionDurationWarning` annotation is also attached for visibility, but the action change is the load-bearing signal.

**Rationale:** A soft annotation would be silently ignored if the agent keeps calling `decide()` and receiving `allow` back. The operator declared a stop-and-ask boundary — that intention can only be enforced by changing the action. The F10 taint-floor (D34) is the correct precedent: the floor changes the action, not just decorates the result. The override is asserted AFTER all demotion blocks so contract-allow/auto-allow-once/trajectory-nudge cannot silently undo it.

**Owner:** Khouly
**Blocker for:** F14b session-over-duration floor.

---

## D48: Migration Writes to `.draft`, Never Live File; Idempotent Exit-0 on v3 Input

**Date:** 2026-05-08

**Context:** `scripts/migrateV2ToV3.js` needs a safe, pipeline-friendly migration UX. Two questions: (a) should it ever overwrite the live `lilara.contract.json`? (b) what should it do on v3 input?

**Decision:** (a) Never — always writes to `lilara.contract.json.draft`. Refuses to overwrite an existing draft. (b) Exits 0 with "already version 3, no migration needed" on stderr; writes no output.

**Rationale (a):** Never-overwrites-live ensures the operator reviews the draft before `contract accept` finalizes. A partial migration failure (schema validation fails on the draft) would otherwise corrupt the live contract.

**Rationale (b):** Migration tools that exit non-zero on already-migrated input break pipelines that unconditionally run `migrate` before `accept` (alembic/knex convention). Exit 0 + stderr message is machine-parseable (check exit code) and human-readable (check message). No draft file is written, so repeated runs are truly idempotent.

**Owner:** Khouly
**Blocker for:** CI gate `check-migrate-v2-v3.sh`.

---

## D49: Lilara ADR-007 — Canonical Action IR + Explicit Decision Lattice (PR-A skeleton)

**Date:** 2026-05-10

**Context:** Lilara scope (`agent-runtime-guard-scope.md`) §4.1 invariants 9 and 10 require (9) every adapter to normalize raw harness payloads into one canonical action representation before floors run, and (10) every floor to declare its rung, action, demotability, and source tag in one explicit table — with no implicit precedence and no hidden demotion paths. Today the precedence ladder lives in prose in `ARCHITECTURE.md` §2 and in inline string literals (`source = "..."`, `floorFired = "..."`) scattered across `runtime/decision-engine.js`; adapter parity is by convention rather than schema. This is the single-failure-point Lilara product plan §6 calls out as the precondition for clean F15/F16/F18 receipts, replay, output-channel exfiltration guards, and audit-grade fixtures.

**Decision (Option C — IR-first, lattice-declarative, floors stay in code):** Land the foundation in four sequential PRs on `feat/adr-007-canonical-action-ir`. **PR-A (this decision)** ships the documented ADR + the lattice table (`runtime/decision-lattice.js`) + the Canonical Action IR module skeleton (`runtime/action-ir.js`) with **zero behavior change**. `decision-engine.js` is unchanged; `pretool-gate.js` is unchanged. PR-B wires `actionIr.build()` into adapters as a back-compat shim and adds cross-adapter parity fixtures. PR-C switches `decision-engine.js` source/floor labels to read from `LATTICE` constants and adds `irHash`/`rung`/`latticeVersion` to receipts (additive). PR-D adds replay + adversarial seed + perf gates.

**Rationale:** The IR removes "what does this adapter actually mean" ambiguity from every floor; the lattice removes "which rung wins, in what order, demotable by what" ambiguity from every operator and auditor. Both are small (zero-dep, fixture-pinned) and stay inside the engine's p99 budget. Alternatives considered: A) IR only — fails invariant 10 (precedence still implicit). B) Lattice only — fails invariant 9 (adapter drift keeps leaking into floors). D) Fully data-driven engine via JSON DSL — adds an interpreter, audit surface, and bug surface; violates the small-core invariant. E) Defer until v0.6 — retrofit cost > upfront cost; rejected by D-013 in `agent-runtime-guard-plan.md`.

**Constraints honored in PR-A:**
- Zero runtime dependencies (`runtime/decision-lattice.js` and `runtime/action-ir.js` use Node builtins + local `runtime/` requires only).
- Schema additive: `schemas/lilara.contract.schema.json` byte-unchanged.
- Hard Ethical Core untouched. Rung 0 (`L1`) is reserved with `predicateRef: "reserved"`; no engine code consumes it yet.
- No floor predicate, ordering, or outcome changes.
- No Lilara enforcement wired into Claude Code or OpenClaw. Adapter manifests + IR consumption are PR-B work.
- New script `scripts/check-lattice-ordering.sh` validates the table at runtime (frozen, strictly-increasing rungs, unique ids, required fields) plus the IR skeleton (frozen `EMPTY_IR`, `build()` returns frozen IR, `validate()` accepts/rejects shapes, `irHash()` is canonical-stable).

**Owner:** Khouly (sponsor) / Misk (scope) / Claude Code (implementation).
**Blocker for:** F15/F16/F18 receipts, output-channel exfiltration guard, change-intent diffing, replay harness, audit-grade receipts. PR-B unblocks adapter parity fixtures; PR-C unblocks lattice-anchored receipts; PR-D unblocks replay + adversarial gates.

**See also:** `references/adr-007-canonical-action-ir.md` (repo-level reference doc), `agent-runtime-guard-scope.md` §4.1, `agent-runtime-guard-plan.md` §4.1 + §6, `lilara-adr-007-claude-plan.md` (full implementation plan).

---

## D-016: State migration — clean break (no dual-read fallback)

**Date:** 2026-05-24

**Context:** Rebranding from Horus Agentic Power (HAP) v3.1.0 to Lilara v0.1.0. Choice: clean break vs. dual-read fallback (read both `HORUS_*` and `LILARA_*` env vars; read both `~/.horus/` and `~/.lilara/` state dirs during a transition window).

**Decision:** Clean break. No `HORUS_*` aliases. No dual-read. VERSION resets to 0.1.0. Operators (currently only Khouly) must `mv ~/.horus ~/.lilara` and update env vars manually. Existing `hap-` prefixed contracts require re-acceptance.

**Rationale:** There is exactly one operator today. Dual-read complexity would persist in the codebase indefinitely, adding test surface and confusion without serving any actual user. v3.x history stays in CHANGELOG for continuity. Lilara starts clean at 0.1.0.

**Owner:** Khouly. Blocker resolved: D23.

---

## D-017: PR shape — single mega-PR

**Date:** 2026-05-24

**Context:** Should the Lilara rebrand land as one large PR (~150 files) or as a sequence of smaller PRs?

**Decision:** Single mega-PR, matching the ECC→Horus v3.0.0 precedent (`d2c5ea1`, ~95 files). Six ordered commits inside the branch preserve review granularity; the PR merges as a merge-commit so `git bisect` can step through them.

**Rationale:** Mechanical renames are atomic — splitting them across PRs creates intermediate broken states where some files say Lilara and others say Horus. The v3.0.0 precedent worked; the lessons-learned fixes (self-exclusion, cross-platform sed, verify mode) are baked into `scripts/lilara-rebrand.sh`.

**Owner:** Khouly.

---

## D-018: Soak timing — Khouly-override during v3.1.0 soak

**Date:** 2026-05-24

**Context:** v3.1.0 is in a 30-day soak window (through ~2026-06-14). Policy normally forbids non-critical merges during soak.

**Decision:** Khouly explicitly overrides the soak rule for the rebrand PR. The soak counter resets at merge; a new 30-day window begins after the rebrand lands (~ending 2026-06-23). The rebrand is mechanical (no semantic behavior change) but large enough that daily-use validation should restart from a stable surface.

**Owner:** Khouly.

---

## D-019: GitHub repo rename — agent-runtime-guard → lilara

**Date:** 2026-05-24

**Context:** The GitHub repo is currently named `agent-runtime-guard`. Domain selection (`lilara.dev` vs `.ai`) is a separate M9 decision.

**Decision:** Rename the GitHub repo `agent-runtime-guard` → `lilara` at the same time as the rebrand PR merges. Domain decision deferred to M9 commercial track. GitHub auto-redirects old URLs for ~12 months.

**Operator action after merge:**
```bash
git remote set-url origin git@github.com:elkhouly007/lilara.git
```

**Owner:** Khouly (GitHub admin action).

---

## D50: R2 review batch — tenets P0–P2 + Q1–Q7 decisions

**Date:** 2026-06-12

**Context:** The R2 scope review (PR #164) raised seven questions (SCOPE §24) against `[LOCKED]`/`[OPEN]` items and
surfaced the default-posture honesty gap (G12). The owner answered all seven in one memo and set three first-order
design tenets.

**Decision:**
- **Tenets P0–P2 written into SCOPE §0/§0.1 as `[LOCKED]`:** P0 — Lilara exists to make users MORE PRODUCTIVE,
  powerfully and safely (security serves productivity, never the reverse); P1 — security must ENABLE work, optimize
  "approve-once, then run freely"; P2 — the consent contract is anti-nag: re-prompting inside a granted scope is a
  defect; halts only at genuine hard exceptions.
- **Q1:** SCOPE §1.5 confirmed canonical (L1 → L2 → L4 → full L5 → L3 last → §23.A UI after all).
- **Q2:** secure-by-default graduation, evidence-gated, one ADR + owner sign-off per flip — **ADR-049**. First wave:
  `LILARA_ENFORCE=1` default for F3/F14/F10/F27 after near-zero-FP calibration; F28/F29/F23 opt-in until each meets
  its own FP budget; env override always retained; never nag-by-default.
- **Q3:** enforcement point (c) renamed "deterministic lattice precedence + consent gate"; determinism committed as a
  design principle; point (b) stays a tracked gap (G2).
- **Q4:** pre-rebrand ROADMAP.md archived to `references/archive/ROADMAP-2026-pre-rebrand.md`; root stub points at
  SCOPE.md.
- **Q5:** "understands the user better than they understand themselves" reworded toward user-sovereignty (SCOPE §1,
  §11); capable-guard voice kept.
- **Q6:** `dashboard-server.js` IS the seed of §23.A; mutating endpoints only in Phase 8 behind Phase-6 approver-auth;
  read/write split is the §14 standing constraint.
- **Q7:** runtime tamper floor scoped to the INSTALLED guard under `~/.lilara` (not the dev checkout); stays
  inviolable, NOT consent-demotable; CI hash-baseline stays as defense-in-depth — **ADR-050**.

**Note:** the memo referenced "ADR-048" for the graduation policy; ADR-048 was already allocated (F4 demotion design),
so the policy took ADR-049.

**Owner:** Khouly.

**Addendum (2026-06-12, owner review of the R2 encoding):** R2 work verified, no revisions. Additionally decided:
(a) SCOPE §19 #15 friction telemetry ACCEPTED → `[LOCKED]` — local-only/zero-egress counters (prompts-per-task,
re-prompts inside a granted scope = P2 defect target zero, grant-to-first-action time, operator-marked false stops),
feeding both the ADR-049 graduation gates and the L2/L4/L3 loop as guard-routed suggestion-only proposals (never
auto-applied); (b) SCOPE §19 #11–#13 explicitly labeled DEFERRED PROPOSALS (placeholders, not commitments);
(c) PRs #164 and #165 approved to merge, #164 first.

## D51: §19 #4 closed — content red lines elevated to the absolute tier; L1 hard-exceptions reframed (ADR-051)

**Date:** 2026-06-13

**Context:** SCOPE §19 #4 (`[CC-PROPOSED][OPEN]`) asked how hard-exception #1 reconciles with what is deterministically
detectable. Guiding principle (owner): never make a promise or rule that hinges on something the system cannot
establish — a layer that cannot enforce it, or a fact it cannot verify. This rules out conditioning on **consent**
(unverifiable) or **fame** (irrelevant).

**Decision (ADR-051):**
- **Part 1 — honest scoping (closes §19 #4):** HX1/HX2/HX3 stay but are reframed as the content-blind Node guard's
  deterministic **mechanical** stops, not the product's ethical red lines. The guard's deterministic egress guarantee
  is stated precisely as the **credential/secret subset (F27/F28)**; general third-party PII is routed to enforcement
  point (b), never implied as covered by the content-blind guard (LOCKED §5). SCOPE §1/§4/§5/§6/§7/§19 #4/§20 updated;
  G1 honest-scoped, G4 reconciled.
- **Part 2 — two inviolable content red lines at point (b)'s ABSOLUTE tier** (CONTENT-CONTRACT.md → v1.1.0): **Red Line
  A** — sexual/nude/explicit content: flat refusal, any subject (real or fictional), any medium, no carve-out, no
  medical exception (removes the v1.0.0 sexual-content carve-out). **Red Line B** — fabricated/manipulated depiction of
  a real specific person: blanket refusal (even benign-looking edits), discriminator = "fabricated depiction of a real
  specific person", defamation/harm an aggravator not the trigger, not conditioned on consent or fame, generic person =
  general policy. The former §8 third-party set merged into §5/§9 on this sign-off.
- **Architectural constraint:** neither red line is added to the L1 deterministic hard-exception list — they are
  enforced entirely at the content layer (point (b)). Recorded in SCOPE §7 as **two new `[LOCKED]` lines** (count
  43→45; baseline rebaselined); no existing locked text changed. No `decide()` / replay / lattice change.
- **Honest status:** point (b) is doc-only today (G2/G3). This is a binding statement of **intent**; harness wiring is
  separate, human-approved work (the follow-on conformance-corpus + propose-only template-install PR).

**Owner:** Khouly.

## D52: R3 intent re-verification — 16 owner decisions + §19 batch (SCOPE §25)

**Date:** 2026-06-13

**Context:** A one-question-at-a-time re-verification of `references/SCOPE.md` against owner *intent* — because a
`[LOCKED]` tag means "owner decided," not "owner re-verified the wording still means what he intended" (the §19 #4
lesson). Several decisions correct drift in previously-locked text. Docs-only (SCOPE/PLAN/CONTENT-CONTRACT + ADRs +
gates/corpus); no `decide()`/lattice/replay change; new enforcement (structured-PII floor, default-deny egress, network
backstop) is scheduled in PLAN, not implemented here.

**Decisions (full record in SCOPE §25):**
1. Productivity & security **CO-EQUAL** (drop "security in service of productivity"); tie-breaker = security wins only
   when an action crosses into non-consented territory (data leak / deletion beyond authorization). *Reverses the
   2026-06-12 subordination wording.*
2. HARM_SELF own-data wholesale-wipe carve-out: snapshot + one confirm (reuse F29), not a red line.
3. Decoy **disclosed, not silent**; CBRN/weapons in fiction narrative-only (no procedural skeleton).
4. Red Line A (sexual/explicit) **re-verified verbatim** — no change.
5. Red Line B **REVERSED** blanket → **deception+harm** rule (consent never the trigger); + B-text rule. Amends
   ADR-051; CONTENT-CONTRACT → v2.0.0.
6. Bulk **structured-PII egress floor** (near-term, reuse F27/F28); only unstructured/contextual PII → point (b).
   ADR-053 (Proposed).
7. Self-improvement = **one engine, four sources**; one absolute limit (never touch red lines); tier-a only w/ explicit
   approval, tier-b never; hooks/adapters human-approved always.
8. Memory ambition **RESTORED** ("over time, better than he knows himself"). *Reverses the 2026-06-12 Q5 softening.*
9. Consent: three impact bands + gather-upfront + mode-independent red lines; autonomy dial `[ADVISORY]`.
10. Control-plane §23.A promoted `[OPEN]`→`[LOCKED]` direction; three product forms; live-visibility; web dashboard.
11. Installed-core tamper runtime floor (ADR-050) = runtime enforcement of #7.
12. Secure-by-default: definitional tier ON at install unconditionally; heuristic floors FP-gated. **Amends ADR-049.**
13. Core thesis "why Lilara exists": collect → clean-room rewrite → full power AND safety; data local, leaves only to
    approved destinations, weekly re-confirm.
14. Egress **default-deny allowlist** + approved-destinations contract + network backstop; delete non-goal #2; promote
    §21 #1/#3/#4/#5 to `[LOCKED]`. ADR-052 (Proposed).
15. Product-improvement **artifact-sharing** (scrubbed system artifacts, NOT user data) — exempt from default-deny,
    default-on, opt-out, privacy never paywalled. Supersedes the telemetry framing + §19 #8.
16. Business model / licensing **DEFERRED** — build first, decide later; don't tier features; privacy not a paywall.

**§19 batch:** #1 resolved; #3/#5/#6/#7/#11/#12/#13/#14 accepted → `[LOCKED]`; #4 amended; #8 dropped.

**Encoding:** SCOPE §25 (new decision record) + all touched sections; scope-locked baseline rebaselined 45 → 77;
CONTENT-CONTRACT v2.0.0 + `check-content-contract.sh` spec bar + red-team corpus; PLAN Phase 3.5 inserted (no
renumber); ADR-049 + ADR-051 amended; ADR-052/053 Proposed; Appendix B count fixed (46 → 49, ADR-051 had been
unindexed).

**Owner:** Khouly.
