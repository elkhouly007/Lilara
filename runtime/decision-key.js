#!/usr/bin/env node
"use strict";

// decision-key.js — Finer-grained decision key with pathBucket + branchBucket.
//
// W10 fix: the original decisionKey in policy-store.js collapses every rm -rf
// against any non-sensitive path into one key. This module adds:
//   - pathBucket: project-relative path prefix (first two segments) for scoped keys
//   - branchBucket: branch class (protected / feature / unknown) for branch-aware policy
//
// The legacy key format (tool|commandClass|targetClass|payloadClass) is preserved
// as a fallback for backward-compat with existing learned-allow entries.

const path = require("path");
// ADR-023: import normalizeCommand here (command-normalize is a leaf module
// with no runtime/* dependencies — no circular-dep risk). Enables exporting
// classifyCommandDual so all call sites can use the same dual-path hardening
// that MCP floors already use via the private _classifyCommandDual in decision-engine.js.
const { normalizeCommand } = require("./command-normalize");

// ---------------------------------------------------------------------------
// Command class detection (mirrors policy-store.js — kept in sync)
// ---------------------------------------------------------------------------

function classifyCommand(cmd) {
  const c = String(cmd || "").trim().toLowerCase();
  if (/\brm\s+(?:\S+\s+)*-[a-z]*r[a-z]*f\b|\brm\s+-{1,2}recursive\b|\brm\b.*--recursive\b/.test(c)) return "destructive-delete";
  if (/\bgit\s+push\b.*(--force|-f\b|--force-with-lease\b)/.test(c))   return "force-push";
  if (/\bcurl\b.*\|\s*(ba)?sh\b|\bwget\b.*\|\s*(ba)?sh\b/.test(c))     return "remote-exec";
  if (/\bnpx\s+(-y\b|--yes\b)/.test(c))                                 return "auto-download";
  if (/\bgit\s+reset\s+--hard\b/.test(c))                               return "hard-reset";
  if (/\b(drop\s+(database|table|schema)|truncate\s+table)\b/i.test(c)) return "destructive-db";
  if (/\bdd\s+/.test(c) && /\bof=/.test(c))                             return "disk-write";
  if (/^\s*sudo\s+/.test(c))                                             return "sudo";
  if (/\b(npm|yarn)\s+(install|add|i)\b.*\s(-g|--global)\b/.test(c))   return "global-pkg-install";
  return "generic";
}

// ---------------------------------------------------------------------------
// Dual-path command classifier (ADR-008 / ADR-023).
//
// Defeats Unicode look-alike bypasses (Cyrillic рm, full-width ｒｍ, ZWJ/ZWNJ
// insertion, IPA small-caps, etc.) by running a NFKD + confusable-fold pass
// when the raw classification returns "generic" and normalization produces a
// different string. ASCII fast-path: returns immediately without normalization
// when rawCls !== "generic" (already caught) or when norm === raw.
//
// Returns the MORE RESTRICTIVE of raw and normalized class — never under-classifies.
// Call sites should prefer this over classifyCommand() wherever the command
// may be user-supplied. Pure function; zero I/O.
//
// Note on previously-deferred call sites (now resolved):
//   - action-ir.js:490 — Khouly authorized re-baseline 2026-06-02 (ADR-026).
//     action-ir.js now uses classifyCommandDual; 2 adversarial corpus entries
//     were re-baselined (adv:critical-rm-cyrillic-er, adv:critical-rm-fullwidth).
//   - decision-key.js learned-allow keys — Khouly approved versioned v2| prefix
//     2026-06-02 (ADR-027). New approvals use fineKeyDual via policy-store.js
//     scopedKey() (v2|<body>); legacy entries match via dual-classified fallback.
//     legacyKey() stays raw (backward-compat, not on live path — see its JSDoc).
// ---------------------------------------------------------------------------
function classifyCommandDual(cmd) {
  const raw    = String(cmd || "");
  const rawCls = classifyCommand(raw);
  if (rawCls !== "generic") return rawCls;     // direct match — skip normalization
  const norm   = normalizeCommand(raw);
  if (norm === raw)         return rawCls;     // ASCII / no confusables — skip second pass
  return classifyCommand(norm);                // Unicode-folded second arm
}

// ---------------------------------------------------------------------------
// Command-class buckets for the MCP floors (F25/F26).
//
//   HARD_BLOCK_CLASSES  — unambiguous: there is no legitimate reason for an MCP
//                         tool to receive these as data. Non-demotable hard block.
//   GATED_REVIEW_CLASSES — dual-use: legitimate INPUT DATA for whole classes of
//                         MCP servers (DB connectors receive `DROP TABLE`,
//                         code-assist MCPs receive `npx -y create-react-app`,
//                         package MCPs receive `npm i -g`). The classifier cannot
//                         tell "will execute" from "is data", so these reach a
//                         configurable gate (require-review) — never a blind block,
//                         never a blind allow. (Khouly decision, 2026-05-29.)
// ---------------------------------------------------------------------------
const HARD_BLOCK_CLASSES = new Set([
  "destructive-delete", "force-push", "remote-exec",
  "hard-reset", "disk-write", "sudo",
]);
const GATED_REVIEW_CLASSES = new Set([
  "destructive-db", "auto-download", "global-pkg-install",
]);

// ---------------------------------------------------------------------------
// Path bucket: project-relative first-two-segment prefix
// ---------------------------------------------------------------------------

function pathBucket(targetPath, projectRoot) {
  if (!targetPath) return "default-target";
  if (/\b(prod(uction)?|secrets?|credentials?|\.env|terraform|infra|vault)\b/i.test(targetPath)) {
    return "sensitive-target";
  }
  if (projectRoot) {
    try {
      const rel = path.relative(projectRoot, targetPath).replace(/\\/g, "/");
      if (!rel.startsWith("..")) {
        const parts = rel.split("/").filter(Boolean);
        if (parts.length >= 2) return parts.slice(0, 2).join("/");
        if (parts.length === 1) return parts[0];
      }
    } catch { /* ignore */ }
  }
  return "default-target";
}

// ---------------------------------------------------------------------------
// Branch bucket: classify branch name
// ---------------------------------------------------------------------------

const PROTECTED_RE = /^(main|master|release\/.*|hotfix\/.*)$/i;
const FEATURE_RE   = /^(feat(ure)?\/|fix\/|chore\/|refactor\/|dev\/)/i;

function branchBucket(branch) {
  if (!branch) return "unknown-branch";
  if (PROTECTED_RE.test(branch)) return "protected-branch";
  if (FEATURE_RE.test(branch))   return "feature-branch";
  return "other-branch";
}

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

/**
 * Build a finer-grained decision key.
 *
 * Format: tool|commandClass|pathBucket|branchBucket|payloadClass
 *
 * @param {object} input — { tool, command, targetPath, projectRoot, branch, payloadClass }
 * @returns {string}
 */
function fineKey(input = {}) {
  const tool         = String(input.tool         || "").toLowerCase() || "unknown-tool";
  const cmdClass     = classifyCommand(input.command);
  const pBucket      = pathBucket(String(input.targetPath || ""), input.projectRoot);
  const bBucket      = branchBucket(String(input.branch || ""));
  const payloadClass = String(input.payloadClass || "A").toUpperCase();
  return [tool, cmdClass, pBucket, bBucket, payloadClass].join("|");
}

/**
 * ADR-027: Dual-path fineKey for the v2 learned-allow namespace.
 *
 * Uses classifyCommandDual instead of classifyCommand so Unicode look-alike
 * commands (Cyrillic рm, full-width ｒｍ, ZWJ splice) are classified correctly
 * and cannot inherit a generic learned-allow grant.
 *
 * Returns the unprefixed 5-part body; the v2| prefix is added by policy-store.js
 * scopedKey() so the prefix is applied consistently and only once.
 *
 * Format (same structure as fineKey): tool|commandClass|pathBucket|branchBucket|payloadClass
 *
 * @param {object} input — { tool, command, targetPath, projectRoot, branch, payloadClass }
 * @returns {string}
 */
function fineKeyDual(input = {}) {
  const tool         = String(input.tool         || "").toLowerCase() || "unknown-tool";
  const cmdClass     = classifyCommandDual(input.command);  // ADR-027: dual-path
  const pBucket      = pathBucket(String(input.targetPath || ""), input.projectRoot);
  const bBucket      = branchBucket(String(input.branch || ""));
  const payloadClass = String(input.payloadClass || "A").toUpperCase();
  return [tool, cmdClass, pBucket, bBucket, payloadClass].join("|");
}

/**
 * Legacy key for backward-compat with existing learned-allow entries.
 * Matches the key format produced by policy-store.js:decisionKey.
 *
 * ADR-027: backward-compat only — not on the live learned-allow path
 * (superseded by policy-store.js v2 scoped keys via fineKeyDual + scopedKey).
 * Do NOT migrate to classifyCommandDual: callers that depend on this function
 * for key-format matching would need coordinated updates. Kept raw intentionally.
 *
 * Format: tool|commandClass|targetClass|payloadClass
 */
function legacyKey(input = {}) {
  const tool    = String(input.tool    || "").toLowerCase() || "unknown-tool";
  const cmd     = String(input.command || "").toLowerCase();
  const payloadClass = String(input.payloadClass || "A").toUpperCase();
  const targetClass  = /\b(prod|production|secrets?|credentials?|\.env|terraform|infra)\b/i
    .test(String(input.targetPath || "")) ? "sensitive-target" : "default-target";
  const cmdClass     = classifyCommand(cmd);
  return [tool, cmdClass, targetClass, payloadClass].join("|");
}

module.exports = {
  fineKey, fineKeyDual, legacyKey, classifyCommand, classifyCommandDual,
  HARD_BLOCK_CLASSES, GATED_REVIEW_CLASSES, pathBucket, branchBucket,
};
