#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { emitEvent } = require("./telemetry");
const { fineKey: computeFineKey } = require("./decision-key");
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

function getApprovalCount(input = {}) {
  const policy = loadPolicy();
  const fine = computeFineKey(input);
  return Number(policy.approvalCounts?.[fine] || 0);
}

function isLearnedAllowed(input = {}) {
  const policy = loadPolicy();
  const fine = computeFineKey(input);
  return Boolean(policy.learnedAllows?.[fine]);
}

function recordApproval(input = {}) {
  const policy = loadPolicy();
  const fine = computeFineKey(input);
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
  const policy = loadPolicy();
  const fine = computeFineKey(input);
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
  const fine = computeFineKey(input);
  return getSuggestion(fine);
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
  const fine = computeFineKey(input);
  const policy = loadPolicy();
  const suggestion = policy.suggestions?.[fine] || null;
  return {
    key: fine,
    approvalCount: Number(policy.approvalCounts?.[fine] || 0),
    learnedAllow: Boolean(policy.learnedAllows?.[fine]),
    pendingSuggestion: suggestion && suggestion.status === "pending" ? { key: fine, ...suggestion } : null,
    acceptedSuggestion: suggestion && suggestion.status === "accepted" ? { key: fine, ...suggestion } : null,
    dismissedSuggestion: suggestion && suggestion.status === "dismissed" ? { key: fine, ...suggestion } : null,
  };
}

module.exports = {
  paths,
  loadPolicy,
  savePolicy,
  decisionKey,
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
