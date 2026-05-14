#!/usr/bin/env node
"use strict";

// build-f16-adversarial.js — F16 ambient-authority adversarial corpus
// (HAP ADR-009 PR-D). Coverage classes documented in ADR-009 §9.2:
// path-folding evasion, NFKD/homoglyphs, projectRoot escape, IR-fileTargets
// shapes, multi-candidate ordering. Replay-stable, zero-dep, pure data.
//
// Synthetic risky path literals (~/.ssh/authorized_keys, .gitconfig, ...)
// live under tests/fixtures/ because scripts/audit-local.sh scopes out
// fixtures while gating those same literals under scripts/.
//
// Usage: node tests/fixtures/replay-corpus/build-f16-adversarial.js [--out path]

const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");

let outPath = path.join(__dirname, "f16-adversarial.jsonl");
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--out") outPath = path.resolve(process.argv[++i]);
  else if (a.startsWith("--out=")) outPath = path.resolve(a.slice(6));
}

// Isolation harness mirrors build-adversarial.js — see that file for the
// branch-sentinel rationale (replay/isolated-context).
process.env.HORUS_CONTRACT_ENABLED = "0";
process.env.HORUS_TRAJECTORY_WINDOW_MIN = "0";
process.env.HORUS_RATE_LIMIT = "0";
delete process.env.HORUS_KILL_SWITCH;
delete process.env.HORUS_CONTRACT_REQUIRED;
delete process.env.HORUS_F4_DEMOTE_TOKEN;
process.env.HORUS_BRANCH_OVERRIDE = "replay/isolated-context";

const { decide } = require(path.join(root, "runtime", "decision-engine"));
const { build: buildIr } = require(path.join(root, "runtime", "action-ir"));
const { resetCache } = require(path.join(root, "runtime", "session-context"));

// Synthetic projectRoot; non-existent on disk so context-discovery's safeGit
// and findConfig both no-op, but the string anchor is stable for the
// projectRoot-escape cases' _isInsideProject prefix compare.
const PR = "/tmp/horus-f16-adversarial-projectroot";

// Case fields: tag (replay-key), intent (ignored by replay), input (passed
// to decide()/buildIr()), _knownBypass (optional metadata — see ADR §9.4).
const CASES = [
  // 1) Path-folding evasion — F16 fires after classifier normalize.
  { tag: "f16:fold:ssh-backslash-authorized-keys",
    intent: "Windows backslash path to ~/.ssh/authorized_keys must fire F16 after \\\\ → / fold",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "\\home\\user\\.ssh\\authorized_keys",
             file_path: "\\home\\user\\.ssh\\authorized_keys" } },

  { tag: "f16:fold:ssh-fileuri-id-rsa",
    intent: "file:// URI prefix on ~/.ssh/id_rsa must fire F16 after file:// strip",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "file:///home/user/.ssh/id_rsa",
             file_path: "file:///home/user/.ssh/id_rsa" } },

  { tag: "f16:fold:ssh-mixed-slashes-id-rsa",
    intent: "Mixed forward + backslash separators on .ssh/id_rsa must fire F16",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "/home\\user/.ssh/id_rsa",
             file_path: "/home\\user/.ssh/id_rsa" } },

  { tag: "f16:fold:ssh-double-slashes-authorized-keys",
    intent: "Repeated // separators around .ssh segment must still fire F16",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "//home//user//.ssh//authorized_keys",
             file_path: "//home//user//.ssh//authorized_keys" } },

  { tag: "f16:fold:gitconfig-windows-drive-backslash",
    intent: "Windows-style C:\\Users\\u\\.gitconfig must fire F16 (outside any projectRoot)",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "C:\\Users\\u\\.gitconfig",
             file_path: "C:\\Users\\u\\.gitconfig" } },

  { tag: "f16:fold:shellrc-fileuri-bashrc",
    intent: "file:// URI on ~/.bashrc must fire F16 (shellRc class)",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "file:///home/user/.bashrc",
             file_path: "file:///home/user/.bashrc" } },

  { tag: "f16:fold:credhelper-mixed-aws-credentials",
    intent: "Mixed slashes on ~/.aws/credentials must fire F16 (credentialHelper)",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "\\home/user\\.aws/credentials",
             file_path: "\\home/user\\.aws/credentials" } },

  { tag: "f16:fold:mcpconfig-unc-claude-json",
    intent: "UNC \\\\server\\share path to .claude.json must fire F16 (mcpConfig); _f16Abs anchored on \\\\\\\\ form",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "\\\\server\\share\\home\\user\\.claude.json",
             file_path: "\\\\server\\share\\home\\user\\.claude.json" } },

  { tag: "f16:fold:mcpconfig-windows-drive-claude-json",
    intent: "Windows drive C:\\Users\\u\\.claude.json must fire F16 (mcpConfig); drive-letter anchor satisfies _f16Abs",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "C:\\Users\\u\\.claude.json",
             file_path: "C:\\Users\\u\\.claude.json" } },

  { tag: "f16:defer:mcpconfig-bare-backslash-no-anchor",
    intent: "Bare-backslash relative-shape '\\home\\user\\.claude.json' (no /, no \\\\, no C:\\) hits the PR-B v2 shape-defer — engine cannot prove it is OUTSIDE projectRoot, so F16 skips. By-design conservative behavior, locked in as a regression pin.",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "\\home\\user\\.claude.json",
             file_path: "\\home\\user\\.claude.json" } },

  { tag: "f16:fold:idesettings-double-slash-vscode",
    intent: "Double-slash path to ~/.vscode/settings.json (outside projectRoot) must fire F16",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "//home//user//.vscode//settings.json",
             file_path: "//home//user//.vscode//settings.json" } },

  // 2) Homoglyph / NFKD — ASCII-only classifier must NOT reclassify
  //    lookalikes. Suffixes avoid known ssh/git filenames so the
  //    .ssh/.gitconfig segment regex is the only path to classification.
  { tag: "f16:homoglyph:cyrillic-dze-pseudo-ssh-dir",
    intent: "Cyrillic dze (U+0455) in '.ѕsh/notes.txt' must NOT classify as ssh",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "/home/user/.ѕsh/notes.txt",
             file_path: "/home/user/.ѕsh/notes.txt" } },

  { tag: "f16:homoglyph:fullwidth-dot-pseudo-ssh-dir",
    intent: "Fullwidth full-stop (U+FF0E) before 'ssh/notes.txt' must NOT classify as ssh",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "/home/user/．ssh/notes.txt",
             file_path: "/home/user/．ssh/notes.txt" } },

  { tag: "f16:homoglyph:latin-script-g-pseudo-gitconfig",
    intent: "Latin small letter script g (U+0261) replacing 'g' in '.gitconfig' must NOT classify as gitConfig",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "/home/user/.ɡitconfig",
             file_path: "/home/user/.ɡitconfig" } },

  { tag: "f16:homoglyph:ligature-fi-pseudo-gitconfig",
    intent: "Latin small ligature fi (U+FB01) in '.gitconfig' tail must NOT classify as gitConfig",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "/home/user/.gitconﬁg",
             file_path: "/home/user/.gitconﬁg" } },

  // 3) projectRoot escape via `..`/%2e%2e. PR-E (ARG-PRE-D-001/002 closure):
  //    _normAmbientPath collapses `.`/`..` and decodes %2e/%2f before the
  //    _isInsideProject prefix compare, so the project-local exception for
  //    gitConfig/ideSettings can no longer be defeated by `<projectRoot>/../`.
  //    All variants now fire F16 (action=block, floor=ambient-authority).
  { tag: "f16:escape:dotdot-ssh-still-fires",
    intent: "<projectRoot>/../.ssh/id_rsa — ssh has no project-local exception, F16 still fires",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/../.ssh/id_rsa",
             file_path: PR + "/../.ssh/id_rsa" } },

  { tag: "f16:escape:dotdot-credentialhelper-still-fires",
    intent: "<projectRoot>/../.aws/credentials — credentialHelper has no project-local exception, F16 fires",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/../.aws/credentials",
             file_path: PR + "/../.aws/credentials" } },

  { tag: "f16:escape:dotdot-mcpconfig-still-fires",
    intent: "<projectRoot>/../../.claude.json — mcpConfig not in PROJECT_LOCAL set; absolute path, F16 fires",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/../../.claude.json",
             file_path: PR + "/../../.claude.json" } },

  { tag: "f16:escape:dotdot-gitconfig-blocked-PRE-E",
    intent: "PR-E (ARG-PRE-D-001 closed): <projectRoot>/../.gitconfig is collapsed to /.gitconfig before _isInsideProject prefix-compare; project-local exception for gitConfig no longer applies → F16 fires.",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/../.gitconfig",
             file_path: PR + "/../.gitconfig" } },

  { tag: "f16:escape:dotdot-vscode-blocked-PRE-E",
    intent: "PR-E (ARG-PRE-D-001 closed): <projectRoot>/../.vscode/settings.json collapses past projectRoot before prefix-compare; ideSettings project-local exception no longer applies → F16 fires.",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/../.vscode/settings.json",
             file_path: PR + "/../.vscode/settings.json" } },

  { tag: "f16:escape:dotdot-deep-gitconfig-blocked-PRE-E",
    intent: "PR-E (ARG-PRE-D-001 closed): <projectRoot>/.git/../../../etc/gitconfig collapses to /etc/gitconfig before prefix-compare; gitConfig project-local exception no longer applies → F16 fires.",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/.git/../../../etc/gitconfig",
             file_path: PR + "/.git/../../../etc/gitconfig" } },

  { tag: "f16:escape:urlencoded-dotdot-gitconfig-blocked-PRE-E",
    intent: "PR-E (ARG-PRE-D-002 closed): <projectRoot>/%2e%2e/.gitconfig — _normAmbientPath URL-decodes %2e/%2f BEFORE the segment walk, so the encoded escape is collapsed past projectRoot; gitConfig project-local exception no longer applies → F16 fires.",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: PR + "/%2e%2e/.gitconfig",
             file_path: PR + "/%2e%2e/.gitconfig" } },

  // 4) IR-fileTargets shapes. _collectAmbientCandidatePaths must filter
  //    non-string/empty paths gracefully; long paths classify by tail shape.
  { tag: "f16:ir:write-empty-string-path-nonambient",
    intent: "IR fileTargets entry with intent=write and path='' must be filtered, no classification, no crash",
    input: { tool: "Bash", harness: "claude", command: "true", branch: "feature/test", projectRoot: PR,
             targetPath: "/tmp/build.log",
             ir: { irHash: "sha256:f16-adv-ir-empty",
                   fileTargets: [{ intent: "write", path: "" }] } } },

  { tag: "f16:ir:write-non-string-numeric-path-nonambient",
    intent: "IR fileTargets entry with numeric path must be filtered (typeof check), no classification, no crash",
    input: { tool: "Bash", harness: "claude", command: "true", branch: "feature/test", projectRoot: PR,
             targetPath: "/tmp/build.log",
             ir: { irHash: "sha256:f16-adv-ir-numeric",
                   fileTargets: [{ intent: "write", path: 12345 }] } } },

  { tag: "f16:ir:write-very-long-path-still-classifies",
    intent: "IR fileTargets entry with >5kB path containing /.ssh/foo tail must still classify as ssh (no truncation in classifier)",
    input: { tool: "Bash", harness: "claude", command: "true", branch: "feature/test", projectRoot: PR,
             targetPath: "/tmp/build.log",
             ir: { irHash: "sha256:f16-adv-ir-long",
                   fileTargets: [{ intent: "write",
                                   path: "/home/user/" + "padding-segment/".repeat(320) + ".ssh/authorized_keys" }] } } },

  // 5) Multi-candidate ordering — first-match per §8.3 (targetPath →
  //    IR.fileTargets[write|delete] → envelope.targets).
  { tag: "f16:order:targetpath-nonambient-ir-write-ambient-first-ir",
    intent: "targetPath='/tmp/build.log' (nonAmbient) + IR write '~/.bashrc' → first ambient hit is IR, F16 fires on shellRc",
    input: { tool: "Bash", harness: "claude", command: "true", branch: "feature/test", projectRoot: PR,
             targetPath: "/tmp/build.log",
             ir: { irHash: "sha256:f16-adv-ir-multi-ir",
                   fileTargets: [{ intent: "write", path: "/home/user/.bashrc" }] } } },

  { tag: "f16:order:targetpath-ssh-ir-gitconfig-first-targetpath",
    intent: "targetPath='~/.ssh/id_rsa' (ssh) + IR write '~/.gitconfig' → first ambient hit is targetPath, F16 fires on ssh (NOT gitConfig)",
    input: { tool: "Write", harness: "claude", branch: "feature/test", projectRoot: PR,
             targetPath: "/home/user/.ssh/id_rsa",
             file_path: "/home/user/.ssh/id_rsa",
             ir: { irHash: "sha256:f16-adv-ir-multi-target",
                   fileTargets: [{ intent: "write", path: "/home/user/.gitconfig" }] } } },

  { tag: "f16:order:envelope-targets-ambient-after-nonambient-targetpath",
    intent: "targetPath='/tmp/x.log' (nonAmbient) + envelope.targets=[ssh] → envelope candidate fires F16 on ssh",
    input: { tool: "Bash", harness: "claude", command: "true", branch: "feature/test", projectRoot: PR,
             targetPath: "/tmp/x.log",
             envelope: { targets: [{ path: "/home/user/.ssh/id_rsa" }] } } },
];

// Isolation mirrors build-adversarial.js: fresh state dir, resetCache(),
// no ctx.cwd (so action-ir's path.resolve() doesn't inject the host cwd).
function isolatedDecide(input) {
  resetCache();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "arg-f16-adv-"));
  process.env.HORUS_STATE_DIR = stateDir;
  try {
    const ir = buildIr(input, { harness: "claude", tool: input.tool });
    const result = decide(input);
    const expected = {
      action: result.action,
      decisionSource: result.decisionSource,
      floorFired: result.floorFired || null,
      irHash: ir.irHash || null,
    };
    // ADR-009 PR-D: receipt enrichment fields are checked by the unit test
    // (replay-decisions.js currently inspects only the 4 baseline fields).
    // Include them in expected so the corpus pins the full receipt shape.
    if (result.ambientClass) expected.ambientClass = result.ambientClass;
    if (result.ambientPath)  expected.ambientPath  = result.ambientPath;
    return expected;
  } finally {
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const lines = [];
for (const c of CASES) {
  const { tag, intent, input, _knownBypass } = c;
  const expected = isolatedDecide(input);
  const entry = { tag, intent, input, expected };
  if (_knownBypass) entry._knownBypass = _knownBypass;
  lines.push(JSON.stringify(entry));
}

fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} F16 adversarial entries to ${path.relative(root, outPath)}`);
