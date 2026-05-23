#!/usr/bin/env node
/**
 * quality-gate.js — Lilara  (PostToolUse hook, Edit/Write only)
 *
 * Fires after Edit or Write tool use on source code files. Reminds the user
 * to run type checking and lint for the relevant language.
 *
 * SAFETY CONTRACT:
 * - Reads JSON from stdin.
 * - Echoes original input to stdout UNCHANGED.
 * - Writes reminders to stderr only.
 * - Reads only `file_path` metadata — never file content.
 * - No external packages, no network calls.
 * - Silent fail on errors.
 */

"use strict";

const path = require("path");
const { readStdin } = require("./hook-utils");

const EDIT_TOOLS = new Set(["Edit", "Write"]);

/**
 * Maps file extension to a check command reminder.
 * Uses local project binaries (./node_modules/.bin/) instead of npx to avoid
 * remote package downloads, consistent with Lilara policy.
 */
const EXT_COMMANDS = {
  ".ts":    "./node_modules/.bin/tsc --noEmit  &&  ./node_modules/.bin/eslint <file>",
  ".tsx":   "./node_modules/.bin/tsc --noEmit  &&  ./node_modules/.bin/eslint <file>",
  ".js":    "./node_modules/.bin/eslint <file>",
  ".jsx":   "./node_modules/.bin/eslint <file>",
  ".py":    "mypy <file>  &&  ruff check <file>",
  ".go":    "go vet ./...  &&  golangci-lint run",
  ".rs":    "cargo clippy  &&  cargo test",
  ".java":  "mvn compile   (or: gradle build)",
  ".kt":    "gradle build  (or: mvn compile)",
  ".kts":   "gradle build",
  ".cs":    "dotnet build  &&  dotnet test",
  ".swift": "swift build  (or: xcodebuild)",
  ".rb":    "bundle exec rubocop <file>",
  ".php":   "./vendor/bin/phpstan analyse <file>  &&  ./vendor/bin/phpcs <file>",
  ".cpp":   "cmake --build build/  (or: make)",
  ".cc":    "cmake --build build/",
  ".c":     "make  (or: gcc -Wall <file>)",
  ".h":     "make  (or: gcc -Wall -fsyntax-only <file>)",
};

readStdin()
  .then((raw) => {
    // Always echo input unchanged first.
    process.stdout.write(raw || "");
    if (process.env.LILARA_KILL_SWITCH === "1") return;

    try {
      const input = JSON.parse(raw || "{}");
      const toolName = typeof input.tool_name === "string" ? input.tool_name : "";

      // Only act on Edit or Write tool events.
      if (!EDIT_TOOLS.has(toolName)) return;

      // Read file_path from metadata — this is safe (no file content).
      const filePath =
        (input.input && typeof input.input.file_path === "string" ? input.input.file_path : null) ??
        (typeof input.file_path === "string" ? input.file_path : null);

      if (!filePath) return;

      const ext = path.extname(filePath).toLowerCase();
      const commandTemplate = EXT_COMMANDS[ext];
      if (!commandTemplate) return;

      const filename = path.basename(filePath);
      const command = commandTemplate.replace(/<file>/g, filePath);

      process.stderr.write(
        `[Agent Runtime Guard] After editing ${filename}: run ${command} to check.\n`
      );
    } catch {
      // Malformed input — do not block.
    }
  })
  .catch(() => process.exit(0));
