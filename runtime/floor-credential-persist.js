#!/usr/bin/env node
"use strict";

// F24: credential-persistence-write floor helpers. Pure; zero I/O.
// Extracted from runtime/decision-engine.js (lines 500-562) by the
// monolith-decomposition sprint (2026-06).
//
// Collects in-project write targets and checks whether any touch a credential
// or execution-persistence path that should always be blocked by default.

const { PERSISTENCE_PATTERNS } = require("./provenance-graph");
const { isAmbientPath: _isAmbientPath } = require("./ambient");
const { globMatch: _globMatch } = require("./glob-match");

function _collectWriteTargets(input) {
  const out = []; const seen = Object.create(null);
  const push = (p, sens) => {
    if (typeof p === "string" && p.length > 0 && !seen[p]) {
      seen[p] = true; out.push({ path: p, sensitivity: sens || null });
    }
  };
  // flat-field fallback for replay (replay calls decide() without building IR)
  if (input && typeof input.targetPath === "string") push(input.targetPath, null);
  if (input && typeof input.file_path  === "string") push(input.file_path,  null);
  // IR fileTargets (write/delete only; sensitivity already classified)
  const irT = input && input.ir && input.ir.fileTargets;
  if (Array.isArray(irT)) {
    for (const t of irT) {
      if (t && (t.intent === "write" || t.intent === "delete")) push(t.path, t.sensitivity);
    }
  }
  return out;
}
function _isHighSensitivityPath(p) {
  const s = String(p || "").replace(/\\/g, "/");
  return (
    /\/\.ssh\b/.test(s) || /\/\.aws\b/.test(s) || /\/\.gnupg\b/.test(s) ||
    /\/\.password-store\b/.test(s) || /\/\.kube\b/.test(s) ||
    /\/(vault|secrets?)\b/i.test(s) || /\/(id_rsa|id_ed25519|id_ecdsa)\b/.test(s) ||
    /\/(payments?|billing)\b/i.test(s) || /\/private[-_]?key\b/i.test(s)
  );
}
function _isPersistencePath(p) {
  return PERSISTENCE_PATTERNS.some((re) => re.test(p));
}
function evalCredPersistFloor(input, contract) {
  // F24 only applies to explicit file-write tool calls (Edit/Write). For Bash
  // commands, `targetPath` is metadata about the project scope — the actual risk
  // from writing credential/persistence files via shell is handled by pattern
  // matching (authorized-keys-modification, persistence-crontab, etc.). Firing
  // F24 on Bash targetPath would trigger on legitimate `sudo service restart`
  // commands whose targetPath happens to be in a vault/payments directory.
  const toolKindIr = input && input.ir && input.ir.toolKind;
  const toolName   = String((input && input.tool) || "").toLowerCase();
  const isFileWrite = toolKindIr === "file-write" || toolName === "edit" || toolName === "write";
  if (!isFileWrite) return { fire: false };
  const targets = _collectWriteTargets(input);
  if (targets.length === 0) return { fire: false };
  const allow = contract && contract.scopes && contract.scopes.files && Array.isArray(contract.scopes.files.allow)
    ? contract.scopes.files.allow : null;
  for (const { path, sensitivity } of targets) {
    // F16 owns ambient paths (ssh, shell-rc, packageCache, etc.) — skip so F16
    // opt-ins via scopes.ambient.allow are not overridden by F24.
    if (_isAmbientPath(path)) continue;
    const highSens = sensitivity === "high" || _isHighSensitivityPath(path);
    const persist  = _isPersistencePath(path);
    if (!highSens && !persist) continue;
    if (allow && allow.some((pat) => {
      try { return _globMatch(path, pat); } catch { return false; }
    })) continue;
    return { fire: true, path, reason: highSens ? "high-sensitivity" : "persistence" };
  }
  return { fire: false };
}

module.exports = { evalCredPersistFloor };
