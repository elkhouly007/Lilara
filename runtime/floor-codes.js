#!/usr/bin/env node
"use strict";

// floor-codes.js — Stable typed code registry for every baked lattice floor.
//
// ADR-016: Every floor block carries a `code` string drawn from this frozen
// map. Format: F<n>_<SCREAMING_SNAKE> (e.g. F8_PROTECTED_BRANCH). Codes are
// never renamed; deprecated codes are aliased to the canonical name only.
//
// The registry maps two distinct string namespaces that the engine uses:
//   - buildEarlyBlock reasonCode (first arg, e.g. "ambient-authority-denied")
//   - main-path floorFired / extra.floorFired (floor name, e.g. "ambient-authority")
// Both namespaces must be present so floorCodeFor() returns a code on either
// lookup path. Same-code entries with different keys are intentional aliases.

const FLOOR_CODES = Object.freeze({
  // ── F1 kill-switch ──────────────────────────────────────────────────────────
  "kill-switch":                    "F1_KILL_SWITCH",
  "kill-switch-engaged":            "F1_KILL_SWITCH",
  // ── F2 contract-hash-mismatch ───────────────────────────────────────────────
  "contract-hash-mismatch":         "F2_CONTRACT_HASH_MISMATCH",
  // ── F3 critical-risk ────────────────────────────────────────────────────────
  "critical-risk":                  "F3_CRITICAL_RISK",
  // ── F4 secret-class-C ───────────────────────────────────────────────────────
  "secret-class-C":                 "F4_SECRET_CLASS_C",
  "secret-class-c":                 "F4_SECRET_CLASS_C",
  // ── F5 strict-gated-no-cover ────────────────────────────────────────────────
  "strict-gated-no-cover":          "F5_STRICT_GATED_NO_COVER",
  "harness-out-of-scope":           "F5_STRICT_GATED_NO_COVER",
  "no-contract-strict":             "F5_STRICT_GATED_NO_COVER",
  // ── F6 posture-strict-no-cover ──────────────────────────────────────────────
  "posture-strict-no-cover":        "F6_POSTURE_STRICT",
  // ── F7 intent-unknown-strict ────────────────────────────────────────────────
  "intent-unknown-strict":          "F7_INTENT_UNKNOWN",
  // ── F8 protected-branch ─────────────────────────────────────────────────────
  "protected-branch":               "F8_PROTECTED_BRANCH",
  // ── F9 session-risk-floor ───────────────────────────────────────────────────
  "session-risk-floor":             "F9_SESSION_RISK",
  // ── F10 taint-floor ─────────────────────────────────────────────────────────
  "taint-floor":                    "F10_TAINT_CORRELATION",
  // ── F11 validity-window ─────────────────────────────────────────────────────
  "validity-window":                "F11_OUTSIDE_VALIDITY_WINDOW",
  // ── F12 mcp-deny ────────────────────────────────────────────────────────────
  "mcp-deny":                       "F12_MCP_DENY",
  // ── F13 skill-deny ──────────────────────────────────────────────────────────
  "skill-deny":                     "F13_SKILL_DENY",
  // ── F14 budget-exceeded ─────────────────────────────────────────────────────
  "budget-exceeded":                "F14_BUDGET_EXCEEDED",
  // ── F14b session-over-duration ──────────────────────────────────────────────
  "session-over-duration":          "F14B_SESSION_OVERDURATION",
  // ── F15 execution-envelope ──────────────────────────────────────────────────
  "execution-envelope":             "F15_EXECUTION_ENVELOPE",
  "execution-envelope-diverged":    "F15_EXECUTION_ENVELOPE",
  // ── F16 ambient-authority ───────────────────────────────────────────────────
  "ambient-authority":              "F16_AMBIENT_AUTHORITY",
  "ambient-authority-denied":       "F16_AMBIENT_AUTHORITY",
  // ── F17 cross-agent-lock ────────────────────────────────────────────────────
  "cross-agent-lock":               "F17_CROSS_AGENT_LOCK",
  "cross-agent-lock-denied":        "F17_CROSS_AGENT_LOCK",
  // ── F18 network-egress ──────────────────────────────────────────────────────
  "network-egress":                 "F18_NETWORK_EGRESS",
  "network-egress-denied":          "F18_NETWORK_EGRESS",
  // ── F18-D007 plaintext-target-blocked ───────────────────────────────────────
  "plaintext-target-blocked":       "F18D007_PLAINTEXT_TARGET",
  // ── F19 output-channel-exfiltration ─────────────────────────────────────────
  "output-channel-exfiltration":    "F19_OUTPUT_CHANNEL_EXFIL",
  "output-exfil-denied":            "F19_OUTPUT_CHANNEL_EXFIL",
  // ── F20 change-intent-drift ─────────────────────────────────────────────────
  "change-intent-drift":            "F20_CHANGE_INTENT_DRIFT",
  // ── F21 compaction-survival (ADR-016) ───────────────────────────────────────
  "compaction-survival":            "F21_COMPACTION_SURVIVAL",
  "compaction-survival-detected":   "F21_COMPACTION_SURVIVAL",
  // ── F22 commit-format-violation ─────────────────────────────────────────────
  "commit-format-violation":        "F22_COMMIT_FORMAT_VIOLATION",
  // ── F23 data-flow-kill-chain ─────────────────────────────────────────────────
  "data-flow-kill-chain":           "F23_DATA_FLOW_KILL_CHAIN",
  "data-flow-kill-chain-detected":  "F23_DATA_FLOW_KILL_CHAIN",
  // ── F24 credential-persistence-write ─────────────────────────────────────────
  "credential-persistence-write":         "F24_CRED_PERSISTENCE_WRITE",
  "credential-persistence-write-denied":  "F24_CRED_PERSISTENCE_WRITE",
  // ── F25 mcp-arg-danger ───────────────────────────────────────────────────────
  "mcp-arg-danger":                        "F25_MCP_ARG_DANGER",
  "mcp-arg-danger-denied":                 "F25_MCP_ARG_DANGER",
  "mcp-arg-shape-unscannable":             "F25_MCP_ARG_DANGER",
  // ── F26 mcp-registration-write ───────────────────────────────────────────────
  "mcp-registration-write":               "F26_MCP_REGISTRATION_WRITE",
  "mcp-registration-write-denied":        "F26_MCP_REGISTRATION_WRITE",
  "mcp-config-unscannable":               "F26_MCP_REGISTRATION_WRITE",
  // ── F27 secret-egress-external ───────────────────────────────────────────────
  // Inviolable single-call hard-stop: credential/key-class material to an
  // external host. demotableBy:[] — never consent-demotable. ADR-036.
  "secret-egress-external":              "F27_SECRET_EGRESS_EXTERNAL",
  "secret-egress-external-denied":       "F27_SECRET_EGRESS_EXTERNAL",
  // ── F23b mcp-result-injection (ADR-017 extension) ─────────────────────────────
  // Observe-only sub-signal of F23: injection patterns detected in MCP tool
  // output. Reinforces the F23 provenance graph (PostToolUse only, Claude Code).
  "mcp-result-injection":                 "F23B_MCP_RESULT_INJECTION",
  // ── F28 taint-egress-consent (ADR-037) ────────────────────────────────────────
  // ESCALATE (consent-eligible). Staged / cross-call credential exfil:
  // credential-class taint → external egress across calls. Routes to consent
  // stop-and-ask with REAL args. Active only when LILARA_TAINT_EGRESS=1.
  "taint-egress-consent":                 "F28_TAINT_EGRESS",
  "credential-staged-exfil-detected":     "F28_TAINT_EGRESS",
  // ── F29 destructive-delete-coord (ADR-038) ────────────────────────────────────
  // REQUIRE-REVIEW (consent-eligible). Out-of-scope destructive-delete coordination:
  // approve-past with recoverability snapshot. Active only when LILARA_DELETE_COORD=1.
  "destructive-delete-coord":             "F29_DESTRUCTIVE_DELETE_COORD",
  "f29-consent-demoted":                  "F29_DESTRUCTIVE_DELETE_COORD",
  // ── F30 tamper-floor (ADR-050) ────────────────────────────────────────────────
  // INVIOlABLE block. In-session write to the installed guard footprint
  // (~/.lilara via state-paths.js). No demotableBy; tier=inviolable.
  // Legitimate updates route through the installer/upgrade path as
  // operator-on-host OUTSIDE the agent session (SCOPE §21 host-trust boundary).
  "tamper-floor":                         "F30_TAMPER_FLOOR",
  "tamper-floor-eval-failed":             "F30_TAMPER_FLOOR",
});

function floorCodeFor(reasonCode) {
  if (typeof reasonCode !== "string") return null;
  return Object.prototype.hasOwnProperty.call(FLOOR_CODES, reasonCode)
    ? FLOOR_CODES[reasonCode]
    : null;
}

module.exports = { FLOOR_CODES, floorCodeFor };
