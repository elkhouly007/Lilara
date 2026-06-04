#!/usr/bin/env node
"use strict";

// floor-consent.js — Pure consent floor evaluator. Zero new I/O beyond the
// already-blessed impurities on the decide() hot path:
//   - scopesMatch's realpathSync (symlink escape check for destructive-delete)
//   - projectScope's git probe (already on the path via policy-store/scopedKey)
//
// Injected `input.now` (epoch ms) is used for expiry — NEVER Date.now() —
// so replay is deterministic and tests can freeze time.
//
// The grant object is injected by pretool-gate.js (loaded from the grant store)
// and attached to `input.consentGrant` before decide() is called. decide() never
// reads the grant store directly — it only sees the pre-loaded, injected value.
//
// Extracted as a separate module to mirror the decomposition pattern used by
// floor-credential-persist.js, floor-mcp.js, etc.

const { scopesMatch }  = require("./contract");
const { projectScope } = require("./project-scope");

/**
 * Evaluate whether an active consent grant covers the current action.
 *
 * @param {object}      input    — same input object passed to decide(); must
 *                                 carry `input.now` (epoch ms, injected by
 *                                 pretool-gate) for deterministic expiry check.
 * @param {object|null} grant    — active consent grant from grant-store.
 *                                 null / undefined → not granted.
 * @param {object|null} _contract — reserved for future cross-checks; unused now.
 * @returns {{ inScope: boolean, reason: string }}
 */
function evalConsentFloor(input, grant, _contract) {
  if (!grant) return { inScope: false, reason: "no-grant" };

  // ── Expiry ─────────────────────────────────────────────────────────────
  // MUST use injected input.now (epoch ms), never Date.now(), so replay is
  // deterministic. When input.now is absent the caller mis-configured the
  // call; skip the expiry check (treating as unexpired) rather than crashing.
  const nowMs = input.now != null ? Number(input.now) : null;
  if (nowMs != null && grant.expiresAt) {
    const expiresMs = new Date(grant.expiresAt).getTime();
    if (!isNaN(expiresMs) && expiresMs < nowMs) {
      return { inScope: false, reason: "grant-expired" };
    }
  }

  // ── Project-scope binding ───────────────────────────────────────────────
  // Defense in depth: the grant store already filters by projectScope on load,
  // but we re-verify here so a grant injected from any other path cannot leak
  // across project contexts (e.g. a prompt-injection carrying a foreign grant
  // id — the injection has no way to compute the correct projectScope hash, so
  // the re-check is the final backstop).
  const grantPs = grant.projectScope;
  if (grantPs) {
    const inputPs = projectScope(input);
    if (inputPs !== grantPs) {
      return { inScope: false, reason: "grant-project-mismatch" };
    }
  }

  // ── Scope check ─────────────────────────────────────────────────────────
  // Delegate to the same scopesMatch core that contract-allow uses. This
  // ensures the class-C hard refusal (payloadClass=C → always block) and
  // the destructive-delete symlink escape check apply to grants identically.
  // A grant can never silently in-scope a class-C payload.
  const result = scopesMatch(grant.scopes || {}, input);
  return {
    inScope: Boolean(result.allowed),
    reason:  result.reason || "scope-mismatch",
  };
}

module.exports = { evalConsentFloor };
