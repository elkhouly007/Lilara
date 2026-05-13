#!/usr/bin/env node
"use strict";

// ambient.js — F16 ambient-authority path classifier (PR-A foundation).
//
// Shape-based classifier that identifies file paths which carry AMBIENT
// AUTHORITY outside the project-dir trust boundary. An "ambient authority"
// path is one whose contents are loaded automatically by the operating
// system, shell, version-control system, package manager, IDE, or browser
// at session start — so a write into that path silently grants persistent
// privilege across sessions and projects.
//
// Examples (non-exhaustive):
//   ~/.ssh/id_rsa             — replaces the user's SSH identity
//   ~/.gitconfig              — global git config; hooks run for every repo
//   ~/.bashrc                 — every interactive shell sources this
//   ~/.npmrc                  — every npm command reads this for auth tokens
//   ~/.netrc                  — every curl/git command reads this
//   ~/.docker/config.json     — every docker pull/push reads credentials here
//   ~/.config/Code/User/...   — VS Code reloads on save; settings persist
//   ~/.claude.json            — MCP servers auto-load on every Claude start
//   ~/.mozilla/firefox/...    — browser cookies/session tokens
//   ~/Library/Keychains/...   — OS credential store
//
// Project-local paths (anything under projectRoot) are NOT classified as
// ambient — they live inside the project trust boundary. This module does
// not know projectRoot; callers (in a later PR) intersect the classifier's
// result with a project-membership check before applying any floor.
//
// PR-A scope: classifier only. Pure data. NO decision-engine wiring, NO
// floor predicate, NO default-deny behavior. Later PRs will add:
//   - decision-engine floor reading classifyAmbientPath(target)
//   - contract schema scopes.ambient.allow[] for explicit opt-ins
//   - receipts with ambient-class metadata
//
// Shape-only: classifier operates on the path STRING, not on the host OS.
// All four platform shapes (Linux, macOS, Windows, WSL) are supported as
// path data, so the same module produces stable results regardless of
// where the agent is running. Path comparison is case-insensitive because
// macOS HFS+/APFS and Windows NTFS are case-insensitive by default.
//
// Zero dependencies. Pure. No I/O. No process.env reads.

// ---------------------------------------------------------------------------
// Classes returned by classifyAmbientPath. Stable identifiers — downstream
// floors and receipts will key off these strings.
// ---------------------------------------------------------------------------
const AMBIENT_CLASSES = Object.freeze([
  "ssh",
  "gitConfig",
  "shellRc",
  "packageCache",
  "credentialHelper",
  "ideSettings",
  "mcpConfig",
  "browserProfile",
  "osKeychain",
  "nonAmbient",
]);

// ---------------------------------------------------------------------------
// Normalize the path string for cross-platform pattern matching:
//   - replace backslashes with forward slashes (Windows / mixed)
//   - strip leading file:// URI scheme if present
//   - collapse leading "~/" so the regex anchor lands on /.ssh consistently
//   - trim trailing slash so directory and file forms compare the same
//
// NOTE: we deliberately do NOT path.resolve() — that would inject the host
// process's cwd and break shape-only classification (a path string passed
// from a different agent must classify the same on every host).
// ---------------------------------------------------------------------------
function normalize(targetPath) {
  if (typeof targetPath !== "string" || targetPath.length === 0) return "";
  let s = targetPath.replace(/\\/g, "/");
  s = s.replace(/^file:\/\//i, "");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

// ---------------------------------------------------------------------------
// Pattern table. Each rule is { cls, re }. Ordering matters when patterns
// could plausibly match the same path (e.g. ~/.gnupg matches osKeychain
// before any credentialHelper rule could touch it). The first matching
// rule wins.
//
// Anchors: every pattern uses `(^|/)` to ensure we match a real path
// segment boundary, not an embedded substring. This prevents false hits
// like /project/.sshield/notes.md matching ssh.
//
// All patterns are case-insensitive (i flag). macOS/Windows filesystems
// are case-insensitive by default; on Linux this still classifies the
// canonical lowercased form correctly. Sub-segments like "Code/User"
// are matched against the lowercased lookup.
// ---------------------------------------------------------------------------
const RULES = Object.freeze([
  // -- SSH --
  { cls: "ssh", re: /(^|\/)\.ssh(\/|$)/i },
  { cls: "ssh", re: /(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i },
  { cls: "ssh", re: /(^|\/)(authorized_keys|known_hosts)$/i },
  { cls: "ssh", re: /(^|\/)etc\/ssh(\/|$)/i },

  // -- Global Git config (project-local .git/config is a special case:
  //    a write into .git/config can still register an arbitrary core.hooksPath
  //    that runs on the next git operation in this repo, so we classify it
  //    as gitConfig regardless of project root. Membership is the caller's
  //    job in a later PR.) --
  { cls: "gitConfig", re: /(^|\/)\.gitconfig$/i },
  { cls: "gitConfig", re: /(^|\/)\.config\/git\/config$/i },
  { cls: "gitConfig", re: /(^|\/)etc\/gitconfig$/i },
  { cls: "gitConfig", re: /(^|\/)\.git\/config$/i },

  // -- Shell rc files --
  { cls: "shellRc", re: /(^|\/)\.(bash|zsh|ksh)(rc|_profile|_login|_logout|env)$/i },
  { cls: "shellRc", re: /(^|\/)\.profile$/i },
  { cls: "shellRc", re: /(^|\/)\.zprofile$/i },
  { cls: "shellRc", re: /(^|\/)\.zshenv$/i },
  { cls: "shellRc", re: /(^|\/)\.inputrc$/i },
  { cls: "shellRc", re: /(^|\/)\.config\/fish\/(config\.fish|conf\.d|functions)(\/|$)/i },

  // -- Package manager configs / caches --
  { cls: "packageCache", re: /(^|\/)\.npmrc$/i },
  { cls: "packageCache", re: /(^|\/)\.npm(\/|$)/i },
  { cls: "packageCache", re: /(^|\/)\.yarnrc(\.yml)?$/i },
  { cls: "packageCache", re: /(^|\/)\.pip(\/|$)/i },
  { cls: "packageCache", re: /(^|\/)pip\.conf$/i },
  { cls: "packageCache", re: /(^|\/)\.config\/pip(\/|$)/i },
  { cls: "packageCache", re: /(^|\/)\.cargo\/(config(\.toml)?|credentials(\.toml)?)$/i },
  { cls: "packageCache", re: /(^|\/)\.gemrc$/i },
  { cls: "packageCache", re: /(^|\/)\.gem(\/|$)/i },
  { cls: "packageCache", re: /(^|\/)\.m2\/settings\.xml$/i },
  { cls: "packageCache", re: /(^|\/)\.gradle\/init\.d(\/|$)/i },

  // -- Credential helpers / cloud-CLI token stores --
  { cls: "credentialHelper", re: /(^|\/)\.netrc$/i },
  { cls: "credentialHelper", re: /(^|\/)_netrc$/i },
  { cls: "credentialHelper", re: /(^|\/)\.git-credentials$/i },
  { cls: "credentialHelper", re: /(^|\/)\.docker\/(config\.json|contexts)(\/|$)/i },
  { cls: "credentialHelper", re: /(^|\/)\.aws(\/|$)/i },
  { cls: "credentialHelper", re: /(^|\/)\.config\/gcloud(\/|$)/i },
  { cls: "credentialHelper", re: /(^|\/)\.azure(\/|$)/i },
  { cls: "credentialHelper", re: /(^|\/)\.kube\/config$/i },

  // -- IDE settings (auto-loaded by editor; can register tasks/extensions
  //    that execute on workspace open) --
  { cls: "ideSettings", re: /(^|\/)\.vscode(\/|$)/i },
  { cls: "ideSettings", re: /(^|\/)\.cursor(\/|$)/i },
  { cls: "ideSettings", re: /(^|\/)\.config\/code\/user(\/|$)/i },
  { cls: "ideSettings", re: /(^|\/)library\/application support\/code\/user(\/|$)/i },
  { cls: "ideSettings", re: /(^|\/)appdata\/(roaming|local)\/code\/user(\/|$)/i },
  { cls: "ideSettings", re: /(^|\/)\.idea(\/|$)/i },
  { cls: "ideSettings", re: /(^|\/)\.config\/jetbrains(\/|$)/i },
  { cls: "ideSettings", re: /(^|\/)library\/application support\/jetbrains(\/|$)/i },
  { cls: "ideSettings", re: /(^|\/)appdata\/roaming\/jetbrains(\/|$)/i },

  // -- MCP / agent harness configs (Claude Desktop, Cursor, Cline, Continue,
  //    Codeium). A write here registers new MCP servers that run on next
  //    agent start. --
  { cls: "mcpConfig", re: /(^|\/)\.claude\.json$/i },
  { cls: "mcpConfig", re: /(^|\/)\.claude(\/|$)/i },
  { cls: "mcpConfig", re: /(^|\/)claude_desktop_config\.json$/i },
  { cls: "mcpConfig", re: /(^|\/)\.config\/claude(\/|$)/i },
  { cls: "mcpConfig", re: /(^|\/)library\/application support\/claude(\/|$)/i },
  { cls: "mcpConfig", re: /(^|\/)appdata\/roaming\/claude(\/|$)/i },
  { cls: "mcpConfig", re: /(^|\/)\.continue(\/|$)/i },
  { cls: "mcpConfig", re: /(^|\/)\.codeium(\/|$)/i },
  { cls: "mcpConfig", re: /(^|\/)\.cline(\/|$)/i },

  // -- Browser profiles (cookies, login data, autofill) --
  { cls: "browserProfile", re: /(^|\/)\.mozilla\/firefox(\/|$)/i },
  { cls: "browserProfile", re: /(^|\/)library\/application support\/firefox(\/|$)/i },
  { cls: "browserProfile", re: /(^|\/)appdata\/roaming\/mozilla\/firefox(\/|$)/i },
  { cls: "browserProfile", re: /(^|\/)\.config\/google-chrome(\/|$)/i },
  { cls: "browserProfile", re: /(^|\/)\.config\/chromium(\/|$)/i },
  { cls: "browserProfile", re: /(^|\/)library\/application support\/google\/chrome(\/|$)/i },
  { cls: "browserProfile", re: /(^|\/)appdata\/local\/google\/chrome\/user data(\/|$)/i },
  { cls: "browserProfile", re: /(^|\/)(cookies|login data|web data)$/i },

  // -- OS keychain / credential vaults --
  { cls: "osKeychain", re: /(^|\/)library\/keychains(\/|$)/i },
  { cls: "osKeychain", re: /(^|\/)\.local\/share\/keyrings(\/|$)/i },
  { cls: "osKeychain", re: /(^|\/)\.gnupg(\/|$)/i },
  { cls: "osKeychain", re: /(^|\/)\.password-store(\/|$)/i },
  { cls: "osKeychain", re: /(^|\/)windows\/system32\/config(\/|$)/i },
]);

// ---------------------------------------------------------------------------
// classifyAmbientPath(targetPath) → one of AMBIENT_CLASSES.
//
// Returns "nonAmbient" for empty, non-string, or unmatched inputs. First
// matching rule wins; ordering of RULES is fixed and stable.
// ---------------------------------------------------------------------------
function classifyAmbientPath(targetPath) {
  const p = normalize(targetPath);
  if (!p) return "nonAmbient";
  for (const { cls, re } of RULES) {
    if (re.test(p)) return cls;
  }
  return "nonAmbient";
}

// ---------------------------------------------------------------------------
// Convenience predicate. Equivalent to classifyAmbientPath(p) !== "nonAmbient".
// ---------------------------------------------------------------------------
function isAmbientPath(targetPath) {
  return classifyAmbientPath(targetPath) !== "nonAmbient";
}

module.exports = { classifyAmbientPath, isAmbientPath, AMBIENT_CLASSES };
