"use strict";

const { execFileSync } = require("child_process");

// ---------------------------------------------------------------------------
// vcs-adapter.js
// VCS-agnostic abstraction layer. Detects the active VCS environment from
// environment variables and provides a consistent branch/diff interface
// across GitHub Actions, GitLab CI, Bitbucket Pipelines, and local git.
// ---------------------------------------------------------------------------

// Detect the active CI/VCS environment.
// Returns: "github" | "gitlab" | "bitbucket" | "local"
function detectVcs() {
  if (process.env.GITHUB_ACTIONS === "true") return "github";
  if (process.env.GITLAB_CI === "true")      return "gitlab";
  if (process.env.BITBUCKET_BUILD_NUMBER)    return "bitbucket";
  return "local";
}

// Get the current branch name from CI env vars or git.
// Returns empty string if unavailable.
function getCurrentBranch(opts = {}) {
  const override = String(process.env.LILARA_BRANCH_OVERRIDE || "").trim();
  if (override) return override;

  const vcs = detectVcs();

  if (vcs === "github") {
    const ref = String(process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "").trim();
    if (ref) return ref;
  }
  if (vcs === "gitlab") {
    const ref = String(process.env.CI_COMMIT_REF_NAME || "").trim();
    if (ref) return ref;
  }
  if (vcs === "bitbucket") {
    const ref = String(process.env.BITBUCKET_BRANCH || "").trim();
    if (ref) return ref;
  }

  // Fall back to git
  const cwd = opts.cwd || process.cwd();
  return safeGitBranch(cwd);
}

// Get the list of protected branches.
// CI environments expose base/target branch; local uses config or defaults.
function getProtectedBranches(opts = {}) {
  const vcs = detectVcs();
  const defaults = ["main", "master"];

  if (vcs === "github") {
    const base = process.env.GITHUB_BASE_REF;
    if (base) return [...new Set([base, ...defaults])];
  }
  if (vcs === "gitlab") {
    const base = process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
    if (base) return [...new Set([base, ...defaults])];
  }
  if (vcs === "bitbucket") {
    const base = process.env.BITBUCKET_PR_DESTINATION_BRANCH;
    if (base) return [...new Set([base, ...defaults])];
  }

  // Try lilara.config.json
  const fs   = require("fs");
  const path = require("path");
  try {
    const cfgPath = path.join(opts.cwd || process.cwd(), "lilara.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (Array.isArray(cfg.runtime && cfg.runtime.protected_branches)) {
      return cfg.runtime.protected_branches;
    }
  } catch { /* no config */ }

  return defaults;
}

// Get a diff summary for the current branch vs. base.
// Returns the output of `git diff --stat` or empty string if unavailable.
function getDiffSummary(opts = {}) {
  const vcs    = detectVcs();
  const cwd    = opts.cwd || process.cwd();

  let baseSha  = "";

  if (vcs === "github") {
    baseSha = String(process.env.GITHUB_BASE_SHA || "").trim();
  } else if (vcs === "gitlab") {
    baseSha = String(process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA || "").trim();
  } else if (vcs === "bitbucket") {
    baseSha = String(process.env.BITBUCKET_PR_DESTINATION_COMMIT || "").trim();
  }

  const diffArgs = baseSha
    ? ["diff", "--stat", baseSha + "...HEAD"]
    : ["diff", "--stat", "origin/main...HEAD"];

  try {
    return execFileSync("git", diffArgs, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 3000,
    }).trim();
  } catch {
    return "";
  }
}

// Internal: resolve branch name from git.
function safeGitBranch(cwd) {
  try {
    const symbolic = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 1500,
    }).trim();
    if (symbolic) return symbolic;
  } catch { /* detached HEAD or not a git repo */ }

  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 1500,
    }).trim();
  } catch { return ""; }
}

module.exports = { detectVcs, getCurrentBranch, getProtectedBranches, getDiffSummary };
