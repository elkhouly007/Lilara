#!/usr/bin/env node
"use strict";

// ambient.test.js — Zero-dep node:assert tests for F16 PR-A classifier.
//
// Verifies:
//   - 9 ambient classes resolve correctly under Linux / macOS / Windows / WSL
//     path shapes (data-only — host OS independent).
//   - false positives DO NOT trigger an ambient class for plausibly-similar
//     project-local paths (.sshield/, project/.gemini/, etc.).
//   - empty / non-string / unmatched inputs return "nonAmbient".
//   - AMBIENT_CLASSES integrity (frozen, exhaustive, no duplicates).
//
// Run:  node tests/runtime/ambient.test.js

const assert = require("node:assert");
const path = require("node:path");
const { classifyAmbientPath, isAmbientPath, AMBIENT_CLASSES } = require(path.join(
  __dirname, "..", "..", "runtime", "ambient"
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

function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, `${label}: expected '${expected}', got '${actual}'`);
}

// ---------------------------------------------------------------------------
// Defensive inputs
// ---------------------------------------------------------------------------

test("classifyAmbientPath: empty / non-string inputs return nonAmbient", () => {
  eq(classifyAmbientPath(""),           "nonAmbient", "empty string");
  eq(classifyAmbientPath(null),         "nonAmbient", "null");
  eq(classifyAmbientPath(undefined),    "nonAmbient", "undefined");
  eq(classifyAmbientPath(0),            "nonAmbient", "number");
  eq(classifyAmbientPath({}),           "nonAmbient", "object");
  eq(classifyAmbientPath([]),           "nonAmbient", "array");
});

test("isAmbientPath: matches classifyAmbientPath !== nonAmbient", () => {
  assert.strictEqual(isAmbientPath(""),                   false);
  assert.strictEqual(isAmbientPath("./src/app.ts"),       false);
  assert.strictEqual(isAmbientPath("~/.ssh/id_rsa"),      true);
  assert.strictEqual(isAmbientPath("~/.gitconfig"),       true);
});

// ---------------------------------------------------------------------------
// ssh
// ---------------------------------------------------------------------------

test("ssh: linux home", () => {
  eq(classifyAmbientPath("/home/user/.ssh/id_rsa"),               "ssh", "linux id_rsa");
  eq(classifyAmbientPath("/home/user/.ssh/id_ed25519"),           "ssh", "linux ed25519");
  eq(classifyAmbientPath("/home/user/.ssh/authorized_keys"),      "ssh", "authorized_keys");
  eq(classifyAmbientPath("/home/user/.ssh/known_hosts"),          "ssh", "known_hosts");
  eq(classifyAmbientPath("~/.ssh/id_ecdsa.pub"),                  "ssh", "tilde ecdsa.pub");
});

test("ssh: macOS / Windows / WSL shapes", () => {
  eq(classifyAmbientPath("/Users/alice/.ssh/id_rsa"),             "ssh", "macOS");
  eq(classifyAmbientPath("C:\\Users\\bob\\.ssh\\id_rsa"),         "ssh", "Windows");
  eq(classifyAmbientPath("/mnt/c/Users/bob/.ssh/id_rsa"),         "ssh", "WSL");
  eq(classifyAmbientPath("/etc/ssh/sshd_config"),                 "ssh", "system /etc/ssh");
});

// ---------------------------------------------------------------------------
// gitConfig
// ---------------------------------------------------------------------------

test("gitConfig: global gitconfig in home", () => {
  eq(classifyAmbientPath("/home/user/.gitconfig"),                "gitConfig", "linux");
  eq(classifyAmbientPath("/Users/alice/.gitconfig"),              "gitConfig", "macOS");
  eq(classifyAmbientPath("C:\\Users\\bob\\.gitconfig"),           "gitConfig", "Windows");
  eq(classifyAmbientPath("~/.gitconfig"),                         "gitConfig", "tilde");
});

test("gitConfig: XDG and system locations", () => {
  eq(classifyAmbientPath("/home/user/.config/git/config"),        "gitConfig", "XDG");
  eq(classifyAmbientPath("/etc/gitconfig"),                       "gitConfig", "/etc");
});

test("gitConfig: per-repo .git/config (project-local but still gitConfig)", () => {
  // PR-A returns the shape-only class; PR-B will intersect with projectRoot
  // membership before applying any floor. A write to project/.git/config can
  // still register an arbitrary core.hooksPath, so the class is correct.
  eq(classifyAmbientPath("/home/user/project/.git/config"),       "gitConfig", "repo .git/config");
});

// ---------------------------------------------------------------------------
// shellRc
// ---------------------------------------------------------------------------

test("shellRc: bash / zsh / fish rc files", () => {
  eq(classifyAmbientPath("/home/user/.bashrc"),                   "shellRc", "bashrc");
  eq(classifyAmbientPath("/home/user/.bash_profile"),             "shellRc", "bash_profile");
  eq(classifyAmbientPath("/home/user/.bash_logout"),              "shellRc", "bash_logout");
  eq(classifyAmbientPath("/home/user/.zshrc"),                    "shellRc", "zshrc");
  eq(classifyAmbientPath("/home/user/.zshenv"),                   "shellRc", "zshenv");
  eq(classifyAmbientPath("/home/user/.zprofile"),                 "shellRc", "zprofile");
  eq(classifyAmbientPath("/home/user/.profile"),                  "shellRc", "profile");
  eq(classifyAmbientPath("/home/user/.config/fish/config.fish"),  "shellRc", "fish");
  eq(classifyAmbientPath("/home/user/.inputrc"),                  "shellRc", "inputrc");
  eq(classifyAmbientPath("C:\\Users\\bob\\.bashrc"),              "shellRc", "Windows bashrc (Git Bash)");
});

// ---------------------------------------------------------------------------
// packageCache
// ---------------------------------------------------------------------------

test("packageCache: npm / yarn / pip / cargo / gem / maven / gradle", () => {
  eq(classifyAmbientPath("/home/user/.npmrc"),                          "packageCache", "npmrc");
  eq(classifyAmbientPath("/home/user/.npm/_authToken"),                 "packageCache", "npm dir");
  eq(classifyAmbientPath("/home/user/.yarnrc.yml"),                     "packageCache", "yarnrc");
  eq(classifyAmbientPath("/home/user/.pip/pip.conf"),                   "packageCache", "pip dir");
  eq(classifyAmbientPath("/home/user/.config/pip/pip.conf"),            "packageCache", "XDG pip");
  eq(classifyAmbientPath("/home/user/.cargo/config.toml"),              "packageCache", "cargo config");
  eq(classifyAmbientPath("/home/user/.cargo/credentials.toml"),         "packageCache", "cargo creds");
  eq(classifyAmbientPath("/home/user/.gemrc"),                          "packageCache", "gemrc");
  eq(classifyAmbientPath("/home/user/.m2/settings.xml"),                "packageCache", "maven");
  eq(classifyAmbientPath("/home/user/.gradle/init.d/setup.gradle"),     "packageCache", "gradle init.d");
});

// ---------------------------------------------------------------------------
// credentialHelper
// ---------------------------------------------------------------------------

test("credentialHelper: netrc / docker / aws / gcp / azure / kube", () => {
  eq(classifyAmbientPath("/home/user/.netrc"),                          "credentialHelper", "netrc");
  eq(classifyAmbientPath("C:\\Users\\bob\\_netrc"),                     "credentialHelper", "Windows _netrc");
  eq(classifyAmbientPath("/home/user/.git-credentials"),                "credentialHelper", "git-credentials");
  eq(classifyAmbientPath("/home/user/.docker/config.json"),             "credentialHelper", "docker");
  eq(classifyAmbientPath("/home/user/.aws/credentials"),                "credentialHelper", "aws creds");
  eq(classifyAmbientPath("/home/user/.aws/config"),                     "credentialHelper", "aws config");
  eq(classifyAmbientPath("/home/user/.config/gcloud/credentials.db"),   "credentialHelper", "gcloud");
  eq(classifyAmbientPath("/home/user/.azure/credentials"),              "credentialHelper", "azure");
  eq(classifyAmbientPath("/home/user/.kube/config"),                    "credentialHelper", "kube config");
});

// ---------------------------------------------------------------------------
// ideSettings
// ---------------------------------------------------------------------------

test("ideSettings: VS Code / Cursor / JetBrains across platforms", () => {
  eq(classifyAmbientPath("/home/user/.vscode/settings.json"),                                "ideSettings", "linux vscode");
  eq(classifyAmbientPath("/home/user/.config/Code/User/settings.json"),                      "ideSettings", "linux Code User");
  eq(classifyAmbientPath("/Users/alice/Library/Application Support/Code/User/settings.json"),"ideSettings", "macOS Code User");
  eq(classifyAmbientPath("C:\\Users\\bob\\AppData\\Roaming\\Code\\User\\settings.json"),     "ideSettings", "Windows Code User");
  eq(classifyAmbientPath("/home/user/.cursor/extensions"),                                   "ideSettings", "cursor");
  eq(classifyAmbientPath("/home/user/.idea/workspace.xml"),                                  "ideSettings", "JetBrains .idea");
  eq(classifyAmbientPath("/home/user/.config/JetBrains/IdeaIC2024.1/options"),               "ideSettings", "linux JetBrains");
});

// ---------------------------------------------------------------------------
// mcpConfig
// ---------------------------------------------------------------------------

test("mcpConfig: Claude / Continue / Codeium / Cline configs", () => {
  eq(classifyAmbientPath("/home/user/.claude.json"),                                                  "mcpConfig", "linux .claude.json");
  eq(classifyAmbientPath("/home/user/.claude/mcp.json"),                                              "mcpConfig", "linux .claude dir");
  eq(classifyAmbientPath("/Users/alice/Library/Application Support/Claude/claude_desktop_config.json"),"mcpConfig", "macOS Claude Desktop");
  eq(classifyAmbientPath("C:\\Users\\bob\\AppData\\Roaming\\Claude\\claude_desktop_config.json"),     "mcpConfig", "Windows Claude Desktop");
  eq(classifyAmbientPath("/home/user/.continue/config.json"),                                         "mcpConfig", "continue");
  eq(classifyAmbientPath("/home/user/.codeium/config.json"),                                          "mcpConfig", "codeium");
  eq(classifyAmbientPath("/home/user/.cline/settings.json"),                                          "mcpConfig", "cline");
});

// ---------------------------------------------------------------------------
// browserProfile
// ---------------------------------------------------------------------------

test("browserProfile: Firefox / Chrome / Chromium across platforms", () => {
  eq(classifyAmbientPath("/home/user/.mozilla/firefox/abcd.default/cookies.sqlite"),                       "browserProfile", "linux Firefox");
  eq(classifyAmbientPath("/Users/alice/Library/Application Support/Firefox/Profiles/abcd.default"),         "browserProfile", "macOS Firefox");
  eq(classifyAmbientPath("C:\\Users\\bob\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\abc"),              "browserProfile", "Windows Firefox");
  eq(classifyAmbientPath("/home/user/.config/google-chrome/Default/Cookies"),                              "browserProfile", "linux Chrome");
  eq(classifyAmbientPath("/Users/alice/Library/Application Support/Google/Chrome/Default/Login Data"),     "browserProfile", "macOS Chrome");
  eq(classifyAmbientPath("C:\\Users\\bob\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data"),"browserProfile", "Windows Chrome");
  eq(classifyAmbientPath("/home/user/.config/chromium/Default/Web Data"),                                  "browserProfile", "linux Chromium");
});

// ---------------------------------------------------------------------------
// osKeychain
// ---------------------------------------------------------------------------

test("osKeychain: macOS Keychain, Linux keyrings, GnuPG, pass, Windows registry", () => {
  eq(classifyAmbientPath("/Users/alice/Library/Keychains/login.keychain-db"),       "osKeychain", "macOS");
  eq(classifyAmbientPath("/home/user/.local/share/keyrings/default.keyring"),       "osKeychain", "GNOME keyring");
  eq(classifyAmbientPath("/home/user/.gnupg/secring.gpg"),                          "osKeychain", "GnuPG");
  eq(classifyAmbientPath("/home/user/.password-store/work/aws.gpg"),                "osKeychain", "pass");
  eq(classifyAmbientPath("C:\\Windows\\System32\\config\\SYSTEM"),                  "osKeychain", "Windows registry hive");
});

// ---------------------------------------------------------------------------
// nonAmbient — false-positive guards
// ---------------------------------------------------------------------------

test("nonAmbient: ordinary project-relative paths", () => {
  eq(classifyAmbientPath("./src/index.ts"),                       "nonAmbient", "src");
  eq(classifyAmbientPath("./tests/runtime/foo.test.js"),          "nonAmbient", "tests");
  eq(classifyAmbientPath("/tmp/build.log"),                       "nonAmbient", "tmp");
  eq(classifyAmbientPath("./README.md"),                          "nonAmbient", "README");
  eq(classifyAmbientPath("./package.json"),                       "nonAmbient", "package.json");
});

test("nonAmbient: plausibly-similar substrings that must NOT match ambient classes", () => {
  // Embedded substrings must not trigger — the (^|/)…(/|$) anchor prevents this.
  eq(classifyAmbientPath("./project/.sshield/notes.md"),          "nonAmbient", ".sshield (not .ssh)");
  eq(classifyAmbientPath("./project/sshrc-docs.md"),              "nonAmbient", "filename containing 'ssh'");
  eq(classifyAmbientPath("./repo/gitconfig-example.txt"),         "nonAmbient", "no leading dot");
  eq(classifyAmbientPath("./repo/.gitconfig.bak.md"),             "nonAmbient", "trailing extension");
  eq(classifyAmbientPath("./project/bashrc-template"),            "nonAmbient", "no leading dot");
  eq(classifyAmbientPath("./project/.bashrc-template"),           "nonAmbient", "extra suffix after rc");
  eq(classifyAmbientPath("./vendor/.npm-pack/index.js"),          "nonAmbient", ".npm-pack (not .npm)");
  eq(classifyAmbientPath("./project/.netrc.example"),             "nonAmbient", "trailing .example");
  eq(classifyAmbientPath("./project/.aws-sdk-notes.md"),          "nonAmbient", ".aws-sdk (not .aws/)");
  eq(classifyAmbientPath("./project/.dockerignore"),              "nonAmbient", ".dockerignore is not docker config");
});

test("nonAmbient: file:// scheme is stripped, then classified correctly", () => {
  eq(classifyAmbientPath("file:///home/user/.ssh/id_rsa"),        "ssh",        "file URI ssh");
  eq(classifyAmbientPath("file:///tmp/scratch.txt"),              "nonAmbient", "file URI tmp");
});

test("nonAmbient: trailing slash on directory does not change classification", () => {
  eq(classifyAmbientPath("/home/user/.ssh/"),                     "ssh",        "trailing slash ssh dir");
  eq(classifyAmbientPath("/home/user/.aws/"),                     "credentialHelper", "trailing slash aws dir");
  eq(classifyAmbientPath("/home/user/.vscode/"),                  "ideSettings","trailing slash vscode dir");
});

// ---------------------------------------------------------------------------
// Case sensitivity (macOS HFS+/APFS + Windows NTFS are case-insensitive)
// ---------------------------------------------------------------------------

test("case insensitivity: upper / mixed case still classifies correctly", () => {
  eq(classifyAmbientPath("/Users/Alice/.SSH/ID_RSA"),             "ssh",        "all upper macOS");
  eq(classifyAmbientPath("C:\\Users\\BOB\\.GitConfig"),           "gitConfig",  "mixed-case Windows");
  eq(classifyAmbientPath("/Users/alice/Library/Keychains/login.keychain-db"), "osKeychain", "library keychains case");
  eq(classifyAmbientPath("c:\\users\\bob\\appdata\\roaming\\code\\user\\settings.json"), "ideSettings", "all-lower Windows");
});

// ---------------------------------------------------------------------------
// AMBIENT_CLASSES integrity
// ---------------------------------------------------------------------------

test("AMBIENT_CLASSES: exhaustive and frozen", () => {
  const expected = [
    "ssh", "gitConfig", "shellRc", "packageCache", "credentialHelper",
    "ideSettings", "mcpConfig", "browserProfile", "osKeychain", "nonAmbient",
  ];
  assert.deepStrictEqual(Array.from(AMBIENT_CLASSES), expected, "class list");
  assert.ok(Object.isFrozen(AMBIENT_CLASSES), "AMBIENT_CLASSES must be frozen");
});

test("AMBIENT_CLASSES: every returned class is in the declared set", () => {
  const declared = new Set(AMBIENT_CLASSES);
  // Sample one path per class plus an unmatched one — verify each class id
  // returned by the classifier is in the declared frozen list.
  const samples = [
    "~/.ssh/id_rsa",
    "~/.gitconfig",
    "~/.bashrc",
    "~/.npmrc",
    "~/.netrc",
    "~/.vscode/settings.json",
    "~/.claude.json",
    "~/.mozilla/firefox/profiles.ini",
    "~/.gnupg/secring.gpg",
    "./src/main.ts",
  ];
  for (const s of samples) {
    const cls = classifyAmbientPath(s);
    assert.ok(declared.has(cls), `class '${cls}' from '${s}' not in AMBIENT_CLASSES`);
  }
});

// ---------------------------------------------------------------------------
// Cross-platform stability
// ---------------------------------------------------------------------------

test("cross-platform: same logical path classifies the same on every shape", () => {
  // Backslash and forward-slash forms of the same path must agree.
  eq(classifyAmbientPath("C:\\Users\\bob\\.ssh\\id_rsa"),    "ssh", "Windows backslash");
  eq(classifyAmbientPath("C:/Users/bob/.ssh/id_rsa"),         "ssh", "Windows forward slash");
  eq(classifyAmbientPath("/c/Users/bob/.ssh/id_rsa"),         "ssh", "Git Bash mount");
  eq(classifyAmbientPath("/mnt/c/Users/bob/.ssh/id_rsa"),     "ssh", "WSL mount");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
