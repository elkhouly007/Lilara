#!/usr/bin/env node
"use strict";

// post-adapter-factory.js — Shared PostToolUse handler for all 6 harnesses.
//
// Extracts the common secret-scan + taint-record logic that was duplicated
// across claude, opencode, openclaw, codex, clawcode, and antegravity adapters.
// Each harness adapter becomes a ~5-line wrapper that calls createPostAdapter().
//
// D38: createPostAdapter factory; D39: canonical EXTERNAL_TOOLS.

const path = require("path");

// Canonical union of all 6 harness pre-refactor EXTERNAL_TOOLS sets (D39).
// Must be a superset of every adapter's pre-refactor set.
// "WebSearch", "Fetch": no current adapter uses these; kept for forward compat.
const EXTERNAL_TOOLS = new Set([
  "WebFetch", "web_fetch",
  "WebSearch",  // no current adapter uses this; kept for forward compat
  "Fetch",      // no current adapter uses this; kept for forward compat
  "fetch",
  "mcp",
  "curl", "wget",
  "browser_action", "Browser",
]);

function sourceLabel(toolName) {
  const t = String(toolName || "").toLowerCase();
  if (t.includes("fetch") || t.includes("browser")) return "web-fetch";
  if (t.includes("mcp")) return "mcp";
  if (t === "curl" || t === "wget") return "curl";
  return "external";
}

/**
 * Wire a PostToolUse stdin handler for a specific harness.
 * Reads stdin, runs secret-scan + taint-record, writes stdin back to stdout.
 *
 * @param {object} opts
 * @param {string} opts.harnessName   — human label (used in warning prefix)
 * @param {string} opts.rateLimitKey  — unique per-harness key for rateLimitCheck + hookLog
 * @param {boolean} [opts.envelopeReporting=false] — adapter can report exec-time F15 envelopes
 */
function createPostAdapter({ harnessName, rateLimitKey, envelopeReporting = false }) {
  const { readStdin, collectText, hookLog, rateLimitCheck } = require(
    path.join(__dirname, "..", "claude", "hooks", "hook-utils")
  );
  const { append } = require("./decision-journal");
  const { loadPending, verify } = require("./envelope");
  const { scanSecrets } = require("./secret-scan");
  const { recordExternalRead } = require("./taint");

  readStdin()
    .then((raw) => {
      if (process.env.LILARA_KILL_SWITCH === "1") {
        process.stdout.write(raw);
        return;
      }

      if (!rateLimitCheck(rateLimitKey)) {
        process.stdout.write(raw);
        return;
      }

      try {
        const input = JSON.parse(raw || "{}");
        // PostToolUse payload shape: { tool_use_id, tool_name, output, ... }
        const toolName   = String(input.tool_name || input.tool || "");
        // tool_response is the verified Codex PostToolUse field (codex-rs/hooks/src/events/post_tool_use.rs).
        const outputText = String(input.tool_response || input.output || input.tool_output || input.content || "");
        const text = outputText || collectText(input);

        // 1. Secret scan — warn if tool output contains a credential pattern.
        const hit = scanSecrets(text);
        if (hit) {
          process.stderr.write(`[Lilara] Possible ${hit.name} detected in tool output.\n`);
          process.stderr.write("[Lilara] Secret may have been echoed by the tool. Rotate the credential if unintentional.\n");
          try { hookLog(rateLimitKey, "WARN", hit.name); } catch { /* log I/O is non-fatal */ }
        }

        // 2. Taint record — annotate external-source outputs for F10 taint floor.
        if (EXTERNAL_TOOLS.has(toolName) && text) {
          try { recordExternalRead(text, sourceLabel(toolName)); } catch { /* provenance is best-effort */ }
        }

        // 3. Optional envelope verification — only active for adapters that can
        // report an exec-time envelope in PostToolUse payloads.
        if (envelopeReporting) {
          const toolUseId = input.tool_use_id || input.toolUseId || null;
          const observedEnvelope = input.executionEnvelope || input.execution_envelope || input.lilara?.executionEnvelope || null;
          const expectedEnvelope = toolUseId ? loadPending(toolUseId, Boolean(observedEnvelope)) : null;
          if (expectedEnvelope && observedEnvelope) {
            const result = verify(expectedEnvelope, observedEnvelope, { enforceEnvDiff: true });
            if (!result.ok) {
              process.stderr.write(`[Lilara] Execution envelope diverged after ${harnessName} tool run (${result.reason}).\n`);
              try {
                append({
                  kind: "execution-envelope-diverged",
                  action: "block",
                  riskLevel: "critical",
                  riskScore: 10,
                  reasonCodes: ["execution-envelope-diverged"],
                  tool: toolName,
                  branch: "",
                  targetPath: "",
                  notes: `posttool:${harnessName}:${result.reason}`,
                  floorFired: "execution-envelope",
                });
              } catch { /* journal is best-effort */ }
            }
          }
        }
      } catch { /* malformed payload — non-blocking */ }

      process.stdout.write(raw);
    })
    .catch(() => process.exit(0));
}

module.exports = { createPostAdapter, EXTERNAL_TOOLS, sourceLabel };
