#!/usr/bin/env node
// secret-warning.js — Claude PreToolUse hook for secret scanning (thin adapter).
//
// Delegates all scanning logic to runtime/secret-scan.js so the same
// patterns are applied consistently across all harnesses.
//
// To enable block mode:  export LILARA_ENFORCE=1

"use strict";

const { readStdin, collectText, hookLog, rateLimitCheck, runtimeDecision, readSessionRisk, ENFORCE } = require("./hook-utils");
const { scanSecrets } = require("../../runtime/secret-scan");

readStdin()
  .then((raw) => {
    if (process.env.LILARA_KILL_SWITCH === "1") { process.stderr.write("[Lilara] Kill-switch engaged — blocked.\n"); process.exit(2); }

    if (!rateLimitCheck("secret-warning")) {
      process.stdout.write(raw);
      return;
    }

    try {
      const input = JSON.parse(raw || "{}");
      const text  = collectText(input);
      const hit   = scanSecrets(text);

      if (hit) {
        process.stderr.write(`[Lilara] Possible ${hit.name} detected in prompt input.\n`);
        process.stderr.write("[Lilara] Remove secrets before submitting. Prefer local env files that are not shared.\n");

        const sessionRisk = readSessionRisk();
        try {
          const decision = runtimeDecision({
            tool: "PreToolUse",
            command: `secret-scan:${hit.name}`,
            payloadClass: "C",
            sessionRisk,
            notes: `secret-warning:${hit.name}`,
          });
          if (decision.riskLevel && decision.riskLevel !== "low") {
            process.stderr.write(`[Lilara] Runtime decision: ${decision.action} (risk=${decision.riskLevel}, source=${decision.decisionSource})\n`);
            process.stderr.write(`[Lilara] Explanation: ${decision.explanation}\n`);
          }
          if (sessionRisk > 0) {
            process.stderr.write(`[Lilara] Session risk: ${sessionRisk}\n`);
          }
        } catch (runtimeErr) {
          const errMsg = runtimeErr instanceof Error ? runtimeErr.message : String(runtimeErr);
          process.stderr.write(`[Lilara] WARNING: runtime decision engine unavailable (${errMsg}).\n`);
        }

        if (ENFORCE) {
          process.stderr.write("[Lilara] BLOCKED — LILARA_ENFORCE=1 is active. Tool call aborted.\n");
          try { hookLog("secret-warning", "BLOCK", hit.name); } catch { /* log I/O is non-fatal */ }
          process.stdout.write(raw);
          process.exit(2);
        }

        try { hookLog("secret-warning", "WARN", hit.name); } catch { /* log I/O is non-fatal */ }
      }
    } catch { /* malformed input — non-blocking */ }

    process.stdout.write(raw);
  })
  .catch(() => process.exit(0));
