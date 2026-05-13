#!/usr/bin/env node
"use strict";

// command-normalize.js — input-normalization spine for command strings.
//
// Two responsibilities:
//
//   1. normalizeCommand(raw)
//      Returns an NFKD-folded, default-ignorable-stripped, combining-mark-
//      stripped, script-confusables-resolved copy of `raw`. Used by
//      risk-score.js as the second arm of a dual-path match against every
//      ASCII destructive-verb regex. Defeats Unicode look-alike bypasses:
//        - script confusables: Cyrillic 'рm' (U+0440 + m), Greek 'ρm'
//        - compatibility forms: full-width 'ｒｍ'
//        - precomposed letter+diacritic: 'ṙm' (U+1E59), 'ŕm' (U+0155)
//        - default-ignorable insertion: 'r' + ZWJ/ZWNJ/BOM/soft-hyphen + 'm'
//        - IPA small-capital letters: 'ʀᴍ' (U+0280 + U+1D0D)
//
//   2. extractCommand(input)
//      Resolves the command field from a PreToolUse payload per the ADR-007
//      §4.2 precedence ladder. First-non-empty-string wins; recursive descent
//      is bounded to one level under `args`. Returns "" when every position
//      is empty or non-string.
//
// Zero dependencies. Pure. Hot path — keep allocations small. ASCII inputs
// take the fast path with a single linear scan and no allocations.
//
// Owned by ADR-008 (Unicode + precedence defense). See
// references/adr-008-unicode-and-precedence-defense.md.

// ---------------------------------------------------------------------------
// Confusables map: non-Latin → Latin for letters that appear in destructive
// verbs (rm, dd, chmod, curl, wget, sudo, mkfs, kubectl, npx, DROP, git,
// push, force, bash, sh).
//
// NFKD (applied first) decomposes precomposed letter+diacritic forms
// (ṙ → r + U+0307, ŕ → r + U+0301, …) and collapses compatibility variants
// (full-width ｒ → r, small-form variants, ligatures). The strip pass that
// follows removes the resulting combining marks and any default-ignorable
// formatting characters. This table therefore only needs to cover script
// confusables NFKD leaves intact — primarily Cyrillic, Greek, and the IPA
// Small Capital Latin Letters block (used by attackers spelling
// destructive verbs in glyphs that look like Latin but have distinct
// code points).
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
  // ── IPA / Phonetic Extensions — Latin Small Capital Letters ─────────────
  // Visually small caps of Latin letters but encoded as distinct code points.
  // NFKD does not fold these onto plain Latin (they are not compatibility
  // characters), so we map them explicitly. Restricted to the destructive-
  // verb letter set (a, b, c, d, e, f, g, h, i, k, l, m, n, o, p, r, s, t,
  // u, v, w) — same scope rule as the Cyrillic/Greek entries.
  "ᴀ": "a", // U+1D00  LATIN LETTER SMALL CAPITAL A
  "ʙ": "b", // U+0299  LATIN LETTER SMALL CAPITAL B
  "ᴄ": "c", // U+1D04  LATIN LETTER SMALL CAPITAL C
  "ᴅ": "d", // U+1D05  LATIN LETTER SMALL CAPITAL D
  "ᴇ": "e", // U+1D07  LATIN LETTER SMALL CAPITAL E
  "ꜰ": "f", // U+A730  LATIN LETTER SMALL CAPITAL F
  "ɢ": "g", // U+0262  LATIN LETTER SMALL CAPITAL G
  "ʜ": "h", // U+029C  LATIN LETTER SMALL CAPITAL H
  "ɪ": "i", // U+026A  LATIN LETTER SMALL CAPITAL I
  "ᴋ": "k", // U+1D0B  LATIN LETTER SMALL CAPITAL K
  "ʟ": "l", // U+029F  LATIN LETTER SMALL CAPITAL L
  "ᴍ": "m", // U+1D0D  LATIN LETTER SMALL CAPITAL M
  "ɴ": "n", // U+0274  LATIN LETTER SMALL CAPITAL N
  "ᴏ": "o", // U+1D0F  LATIN LETTER SMALL CAPITAL O
  "ᴘ": "p", // U+1D18  LATIN LETTER SMALL CAPITAL P
  "ʀ": "r", // U+0280  LATIN LETTER SMALL CAPITAL R
  "ꜱ": "s", // U+A731  LATIN LETTER SMALL CAPITAL S
  "ᴛ": "t", // U+1D1B  LATIN LETTER SMALL CAPITAL T
  "ᴜ": "u", // U+1D1C  LATIN LETTER SMALL CAPITAL U
  "ᴠ": "v", // U+1D20  LATIN LETTER SMALL CAPITAL V
  "ᴡ": "w", // U+1D21  LATIN LETTER SMALL CAPITAL W
});

// ---------------------------------------------------------------------------
// Strip-set: Unicode default-ignorables + combining marks.
//
// Default-ignorable code points (Cf class — ZWJ/ZWNJ, BOM, soft hyphen,
// directional overrides, variation selectors, etc.) defeat the regex
// matchers by inserting zero-width characters between letters of a
// destructive verb ('r' + ZWJ + 'm' renders identically to 'rm' but the
// ASCII regex \brm\b sees two single-letter words).
//
// Combining marks (Mn/Mc) are the NFKD residue of precomposed letter+
// diacritic forms ('ṙ' → 'r' + U+0307). Stripping them after NFKD turns
// 'ṙm' into 'rm' for the verb-recognition arm. We use a single linear
// String.replace pass with a precompiled regex so this stays branch-light.
//
// The set is curated, not the full Unicode property set — it covers the
// ranges that NFKD on Latin letters with diacritics actually produces
// (U+0300-U+036F) plus the directly observed attack vectors (ZWJ/ZWNJ,
// BOM, soft hyphen, variation selectors, bidi overrides) and the wider
// combining ranges for completeness. Restricting the strip set keeps the
// regex small and auditable.
const STRIP_RE = new RegExp(
  // ── Default-ignorables (Cf / Default_Ignorable_Code_Point) ─────────────
  "[" +
    "\\u00AD" +              // SOFT HYPHEN
    "\\u034F" +              // COMBINING GRAPHEME JOINER (Mn but also default-ignorable)
    "\\u061C" +              // ARABIC LETTER MARK
    "\\u115F\\u1160" +       // HANGUL CHOSEONG/JUNGSEONG FILLER
    "\\u17B4\\u17B5" +       // KHMER VOWEL INHERENT AQ/AA
    "\\u180B-\\u180E" +      // MONGOLIAN FREE VARIATION SELECTORS + VOWEL SEPARATOR
    "\\u200B-\\u200F" +      // ZWSP, ZWNJ, ZWJ, LRM, RLM
    "\\u202A-\\u202E" +      // LRE, RLE, PDF, LRO, RLO
    "\\u2060-\\u206F" +      // WORD JOINER, FUNCTION APPLICATION, INVISIBLE TIMES/SEPARATOR, etc.
    "\\u3164" +              // HANGUL FILLER
    "\\uFE00-\\uFE0F" +      // VARIATION SELECTORS 1-16
    "\\uFEFF" +              // ZERO WIDTH NO-BREAK SPACE (BOM)
    "\\uFFA0" +              // HALFWIDTH HANGUL FILLER
    "\\uFFF0-\\uFFF8" +      // unassigned / specials
  // ── Combining marks (Mn / Mc) — main + supplementary blocks ────────────
    "\\u0300-\\u036F" +      // COMBINING DIACRITICAL MARKS
    "\\u0483-\\u0489" +      // Cyrillic combining marks
    "\\u0591-\\u05BD\\u05BF\\u05C1-\\u05C2\\u05C4-\\u05C5\\u05C7" + // Hebrew
    "\\u0610-\\u061A\\u064B-\\u065F\\u0670" +                       // Arabic
    "\\u06D6-\\u06DC\\u06DF-\\u06E4\\u06E7-\\u06E8\\u06EA-\\u06ED" +
    "\\u1AB0-\\u1AFF" +      // COMBINING DIACRITICAL MARKS EXTENDED
    "\\u1DC0-\\u1DFF" +      // COMBINING DIACRITICAL MARKS SUPPLEMENT
    "\\u20D0-\\u20FF" +      // COMBINING DIACRITICAL MARKS FOR SYMBOLS
    "\\uFE20-\\uFE2F" +      // COMBINING HALF MARKS
  "]" +
  // ── Variation Selectors Supplement (U+E0100..U+E01EF) ──────────────────
  // Encoded as the high-surrogate U+DB40 followed by a low surrogate
  // U+DD00..U+DDEF. Default-ignorable; sometimes appended to letters in
  // emoji/text-style modifier sequences. Strip via explicit surrogate pair
  // match rather than the `u` flag so we keep one regex for everything.
  "|\\uDB40[\\uDD00-\\uDDEF]",
  "g"
);

/**
 * NFKD-normalize, strip default-ignorables and combining marks, then fold
 * script-confusables onto ASCII for downstream regex predicates. Returns ""
 * when input is empty/non-string.
 *
 * Hot path: branch-light. ASCII-only inputs take the fast path — one linear
 * scan, no allocations, no regex. Non-ASCII inputs pay one NFKD, one regex
 * replace, and one code-point loop.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeCommand(raw) {
  if (raw === "" || raw == null) return "";
  const s = typeof raw === "string" ? raw : String(raw);
  let nfkd;
  try {
    nfkd = s.normalize("NFKD");
  } catch {
    // String.prototype.normalize throws RangeError on unpaired surrogates.
    // Treat the unfoldable input as raw — the dual-path matcher still tests
    // the original string against destructive-verb regexes.
    nfkd = s;
  }
  // Fast path: pure ASCII after NFKD — no strip, no fold needed.
  let needsFold = false;
  for (let i = 0; i < nfkd.length; i++) {
    if (nfkd.charCodeAt(i) > 0x7f) { needsFold = true; break; }
  }
  if (!needsFold) return nfkd;
  // Slow path: strip default-ignorables + combining marks, then fold.
  const stripped = nfkd.replace(STRIP_RE, "");
  let out = "";
  // Iterate by code-point so any surviving surrogate-pair characters do not
  // get split mid-glyph.
  for (const ch of stripped) {
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
