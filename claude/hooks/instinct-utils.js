/**
 * instinct-utils.js — Lilara
 *
 * Shared utilities for the instinct learning system.
 *
 * SAFETY CONTRACT:
 * - No external packages (stdlib only: fs, path, os)
 * - No network calls
 * - No access to session content or payloads
 * - Writes only to ~/.lilara/instincts/ (user-local, not synced)
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { instinctDir } = require("../../runtime/state-paths");

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

const INSTINCT_DIR  = instinctDir();
const PENDING_FILE  = path.join(INSTINCT_DIR, "pending.json");
const CONFIDENT_FILE = path.join(INSTINCT_DIR, "confident.json");

const TTL_DAYS = 30; // pending instincts expire after 30 days

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function ensureDir() {
  if (!fs.existsSync(INSTINCT_DIR)) {
    fs.mkdirSync(INSTINCT_DIR, { recursive: true, mode: 0o700 });
  }
}

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeJSON(filePath, data) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Instinct schema
// ---------------------------------------------------------------------------

/**
 * Create a new instinct record.
 *
 * Fields captured:
 *   - tool_name: which Claude tool was used (safe metadata)
 *   - event_type: category of the pattern (safe metadata)
 *   - trigger: human-readable description — written by Ahmed, never auto-extracted content
 *   - behavior: what was done — written by Ahmed, never auto-extracted content
 *   - outcome: positive | negative | neutral
 *   - confidence: 0.0–1.0 (starts at 0.1, increases with use)
 *   - uses_count: how many times this pattern has been applied
 *   - status: pending | candidate | confident | pruned
 *
 * NEVER captured:
 *   - session content, user prompts, file contents, API responses, secrets
 */
function createInstinct({ tool_name, event_type, trigger, behavior, outcome = "neutral" }) {
  return {
    id: `inst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + TTL_DAYS * 86400 * 1000).toISOString(),
    tool_name:  tool_name  || "unknown",
    event_type: event_type || "general",
    trigger:    trigger    || "",
    behavior:   behavior   || "",
    outcome,
    confidence: 0.1,
    uses_count: 1,
    status: "pending",
  };
}

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

/**
 * Score formula: (uses_count × outcome_weight) / (age_in_days + 1)
 *
 * outcome_weight: positive=1.0, neutral=0.5, negative=0.0
 * Threshold to auto-promote to "candidate": 0.5
 * Threshold to mark "confident" (requires manual review): 0.8
 */
function scoreInstinct(instinct) {
  const outcomeWeight = { positive: 1.0, neutral: 0.5, negative: 0.0 };
  const weight  = outcomeWeight[instinct.outcome] ?? 0.5;
  const ageMs   = Date.now() - new Date(instinct.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return (instinct.uses_count * weight) / (ageDays + 1);
}

function recalculateStatus(instinct) {
  const score = scoreInstinct(instinct);
  if (instinct.status === "pruned") return instinct;
  if (score >= 0.8) return { ...instinct, confidence: Math.min(score, 1.0), status: "candidate" };
  if (score >= 0.5) return { ...instinct, confidence: Math.min(score, 1.0), status: "pending" };
  return { ...instinct, confidence: Math.min(score, 1.0) };
}

// ---------------------------------------------------------------------------
// TTL pruning
// ---------------------------------------------------------------------------

function isExpired(instinct) {
  if (!instinct.expires_at) return false;
  return new Date(instinct.expires_at) < new Date();
}

function prunePending() {
  const instincts = readJSON(PENDING_FILE);
  const active    = instincts.filter((i) => !isExpired(i));
  const pruned    = instincts.length - active.length;
  writeJSON(PENDING_FILE, active);
  return pruned;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

function appendPending(instinct) {
  ensureDir();
  const list = readJSON(PENDING_FILE);
  list.push(instinct);
  writeJSON(PENDING_FILE, list);
}

function listPending() {
  return readJSON(PENDING_FILE).filter((i) => i.status !== "pruned");
}

function listConfident() {
  return readJSON(CONFIDENT_FILE);
}

/**
 * Promote a pending instinct to the confident store.
 * Requires explicit call — never happens automatically.
 * Ahmed must review before promoting.
 */
function promote(id) {
  const pending   = readJSON(PENDING_FILE);
  const idx       = pending.findIndex((i) => i.id === id);
  if (idx === -1) return false;

  const instinct  = { ...pending[idx], status: "confident", promoted_at: new Date().toISOString() };
  pending.splice(idx, 1);
  writeJSON(PENDING_FILE, pending);

  const confident = readJSON(CONFIDENT_FILE);
  confident.push(instinct);
  writeJSON(CONFIDENT_FILE, confident);
  return true;
}

/**
 * Summary for session-start display.
 * Returns counts only — never exposes raw content to stdout.
 */
function summary() {
  const pending   = listPending();
  const confident = listConfident();
  const candidates = pending.filter((i) => i.status === "candidate");
  const expiringSoon = pending.filter((i) => {
    const daysLeft = (new Date(i.expires_at) - Date.now()) / (1000 * 60 * 60 * 24);
    return daysLeft < 7 && daysLeft > 0;
  });
  return { pending: pending.length, candidates: candidates.length, confident: confident.length, expiringSoon: expiringSoon.length };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  INSTINCT_DIR,
  PENDING_FILE,
  CONFIDENT_FILE,
  createInstinct,
  appendPending,
  listPending,
  listConfident,
  promote,
  prunePending,
  scoreInstinct,
  recalculateStatus,
  summary,
};
