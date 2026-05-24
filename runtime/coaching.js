#!/usr/bin/env node
"use strict";

// coaching.js — Build additionalContext coaching envelopes per harness capability.
//
// ADR-016 Feature 1: adapters with additionalContextSupported:true (Claude,
// ClawCode) emit hookSpecificOutput.additionalContext so the model receives
// coaching in its next turn. Other adapters emit stderr [lilara:coaching]
// (operator sees it; model does not).
//
// Pure function; zero I/O. Message capped at 500 chars per plan decision.

const MAX_MSG = 500;

function _truncate(s) {
  if (typeof s !== "string") return "";
  return s.length > MAX_MSG ? s.slice(0, MAX_MSG - 1) + "…" : s;
}

/**
 * buildCoachingEnvelope({ manifest, coaching, hookEventName }) → { stdout?, stderr? }
 *
 * manifest  — harness manifest object (may be null). Reads additionalContextSupported.
 * coaching  — { message: string, hint?: string }
 * hookEventName — "PreToolUse" | "PostToolUse" (defaults to "PreToolUse")
 *
 * Returns an object with at most one key:
 *   { stdout: string } — when manifest.additionalContextSupported is true
 *   { stderr: string } — otherwise (fallback; model never sees it)
 */
function buildCoachingEnvelope({ manifest, coaching, hookEventName = "PreToolUse" }) {
  if (!coaching || typeof coaching.message !== "string") return {};
  const message = _truncate(coaching.message);
  if (!message) return {};

  const supported = Boolean(manifest && manifest.additionalContextSupported);
  if (supported) {
    const payload = {
      hookSpecificOutput: {
        hookEventName,
        additionalContext: message,
      },
    };
    return { stdout: JSON.stringify(payload) };
  }

  // Fallback: stderr line visible to operator but not injected into model stream.
  return { stderr: `[lilara:coaching] ${message}\n` };
}

module.exports = { buildCoachingEnvelope };
