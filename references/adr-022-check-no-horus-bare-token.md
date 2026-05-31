# ADR-022 — Strengthen `check-no-horus.sh` to catch bare lowercase `horus`

- **Status:** Proposed (2026-05-30)
- **Owner decision required:** yes — tightens a CI gate's strictness (could flag future legitimate uses).

## Problem

`scripts/check-no-horus.sh` is the rebrand-drift gate. It searches for a handful of pre-rebrand
*token shapes* — the upper-case env-var prefix, the dotfile/state-dir form, the old
contract-id prefix, and the old product name (each stored via string concatenation so the gate
does not flag itself). It does **not** match bare lowercase `horus`. As a result, nine bare-`horus`
references survived the rebrand undetected in `runtime/` and `scripts/` (PR #85): comments
(`horus doctor`, `horus envelope`), SMTP defaults (`horus@localhost`, `EHLO horus`), a notify
user-agent (`horus-notify/1` ×2), and two temp-dir prefixes (`horus-audit.$$`, `horus-e2e-`). And a
tenth — the `change-intent.js` contract-path pattern `horus.contract.json` — was not cosmetic at
all: it silently disabled an F20 escalation (PR #84).

So the gate that exists to prevent rebrand drift has a blind spot exactly where drift accumulated.

## Evidence

- PR #85 removed 9 bare-`horus` refs that `check-no-horus.sh` passed both before and after.
- PR #84 showed one bare-`horus` ref was behavior-affecting (dormant F20).

## Options considered

1. **Add a bare-`horus` (case-insensitive, word-boundary) check** to `check-no-horus.sh`, with an
   explicit allowlist for the legitimate retainers the gate already exempts (`CHANGELOG.md`,
   `MIGRATION.md`, `DECISIONS.md`, `references/archive/`, the rebrand scripts, and the gate
   itself). Fail on any other bare `horus`.
2. **Narrower:** only scan `runtime/` and `scripts/` for bare `horus` (the code surface), leaving
   prose docs alone — smaller blast radius, still catches the class that mattered.
3. **Do nothing** — accept that bare `horus` can recur; rely on manual review.

## Recommendation

**Option 2.** Code (`runtime/`, `scripts/`) is where a bare-`horus` residue can be
behavior-affecting (as the F20 case proved); prose docs legitimately discuss the old brand and are
a large FP source. Scanning only the code surface for bare `horus` (case-insensitive, `\bhorus\b`)
with the existing allowlist gives the safety without the doc-prose noise. Land it **after** PR #85
merges (so the gate is green on entry).

## FP analysis

- Restricting to `runtime/` + `scripts/` and excluding the already-allowlisted files removes the
  main FP source (historical prose). Remaining FP risk: a legitimate future identifier that
  contains `horus` as a word — vanishingly unlikely in this code surface. If one appears, the
  allowlist mechanism the gate already has handles it.
- No runtime behavior change; CI-only.

## Where it hooks

- `scripts/check-no-horus.sh` (add a `\bhorus\b` case-insensitive arm scoped to `runtime/` +
  `scripts/`, reusing the existing `_EXCL_DIRS` / `_EXCL_FILES` allowlist).
