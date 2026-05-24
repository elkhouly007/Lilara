# ADR-008 — Unicode look-alike + ADR-007 §4.2 precedence defense

**Status:** ACCEPTED — Khouly 2026-05-13 (stop-the-line response to the 2026-05-13 adversarial corpus run; ADR within 24 h per `MASTER_PLAN.md` §7.4).
**Author:** Claude Code (implementer), reviewed by Misk.
**Authoritative cross-refs:** `DECISIONS.md` (pending entry), `ARCHITECTURE.md` §1 (runtime module map), `CHANGELOG.md` Unreleased — Security, `references/adr-007-canonical-action-ir.md` (§4.2 precedence ladder it codifies).
**Predecessor evidence:** session `agent:claude:acp:488d28ae-…` reproduced three live bypasses; reproduction commands in `~/.openclaw/workspace/workstreams/adversarial-bypass-fix-2026-05-13-brief.md`.

---

## 1. Why this exists

The 2026-05-13 adversarial corpus run found three real bypasses that defeated `claude/hooks/dangerous-command-gate.js` in `LILARA_ENFORCE=1` mode. All three exited 0 with empty stderr — i.e. silently allowed — even though each carried a destructive intent the engine has blocked since v1.0.

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

- `normalizeCommand(raw)` — NFKD-decomposes the input, strips Unicode default-ignorable code points (ZWJ/ZWNJ, BOM, soft hyphen, bidi overrides, variation selectors, Mongolian/Khmer/Hangul fillers, U+E0100..U+E01EF) and combining marks (Mn/Mc — main U+0300-036F block plus Hebrew/Arabic/Cyrillic/symbol/half-mark ranges), then applies a curated Cyrillic + Greek + IPA-small-capital script-confusables map onto the destructive-verb letter set. Returns "" on empty / non-string input. Fast-path returns the input unchanged when the NFKD result is pure ASCII so the hot path stays branch-light (no strip regex, no fold loop, no allocations). The follow-up hardening landed in 2026-05-13 (see §6.5) replaced the initial NFKC + Cyrillic/Greek fold with this stronger pipeline after a read-only adversarial reconfirmation found five realistic evasions the NFKC arm did not cover.
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

`tests/runtime/command-normalize.test.js` (45 zero-dep `node:assert` cases — 29 in the original stop-the-line PR, +16 in the §6.5 follow-up for precomposed-diacritic, default-ignorable, IPA small-cap, bidi override, and benign-text-regression coverage) pins the §4.2 precedence ladder explicitly. Each alias position has an isolated test; an "intentionally not walked" case asserts `args.args.command` is **not** extracted (parse-surface lockdown).

## 6. Known limitations & follow-up

1. **chmod alone does not BLOCK.** The standalone `chmod 777 /etc/shadow` scores 4 (medium → route) in the current risk weights, regardless of Cyrillic obfuscation. The brief asked for a BLOCK fixture, so `ast-bypass-cyrillic-chmod-enforce` uses the composite `sudo сhmod 777 /etc/shadow` which scores 7 (high → escalate → block in enforce mode) and exercises both the `broad-permission-pattern` regex (after Cyrillic fold) and `privilege-elevation`. Raising the standalone-chmod risk weight is out of scope for this stop-the-line PR.
2. **Adapters `openclaw`, `clawcode`, `codex`, `antegravity`** retain inline `extractCommand` lambdas. They each already cover `cmd` so leak #3 does not apply to them; the `pretool-gate.js` backstop catches nested-form regressions. Consolidating them onto `extractCommand` is a follow-up.
3. **Confusables map** is restricted to the destructive-verb letter set. New destructive-verb additions (e.g. `terraform destroy`) must be reviewed against the map at the time of addition.
4. **Visual-only homoglyph attacks on letters where phonetic and visual interpretation diverge** (e.g. Cyrillic 'р' used as visual `p` in `push`) rely on the raw-arm of dual-path matching to fire on the unobfuscated letters. The relevant fixture uses Cyrillic `і` for `i` in `git`, not Cyrillic `р` for `p` in `push`.

### 6.5 Follow-up hardening (2026-05-13, post-merge of stop-the-line)

A read-only adversarial reconfirmation audit confirmed the original three leaks are closed, but found five realistic Unicode evasions that were not in the original scope and were not yet documented as limitations:

| Evasion | Code points | Root cause |
|---|---|---|
| `ṙm -rf /` | U+1E59 LATIN SMALL LETTER R WITH DOT ABOVE | NFKC composes — the precomposed code point survived as-is |
| `ŕm -rf /` | U+0155 LATIN SMALL LETTER R WITH ACUTE | NFKC composes — same root cause as above |
| `r‍m -rf /` | U+0072 U+200D U+006D (ZWJ) | NFKC does not strip default-ignorable Cf chars |
| `r‌m -rf /` | U+0072 U+200C U+006D (ZWNJ) | same root cause as ZWJ |
| `ʀᴍ -rf /` | U+0280 + U+1D0D (IPA small caps) | small-caps Latin letters are not compatibility chars; not in confusables map |

All five exited 0 (silently allowed) under `LILARA_ENFORCE=1`. The fix is contained to `runtime/command-normalize.js`:

1. **NFKD instead of NFKC** for the verb-recognition arm — precomposed letter+diacritic forms decompose to base + combining mark (e.g. `ṙ → r + U+0307`), which the strip pass then collapses to the bare base.
2. **Default-ignorable strip** — a single linear `String.replace` pass with one precompiled regex removes the Cf-class formatting code points (ZWJ U+200D, ZWNJ U+200C, BOM U+FEFF, soft hyphen U+00AD, bidi overrides U+202A-U+202E, word joiner / invisible operator block U+2060-U+206F, variation selectors U+FE00-U+FE0F + supplement U+E0100-U+E01EF, Mongolian / Khmer / Hangul fillers).
3. **Combining-mark strip** — the same regex collapses Mn/Mc residue from NFKD (U+0300-U+036F main block plus Hebrew, Arabic, Cyrillic, symbol-combining, half-mark, and Combining Diacritical Marks Extended/Supplement ranges).
4. **IPA Small Capital confusables** — the curated map gains the IPA Phonetic Extensions block for the destructive-verb letter set (`ᴀʙᴄᴅᴇꜰɢʜɪᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡ → a..w`). Same scope rule as the Cyrillic/Greek entries: restricted to letters that actually appear in tracked destructive verbs.

The ASCII fast path is preserved — pure-ASCII inputs after NFKD return immediately with no strip, no fold loop, no allocations. `runtime/risk-score.js`, the dual-path matcher, the precedence ladder, and `extractCommand` are unchanged. Five new fixtures under `tests/fixtures/shell-ast/` (`ast-bypass-precomposed-rdot-rm-enforce`, `ast-bypass-precomposed-racute-rm-enforce`, `ast-bypass-zwj-rm-enforce`, `ast-bypass-zwnj-rm-enforce`, `ast-bypass-smallcap-rm-enforce`) pin each evasion; benign-text regression fixtures (`echo 'Привет, мир'`, Greek text, Latin diacritics like `café`) continue to ALLOW. The full test count is now 45 unit cases (was 29) and **302 fixtures** (was 297).

Residual limitations after 6.5:

- **Latin-with-combining-marks → base letter** is a one-way fold. Benign tokens like `café` normalize to `cafe` and `naïve` to `naive` in the verb-recognition arm only; this is fine because no destructive verb regex matches these words and the raw-arm continues to see the original string. If a future destructive verb name collides with a real Latin-with-diacritic word, this will need re-examination.
- **Outside-Latin script confusables** (e.g. Armenian, Coptic, Cherokee, full Hebrew/Arabic look-alike letter sets) are not in the curated map. The threat model assumes the attacker is targeting ASCII destructive-verb regexes via the most common confusables paths; expanding the map further is held back by the false-positive cost on benign multi-script comments.

## 7. Acceptance evidence

- All 3 original brief-attached repro commands and all 5 §6.5 follow-up repros now exit 2 with the BLOCK reason in stderr.
- `bash scripts/run-fixtures.sh` — passing (302 / 302 after §6.5).
- `bash scripts/check-counts.sh` — fixtures: 302.
- `bash scripts/check-fixture-count.sh` — README + CHANGELOG + full-power-status all aligned at 302.
- `bash scripts/check-zero-deps.sh` — passes.
- `node tests/runtime/command-normalize.test.js` — 45 / 45 passing.
- `bash scripts/bench-runtime-decision.sh` — p99 within ceiling. NFKD + strip + fold remain gated by an ASCII fast-path; pure-ASCII inputs cost one linear scan and one string-equality check on `cmdNorm === cmdRaw`.
