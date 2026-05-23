#!/usr/bin/env node
// build-reminder.js — PreToolUse hook for the Bash tool.
//
// Reminds the agent to review build/test output before continuing.
// In enforce mode (LILARA_ENFORCE=1) blocks merging or committing after
// a known failing build command — currently advisory-only for build runs
// (no blocking: the agent needs to SEE the output to know if it failed).
//
// Enforce levels:
//   LILARA_ENFORCE=1  →  block mode: suppresses the "proceeding in warn mode" message
//                     (blocking build commands before run makes no sense; the hook
//                      enforces the REVIEW step, not the run step).
//   Default        →  warn mode:  prints a reminder to review before continuing.

"use strict";

const { readStdin, commandFrom, rateLimitCheck } = require("./hook-utils");

const LOCAL_BUILD_OR_TEST = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(build|test|check|lint)\b|\b(cargo|go|mvn|gradle|make)\s+(build|test|check)\b|\b(pytest|vitest|jest|rspec|phpunit)\b/;

readStdin()
  .then((raw) => {
    if (process.env.LILARA_KILL_SWITCH === "1") { process.stderr.write("[Agent Runtime Guard] Kill-switch engaged — blocked.\n"); process.exit(2); }
    if (!rateLimitCheck("build-reminder")) {
      process.stdout.write(raw);
      return;
    }
    try {
      const input   = JSON.parse(raw || "{}");
      const command = commandFrom(input);
      if (LOCAL_BUILD_OR_TEST.test(command)) {
        console.error("[Agent Runtime Guard] Build / test command detected.");
        console.error("[Agent Runtime Guard] Review the full output before continuing — do not skip past failures.");
      }
    } catch {
      // Non-blocking by design.
    }
    process.stdout.write(raw);
  })
  .catch(() => process.exit(0));
