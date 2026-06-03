#!/usr/bin/env node
"use strict";

// consent/transport.js — Interactive consent transport for the 0.2.0 gate.
//
// Implements the "stop-and-ask" half of the scope-based consent gate.
// Selected by LILARA_CONSENT environment variable (public enum):
//
//   interactive — open the controlling TTY (/dev/tty on POSIX,
//                 \\.\CONIN$ + \\.\CONOUT$ on Windows), display the prompt,
//                 read one line. If no TTY is available (unattended session,
//                 redirect, CI) → fail-closed deny.
//
//   block        — always return deny + fire one-way notify. For fully
//                 unattended runs where the operator wants hard-stop behaviour
//                 but still wants to receive notifications.
//
//   off / unset  — the gate should not have been called in this mode.
//                 Return deny defensively.
//
// SECURITY INVARIANTS (do NOT change without an ADR):
//   - READS THE CONTROLLING TTY, NEVER fd 0 (the hook payload pipe). The agent's
//     hook JSON arrives on stdin (fd 0); reading it would allow a prompt-injected
//     "approve\n" to self-approve. The TTY is a separate fd controlled by the
//     human terminal (/dev/tty on POSIX, CONIN$ on Windows).
//   - The promptObject is built from REAL decision fields (ir.fileTargets,
//     networkEgress.hostname, decision.command, floor code). Never from agent
//     self-description fields (notes, tool_input description, etc.).
//   - NO auto-approve for any production env var value. The ONLY path to auto-
//     approve is the internal test sentinel (__LILARA_CONSENT_TEST_AUTO=1) and
//     ONLY when NODE_ENV === "test".
//
// Zero external dependencies.

const fs   = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// ONE-SHOT floors: F4 (secret-class-C) and F19 (output-exfil). Approval for
// these mints+consumes a scoped operator token; it does NOT widen the session
// scope grant (too broad: secrets/exfil re-ask every time by design).
// ---------------------------------------------------------------------------
const ONE_SHOT_FLOORS = new Set(["secret-class-C", "output-channel-exfiltration"]);

function isOneShot(floorFired) {
  return Boolean(floorFired && ONE_SHOT_FLOORS.has(floorFired));
}

// ---------------------------------------------------------------------------
// buildConsentPrompt — derive the human-facing prompt from REAL decision fields.
// MUST NOT include any agent-controlled fields verbatim as approval signals.
// ---------------------------------------------------------------------------
function buildConsentPrompt(decision, extra = {}) {
  // Real structured fields from the decision object:
  const hostname    = decision.networkEgress?.hostname || null;
  const fileTargets = (decision.ir?.fileTargets || []).map((t) => t.path || t).filter(Boolean);
  const command     = String(extra.command || decision.command || "").slice(0, 500);
  const floorCode   = decision.code || null;
  const floorFired  = decision.floorFired || null;
  const explanation = String(decision.explanation || "").slice(0, 500);

  return {
    floorCode,
    floorFired,
    command,
    hostname,
    fileTargets,
    explanation,
    // Structured fields for display — not from agent self-description:
    tool:   String(extra.tool || decision.tool || ""),
    action: String(decision.action || "block"),
  };
}

// ---------------------------------------------------------------------------
// buildPromptText — human-readable text rendered to the TTY.
// ---------------------------------------------------------------------------
function buildPromptText(prompt) {
  const lines = [
    "",
    "┌─ Lilara Consent Required ─────────────────────────────────────────────┐",
    `│ Floor:   ${String(prompt.floorCode || prompt.floorFired || "unknown").padEnd(62)}│`,
    `│ Command: ${String(prompt.command || "").slice(0, 62).padEnd(62)}│`,
  ];
  if (prompt.hostname) {
    lines.push(`│ Host:    ${String(prompt.hostname).slice(0, 62).padEnd(62)}│`);
  }
  if (prompt.fileTargets && prompt.fileTargets.length > 0) {
    const ft = prompt.fileTargets.slice(0, 3).join(", ").slice(0, 62);
    lines.push(`│ Files:   ${ft.padEnd(62)}│`);
  }
  lines.push(
    `│ Reason:  ${String(prompt.explanation || "").slice(0, 62).padEnd(62)}│`,
    "└───────────────────────────────────────────────────────────────────────┘",
    "  Approve this action? [y/N] (reads from terminal, not stdin): ",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// openTTY — open the controlling terminal for reading user input.
// Returns { fd, writeFd } or null when no TTY is available.
// NEVER reads fd 0 (the stdin pipe — the agent's hook payload).
//
// Internal test sentinel: set __LILARA_CONSENT_TEST_NO_TTY=1 to simulate
// a no-TTY environment in automated tests. Not a public API.
// ---------------------------------------------------------------------------
function openTTY() {
  // Internal test sentinel: simulate no-TTY without spawning a real terminal.
  if (process.env.__LILARA_CONSENT_TEST_NO_TTY === "1" && process.env.NODE_ENV === "test") {
    return null;
  }
  try {
    if (process.platform === "win32") {
      // Windows: CONOUT$ for writing, CONIN$ for reading.
      const writeFd = fs.openSync("\\\\.\\CONOUT$", "w");
      const fd      = fs.openSync("\\\\.\\CONIN$",  "r");
      return { fd, writeFd };
    } else {
      // POSIX: /dev/tty gives the controlling terminal regardless of stdio redirects.
      const fd = fs.openSync("/dev/tty", "r+");
      return { fd, writeFd: fd };
    }
  } catch {
    // No controlling terminal (e.g. headless CI, nohup, Docker without -t).
    return null;
  }
}

// ---------------------------------------------------------------------------
// readLineFromFd — read one line from a file descriptor synchronously.
// Returns the trimmed line string.
// ---------------------------------------------------------------------------
function readLineFromFd(fd) {
  const chunks = [];
  const buf    = Buffer.alloc(1);
  try {
    for (let i = 0; i < 4096; i++) {
      const n = fs.readSync(fd, buf, 0, 1, null);
      if (n === 0) break;
      const ch = buf[0];
      if (ch === 10 /* \n */ || ch === 13 /* \r */) break;
      chunks.push(ch);
    }
  } catch { /* read error → empty line → deny */ }
  return Buffer.from(chunks).toString("utf8").trim();
}

// ---------------------------------------------------------------------------
// requestConsent — main entry point.
// ---------------------------------------------------------------------------

/**
 * Present the consent prompt and return the human's decision.
 *
 * @param {object} promptOrDecision  — output of buildConsentPrompt (or the
 *                                     raw decision object for convenience)
 * @param {object} [opts]
 * @param {string} [opts.mode]       — override mode (defaults to LILARA_CONSENT)
 * @returns {{ decision: "approve" | "deny", grantScopes?: object }}
 */
function requestConsent(promptOrDecision, opts = {}) {
  const mode = String(opts.mode || process.env.LILARA_CONSENT || "off").trim().toLowerCase();

  // ── Test sentinel (internal only) ─────────────────────────────────────
  // NEVER a public LILARA_CONSENT value. Only active when NODE_ENV === "test".
  if (process.env.__LILARA_CONSENT_TEST_AUTO === "1" && process.env.NODE_ENV === "test") {
    return { decision: "approve", grantScopes: promptOrDecision.grantScopes || {} };
  }

  // ── Production modes ───────────────────────────────────────────────────
  if (mode === "off" || !mode) {
    // Gate should not have been reached in this mode; deny defensively.
    return { decision: "deny" };
  }

  if (mode === "block") {
    return { decision: "deny" };
  }

  if (mode === "interactive") {
    // Build a displayable prompt from the real structured fields
    const prompt = (typeof promptOrDecision.floorCode !== "undefined" ||
                    typeof promptOrDecision.command !== "undefined")
      ? promptOrDecision
      : buildConsentPrompt(promptOrDecision);

    const tty = openTTY();
    if (!tty) {
      // No controlling terminal — unattended session. Fail closed.
      return { decision: "deny" };
    }

    try {
      // Write prompt to the terminal
      const promptText = buildPromptText(prompt);
      if (process.platform === "win32") {
        try { fs.writeSync(tty.writeFd, promptText); } catch { /* ignore write errors */ }
        if (tty.writeFd !== tty.fd) try { fs.closeSync(tty.writeFd); } catch { /* */ }
      } else {
        try { fs.writeSync(tty.fd, promptText); } catch { /* ignore write errors */ }
      }

      // Read one character from TTY
      const answer = readLineFromFd(tty.fd);
      const approved = answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";

      if (approved) {
        // Derive grant scopes from the real decision fields.
        // For scope-shaped floors (F18/F20): widen the session scope.
        // For one-shot floors (F4/F19): return empty grantScopes (caller handles token).
        const grantScopes = _deriveGrantScopes(prompt);
        return { decision: "approve", grantScopes };
      }
      return { decision: "deny" };
    } finally {
      try { fs.closeSync(tty.fd); } catch { /* best-effort */ }
    }
  }

  // Unknown mode — fail closed
  return { decision: "deny" };
}

// ---------------------------------------------------------------------------
// _deriveGrantScopes — minimal scope derived from REAL decision fields.
// Used when approval widens the session grant (scope-shaped floors).
// ---------------------------------------------------------------------------
function _deriveGrantScopes(prompt) {
  const scopes = {};

  // Network egress: allow the specific host that was approved.
  if (prompt.hostname) {
    scopes.network = { allowDomains: [String(prompt.hostname)] };
  }

  // File targets: allow the specific approved paths (destructive scope).
  if (prompt.fileTargets && prompt.fileTargets.length > 0) {
    scopes.filesystem = {
      destructiveAllow: prompt.fileTargets.map((p) => ({
        commandClass: "destructive-delete",
        pathGlob: String(p),
      })),
    };
  }

  return scopes;
}

module.exports = { requestConsent, buildConsentPrompt, buildPromptText, isOneShot };
