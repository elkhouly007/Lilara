#!/usr/bin/env node
// post-adapter.js — Codex PostToolUse adapter for Agent Runtime Guard (best-effort).
//
// Codex hook API is not publicly documented. This adapter covers the most likely
// PostToolUse payload shapes. Test against your actual Codex hook payload.
//
// Likely Codex shapes (not verified):
//   { "tool": "bash", "command": "...", "output": "...", "exit_code": 0 }
//   { "tool_name": "Bash", "tool_input": { "command": "..." }, "output": "..." }
//
// Does two things on every PostToolUse event:
//   1. Secret scan: warns if tool output contains a credential pattern.
//   2. Taint record: annotates external-source outputs into the provenance window.
//
// PostToolUse hooks cannot block; all output goes to stderr as warnings.
// HORUS_KILL_SWITCH=1 disables all processing (pass-through).

"use strict";

const { readStdin, collectText, hookLog, rateLimitCheck } = require("../../claude/hooks/hook-utils");
const { scanSecrets } = require("../../runtime/secret-scan");
const { recordExternalRead } = require("../../runtime/taint");

const EXTERNAL_TOOLS = new Set([
  "WebFetch", "web_fetch", "fetch", "mcp", "curl", "wget",
  "browser_action", "Browser",
]);

function sourceLabel(toolName) {
  const t = String(toolName || "").toLowerCase();
  if (t.includes("fetch") || t.includes("browser")) return "web-fetch";
  if (t.includes("mcp")) return "mcp";
  if (t === "curl" || t === "wget") return "curl";
  return "external";
}

readStdin()
  .then((raw) => {
    if (process.env.HORUS_KILL_SWITCH === "1") {
      process.stdout.write(raw);
      return;
    }

    if (!rateLimitCheck("codex-post-adapter")) {
      process.stdout.write(raw);
      return;
    }

    try {
      const input = JSON.parse(raw || "{}");
      const toolName   = String(input.tool_name || input.tool || input.type || "");
      const outputText = String(input.output || input.result || input.tool_output || input.content || "");
      const text = outputText || collectText(input);

      // 1. Secret scan
      const hit = scanSecrets(text);
      if (hit) {
        process.stderr.write(`[Agent Runtime Guard] Possible ${hit.name} detected in tool output.\n`);
        process.stderr.write("[Agent Runtime Guard] Secret may have been echoed by the tool. Rotate the credential if unintentional.\n");
        try { hookLog("codex-post-adapter", "WARN", hit.name); } catch { /* log I/O is non-fatal */ }
      }

      // 2. Taint record for external-source tools
      if (EXTERNAL_TOOLS.has(toolName) && text) {
        try { recordExternalRead(text, sourceLabel(toolName)); } catch { /* provenance is best-effort */ }
      }
    } catch { /* malformed payload — non-blocking */ }

    process.stdout.write(raw);
  })
  .catch(() => process.exit(0));
