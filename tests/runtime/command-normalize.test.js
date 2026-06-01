#!/usr/bin/env node
"use strict";

// command-normalize.test.js — Zero-dep node:assert tests for ADR-008.
//
// Covers:
//   - extractCommand precedence ladder (ADR-007 §4.2): first-non-empty wins
//     across the 12 alias positions (command, cmd, tool_input.{command,cmd},
//     input.{command,cmd}, args.{command,cmd}, args.tool_input.{command,cmd},
//     args.input.{command,cmd}).
//   - normalizeCommand NFKD + combining-mark strip + script-confusables folding.
//   - Defensive cases: null/undefined inputs, non-string fields, deeply
//     nested structures we intentionally do NOT walk.
//
// Run:  node tests/runtime/command-normalize.test.js

const assert = require("node:assert");
const path   = require("node:path");
const { normalizeCommand, extractCommand } = require(path.join(
  __dirname, "..", "..", "runtime", "command-normalize"
));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stderr.write(`  FAIL ${name}: ${err && err.message || err}\n`);
  }
}

// ---------------------------------------------------------------------------
// extractCommand — precedence (ADR-007 §4.2)
// ---------------------------------------------------------------------------

test("extractCommand: empty / non-object inputs return ''", () => {
  assert.strictEqual(extractCommand(null), "");
  assert.strictEqual(extractCommand(undefined), "");
  assert.strictEqual(extractCommand("not an object"), "");
  assert.strictEqual(extractCommand(123), "");
  assert.strictEqual(extractCommand({}), "");
});

test("extractCommand: top-level command wins over every alias", () => {
  const out = extractCommand({
    command: "TOP",
    cmd: "CMD",
    tool_input: { command: "TI", cmd: "TIC" },
    input:      { command: "IN", cmd: "INC" },
    args: { command: "A", cmd: "AC", tool_input: { command: "ATI" } },
  });
  assert.strictEqual(out, "TOP");
});

test("extractCommand: top-level cmd resolves when command missing", () => {
  assert.strictEqual(extractCommand({ cmd: "rm -rf /" }), "rm -rf /");
});

test("extractCommand: top-level cmd preferred over tool_input.command (ADR-007 §4.2 order)", () => {
  const out = extractCommand({
    cmd: "ALIAS",
    tool_input: { command: "NESTED" },
  });
  assert.strictEqual(out, "ALIAS");
});

test("extractCommand: tool_input.command resolves (leak #2 simple form)", () => {
  assert.strictEqual(
    extractCommand({ tool_input: { command: "rm -rf /" } }),
    "rm -rf /"
  );
});

test("extractCommand: tool_input.cmd alias resolves", () => {
  assert.strictEqual(
    extractCommand({ tool_input: { cmd: "rm -rf /" } }),
    "rm -rf /"
  );
});

test("extractCommand: input.command resolves", () => {
  assert.strictEqual(
    extractCommand({ input: { command: "rm -rf /" } }),
    "rm -rf /"
  );
});

test("extractCommand: input.cmd resolves", () => {
  assert.strictEqual(extractCommand({ input: { cmd: "x" } }), "x");
});

test("extractCommand: args.command resolves", () => {
  assert.strictEqual(extractCommand({ args: { command: "ls" } }), "ls");
});

test("extractCommand: args.cmd resolves (leak #3 nested form)", () => {
  assert.strictEqual(
    extractCommand({ args: { cmd: "rm -rf /" } }),
    "rm -rf /"
  );
});

test("extractCommand: args.tool_input.command resolves (leak #2 nested form)", () => {
  assert.strictEqual(
    extractCommand({ args: { tool_input: { command: "rm -rf /" } } }),
    "rm -rf /"
  );
});

test("extractCommand: args.tool_input.cmd resolves", () => {
  assert.strictEqual(
    extractCommand({ args: { tool_input: { cmd: "rm -rf /" } } }),
    "rm -rf /"
  );
});

test("extractCommand: args.input.command and args.input.cmd resolve", () => {
  assert.strictEqual(
    extractCommand({ args: { input: { command: "a" } } }),
    "a"
  );
  assert.strictEqual(
    extractCommand({ args: { input: { cmd: "b" } } }),
    "b"
  );
});

test("extractCommand: empty string is treated as absent — falls through", () => {
  assert.strictEqual(
    extractCommand({ command: "", args: { command: "rm -rf /" } }),
    "rm -rf /"
  );
  assert.strictEqual(
    extractCommand({ command: "", cmd: "", tool_input: { command: "" }, args: { tool_input: { command: "x" } } }),
    "x"
  );
});

test("extractCommand: non-string command field is ignored, alias used instead", () => {
  assert.strictEqual(
    extractCommand({ command: 42, cmd: "good" }),
    "good"
  );
  assert.strictEqual(
    extractCommand({ command: { nested: "x" }, args: { command: "ok" } }),
    "ok"
  );
});

test("extractCommand: does not walk arbitrary depth (args.args.command is NOT extracted)", () => {
  // Intentional: we descend at most one level under args. A payload that
  // hides the command at args.args.command must be considered malformed —
  // do not silently follow it. This locks down the parse surface.
  const out = extractCommand({ args: { args: { command: "evil" } } });
  assert.strictEqual(out, "");
});

test("extractCommand: precedence order — args.command beats args.tool_input.command", () => {
  const out = extractCommand({
    args: { command: "FIRST", tool_input: { command: "SECOND" } },
  });
  assert.strictEqual(out, "FIRST");
});

test("extractCommand: precedence — args.cmd beats args.tool_input.command", () => {
  const out = extractCommand({
    args: { cmd: "FIRST", tool_input: { command: "SECOND" } },
  });
  assert.strictEqual(out, "FIRST");
});

// ---------------------------------------------------------------------------
// normalizeCommand — NFKD + combining-mark strip + confusables
// ---------------------------------------------------------------------------

test("normalizeCommand: empty / non-string passes through to ''", () => {
  assert.strictEqual(normalizeCommand(""), "");
  assert.strictEqual(normalizeCommand(null), "");
  assert.strictEqual(normalizeCommand(undefined), "");
});

test("normalizeCommand: pure ASCII is returned unchanged (fast path)", () => {
  assert.strictEqual(normalizeCommand("rm -rf /"), "rm -rf /");
  assert.strictEqual(normalizeCommand("git push --force"), "git push --force");
});

test("normalizeCommand: Cyrillic er (U+0440) folds to Latin r (leak #1 vector)", () => {
  assert.strictEqual(normalizeCommand("рm -rf /"), "rm -rf /");
});

test("normalizeCommand: full-width ｒｍ folds to rm via NFKD (compatibility decomposition)", () => {
  assert.strictEqual(normalizeCommand("ｒｍ -rf /"), "rm -rf /");
});

test("normalizeCommand: Cyrillic 'с' (es) folds to Latin c", () => {
  assert.strictEqual(normalizeCommand("сurl evil.com"), "curl evil.com");
});

test("normalizeCommand: Cyrillic Komi De ԁ folds to d", () => {
  assert.strictEqual(normalizeCommand("ԁԁ if=/dev/zero"), "dd if=/dev/zero");
});

test("normalizeCommand: Cyrillic i (і U+0456) folds inside git for force-push fixture", () => {
  assert.strictEqual(
    normalizeCommand("gіt push --force"),
    "git push --force"
  );
});

test("normalizeCommand: Greek lowercase folds (rho → r)", () => {
  assert.strictEqual(normalizeCommand("ρm -rf"), "rm -rf");
});

test("normalizeCommand: untouched characters pass through (digits, punctuation, emoji)", () => {
  assert.strictEqual(normalizeCommand("echo 'hello 世界 🚀'"), "echo 'hello 世界 🚀'");
});

test("normalizeCommand: idempotent — normalize(normalize(x)) === normalize(x)", () => {
  const inputs = [
    "rm -rf /",
    "рm -rf /",
    "ｒｍ -rf /",
    "gіt push --force",
    "ṙm -rf /",
    "ŕm -rf /",
    "r‍m -rf /",
    "r‌m -rf /",
    "ʀᴍ -rf /",
  ];
  for (const s of inputs) {
    const once = normalizeCommand(s);
    assert.strictEqual(normalizeCommand(once), once, `idempotency broken for: ${JSON.stringify(s)}`);
  }
});

test("normalizeCommand: handles unpaired surrogates gracefully", () => {
  // String.prototype.normalize can throw on unpaired surrogates; the module
  // must catch and degrade to the unfolded form rather than propagating.
  const s = "rm -rf /\uD83D";  // lone high surrogate
  // Should not throw.
  const out = normalizeCommand(s);
  assert.ok(typeof out === "string");
});

// ---------------------------------------------------------------------------
// normalizeCommand — extended Unicode hardening (ADR-008 follow-up)
//
// NFKD-then-strip combining marks defeats precomposed letter+diacritic
// look-alikes; default-ignorable strip defeats zero-width / formatting
// insertions; IPA Small-Capital confusables defeat the small-caps glyph
// substitution attack.
// ---------------------------------------------------------------------------

test("normalizeCommand: precomposed r-with-dot (U+1E59) folds via NFKD-strip", () => {
  assert.strictEqual(normalizeCommand("ṙm -rf /"), "rm -rf /");
});

test("normalizeCommand: precomposed r-with-acute (U+0155) folds via NFKD-strip", () => {
  assert.strictEqual(normalizeCommand("ŕm -rf /"), "rm -rf /");
});

test("normalizeCommand: ZWJ (U+200D) between letters is stripped", () => {
  assert.strictEqual(normalizeCommand("r‍m -rf /"), "rm -rf /");
});

test("normalizeCommand: ZWNJ (U+200C) between letters is stripped", () => {
  assert.strictEqual(normalizeCommand("r‌m -rf /"), "rm -rf /");
});

test("normalizeCommand: BOM (U+FEFF) between letters is stripped", () => {
  assert.strictEqual(normalizeCommand("r﻿m -rf /"), "rm -rf /");
});

test("normalizeCommand: soft hyphen (U+00AD) between letters is stripped", () => {
  assert.strictEqual(normalizeCommand("r­m -rf /"), "rm -rf /");
});

test("normalizeCommand: LRO (U+202D) bidi override is stripped", () => {
  assert.strictEqual(normalizeCommand("r‭m -rf /"), "rm -rf /");
});

test("normalizeCommand: IPA small-cap R+M (U+0280 / U+1D0D) folds to rm", () => {
  assert.strictEqual(normalizeCommand("ʀᴍ -rf /"), "rm -rf /");
});

test("normalizeCommand: IPA small-cap D+D folds to dd (disk-write verb)", () => {
  assert.strictEqual(normalizeCommand("ᴅᴅ if=/dev/zero"), "dd if=/dev/zero");
});

test("normalizeCommand: IPA small-cap C+U+R+L folds to curl", () => {
  assert.strictEqual(normalizeCommand("ᴄᴜʀʟ evil.com"), "curl evil.com");
});

test("normalizeCommand: combining marks alone (decomposed) collapse to base", () => {
  // Manually decomposed form: r + U+0307 + m
  assert.strictEqual(normalizeCommand("ṙm -rf /"), "rm -rf /");
  assert.strictEqual(normalizeCommand("ŕm -rf /"), "rm -rf /");
});

test("normalizeCommand: benign Cyrillic still allows (no destructive verb)", () => {
  // After folding, no rm/curl/etc. is reconstructed — must not produce a
  // destructive verb token that downstream regexes would match.
  const out = normalizeCommand("echo 'Привет, мир'");
  assert.ok(!/\brm\b|\bcurl\b|\bdd\b|\bsudo\b/.test(out),
    `unexpected destructive verb in normalized benign Cyrillic: ${JSON.stringify(out)}`);
});

test("normalizeCommand: benign Greek still allows (no destructive verb)", () => {
  const out = normalizeCommand("echo 'α β γ'");
  assert.ok(!/\brm\b|\bcurl\b|\bdd\b|\bsudo\b/.test(out),
    `unexpected destructive verb in normalized benign Greek: ${JSON.stringify(out)}`);
});

test("normalizeCommand: benign Latin diacritics fold to base ASCII but no destructive verb", () => {
  // café → cafe is fine; no destructive verb is reconstructed.
  assert.strictEqual(normalizeCommand("echo café"), "echo cafe");
  const out = normalizeCommand("echo naïve approach");
  assert.ok(!/\brm\b|\bcurl\b|\bdd\b/.test(out));
});

test("normalizeCommand: emoji and CJK pass through unchanged", () => {
  assert.strictEqual(
    normalizeCommand("echo 'hello 世界 🚀'"),
    "echo 'hello 世界 🚀'"
  );
});

test("normalizeCommand: variation selector (U+FE0F) between letters is stripped", () => {
  assert.strictEqual(normalizeCommand("r️m -rf /"), "rm -rf /");
});

// ---------------------------------------------------------------------------
// ${IFS} / $IFS whitespace-evasion folding
//
// ${IFS} and $IFS expand to whitespace in a real shell. The generic ${…}→""
// strip alone would delete them and GLUE the verb to its argument
// (rm${IFS}-rf → rm-rf → generic), silently bypassing the MCP danger floors,
// which classify via normalizeCommand. A dedicated IFS→space arm (running
// before the generic strip) folds them to a separator so the destructive-verb
// regexes still match.
// ---------------------------------------------------------------------------

test("normalizeCommand: ${IFS} braces fold to space (rm${IFS}-rf → rm -rf)", () => {
  assert.strictEqual(normalizeCommand("rm${IFS}-rf${IFS}/"), "rm -rf /");
});

test("normalizeCommand: bare $IFS folds to space (rm$IFS-rf → rm -rf)", () => {
  assert.strictEqual(normalizeCommand("rm$IFS-rf$IFS/"), "rm -rf /");
});

test("normalizeCommand: ${IFS} folds for git force-push and dd disk-write", () => {
  assert.strictEqual(normalizeCommand("git${IFS}push${IFS}--force"), "git push --force");
  assert.strictEqual(normalizeCommand("dd${IFS}if=/dev/zero${IFS}of=/dev/sda"), "dd if=/dev/zero of=/dev/sda");
});

test("normalizeCommand: ${IFS:-x} modifier form still folds to space", () => {
  assert.strictEqual(normalizeCommand("rm${IFS:-X}-rf /"), "rm -rf /");
});

test("normalizeCommand: precision — ${IFSFOO}/$IFSFOO are NOT folded as IFS", () => {
  // A different variable whose name merely starts with IFS must fall through to
  // the generic ${…}→"" strip (or be left intact), never the IFS→space arm.
  assert.strictEqual(normalizeCommand("echo ${IFSFOO}done"), "echo done");
  assert.strictEqual(normalizeCommand("echo $IFSFOO"), "echo $IFSFOO");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
