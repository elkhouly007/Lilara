# ADR-008 — Unicode look-alike + ADR-007 §4.2 precedence defense

**Status:** ACCEPTED — Khouly 2026-05-13 (stop-the-line response to the 2026-05-13 adversarial corpus run; ADR within 24 h per `MASTER_PLAN.md` §7.4).
**Author:** Claude Code (implementer), reviewed by Misk.
**Authoritative cross-refs:** `DECISIONS.md` (pending entry), `ARCHITECTURE.md` §1 (runtime module map), `CHANGELOG.md` Unreleased — Security, `references/adr-007-canonical-action-ir.md` (§4.2 precedence ladder it codifies).
**Predecessor evidence:** session `agent:claude:acp:488d28ae-…` reproduced three live bypasses; reproduction commands in `~/.openclaw/workspace/workstreams/adversarial-bypass-fix-2026-05-13-brief.md`.

---

## 1. Why this exists

The 2026-05-13 adversarial corpus run found three real bypasses that defeated `claude/hooks/dangerous-command-gate.js` in `HORUS_ENFORCE=1` mode. All three exited 0 with empty stderr — i.e. silently allowed — even though each carried a destructive intent the engine has blocked since v1.0.

| # | Leak | Root cause | File:line at fault |
|---|---|---|---|
| 1 | Unicode look-alike (`рm -rf /`, `ｒｍ -rf /`) | ASCII-only regex; no NFKC + confusables fold | `runtime/risk-score.js:31` |
| 2 | Nested `args.tool_input.command` | `commandFrom` probed `args.command` and `tool_input.command` but never `args.tool_input.command`; empty top-level short-circuited the gate | `claude/hooks/hook-utils.js:48-56`, `runtime/pretool-gate.js:138` |
| 3 | `cmd` alias not normalized | ADR-007 §4.2 alias was simply absent from `commandFrom`'s ladder | `claude/hooks/hook-utils.js:48-56` |

Plan §7.4 mandates: "Adversarial bypass found: stop-the-line. ADR within 24 h, fix within 72 h." This ADR is that record.

## 2. Decision

Land **one new zero-dep engine module** that owns both responsibilities and have every adapter inherit through it. No per-adapter normalization, no per-file confusables map, no inline precedence ladder.

### 2.1 New module — `runtime/command-normalize.js`

Two exported functions, pure, no I/O, no deps:

- `normalizeCommand(raw)` — NFKC-folds, then applies a curated Cyrillic + Greek script-confusables map onto the destructive-verb letter set. Returns "" on empty / non-string input. Fast-path returns the NFKC string unchanged when the result is pure ASCII so the hot path stays branch-light.
- `extractCommand(input)` — implements the ADR-007 §4.2 precedence ladder verbatim: first-non-empty wins across `command | cmd | tool_input.{command,cmd} | input.{command,cmd} | args.{command,cmd} | args.tool_input.{command,cmd} | args.input.{command,cmd}`. Recursive descent is **bounded to one level under `args`** — deeper structures are treated as malformed and ignored rather than silently walked.

### 2.2 Dual-path matching in `runtime/risk-score.js`

Every destructive-verb predicate (`destructive-delete-pattern`, `disk-write-pattern`, `force-push-pattern`, `remote-exec-pattern`, `auto-download-pattern`, `privilege-elevation`, `destructive-database-pattern`, `global-package-install`, `hard-reset-pattern`, `kubectl-delete-pattern`, `git-clean-pattern`, `broad-permission-pattern`, the `filesystem-root-target` rm-form check) is now evaluated against **both** the raw command and `normalizeCommand(raw)`. If either matches, the predicate fires. The ASCII regexes themselves are unchanged — keeping them in place means the file still passes human review at a glance, and `dangerous-patterns.json` (consumed by the pattern-emit path) is byte-stable.

### 2.3 Backstop in `runtime/pretool-gate.js`

If the adapter hands the gate an empty `command` string but `rawInput` carries a non-empty value under any §4.2 alias, the gate re-extracts via `extractCommand(rawInput)` before the early-exit short-circuit. This is intentionally redundant with `hook-utils.commandFrom` — defense in depth, not single-point-of-truth, because adapter extractors are written independently and have drifted from the spec before.

### 2.4 Adapter changes

`claude/hooks/hook-utils.js` `commandFrom(input)` now delegates to `require("../../runtime/command-normalize").extractCommand`. The public surface (`commandFrom`) is unchanged so the `claude/`, `opencode/` (and any future adapter that imports `commandFrom`) need no edit and inherit the full §4.2 ladder transparently. The four adapters with inline extract lambdas (`openclaw`, `clawcode`, `codex`, `antegravity`) are left alone in this PR — their lambdas already cover `cmd` (so leak #3 does not apply to them), and the `pretool-gate.js` backstop catches any nested-form regression for them via dual-path re-extraction. A follow-up PR consolidating those four adapters onto `extractCommand` is tracked in the changelog.

## 3. Confusables mapping convention

Cyrillic and Greek letters that visually resemble Latin letters in destructive-verb words are folded to **their phonetic Latin equivalent**, not their visual look-alike, when the two diverge. The canonical example:

- Cyrillic 'р' (U+0440 "er") — visually resembles Latin 'p' but encodes the /r/ sound — is mapped to `'r'`.

This convention is chosen because the in-the-wild attack vector is **transliteration of Latin words into Cyrillic to dodge ASCII regexes**, not visual deception of the engine. The brief explicitly directs this mapping (`р → r`) and the live `рm -rf /` repro is the witness. Visual-only substitutions on non-target letters are still caught when the unsubstituted letters in the destructive verb match the raw regex (handled by the raw-arm of dual-path matching), and for letters where visual and phonetic interpretation agree (`а → a`, `с → c`, `е → e`, `і → i`, `о → o`, `т → t`, `х → x`, …) the mapping serves both.

The map is restricted to the letters that appear in the codebase's tracked destructive verbs (`rm`, `dd`, `chmod`, `curl`, `wget`, `sudo`, `mkfs`, `kubectl`, `npx`, `DROP`, `git`, `push`, `force`, `bash`, `sh`). Extending the map beyond this set was deliberately rejected — every new entry is a chance for a benign Cyrillic identifier in a user comment to spuriously match a destructive verb after folding. NFKC (applied first) collapses full-width Latin (`ｒ → r`, etc.) so we do not need to enumerate compatibility forms in the table.

## 4. Why not …

| Alternative | Why rejected |
|---|---|
| Add NFKC fold inside each adapter's `extractCommand` lambda | Fails for unknown future adapters; duplicates the confusables list; introduces drift between adapters. |
| Modify the regex literals in `dangerous-patterns.json` and `risk-score.js` to use `\p{Letter}` / Unicode-aware character classes | Substantially broadens match surface; risk of new false positives in benign multi-script comments; harder to audit; loses NFKC's compatibility-form handling. |
| Use the official Unicode `confusables.txt` data file at runtime | Adds an I/O dependency and ~1 MB of data the runtime does not need. The 50-character curated map covers the destructive-verb letter set and is auditable on one screen. |
| Block every command containing any non-ASCII letter | Hard-breaks benign use cases (translated comments, internationalized identifiers, file paths with diacritics). |
| Move precedence resolution into `pretool-gate.js` only | Loses adapter-level early extraction; the `commandFrom` callsites still get the wrong answer for downstream pattern emit / hook log labelling. |

## 5. Test surface

12 new fixtures under `tests/fixtures/shell-ast/` cover all three leak repros plus the missing alias positions and the over-block regression:

| Fixture | Vector | Expected |
|---|---|---|
| `ast-bypass-cyrillic-rm-enforce` | Leak #1 verbatim | BLOCK / `destructive-delete-pattern` |
| `ast-bypass-fullwidth-rm-enforce` | NFKC compatibility-form arm | BLOCK / `destructive-delete-pattern` |
| `ast-bypass-cyrillic-dd-enforce` | Cyrillic Komi De (U+0501) | BLOCK / `disk-write-pattern` |
| `ast-bypass-cyrillic-curl-pipe-enforce` | Cyrillic `с` in `curl` | BLOCK / `remote-exec-pattern` |
| `ast-bypass-cyrillic-gitforce-enforce` | Cyrillic `і` in `git` | BLOCK / `force-push-pattern` |
| `ast-bypass-nested-tool-input-enforce` | Leak #2 verbatim | BLOCK / `destructive-delete-pattern` |
| `ast-bypass-cmd-alias-enforce` | Leak #3 verbatim | BLOCK / `destructive-delete-pattern` |
| `ast-bypass-cmd-alias-nested-enforce` | `args.cmd` | BLOCK / `destructive-delete-pattern` |
| `ast-bypass-args-tool-input-cmd-enforce` | `args.tool_input.cmd` | BLOCK / `destructive-delete-pattern` |
| `ast-bypass-normalized-allow-enforce` | Benign Russian text in `echo` | ALLOW (exit 0) — pins no-over-block |
| `ast-bypass-cyrillic-chmod-enforce` | Cyrillic `с` in `chmod` (uses `sudo` prefix; see §6) | BLOCK / `broad-permission-pattern` |
| `ast-bypass-cyrillic-rmrf-quoted-enforce` | `bash -c 'рm -rf /'` (covers `-c` path) | BLOCK / `destructive-delete-pattern` |

`tests/runtime/command-normalize.test.js` (29 zero-dep `node:assert` cases) pins the §4.2 precedence ladder explicitly. Each alias position has an isolated test; an "intentionally not walked" case asserts `args.args.command` is **not** extracted (parse-surface lockdown).

## 6. Known limitations & follow-up

1. **chmod alone does not BLOCK.** The standalone `chmod 777 /etc/shadow` scores 4 (medium → route) in the current risk weights, regardless of Cyrillic obfuscation. The brief asked for a BLOCK fixture, so `ast-bypass-cyrillic-chmod-enforce` uses the composite `sudo сhmod 777 /etc/shadow` which scores 7 (high → escalate → block in enforce mode) and exercises both the `broad-permission-pattern` regex (after Cyrillic fold) and `privilege-elevation`. Raising the standalone-chmod risk weight is out of scope for this stop-the-line PR.
2. **Adapters `openclaw`, `clawcode`, `codex`, `antegravity`** retain inline `extractCommand` lambdas. They each already cover `cmd` so leak #3 does not apply to them; the `pretool-gate.js` backstop catches nested-form regressions. Consolidating them onto `extractCommand` is a follow-up.
3. **Confusables map** is restricted to the destructive-verb letter set. New destructive-verb additions (e.g. `terraform destroy`) must be reviewed against the map at the time of addition.
4. **Visual-only homoglyph attacks on letters where phonetic and visual interpretation diverge** (e.g. Cyrillic 'р' used as visual `p` in `push`) rely on the raw-arm of dual-path matching to fire on the unobfuscated letters. The relevant fixture uses Cyrillic `і` for `i` in `git`, not Cyrillic `р` for `p` in `push`.

## 7. Acceptance evidence

- All 3 brief-attached repro commands now exit 2 with the BLOCK reason in stderr.
- `bash scripts/run-fixtures.sh` — 314 / 314 passing (was 302 pre-PR; +12 from this PR).
- `bash scripts/check-counts.sh` — fixtures: 261.
- `bash scripts/check-fixture-count.sh` — README + CHANGELOG + full-power-status all aligned at 261.
- `bash scripts/check-zero-deps.sh` — passes.
- `node tests/runtime/command-normalize.test.js` — 29 / 29 passing.
- `bash scripts/bench-runtime-decision.sh` — p99 within ceiling. NFKC + fold is gated by an ASCII fast-path; pure-ASCII inputs cost one extra string-equality check on `cmdNorm === cmdRaw`.
