#!/usr/bin/env node
/**
 * commit-validator.js — Lilara  (PostToolUse hook, Bash only)
 *
 * Fires after Bash tool use. Detects completed `git commit` commands and
 * validates their message against Conventional Commits rules:
 *   - Subject line follows `type(scope)?: description` format
 *   - Subject line is ≤ 72 characters
 *   - Message does not start with "WIP" on a protected branch
 *
 * On violation: logs F22_COMMIT_FORMAT_VIOLATION and emits coaching on stderr.
 * This is observation-only — the commit has already landed; the hook coaches
 * the author to fix it via `git commit --amend` before pushing.
 *
 * SAFETY CONTRACT:
 * - Reads JSON from stdin.
 * - Echoes original input to stdout UNCHANGED.
 * - Writes coaching to stderr only.
 * - Reads only command string from tool_input — no file content.
 * - No external packages, no network calls.
 * - Silent fail on errors.
 */

"use strict";

const { readStdin, commandFrom, hookLog } = require("./hook-utils");

// Conventional Commits subject pattern — allows optional scope and breaking `!`
const CONV_COMMIT_RE =
  /^(feat|fix|chore|docs|style|refactor|test|build|ci|perf|revert)(\([^)]+\))?!?: .+$/;

const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod", "release"]);

/** Extract the commit message from a git commit command string. */
function extractMessage(command) {
  // Match -m "..." or -m '...' (single-line; multiline commits via heredoc are ignored)
  const dq = command.match(/-m\s+"((?:[^"\\]|\\.)*)"/);
  if (dq) return dq[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  const sq = command.match(/-m\s+'((?:[^'\\]|\\.)*)'/);
  if (sq) return sq[1];
  return null;
}

/** Get current branch name (best-effort). */
function currentBranch() {
  try {
    const { execSync } = require("child_process");
    return execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { encoding: "utf8", timeout: 3000 }).trim();
  } catch { return ""; }
}

readStdin()
  .then((raw) => {
    process.stdout.write(raw || "");
    if (process.env.LILARA_KILL_SWITCH === "1") return;

    try {
      const input = JSON.parse(raw || "{}");
      if (input.tool_name !== "Bash") return;

      const command = commandFrom(input);
      if (!command || !/\bgit\s+commit\b/.test(command)) return;

      const message = extractMessage(command);
      if (!message) return; // heredoc or complex form — skip

      const subject = message.split("\n")[0].trimEnd();
      const violations = [];

      if (!CONV_COMMIT_RE.test(subject)) {
        violations.push(
          `Subject does not follow Conventional Commits.\n` +
          `  Expected: feat|fix|chore|docs|style|refactor|test|build|ci|perf|revert(scope)?: description\n` +
          `  Got:      "${subject}"`
        );
      }

      if (subject.length > 72) {
        violations.push(
          `Subject line is ${subject.length} characters (max 72).\n` +
          `  "${subject.slice(0, 72)}…"`
        );
      }

      if (/^wip\b/i.test(subject)) {
        const branch = currentBranch();
        if (PROTECTED_BRANCHES.has(branch)) {
          violations.push(
            `WIP commit on protected branch "${branch}". Squash or amend before pushing.`
          );
        }
      }

      if (violations.length === 0) return;

      hookLog("commit-validator", "WARN", `F22_COMMIT_FORMAT_VIOLATION violations=${violations.length}`);
      process.stderr.write(
        `[Lilara] F22_COMMIT_FORMAT_VIOLATION — commit message needs attention:\n` +
        violations.map((v) => `  • ${v}`).join("\n") + "\n" +
        `  Fix with: git commit --amend (before pushing)\n`
      );
    } catch {}
  })
  .catch(() => process.exit(0));
