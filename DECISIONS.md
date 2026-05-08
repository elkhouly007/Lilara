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

## D33: A2 Taint Correlator — Token-Overlap Algorithm

**Status: CLOSED — implemented in `feat/a2-taint-claude` (PR #12).**

`runtime/provenance-correlator.js:correlate()` checks whether shell command tokens appear verbatim in the provenance window (recent external reads). Exact-match first, then per-token. Token filter: `length >= minTokenLength && not a flag (-x / --foo)`.

**Minimum token length:** configurable via `horus.config.json` key `taint.minTokenLength` (integer, range 4–32, default 6). Read by `project-policy.js:loadProjectPolicy()` and passed into `correlate()` via `taint.js:correlateCommand()`. Operators in high-FP token-overlap environments (e.g., reading package docs then installing that package) can raise this threshold without code changes.

**Recommended path:** set `"taint": { "minTokenLength": 10 }` in `horus.config.json` to reduce false-positives in doc-heavy workflows.

**Known gap (D37):** tool-class gate not yet implemented — F10 fires on any tool, not just Bash/Edit/Write/WebFetch. Tracked as D37.

---

## D37: F10 Tool-Class Filter Missing

**Status: OPEN — Wave-2 cleanup pass.**

The ENHANCEMENT_PLAN §A2 acceptance criteria specified: "fires on the next 3 tool calls *if any of those calls construct shell strings, edit files, or invoke network tools* — a tool-class gate." Current implementation (`runtime/decision-engine.js`, A2) fires the taint floor for *any* tool call when the command overlaps a recent external read. This will generate false-positives for low-risk tool classes (e.g., `Read`, `Glob`, `TodoWrite`).

**Recommended path:** in `runtime/decision-engine.js`, wrap the F10 block with a tool-class guard:
```js
const TAINT_ELIGIBLE_TOOLS = new Set(["Bash","Edit","Write","NotebookEdit","WebFetch","WebSearch"]);
if (TAINT_ELIGIBLE_TOOLS.has(input.tool)) { /* run correlateCommand */ }
```
Cross-harness tool-name mapping is needed for OpenCode/OpenClaw/Codex/Clawcode/Antegravity (A3's job). Default action stays `require-review` — the guard only prevents the floor from firing on provably low-risk tools. No fixture or contract changes required.

**Owner:** Wave-2 cleanup pass.
**Blocker for:** nothing — current behavior is conservative (over-fires), not under-fires. No security regression.

---

## D38: Post-Adapter Factory Refactor — DRY Violation Across 5 Adapters

**Status: OPEN — Wave-2 cleanup pass.**

The five `post-adapter.js` files added by A3 (`opencode/`, `openclaw/`, `codex/`, `clawcode/`, `antegravity/`) each contain ~40 lines of identical logic: the `EXTERNAL_TOOLS` set, a `sourceLabel()` helper, the secret-scan + taint-record flow, and the `HORUS_KILL_SWITCH` / `rateLimitCheck()` guards. This is a DRY violation — any logic change must be applied to all five files.

**Recommended path:** extract shared logic into `claude/hooks/post-hook-utils.js` exporting `createPostAdapter(harnessName)`, parallel to how `hook-utils.js` serves PreToolUse adapters. Each per-harness adapter becomes 5–10 lines wrapping the factory call. `check-post-adapter-parity.sh` continues to assert the structural contract.

**Owner:** Wave-2 cleanup pass.
**Blocker for:** nothing — current adapters are correct; this is a maintainability concern only.

---

## D39: EXTERNAL_TOOLS Canonicalization — Codex "fetch" Divergence

**Status: OPEN — Wave-2 cleanup pass (or paired with D38).**

The Codex `post-adapter.js` includes `"fetch"` in its `EXTERNAL_TOOLS` set; the OpenCode, OpenClaw, Clawcode, and Antegravity adapters do not. This may be intentional (Codex uses a native `fetch` tool not present in other harnesses) or an inconsistency introduced during parallel development.

**Recommended path:** confirm whether `"fetch"` is a real Codex tool class. If yes, document the divergence in `codex/WIRING_PLAN.md`. If no, remove it. The question resolves naturally when D38's factory consolidates the `EXTERNAL_TOOLS` list into one canonical set with per-harness overrides.

**Owner:** Wave-2 cleanup pass.
**Blocker for:** nothing — over-including a tool class in EXTERNAL_TOOLS is conservative (records more provenance, not less). No security regression.

---

## D40: Post-Adapter Behavioral Parity Fixtures

**Status: OPEN — Wave-2 testing pass (lower priority than D38/D39).**

`scripts/check-post-adapter-parity.sh` is structural — it verifies that each adapter imports `scanSecrets` and `recordExternalRead` and calls them at the right call sites. It does not run the adapters against live inputs.

**Recommended path:** add per-harness PostToolUse fixtures (one per adapter) that pipe a synthetic payload containing (a) a secret pattern in the `output` field, and (b) an external-tool name in the `tool` field. Assert that (1) stderr carries a secret-warning line and (2) `~/.horus/provenance-window.json` gains a new entry. These can live under `tests/fixtures/posttool/` and be driven by a new `run_posttool_fixtures` helper in `scripts/run-fixtures.sh`.

**Owner:** Wave-2 testing pass.
**Blocker for:** nothing — the structural check is sufficient for correctness; behavioral fixtures add regression depth.

---

## D41: Atomic Write on Rate-Limit State File

**Status: OPEN — Wave-2 cleanup pass.**

`claude/hooks/hook-utils.js:rateLimitCheck()` uses an O_EXCL lockfile to prevent concurrent writers, but the underlying `rate-state.json` is still written with a plain `fs.writeFileSync`. A process killed mid-write leaves a truncated state file; on next read the JSON.parse fails and the rate limiter resets to defaults — allowing a burst through. Other state files in the project (`state.json`, `policy.json`, `provenance-window.json`) use the tmp+renameSync pattern for exactly this reason.

**Recommended path:** in `rateLimitCheck()`, replace the direct `fs.writeFileSync(statePath, ...)` with `fs.writeFileSync(statePath + ".tmp", ...); fs.renameSync(statePath + ".tmp", statePath)`. The O_EXCL lock already serializes writers, so this is a one-call-site change.

**Owner:** Wave-2 cleanup pass.
**Blocker for:** nothing — torn-write window is narrow (sub-millisecond on modern FS); the O_EXCL lock already prevents concurrent corruption. This closes the remaining single-process-crash edge case.

---

## D42: Document the 2000ms Stale-Lock Threshold

**Status: OPEN — trivial. Any next pass touching hook-utils.js.**

`rateLimitCheck()` steals stale locks older than 2000ms with no inline comment explaining the value. Future readers may question why 2s, or whether it's safe to lower.

**Recommended path:** add a one-line comment above the threshold constant:
```js
// 2000ms: well above normal hook execution (typical 5–50ms); well below user-noticeable wait.
// A slow hook may let a second caller steal the lock — benign: one extra invocation passes through.
const STALE_LOCK_MS = 2000;
```

**Owner:** any contributor touching hook-utils.js.
**Blocker for:** nothing.

---

## D43: consumeOperatorToken Fallback Defeats Atomicity

**Status: OPEN — Wave-2 cleanup pass.**

In `runtime/contract.js`, `consumeOperatorToken()` writes the updated token store atomically (tmp + renameSync), but the `catch` block falls back to a direct `fs.writeFileSync(tokensPath, ...)` if the rename fails. This fallback is non-atomic and can corrupt the file mid-write, defeating the purpose of the tmp+rename pattern. The "try harder" fallback is worse than failing loudly: on rename failure the original file remains readable and consistent; a corrupt write from the fallback breaks all subsequent token operations.

**Recommended path:** drop the fallback entirely. On rename failure, return `false` and let the caller handle it. The `.tmp` file stays as forensic evidence. The original `tokensPath` remains readable. One fewer code path, no corruption risk.

**Owner:** Wave-2 cleanup pass.
**Blocker for:** nothing — rename failures in practice require FS-level problems that would also affect the direct write; the improvement is principled, not urgent.

---

## D44: Concurrent consumeOperatorToken Race

**Status: OPEN — Wave-2 hardening pass.**

Two processes presenting the same token concurrently can both read it as unused (before either writes back "consumed"), causing both `accept()` calls to succeed. The threat model is low: single-operator + single-pipeline deployments have no realistic concurrent consumption. However, the race is latent.

**Recommended path:** wrap the read-modify-write in `consumeOperatorToken()` with an O_EXCL lockfile mirroring the A5 rate-limit pattern. Lock on entry, unlock in `finally`. Contention returns `false` (conservative). Priority is lower than D43 because D43's fallback removal already tightens the write path; this adds the serialization layer.

**Owner:** Wave-2 hardening pass.
**Blocker for:** nothing — race requires specific operator misconfiguration (two callers presenting the same token at the same millisecond). Not a practical threat for the intended single-operator use case.

---

## D45: operator-token list and revoke Subcommands Missing

**Status: OPEN — Wave-2 UX pass.**

An operator who mints a token has no UX to inspect the store or invalidate a token they suspect was leaked. The current CLI only supports `mint` and `verify`.

**Recommended path:**
- `horus-cli.sh operator-token list` — prints `{ token-prefix-8-chars, label, createdAt, usedAt? }` per line (never prints the full token)
- `horus-cli.sh operator-token revoke <token>` — marks `usedAt` on the entry without consuming it via the normal gate, so a re-presented token fails with `"invalid or already consumed"`

**Owner:** Wave-2 UX pass.
**Blocker for:** nothing — operators can work around the absence by re-minting and discarding old state.

---

## D27: secret-scan.js Encapsulation — getPatterns() vs redact(text)

**Status: OPEN — low-priority follow-up, not blocking Wave 1.**

`runtime/secret-scan.js` exposes `getPatterns()` as a raw pattern array. Callers (currently `decision-journal.js`) iterate the array and apply `pattern.replace()` themselves. This leaks the redaction mechanic into the caller.

**Better interface:** export `redact(text, extraPatterns?)` from `secret-scan.js` and let `decision-journal.js` call that. This becomes important when contract-custom patterns land (caller would not need to merge arrays).

**Recommended action:** fold into a future `secret-scan` improvement pass. Do not reopen A4.
**Priority:** low — no correctness impact today.

---

## D28: decision-journal.js Redaction Policy Comment

**Status: OPEN — trivial one-liner, low-priority.**

`runtime/decision-journal.js:append()` redacts `targetPath` and `notes` but not `tool`, `branch`, `kind`, or `action`. These structured/enum-like fields are defensible exclusions (they don't carry user-controlled free text), but the code does not say so.

**Recommended action:** add a one-line comment in `decision-journal.js` next to the `const record = {` block explaining which fields are redacted and why others are not.
**Priority:** low — doc-only.

---

## D29: Journal Redaction Provenance Label — [REDACTED:class-C] vs [REDACTED:<name>]

**Status: OPEN — forensics improvement, low-priority.**

The replacement label `[REDACTED:class-C]` is hardcoded in `decision-journal.js:redactText()`. This loses pattern provenance: a forensic reviewer cannot tell whether the redacted value was an AWS key, a Slack token, or a generic secret.

**Better label:** `[REDACTED:<pattern_name>]` (e.g. `[REDACTED:AWS-access-key]`). Requires iterating matches and replacing per-pattern rather than in a single loop. Small performance overhead; large forensic gain.

**Recommended action:** fold into the D27 encapsulation cleanup (if `secret-scan.js` exports `redact()`, it can return metadata too).
**Priority:** low — no security regression in current form.

---

## D30: Fixture Pattern For One-Off Output-Inspection Tests

**Status: OPEN — decide before A1 starts (or immediately after A5 lands).**

A4's `jredact:redact-on` / `jredact:redact-off` tests live inline in `scripts/run-fixtures.sh` rather than in `tests/fixtures/<category>/`. A5's concurrent-invocation harness uses `tests/fixtures/rate-limit/`. These are two different patterns for tests that inspect runtime output rather than hook stdin/stdout.

**Decision needed:** should output-inspection tests live in `tests/fixtures/runtime/`, `tests/inline/`, or inline in `run-fixtures.sh`? Decide once and apply consistently across A1/A2/A3.

**Options:**
1. `tests/fixtures/runtime/` — co-located with other fixture categories; discovery is easy; no `.input` files so check-counts is unaffected.
2. `tests/inline/` — separate directory signals "not stdin/stdout pair tests"; cleaner conceptual boundary.
3. Inline in `run-fixtures.sh` — no new directories; harder to navigate as count grows.

**Recommended action:** pick one pattern, port the A4 jredact tests to match, then A1/A2/A3 follow the same pattern.
**Priority:** medium — compounding debt if each item invents its own pattern.

---

## D31: bench-runtime-decision.sh — Win32 Machine-Load Noise At p99

**Status: RESOLVED by documentation. No code change needed.**

On 2026-05-08, `bench-runtime-decision.sh` produced two consecutive p99 readings of ~102ms and ~104ms against the 85ms cap (1.5× of 56.831ms baseline), causing the gate to fail. The same failure occurred on clean master with no A-series changes applied. A systematic 5-run diagnostic the same night showed p99 values of 53.8, 54.8, 66.9, 55.3, 53.8ms on master — all within the 1.5× cap — confirming the earlier failures were transient Windows machine-load spikes (likely background indexing or antivirus scan).

**A5 bench (5 runs immediately after master):** 54.3, 53.9, 54.0, 53.5, 54.8ms — tightly clustered, zero regression vs master. The A5 change (`hook-utils.js`) does not touch `decision-engine.js:decide()` — the bench hot path — so A5 cannot regress the bench.

**Resolution:** The scoped-baseline approach (each run compares against the previous run's p99) already self-corrects for persistent load shifts. For isolated spikes, re-running the bench gate is sufficient. No baseline recapture or bench-tool change required.

**Recommended action:** if bench fails in CI on any single run, re-run once before treating it as a hard stop. A second consecutive failure is a real regression. Document this in `SECURITY_MODEL.md` or bench runner header as a known Win32 behaviour.
**Priority:** low — monitoring only.

---

## D32: contract.accept() — Invert Signal Model From Env-Var Allowlist To Positive Operator Token

**Status: RESOLVED — B3 implemented in `runtime/contract.js`, shipped in Wave 2 Track 1.**

**Date:** 2026-05-08

**Problem (Q2):** The old `accept()` guarded against non-interactive acceptance by checking that none of the known harness session env vars were present (e.g. `CLAUDE_CODE_ENTRYPOINT`, `OPENCODE_SESSION_ID`). This "defense by absence" has a structural flaw: any novel harness or automation context whose env var was not in the allowlist would bypass the gate silently. Adding new harnesses (A3) made the allowlist permanently incomplete.

**Decision:** Replace the env-var allowlist with a **positive operator signal**. Two paths are valid:
1. `stdin.isTTY` is true — caller is in an interactive terminal.
2. `HORUS_OPERATOR_TOKEN` is set to a valid unconsumed one-shot token from `~/.horus/operator-tokens.jsonl`.

Any other caller (piped stdin, no token, or expired/consumed token) receives a hard error with remediation instructions.

**One-shot token semantics:** tokens are 32-byte random hex, stored as JSONL records `{token, label, createdAt, usedAt}`. `usedAt` is null until the first successful `accept()`. Second use is rejected. Tokens are minted via `horus-cli.sh operator-token mint [label]`.

**Alternatives considered:**
- Keep and grow the allowlist — rejected; allowlist will always lag novel harnesses.
- Require a password/passphrase — rejected; adds friction without a meaningful security gain over TTY check.

**Impact:** breaking change for any automation that used `accept()` in a non-TTY context without `HORUS_OPERATOR_TOKEN`. Remediation: pre-mint a token and pass it. The `CHANGELOG.md` entry for B3 documents the migration path.

**Owner:** Khouly
**Blocker for:** nothing (no other item depends on the old allowlist).
