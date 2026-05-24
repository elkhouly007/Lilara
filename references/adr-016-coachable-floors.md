# ADR-016 — Coachable Floors

**Status:** ACCEPTED — 2026-05-24 (v0.5 Stage E, wave-1).
**Scope refs:** `references/competitive-audit.md` Top-15 items #1–4.
**Plan ref:** `.claude/plans/read-the-full-scope-golden-wolf.md` (this run).

## 1. Why this exists

Lilara is a silent wall. When a floor fires, the operator sees
`decisionSource: "ambient-authority-denied"` in stderr (Claude/echo adapters)
or a one-line `permissionDecisionReason` (ClawCode), and the model receives
nothing it can act on except a blocked tool call. There is no programmatic way
to coach the model on warn-mode fires, assert on stable error codes in tests or
CI, detect prompt-injection payloads in tool output, or preview which floors
would fire for a hypothetical command without polluting the decision journal.

Four primitives — additionalContext injection, typed block-codes, a
compaction-survival scanner (F21), and `lilara sandbox` dry-run — together flip
the wall into a **coachable, debuggable, testable wall** without changing any
existing floor's behaviour, breaking the v1 receipt schema, or pulling in a
dependency.

## 2. Decision

**Coaching envelopes.** Floor decisions may carry an optional
`coaching: {message, hint}` field. Adapters with `additionalContextSupported:
true` (Claude, ClawCode) emit a `hookSpecificOutput.additionalContext` block on
PreToolUse so the model receives the coaching in its next turn. Other adapters
emit `[lilara:coaching] …` to stderr (operator sees it; model does not).
Coaching is additive; absence of the field is a no-op. Messages are capped at
500 characters.

**Typed block-codes.** Every floor block carries a stable `code:` string drawn
from a frozen `floorCodeFor(reasonCode)` registry in `runtime/floor-codes.js`.
Format: `F<n>_<SCREAMING_SNAKE>` (e.g. `F8_PROTECTED_BRANCH`,
`F21_COMPACTION_SURVIVAL`). Codes are versioned in the registry, never renamed
(only deprecated → aliased). The field is additive-optional on receipts per
ADR-014.

**F21 compaction-survival.** New floor at rung 18.7 (after F20 at 18.5, before
D-LEARNED-ALLOW at 19). Action: `"warn"`. Fires in PostToolUse on
`Read | WebFetch | WebSearch | Fetch | mcp | Browser` results when
`scanForInjection(text)` matches any seeded pattern (see §3). On fire: writes
a receipt with `floorFired: "compaction-survival"`, emits a coaching envelope,
and records an injection-class taint entry so the next PreToolUse can correlate
via the existing F10 machinery (action: `require-review`).

**`lilara sandbox`.** New CLI subcommand. Takes a command, builds synthetic IR,
calls `decide({dryRun: true})`, prints which floors fire at what rung with what
typed code. No state writes — journal append is skipped when `dryRun: true`.
Flags: `--json`, `--tool <name>`, `--harness <name>`, `--explain`.

## 3. Pattern seed for F21

Initial regex pack (zero-dep, <1 ms each); loaded from `runtime/compaction-survival.js`:

| id     | pattern                                           | severity |
|--------|---------------------------------------------------|----------|
| CS-001 | `/ignore (all )?previous instructions/i`          | high     |
| CS-002 | `/disregard (the )?system prompt/i`               | high     |
| CS-003 | `/when summarizing,? retain (this\|the following)/i` | medium |
| CS-004 | `/this directive is permanent/i`                  | medium   |
| CS-005 | `/preserve (this\|the following) through compaction/i` | high |
| CS-006 | `/<\s*sudo\s*>\|<\s*admin\s*>/i`                 | medium   |
| CS-007 | `/\`\`\`(json\|yaml)[\s\S]{0,40}"role"\s*:\s*"(system\|assistant)"/i` | high |

Hard cap: scan first 64 KB only (perf budget <1 ms). Adding a pattern is
non-breaking. All severities start at `require-review` via taint; escalation to
`block` deferred pending corpus data.

## 4. Where this stops

- Coaching is **opt-in per floor**. F1 (kill-switch) and the Hard Ethical Core
  do not coach — denial is the signal.
- F21 is **detection-only**. The in-flight tool result has already been
  delivered when PostToolUse runs; enforcement is taint correlation on the NEXT
  PreToolUse via F10 machinery.
- `lilara sandbox` is **read-only on state**. Journal disabled via `dryRun: true`.
- Typed codes are **additive on receipts**. Existing fixtures keep validating;
  codes appear only on new receipts.

## 5. Non-goals

- LLM-based injection classification (still out of scope per ASI01 NOT-COVERED
  note in `references/owasp-agentic-coverage.md`).
- Coaching for non-Claude adapters via in-stream injection (no protocol hook).
- Multi-step approval loops for warn-mode fires (Feature 5 from competitive
  audit — defer decision — is separate, M-effort, not in ADR-016).
- Rewriting tool input/output (`updatedInput`/`updatedToolOutput` — separate
  ADR-017).

## 6. Acceptance evidence

- `tests/runtime/compaction-survival.test.js` — 5 positive + 3 negative payloads.
- `tests/runtime/floor-codes.test.js` — every active lattice floor has a stable
  code; registry has no duplicate codes; code format matches `^F[0-9]+`.
- `tests/runtime/coaching-envelope.test.js` — claude/clawcode emit
  `hookSpecificOutput.additionalContext`; other 4 adapters emit
  `[lilara:coaching]` to stderr.
- `tests/runtime/sandbox-dry-run.test.js` — spawns `lilara sandbox 'rm -rf /'`,
  asserts F-codes printed, asserts journal length unchanged.
- `tests/fixtures/compaction-survival/*.input` replayed via
  `check-decision-replay.sh`; zero divergence.
- `lilara-cli.sh ci` passes clean.

## 7. References

- `references/competitive-audit.md` Top-15 #1, #2, #3, #4
- ADR-014 (receipt schema additive policy)
- DECISIONS.md D34 (provenance window), D38 (post-adapter factory), D39
  (EXTERNAL_TOOLS canonical set)
- `references/owasp-agentic-coverage.md` ASI01 row
