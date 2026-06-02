#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { emitEvent } = require("./telemetry");
const { fineKey: computeFineKey, fineKeyDual: computeFineKeyDual } = require("./decision-key");

// ADR-027: versioned learned-allow key prefix. New approvals are recorded under
// v2|<fineKeyDual-body> so the classification uses the dual-path classifier and
// Unicode look-alike commands (Cyrillic рm, full-width ｒｍ) cannot inherit a
// generic learned-allow grant. Existing legacy entries (no prefix, raw-classified)
// still match via the dual-classified fallback in legacyScopedKey(). Old bypass-
// shaped entries are NOT promoted — they age out naturally (lazy age-out strategy,
// Khouly approved 2026-06-02).
const LEARNED_KEY_VERSION = "v2";
const { projectScope } = require("./project-scope");
const { stateDir } = require("./state-paths");

function paths() {
  const baseDir = stateDir();
  return {
    baseDir,
    policyFile: path.join(baseDir, "learned-policy.json"),
  };
}

function ensureBaseDir() {
  const { baseDir } = paths();
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  }
}

function emptyPolicy() {
  return {
    learnedAllows: {},
    approvalCounts: {},
    suggestions: {},
    autoAllowOnce: {},
  };
}

// Module-level cache — valid for the lifetime of one Node.js process.
// Each hook invocation is a fresh process, so this never stales across calls.
// Invalidated immediately on any write so reads after consumeAutoAllowOnce
// observe the updated value within the same decide() call.
let _policyCache = null;

function loadPolicy() {
  if (_policyCache !== null) return _policyCache;
  const { policyFile } = paths();
  try {
    _policyCache = JSON.parse(fs.readFileSync(policyFile, "utf8"));
  } catch (err) {
    // If the file exists but is corrupt, back it up and warn.
    if (err && err.code !== "ENOENT") {
      try {
        const bak = `${policyFile}.corrupt-${Date.now()}.bak`;
        fs.copyFileSync(policyFile, bak);
        process.stderr.write(`[ARG] WARNING: learned-policy.json corrupt — backed up to ${path.basename(bak)}, resetting to defaults.\n`);
        emitEvent("policy-store-corrupt", { file: "learned-policy.json", errCode: String(err.code || "parse-error") });
      } catch { /* backup is best-effort */ }
    }
    _policyCache = emptyPolicy();
  }
  return _policyCache;
}

function savePolicy(policy) {
  if (process.env.LILARA_READONLY_CONTRACT === "1") { _policyCache = policy; return; }
  _policyCache = null;
  try {
    ensureBaseDir();
    const { policyFile } = paths();
    const data = JSON.stringify(policy, null, 2) + "\n";
    const tmp = policyFile + ".tmp";
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    try {
      fs.renameSync(tmp, policyFile);
    } catch {
      // Atomic rename failed (e.g. EPERM on Windows when file is locked by AV).
      // Fall back to direct write — slightly less atomic but functionally correct.
      try {
        fs.writeFileSync(policyFile, data, { mode: 0o600 });
      } catch { /* best-effort fallback */ }
      try { fs.unlinkSync(tmp); } catch { /* tmp cleanup is best-effort */ }
    }
  } finally {
    // Always repopulate cache so callers in the same process see the new state,
    // even if the disk write failed. Each hook invocation is a separate process,
    // so cross-process cache sharing is never an issue.
    _policyCache = policy;
  }
}

function decisionKey(input = {}) {
  const tool = String(input.tool || "").trim().toLowerCase() || "unknown-tool";
  const cmd = String(input.command || "").trim().toLowerCase();
  const payloadClass = String(input.payloadClass || "A").trim().toUpperCase();
  const targetClass = /\b(prod|production|secrets?|credentials?|\.env|terraform|infra)\b/i.test(String(input.targetPath || ""))
    ? "sensitive-target"
    : "default-target";

  let commandClass = "generic";
  if (/\brm\s+(-[A-Za-z]*r[A-Za-z]*f|-{1,2}recursive)\b/.test(cmd)) commandClass = "destructive-delete";
  else if (/\bgit\s+push\b.*(--force|-f\b|--force-with-lease\b)/.test(cmd)) commandClass = "force-push";
  else if (/\bcurl\b.*\|\s*(ba)?sh\b|\bwget\b.*\|\s*(ba)?sh\b/.test(cmd)) commandClass = "remote-exec";
  else if (/\bnpx\s+(-y\b|--yes\b)/.test(cmd)) commandClass = "auto-download";
  else if (/\b(npm|yarn)\s+(install|add|i)\b.*\s(-g|--global)\b|\b(npm|yarn)\s+(-g|--global)\s+(install|add|i)\b/.test(cmd)) commandClass = "global-package-install";
  else if (/^\s*sudo\s+/.test(cmd)) commandClass = "sudo";

  return [tool, commandClass, targetClass, payloadClass].join("|");
}

// L6: the learned-policy lookup key is the project-agnostic fineKey prefixed by
// a per-project scope tag, so an approval recorded in one project never matches
// an action in another. Returns null when no stable project identity exists —
// callers MUST treat null as "no match / do not record" (fail-safe, never a
// fall-through to the old global key). The "::" separator cannot occur in a
// fineKey (pipe-delimited) or a scope tag ("<char>:<hex>"), so a legacy unscoped
// entry can never collide with a scoped one — pre-L6 entries are orphaned.
//
// ADR-027: scopedKey now produces a v2| prefixed key using fineKeyDual (dual-path
// classification). New approvals are written under this key. Existing entries
// recorded without the v2| prefix are matched via legacyScopedKey() below.
function scopedKey(input = {}) {
  const scope = projectScope(input);
  if (scope == null) return null;
  return scope + "::" + LEARNED_KEY_VERSION + "|" + computeFineKeyDual(input);
}

// ADR-027: backward-compat read key for pre-v2 learned-allow entries.
// Uses fineKeyDual (not fineKey/raw) so that confusable Unicode variants
// (Cyrillic рm → destructive-delete) produce a different body than a stored
// generic grant — closing the bypass without orphaning legitimate ASCII grants
// (dual==raw for ASCII, so existing legit entries still match).
// Never used for writes — only as a fallback in read operations.
function legacyScopedKey(input = {}) {
  const scope = projectScope(input);
  if (scope == null) return null;
  return scope + "::" + computeFineKeyDual(input);
}

function getApprovalCount(input = {}) {
  const v2Key = scopedKey(input);
  if (v2Key == null) return 0;
  const policy = loadPolicy();
  const v2Count = Number(policy.approvalCounts?.[v2Key] || 0);
  if (v2Count > 0) return v2Count;
  // Fallback: check legacy entry
  const legacyKey = legacyScopedKey(input);
  return Number((legacyKey != null && policy.approvalCounts?.[legacyKey]) || 0);
}

function isLearnedAllowed(input = {}) {
  const v2Key = scopedKey(input);
  if (v2Key == null) return false;
  const policy = loadPolicy();
  if (Boolean(policy.learnedAllows?.[v2Key])) return true;
  // ADR-027 fallback: check legacy (pre-v2) entry for backward compat.
  // legacyScopedKey uses dual-path classification so confusable commands
  // (Cyrillic рm) resolve to destructive-delete and cannot match a
  // legacy generic grant — the bypass remains closed.
  const legacyKey = legacyScopedKey(input);
  return legacyKey != null && Boolean(policy.learnedAllows?.[legacyKey]);
}

function recordApproval(input = {}) {
  const fine = scopedKey(input);
  if (fine == null) return 0; // no stable project scope -> do not build toward a learned-allow
  const policy = loadPolicy();
  const current = Number(policy.approvalCounts?.[fine] || 0) + 1;
  const now = new Date().toISOString();
  policy.approvalCounts[fine] = current;

  if (current >= 3 && !policy.learnedAllows?.[fine]) {
    const previous = policy.suggestions?.[fine] || {};
    policy.suggestions[fine] = {
      type: "learned-allow",
      status: "pending",
      approvalCount: current,
      createdAt: previous.createdAt || now,
      eligibleAt: previous.eligibleAt || now,
      updatedAt: now,
      lastApprovedAt: now,
      summary: fine,
    };
  }

  savePolicy(policy);
  return current;
}

function setLearnedAllow(input = {}, enabled = true) {
  const fine = scopedKey(input);
  if (fine == null) return null; // unknown project scope -> cannot record a scoped grant
  const policy = loadPolicy();
  policy.learnedAllows[fine] = Boolean(enabled);
  if (policy.suggestions?.[fine]) {
    policy.suggestions[fine].status = enabled ? "accepted" : "dismissed";
    policy.suggestions[fine].updatedAt = new Date().toISOString();
  }
  savePolicy(policy);
  return fine;
}

function listSuggestions() {
  const policy = loadPolicy();
  return Object.entries(policy.suggestions || {})
    .map(([key, value]) => ({ key, ...value }))
    .filter((item) => item.status === "pending")
    .sort((a, b) => (b.approvalCount || 0) - (a.approvalCount || 0));
}

function getSuggestion(key) {
  const policy = loadPolicy();
  const value = policy.suggestions?.[key];
  return value ? { key, ...value } : null;
}

function getSuggestionForInput(input = {}) {
  const fine = scopedKey(input);
  if (fine != null) {
    const s = getSuggestion(fine);
    if (s) return s;
  }
  // ADR-027: fall back to legacy key for pre-v2 suggestions
  const legacy = legacyScopedKey(input);
  return legacy != null ? getSuggestion(legacy) : null;
}

function acceptSuggestion(key) {
  const policy = loadPolicy();
  if (!policy.suggestions?.[key]) return false;
  const now = new Date().toISOString();
  policy.learnedAllows[key] = true;
  policy.suggestions[key].status = "accepted";
  policy.suggestions[key].acceptedAt = now;
  policy.suggestions[key].updatedAt = now;
  savePolicy(policy);
  return true;
}

function dismissSuggestion(key) {
  const policy = loadPolicy();
  if (!policy.suggestions?.[key]) return false;
  const now = new Date().toISOString();
  policy.suggestions[key].status = "dismissed";
  policy.suggestions[key].dismissedAt = now;
  policy.suggestions[key].updatedAt = now;
  savePolicy(policy);
  return true;
}

function listAcceptedSuggestions() {
  const policy = loadPolicy();
  return Object.entries(policy.suggestions || {})
    .map(([key, value]) => ({ key, ...value }))
    .filter((item) => item.status === "accepted")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function listDismissedSuggestions() {
  const policy = loadPolicy();
  return Object.entries(policy.suggestions || {})
    .map(([key, value]) => ({ key, ...value }))
    .filter((item) => item.status === "dismissed")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function summarizePolicy() {
  const policy = loadPolicy();
  return {
    learnedAllowCount: Object.values(policy.learnedAllows || {}).filter(Boolean).length,
    approvalKeyCount: Object.keys(policy.approvalCounts || {}).length,
    pendingSuggestionCount: listSuggestions().length,
    acceptedSuggestionCount: listAcceptedSuggestions().length,
    dismissedSuggestionCount: listDismissedSuggestions().length,
  };
}

function grantAutoAllowOnce(key) {
  const policy = loadPolicy();
  if (!policy.suggestions?.[key] || policy.suggestions[key].status !== "pending") return false;
  if (!policy.autoAllowOnce) policy.autoAllowOnce = {};
  policy.autoAllowOnce[key] = (Number(policy.autoAllowOnce[key] || 0)) + 1;
  savePolicy(policy);
  return true;
}

function consumeAutoAllowOnce(key) {
  const policy = loadPolicy();
  const count = Number(policy.autoAllowOnce?.[key] || 0);
  if (count <= 0) return false;
  if (!policy.autoAllowOnce) policy.autoAllowOnce = {};
  if (count <= 1) delete policy.autoAllowOnce[key];
  else policy.autoAllowOnce[key] = count - 1;
  savePolicy(policy);
  return true;
}

function hasAutoAllowOnce(key) {
  const policy = loadPolicy();
  return Number(policy.autoAllowOnce?.[key] || 0) > 0;
}

function getPolicyFacts(input = {}) {
  const fine = scopedKey(input);
  const policy = loadPolicy();
  // ADR-027: prefer v2 key; fall back to legacy for read operations.
  const legacyFine = legacyScopedKey(input);
  const effectiveFine = fine;
  const suggestion =
    (effectiveFine != null && policy.suggestions?.[effectiveFine]) ||
    (legacyFine != null && policy.suggestions?.[legacyFine]) || null;
  const effectiveSuggestionKey = suggestion
    ? (policy.suggestions?.[effectiveFine] ? effectiveFine : legacyFine)
    : null;
  return {
    key: effectiveFine,
    approvalCount: getApprovalCount(input),
    learnedAllow: isLearnedAllowed(input),
    pendingSuggestion: suggestion && suggestion.status === "pending"
      ? { key: effectiveSuggestionKey, ...suggestion } : null,
    acceptedSuggestion: suggestion && suggestion.status === "accepted"
      ? { key: effectiveSuggestionKey, ...suggestion } : null,
    dismissedSuggestion: suggestion && suggestion.status === "dismissed"
      ? { key: effectiveSuggestionKey, ...suggestion } : null,
  };
}

module.exports = {
  paths,
  loadPolicy,
  savePolicy,
  decisionKey,
  scopedKey,
  getApprovalCount,
  isLearnedAllowed,
  recordApproval,
  setLearnedAllow,
  listSuggestions,
  listAcceptedSuggestions,
  listDismissedSuggestions,
  getSuggestion,
  getSuggestionForInput,
  acceptSuggestion,
  dismissSuggestion,
  summarizePolicy,
  getPolicyFacts,
  grantAutoAllowOnce,
  consumeAutoAllowOnce,
  hasAutoAllowOnce,
};
