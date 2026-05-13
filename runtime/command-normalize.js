#!/usr/bin/env node
"use strict";

// command-normalize.js — input-normalization spine for command strings.
//
// Two responsibilities:
//
//   1. normalizeCommand(raw)
//      Returns an NFKC-folded, script-confusables-resolved copy of `raw`.
//      Used by risk-score.js as the second arm of a dual-path match against
//      every ASCII destructive-verb regex. Defeats Unicode look-alike bypasses
//      such as Cyrillic 'рm' (U+0440 + m) or full-width 'ｒｍ' that slip past
//      ASCII-only regexes like /\brm\b/.
//
//   2. extractCommand(input)
//      Resolves the command field from a PreToolUse payload per the ADR-007
//      §4.2 precedence ladder. First-non-empty-string wins; recursive descent
//      is bounded to one level under `args`. Returns "" when every position
//      is empty or non-string.
//
// Zero dependencies. Pure. Hot path — keep allocations small.
// Owned by ADR-008 (Unicode + precedence defense). See
// references/adr-008-unicode-and-precedence-defense.md.

// ---------------------------------------------------------------------------
// Confusables map: non-Latin → Latin for letters that appear in destructive
// verbs (rm, dd, chmod, curl, wget, sudo, mkfs, kubectl, npx, DROP, git,
// push, force, bash, sh, sudo).
//
// NFKC (applied first) collapses full-width Latin (ｒ → r), small-form
// compatibility variants, and ligatures, so this table only needs to cover
// script-confusables NFKC leaves intact — primarily Cyrillic and Greek.
//
// Mapping convention (ADR-008 §3): when a Cyrillic or Greek letter has a
// PHONETIC interpretation that differs from its VISUAL look-alike, we map
// to the phonetic equivalent. The canonical example is Cyrillic 'р'
// (U+0440 "er") which visually resembles Latin 'p' but encodes /r/ in
// Cyrillic. Attackers transliterating Latin words into Cyrillic to dodge
// ASCII regexes hit the phonetic mapping ('рm' → 'rm'), and dual-path
// matching in risk-score.js still tests the raw string so VISUAL-only
// substitutions on non-target letters do not silently bypass.
const CONFUSABLES = Object.freeze({
  // ── Cyrillic lowercase ──────────────────────────────────────────────────
  "а": "a", // а  CYRILLIC SMALL LETTER A
  "с": "c", // с  CYRILLIC SMALL LETTER ES
  "ԁ": "d", // ԁ  CYRILLIC SMALL LETTER KOMI DE
  "е": "e", // е  CYRILLIC SMALL LETTER IE
  "һ": "h", // һ  CYRILLIC SMALL LETTER SHHA
  "і": "i", // і  CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I
  "ј": "j", // ј  CYRILLIC SMALL LETTER JE
  "к": "k", // к  CYRILLIC SMALL LETTER KA
  "ӏ": "l", // ӏ  CYRILLIC SMALL LETTER PALOCHKA
  "о": "o", // о  CYRILLIC SMALL LETTER O
  "р": "r", // р  CYRILLIC SMALL LETTER ER  (phonetic /r/; see header)
  "ѕ": "s", // ѕ  CYRILLIC SMALL LETTER DZE
  "т": "t", // т  CYRILLIC SMALL LETTER TE
  "х": "x", // х  CYRILLIC SMALL LETTER HA
  // ── Cyrillic uppercase ──────────────────────────────────────────────────
  "А": "A", // А
  "В": "B", // В
  "С": "C", // С
  "Е": "E", // Е
  "Н": "H", // Н
  "І": "I", // І
  "Ј": "J", // Ј
  "К": "K", // К
  "М": "M", // М
  "О": "O", // О
  "Р": "R", // Р  (phonetic /R/; parallel to lowercase mapping)
  "Ѕ": "S", // Ѕ
  "Т": "T", // Т
  "Х": "X", // Х
  // ── Greek lowercase ─────────────────────────────────────────────────────
  "α": "a", // α
  "ε": "e", // ε
  "ι": "i", // ι
  "κ": "k", // κ
  "ο": "o", // ο
  "ρ": "r", // ρ  (rho — phonetic /r/)
  "τ": "t", // τ
  "υ": "u", // υ
  "χ": "x", // χ
  // ── Greek uppercase ─────────────────────────────────────────────────────
  "Α": "A", // Α
  "Β": "B", // Β
  "Ε": "E", // Ε
  "Η": "H", // Η
  "Ι": "I", // Ι
  "Κ": "K", // Κ
  "Μ": "M", // Μ
  "Ν": "N", // Ν
  "Ο": "O", // Ο
  "Ρ": "R", // Ρ  (phonetic /R/)
  "Τ": "T", // Τ
  "Υ": "Y", // Υ
  "Χ": "X", // Χ
});

/**
 * NFKC-normalize, then fold script-confusables onto ASCII for downstream
 * regex predicates. Returns "" when input is empty/non-string.
 *
 * Hot path: branch-light, no regex, single pass over the NFKC string.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeCommand(raw) {
  if (raw === "" || raw == null) return "";
  const s = typeof raw === "string" ? raw : String(raw);
  let nfkc;
  try {
    nfkc = s.normalize("NFKC");
  } catch {
    // String.prototype.normalize throws RangeError on unpaired surrogates.
    // Treat the unfoldable input as raw — the dual-path matcher still tests
    // the original string against destructive-verb regexes.
    nfkc = s;
  }
  // Fast path: pure ASCII after NFKC — no folding needed.
  let needsFold = false;
  for (let i = 0; i < nfkc.length; i++) {
    if (nfkc.charCodeAt(i) > 0x7f) { needsFold = true; break; }
  }
  if (!needsFold) return nfkc;
  let out = "";
  // Iterate by code-point so surrogate-pair characters do not get split.
  for (const ch of nfkc) {
    const mapped = CONFUSABLES[ch];
    out += mapped !== undefined ? mapped : ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Command field extraction — ADR-007 §4.2 precedence ladder.
//
// First-non-empty-string wins in this order:
//   1.  input.command
//   2.  input.cmd
//   3.  input.tool_input.command
//   4.  input.tool_input.cmd
//   5.  input.input.command
//   6.  input.input.cmd
//   7.  input.args.command
//   8.  input.args.cmd
//   9.  input.args.tool_input.command
//   10. input.args.tool_input.cmd
//   11. input.args.input.command
//   12. input.args.input.cmd
//
// "Recursive descent at most one level under `args`" per ADR-008. Anything
// deeper is the caller's responsibility — the engine refuses to walk an
// arbitrary nested payload because that broadens the parse surface.
// ---------------------------------------------------------------------------

function _str(v) {
  return typeof v === "string" ? v : "";
}

function extractCommand(input) {
  if (input == null || typeof input !== "object") return "";
  const args      = input.args      != null && typeof input.args      === "object" ? input.args      : null;
  const tool      = input.tool_input != null && typeof input.tool_input === "object" ? input.tool_input : null;
  const inner     = input.input     != null && typeof input.input     === "object" ? input.input     : null;
  const argsTool  = args && args.tool_input != null && typeof args.tool_input === "object" ? args.tool_input : null;
  const argsInner = args && args.input     != null && typeof args.input     === "object" ? args.input     : null;

  const ordered = [
    _str(input.command),
    _str(input.cmd),
    tool      ? _str(tool.command)      : "",
    tool      ? _str(tool.cmd)          : "",
    inner     ? _str(inner.command)     : "",
    inner     ? _str(inner.cmd)         : "",
    args      ? _str(args.command)      : "",
    args      ? _str(args.cmd)          : "",
    argsTool  ? _str(argsTool.command)  : "",
    argsTool  ? _str(argsTool.cmd)      : "",
    argsInner ? _str(argsInner.command) : "",
    argsInner ? _str(argsInner.cmd)     : "",
  ];
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i]) return ordered[i];
  }
  return "";
}

module.exports = { normalizeCommand, extractCommand, CONFUSABLES };
