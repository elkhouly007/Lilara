# OVERNIGHT_REPORT_2.md — Wave 2 Prep + Backlog Cleanup

**Date:** 2026-05-08  
**Session scope:** Wave 2 prep + backlog cleanup. All work on branches off master, independent of pending Wave 1 PRs (#10–#13). No Wave 1 PRs merged.

---

## Summary

All 4 tracks complete. 4 PRs opened. OVERNIGHT_QUEUE_2.md not needed — no hard stops encountered.

---

## Track 1 — B3: Acceptance Gate Hardening

**Branch:** `feat/b3-accept-gate-hardening`  
**PR:** [#14](https://github.com/elkhouly007/agent-runtime-guard/pull/14)  
**Status:** Complete. PR open, awaiting review.

**What was done:**

Replaced the env-var allowlist in `runtime/contract.js:accept()` with a positive operator signal (Q2 fix). The old guard checked that none of the known harness session env vars were present — a "defense by absence" that would be silently bypassed by any novel harness.

New mechanism: accept() requires either (a) `stdin.isTTY` (interactive terminal) or (b) a valid unconsumed `HORUS_OPERATOR_TOKEN` from `~/.horus/operator-tokens.jsonl`.

**New exports from `runtime/contract.js`:**
- `mintOperatorToken(label)` — 32-byte random hex token, appended to JSONL
- `consumeOperatorToken(token)` — one-shot consume (tmp+rename pattern)
- `operatorTokensPath()` — path to operator-tokens.jsonl

**New CLI subcommand:** `horus-cli.sh operator-token mint [label]` / `operator-token verify <token>`

**Docs:** `CONTRACT.md` § Operator Token Flow, `DECISIONS.md` D32

**Fixtures:** 6 inline accept-gate tests (197 total passing):
- `accept-gate:mint-format` — 64-char hex
- `accept-gate:consume-first` — returns true
- `accept-gate:consume-second-rejected` — returns false
- `accept-gate:no-signal-error` — "refusing to accept" in piped-stdin/no-token context
- `accept-gate:valid-token-passes-gate` — gate passes, fails on missing draft (expected)
- `accept-gate:consumed-token-rejected` — "invalid or already consumed" error

**CI:** All 7 gates pass. Bench p99=56.895ms (cap=85.782ms).

**Breaking change:** Non-TTY automation that called `contract accept` without a token will fail. Documented in `CHANGELOG.md` with migration path.

---

## Track 2 — E2: Per-Harness Wiring Docs Parity

**Branch:** `docs/e2-wiring-parity`  
**PR:** [#15](https://github.com/elkhouly007/agent-runtime-guard/pull/15)  
**Status:** Complete (2 commits). PR open, awaiting review.

**What was done:**

Brought all 4 harness `WIRING_PLAN.md` files to the `opencode/WIRING_PLAN.md` gold standard level.

- **openclaw:** Fixture count corrected (12→19). PostToolUse Parity section added documenting that Wave 1 A3 (PR #13) adds `openclaw/hooks/post-adapter.js`.
- **codex:** Added Scope, Fixtures (10 fixtures), PostToolUse Parity (pending A3), Target Paths, Wiring Steps (formal confirmation procedure), Wiring Model, Approval Mapping, expanded Definition of Done.
- **clawcode:** Same additions as codex. Notes that it is the most tested of the three EXPERIMENTAL harnesses (12 checks in `check-clawcode-adapter.sh`).
- **antegravity:** Same additions as codex.

All four correctly state "PostToolUse hook is being added by Wave 1 A3 (PR #13)" rather than "is implemented" (A3 is still open on master).

No code or fixture changes. check-counts passes.

---

## Track 3 — B1: Codex/Clawcode/Antegravity PostToolUse Payload Research

**Branch:** `research/b1-payload-shapes`  
**PR:** [#16](https://github.com/elkhouly007/agent-runtime-guard/pull/16)  
**Status:** Complete. PR open, awaiting review.

**What was done:**

Created three POSTTOOL_RESEARCH.md files documenting hypothesised PostToolUse event shapes, verification procedures, and open unknowns for each EXPERIMENTAL harness.

**Per-file content:**
- 3 hypothesised event shapes per harness (Claude Code-compat, native format, streaming)
- Stdin-capture verification stub (non-blocking shell script)
- Suspected output field priority fallback chain
- Current adapter coverage table (PreToolUse: EXPERIMENTAL; PostToolUse: NOT WIRED)
- Relation to ASI05 coverage status

**antegravity-specific:** Additional unknowns section (no known public documentation; uncertain whether PostToolUse event is even supported; streaming output unknown).

Research only — no code or adapter changes.

---

## Track 4a — D33-D36: Wave 1 Follow-Up Design Decisions

**Branch:** `docs/wave1-followup-decisions`  
**PR:** [#17](https://github.com/elkhouly007/agent-runtime-guard/pull/17)  
**Status:** Complete. PR open, awaiting review.

**Decisions filed (renumbered D33-D36 to avoid conflict with A5's D27-D30 A4-smells):**

- **D33 (A2 Taint correlator):** MIN_TOKEN_LENGTH=6 rationale; flag-style arg filter; exact command match first. Rejected semantic similarity (LLM too slow) and edit distance (dependency).
- **D34 (A2 Provenance window):** 5-min TTL, 20-entry cap, mode 0600, best-effort. Taint fires `require-review` not `block`.
- **D35 (A3 Post-adapter split):** Claude extends output-sanitizer.js; others get new post-adapter.js. Avoids disruptive rename of existing Claude hook wiring.
- **D36 (A4 Redaction scope):** Only targetPath and notes are redacted. Structural fields (action, riskLevel, etc.) cannot embed secrets and must stay stable for JSONL replay.

---

## Track 4b — Bench Empirical Update (D31 Append)

**Committed with:** Track 4a on `docs/wave1-followup-decisions`

**5 runs on master HEAD `dc9bb5d`:**

| Run | p50 | p95 | p99 |
|---|---|---|---|
| 1 | 39.3ms | 61.3ms | 68.9ms |
| 2 | 38.0ms | 59.8ms | 67.5ms |
| 3 | 37.0ms | 53.2ms | 60.1ms |
| 4 | 36.8ms | 53.1ms | 61.2ms |
| 5 | 36.6ms | 52.6ms | 60.2ms |

**p99 spread: 14.4% of median (61.2ms) — under 30% threshold → accepted noise, no follow-up item.**  
Scoped-baseline self-correction is confirmed to be sufficient. D31 updated with this empirical data.

---

## Open PRs At End Of Session

| PR | Branch | What |
|---|---|---|
| [#10](https://github.com/elkhouly007/agent-runtime-guard/pull/10) | feat/a5-rate-limit-toctou | Wave 1 A5 — do NOT merge (per standing instruction) |
| [#11](https://github.com/elkhouly007/agent-runtime-guard/pull/11) | feat/a1-shell-ast | Wave 1 A1 — awaiting review |
| [#12](https://github.com/elkhouly007/agent-runtime-guard/pull/12) | feat/a2-taint-claude | Wave 1 A2 — awaiting review |
| [#13](https://github.com/elkhouly007/agent-runtime-guard/pull/13) | feat/a3-posttool-parity | Wave 1 A3 — awaiting review |
| [#14](https://github.com/elkhouly007/agent-runtime-guard/pull/14) | feat/b3-accept-gate-hardening | Wave 2 B3 — awaiting review |
| [#15](https://github.com/elkhouly007/agent-runtime-guard/pull/15) | docs/e2-wiring-parity | Wave 2 E2 — awaiting review |
| [#16](https://github.com/elkhouly007/agent-runtime-guard/pull/16) | research/b1-payload-shapes | Wave 2 B1 — awaiting review |
| [#17](https://github.com/elkhouly007/agent-runtime-guard/pull/17) | docs/wave1-followup-decisions | Wave 2 D33-D36 + D31 bench — awaiting review |

---

## Decision Inventory (End Of Session)

New decisions filed this session:
- **D33** — A2 taint correlator parameters
- **D34** — A2 provenance window
- **D35** — A3 post-adapter split rationale
- **D36** — A4 redaction scope
- **D31** — (update) bench empirical validation data appended
- **D32** — B3 accept gate inversion rationale (on PR #14)

Note: D27-D30 are reserved for A4 code-smell follow-up decisions (filed on `feat/a5-rate-limit-toctou`, PR #10).

---

## What Is Needed From Morning Review

1. Approve or comment on Wave 1 PRs (#11, #12, #13) — A1/A2/A3 — so they can be merged in order (A1→A2→A3).
2. A5 (#10): standing instruction says do not merge — confirm this is still the intent.
3. Wave 2 PRs (#14-#17): these are independent of Wave 1. Can be reviewed and merged in any order.
4. After A3 merges: update E2 wiring plans to reflect post-adapter.js as implemented (remove "being added by PR #13" phrasing).
