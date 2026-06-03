#!/usr/bin/env node
"use strict";

// consent/grant-store.js — Session consent grant store.
//
// Modeled on the scoped operator-token store (runtime/contract.js:200-300).
// Grants are appended to ~/.lilara/consent-grants.jsonl with the same
// security posture: O_EXCL lock, 0600 file, 0700 dir, ensureStateDirSafe guard,
// ADR-024/028/032 conventions.
//
// The grant is bound to a projectScope (from runtime/project-scope.js) so a
// grant minted in one project cannot bleed into another — avoiding the
// decision-key over-scoping gap documented in strategy-2026-05-31.
//
// Grants are NEVER read inside decide(). They are loaded at the boundary
// (pretool-gate.js) and injected as input.consentGrant. This keeps decide()
// pure and byte-identical-replayable.

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const { stateDir }                           = require("../state-paths");
const { ensureStateDirSafe, ensureBaseDirSafe } = require("../state-dir");

const STORE_FILE_NAME = "consent-grants.jsonl";

function grantsPath() {
  return path.join(stateDir(), STORE_FILE_NAME);
}

// ---------------------------------------------------------------------------
// mintConsentGrant — append a new grant record.
// ---------------------------------------------------------------------------

/**
 * Mint a new session consent grant and persist it to the grant store.
 *
 * @param {object}  scopes       — grant scopes (same shape as contract.scopes)
 * @param {object}  opts
 * @param {string}  opts.projectScope — stable project id from project-scope.js
 * @param {string|null} opts.sessionId — agent session id, or null for session-agnostic
 * @param {number}  [opts.ttlMs=3600000] — TTL in milliseconds (default 1 hour)
 * @param {string[]} [opts.floorCodes=[]] — floor codes this grant may demote
 * @returns {string} the new grant id (64-char hex)
 */
function mintConsentGrant(scopes, opts = {}) {
  const base = stateDir();
  if (!ensureBaseDirSafe(base)) {
    throw new Error("consent-grant-store: state-dir-insecure — cannot mint consent grant");
  }

  const id          = crypto.randomBytes(32).toString("hex");
  const now         = new Date();
  const ttlMs       = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : 3600000;
  const expiresAt   = new Date(now.getTime() + ttlMs).toISOString();
  const grantedAt   = now.toISOString();
  const projectScope = String(opts.projectScope || "");
  const sessionId    = opts.sessionId != null ? String(opts.sessionId) : null;
  const floorCodes   = Array.isArray(opts.floorCodes) ? opts.floorCodes : [];

  const record = JSON.stringify({
    id,
    projectScope,
    sessionId,
    scopes:     scopes || {},
    grantedAt,
    expiresAt,
    grantedVia: "consent:interactive",
    floorCodes,
  });

  const file = grantsPath();
  const dir  = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, record + "\n", { mode: 0o600 });

  return id;
}

// ---------------------------------------------------------------------------
// loadActiveGrant — find the most recent active grant for a project+session.
// ---------------------------------------------------------------------------

/**
 * Load the most recent active consent grant for a given project scope and
 * session. "Active" means: projectScope matches AND (sessionId matches OR
 * sessionId is null in the record) AND expiresAt > nowMs.
 *
 * Returns null when no matching active grant exists. Tolerates missing file
 * and malformed lines (fail-safe: no match rather than throwing).
 *
 * @param {string}      projectScope — from project-scope.js
 * @param {string|null} sessionId    — current agent session id
 * @param {number}      nowMs        — current time as epoch ms (injected; not Date.now())
 * @returns {object|null}
 */
function loadActiveGrant(projectScope, sessionId, nowMs) {
  if (!ensureStateDirSafe(stateDir())) return null;

  const file = grantsPath();
  if (!fs.existsSync(file)) return null;

  let lines;
  try {
    lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return null;
  }

  let best = null;
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }

    // Project scope must match exactly
    if (rec.projectScope !== projectScope) continue;

    // Session: record with null sessionId matches any session;
    // a non-null sessionId must match exactly.
    if (rec.sessionId !== null && rec.sessionId !== sessionId) continue;

    // Expiry: skip records where expiresAt is in the past
    if (rec.expiresAt && nowMs != null) {
      const expiresMs = new Date(rec.expiresAt).getTime();
      if (!isNaN(expiresMs) && expiresMs < nowMs) continue;
    }

    // Keep the most recently granted active record (last write wins)
    best = rec;
  }

  return best;
}

module.exports = { mintConsentGrant, loadActiveGrant, grantsPath };
