#!/usr/bin/env node
// git-push-reminder.js — PreToolUse hook for the Bash tool.
//
// Warns before any `git push` command. In enforce mode (LILARA_ENFORCE=1)
// blocks force-pushes entirely; a regular push still proceeds with a reminder.
//
// Enforce levels:
//   LILARA_ENFORCE=1  →  block mode: git push --force / --force-with-lease aborted.
//   Default        →  warn mode:  all git push commands print a reminder, none are blocked.

"use strict";

const { readStdin, commandFrom, ENFORCE, hookLog, rateLimitCheck, runtimeDecision, runtimeContext, readSessionRisk, classifyCommandPayload } = require("./hook-utils");

const FORCE_PUSH  = /\bgit\s+push\b.*(-f\b|--force\b|--force-with-lease\b)/;
const ANY_PUSH    = /\bgit\s+push\b/;
const MAIN_BRANCH = /\b(main|master|production|prod|release)\b/;

readStdin()
  .then((raw) => {
    if (process.env.LILARA_KILL_SWITCH === "1") { process.stderr.write("[Lilara] Kill-switch engaged — blocked.\n"); process.exit(2); }
    if (!rateLimitCheck("git-push-reminder")) {
      process.stdout.write(raw);
      return;
    }
    try {
      const input   = JSON.parse(raw || "{}");
      const command = commandFrom(input);

      if (ANY_PUSH.test(command)) {
        const isForce    = FORCE_PUSH.test(command);
        const targetMain = MAIN_BRANCH.test(command);

        if (isForce) {
          console.error("[Lilara] [CRITICAL] Force push detected.");
          if (targetMain) {
            console.error("[Lilara] Target appears to be a protected branch (main/master/prod).");
          }
          console.error("[Lilara] Force push can overwrite shared history and destroy teammates' work.");

          // Route force-push through the runtime decision engine for unified policy,
          // trajectory tracking, and explainability. Inherits session risk and project
          // context so escalation kicks in under repeated risky patterns.
          const sessionRisk = readSessionRisk();
          const payloadClass = classifyCommandPayload(command);
          try {
            const targetPath = String(input.cwd || input.args?.cwd || input.tool_input?.cwd || "");
            const discovered = runtimeContext({ targetPath });
            const decision = runtimeDecision({
              tool: "Bash",
              command,
              targetPath,
              branch: discovered.branch,
              projectRoot: discovered.projectRoot,
              payloadClass,
              sessionRisk,
              notes: "git-push-reminder:force-push",
            });
            console.error(`[Lilara] Runtime decision: ${decision.action} (risk=${decision.riskLevel}, source=${decision.decisionSource})`);
            console.error(`[Lilara] Explanation: ${decision.explanation}`);
            if (sessionRisk > 0) {
              console.error(`[Lilara] Session risk: ${sessionRisk}`);
            }
          } catch (runtimeErr) {
            const errMsg = runtimeErr instanceof Error ? runtimeErr.message : String(runtimeErr);
            console.error(`[Lilara] WARNING: runtime decision engine unavailable (${errMsg}).`);
          }

          if (ENFORCE) {
            console.error("[Lilara] BLOCKED — LILARA_ENFORCE=1 is active. Force push aborted.");
            console.error("[Lilara] To proceed: get explicit approval, then run the command manually.");
            try { hookLog("git-push-reminder", "BLOCK", "force-push"); } catch { /* log I/O is non-fatal */ }
            process.exit(2);
          }

          try { hookLog("git-push-reminder", "WARN", "force-push"); } catch { /* log I/O is non-fatal */ }
          console.error("[Lilara] Proceeding in warn mode. Set LILARA_ENFORCE=1 to block force pushes.");
        } else {
          try { hookLog("git-push-reminder", "WARN", "git-push"); } catch { /* log I/O is non-fatal */ }
          console.error("[Lilara] Before pushing: review branch, remote, staged files, and diff.");
          if (targetMain) {
            console.error("[Lilara] Pushing directly to a main/master/prod branch — confirm this is intentional.");
          }
        }
      }
    } catch {
      // Non-blocking by design.
    }
    process.stdout.write(raw);
  })
  .catch(() => process.exit(0));
