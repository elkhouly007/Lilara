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
// F.6 secret/API-key egress consent line (CONTRACT.md §Level 3, RED-LINES.md §2.2).
// The two secret-egress floors (F27 secret-egress-external, F28 taint-egress-
// consent) render a full-width, un-boxed F.6 line ABOVE the consent box naming
// the external destination. f6PromptLine() emits the byte-exact canonical ASCII
// form (capital A, tight "secret/API key" slash, ASCII HYPHEN-MINUS before
// "approve?") — unified across runtime, tests, CONTRACT.md, and RED-LINES.md.
// ---------------------------------------------------------------------------
const SECRET_EGRESS_FLOORS = new Set(["secret-egress-external", "taint-egress-consent"]);

// A "nameable" destination for the F.6 line. The taint-egress floor emits the
// LITERAL sentinel string 'unknown' as host when no destination could be parsed
// (floor-taint-egress.js:181, via the provenance-graph.js:263 bare-curl @file
// fallback that returns host:null). 'unknown' is the ABSENCE of a destination,
// not a destination — treating it as nameable would render
// "...about to be sent to unknown - approve?" and let an operator approve a
// blind egress. Scoped to the F27/F28 secret-egress F.6 derivation ONLY; it does
// NOT reinterpret ordinary host strings on any other consent path.
function isNameableHost(h) {
  return h != null && h !== "" && h !== "unknown";
}

function f6PromptLine(host) {
  return `A secret/API key is about to be sent to ${host} - approve?`;
}

// ---------------------------------------------------------------------------
// buildConsentPrompt — derive the human-facing prompt from REAL decision fields.
// MUST NOT include any agent-controlled fields verbatim as approval signals.
// ---------------------------------------------------------------------------
function buildConsentPrompt(decision, extra = {}) {
  // Real structured fields from the decision object:
  const hostname    = decision.networkEgress?.hostname || null;
  // ADR-038: the engine result does NOT include `ir`, so decision.ir?.fileTargets
  // is always empty. The caller (pretool-gate.js) injects fileTargets from gateIr
  // via extra.fileTargets. Prefer extra.fileTargets when present; fall back to the
  // decision field so all other call sites remain unaffected.
  const fileTargets = extra.fileTargets ||
    (decision.ir?.fileTargets || []).map((t) => t.path || t).filter(Boolean);
  const command     = String(extra.command || decision.command || "").slice(0, 500);
  const floorCode   = decision.code || null;
  const floorFired  = decision.floorFired || null;
  const explanation = String(decision.explanation || "").slice(0, 500);
  // ADR-037 F28: taint-egress REAL decision fields. Present only when F28 fired.
  // Never read from agent self-description (transport security invariant).
  const taintedFile = decision.taintEgress?.taintedFilePath || null;
  const taintedFilePathHash = decision.taintEgress?.taintedFilePathHash || null;
  const credClass   = decision.taintEgress?.credClass || null;

  // ── F.6 secret/API-key egress wiring (ADR-036 F27 + ADR-037 F28) ──────────
  // The external destination shown in the F.6 line. Sourced ONLY from REAL
  // decision fields (never agent self-description): F27 → f27Consent.host;
  // F28 → taintEgress.host (the engine also mirrors it to networkEgress.hostname).
  // The 'unknown' sentinel (F28 no-host fallback) is non-nameable → treated like
  // null so the floor fails closed instead of naming a blind destination.
  const secretEgressFloor = SECRET_EGRESS_FLOORS.has(floorFired);
  const secretEgressHost =
    [decision.f27Consent?.host,
     decision.taintEgress?.host,
     decision.networkEgress?.hostname].find(isNameableHost) || null;
  const secretEgressCredClass =
    decision.f27Consent?.credentialClass ||
    decision.taintEgress?.credClass || null;
  // Fail-closed: a secret-egress floor fired but no destination can be named.
  // The F.6 line MUST NOT render; the caller (pretool-gate.js) downgrades the
  // receipt from consent-required to a hard block. Testable via this flag.
  const noDestination = secretEgressFloor && !secretEgressHost;

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
    // F28 taint fields (present only when F28 fired):
    taintedFile,
    taintedFilePathHash,
    credClass,
    // F.6 secret-egress wiring (additive; falsy/absent-effect on all other floors):
    secretEgressFloor,
    secretEgressHost,
    secretEgressCredClass,
    noDestination,
  };
}

// ---------------------------------------------------------------------------
// buildPromptText — human-readable text rendered to the TTY.
// ---------------------------------------------------------------------------
function buildPromptText(prompt) {
  const lines = [];
  // F.6: full-width, UN-BOXED secret/API-key egress line rendered ABOVE the box.
  // The destination is never truncated and always visible (no 62-char clamp).
  // Only rendered when a destination is known; the no-destination case is handled
  // fail-closed by the caller (pretool-gate.js) before this is ever reached.
  if (prompt.secretEgressFloor && prompt.secretEgressHost) {
    lines.push("", f6PromptLine(String(prompt.secretEgressHost)));
  }
  lines.push(
    "",
    "┌─ Lilara Consent Required ─────────────────────────────────────────────┐",
    `│ Floor:   ${String(prompt.floorCode || prompt.floorFired || "unknown").padEnd(62)}│`,
    `│ Command: ${String(prompt.command || "").slice(0, 62).padEnd(62)}│`,
  );
  if (prompt.hostname) {
    lines.push(`│ Host:    ${String(prompt.hostname).slice(0, 62).padEnd(62)}│`);
  }
  if (prompt.fileTargets && prompt.fileTargets.length > 0) {
    const ft = prompt.fileTargets.slice(0, 3).join(", ").slice(0, 62);
    lines.push(`│ Files:   ${ft.padEnd(62)}│`);
    // ADR-038 F29: deletion-coordination — surface the recoverability guarantee
    // so operators can approve with confidence. Reads from REAL decision fields only.
    if (prompt.floorFired === "destructive-delete-coord") {
      lines.push(`│ Recovery: snapshot will be taken before delete proceeds           │`);
    }
  }
  // ADR-037 F28: show the tainted credential file and class when present.
  // These are REAL decision fields, never from agent self-description.
  if (prompt.taintedFile) {
    lines.push(`│ Tainted: ${String(prompt.taintedFile).slice(0, 62).padEnd(62)}│`);
  }
  if (prompt.credClass) {
    lines.push(`│ Class:   ${String(prompt.credClass).slice(0, 62).padEnd(62)}│`);
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

  // ADR-037 F28: bespoke taint-egress scope — keyed on exact (host, filePathHash)
  // pair. Checked by evalTaintEgressFloor() directly against input.consentGrant
  // (bypasses the general scopesMatch engine, which has no network branch).
  // Present only for F28 approvals; inert for all other floors.
  if (prompt.floorFired === "taint-egress-consent" && prompt.hostname &&
      prompt.taintedFilePathHash) {
    scopes.taintEgress = [{
      host:         String(prompt.hostname),
      filePathHash: String(prompt.taintedFilePathHash),
    }];
  }

  // F.7 grant-sharing — shared per-(credentialClass, host) scope recognized by
  // BOTH F27 (secret-egress-external) AND F28 (taint-egress-consent). Emitted
  // for every secret-egress approval where the destination and credential class
  // are both named. Additive: F28's bespoke scopes.taintEgress (above) is
  // preserved. This is the shape that lets an F27-minted approval be recognized
  // by F28 and vice-versa (EXECUTION-PLAN F.7 / decision F.7). Inert for
  // non-secret-egress floors (secretEgressHost/CredClass absent there).
  if (prompt.secretEgressHost && prompt.secretEgressCredClass) {
    scopes.secretEgress = [{
      credentialClass: String(prompt.secretEgressCredClass),
      host:            String(prompt.secretEgressHost),
    }];
  }

  return scopes;
}

module.exports = {
  requestConsent,
  buildConsentPrompt,
  buildPromptText,
  isOneShot,
  // F.7: exported (public alias) so the grant-sharing test can exercise the
  // shape emitter directly. Internal name keeps the underscore prefix.
  deriveGrantScopes: _deriveGrantScopes,
};
