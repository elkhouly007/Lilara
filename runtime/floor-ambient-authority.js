#!/usr/bin/env node
"use strict";

// F16 (ADR-009 PR-B): ambient-authority floor helpers. Extracted from
// runtime/decision-engine.js by the monolith-decomposition sprint (2026-06).
//
// Pure; zero I/O. Path normalization mirrors runtime/ambient.js
// (backslash→slash, strip `file://`, trim trailing slash); comparisons
// lowercase for parity with case-insensitive HFS+/APFS/NTFS shapes.

const { classifyAmbientPath: _classifyAmbientPath } = require("./ambient");

function normAmbientPath(p) {
  if (typeof p !== "string" || p.length === 0) return "";
  // ARG-PRE-D-002: decode `%2e`/`%2f` BEFORE backslash fold + segment walk so
  // URL-encoded traversal cannot string-prefix-match projectRoot. Narrow on
  // purpose — full decodeURIComponent throws on malformed input and decodes
  // characters we do not need to interpret here.
  let s = p.replace(/%2e/gi, ".").replace(/%2f/gi, "/");
  s = s.replace(/\\/g, "/").replace(/^file:\/\//i, "");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  // ARG-PRE-D-001: POSIX-style `.`/`..` collapse so `<projectRoot>/../foo`
  // no longer string-prefix-matches `<projectRoot>/`. Pure string algorithm —
  // path.resolve would inject the host cwd on relative inputs and break the
  // _f16Abs shape detector downstream.
  const drive = /^[A-Za-z]:\//.test(s) ? s.slice(0, 2) : "";
  const body  = drive ? s.slice(2) : s;
  const segs  = body.split("/");
  const out   = [];
  for (const seg of segs) {
    if (seg === "" || seg === ".") {
      if (out.length === 0 && body.startsWith("/")) out.push("");
      continue;
    }
    if (seg === "..") {
      if (out.length > 1 || (out.length === 1 && out[0] !== "")) out.pop();
      continue;
    }
    out.push(seg);
  }
  return drive + out.join("/");
}
function _isInsideProject(targetPath, projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) return false;
  const np = normAmbientPath(targetPath).toLowerCase();
  const nr = normAmbientPath(projectRoot).toLowerCase();
  if (!np || !nr) return false;
  return np === nr || np.startsWith(nr + "/");
}
// gitConfig/ideSettings have a legitimate in-project shape; every other
// ambient class still fires when project-local (e.g. `<proj>/.ssh/id_rsa`).
const _PROJECT_LOCAL_AMBIENT_CLASSES = new Set(["gitConfig", "ideSettings"]);
// Segment-aligned, case-insensitive opt-in match. pathPrefix is optional;
// when absent the entry permits ALL paths of `class`.
function _matchAmbientAllow(allow, ambientClass, normPath) {
  if (!Array.isArray(allow)) return false;
  for (const e of allow) {
    if (!e || typeof e !== "object" || e.class !== ambientClass) continue;
    if (e.pathPrefix == null || e.pathPrefix === "") return true;
    const np = normAmbientPath(e.pathPrefix).toLowerCase();
    if (!np || normPath === np || normPath.startsWith(np + "/")) return true;
  }
  return false;
}
// Collect write-class candidate paths: flat targetPath, IR fileTargets
// (write/delete only), envelope.targets. Deduped in insertion order.
function collectAmbientCandidatePaths(input) {
  const out = []; const seen = Object.create(null);
  const push = (p) => { if (typeof p === "string" && p.length > 0 && !seen[p]) { seen[p] = true; out.push(p); } };
  if (input && typeof input.targetPath === "string") push(input.targetPath);
  const irT = input && input.ir && input.ir.fileTargets;
  if (Array.isArray(irT)) for (const t of irT) if (t && (t.intent === "write" || t.intent === "delete")) push(t.path);
  const envT = input && input.envelope && input.envelope.targets;
  if (Array.isArray(envT)) for (const t of envT) if (t) push(t.path);
  return out;
}
// ADR-009 PR-C: classify the first ambient touch on a decision. Independent
// of F16's fire/skip logic (project-local exception, scopes.ambient.allow) —
// used purely for receipt enrichment so audit can tell whether any decision
// touched ambient state. First-match-wins on the same candidate iteration as
// evalAmbientFloor (targetPath → IR write/delete → envelope.targets).
function classifyAmbientTouch(input) {
  for (const raw of collectAmbientCandidatePaths(input)) {
    const cls = _classifyAmbientPath(raw);
    if (cls && cls !== "nonAmbient") return { class: cls, path: raw };
  }
  return { class: null, path: null };
}
function evalAmbientFloor(input, discovered, contract) {
  const projectRoot = (discovered && discovered.projectRoot) || (input && input.projectRoot) || "";
  const allow = contract && contract.scopes && contract.scopes.ambient && Array.isArray(contract.scopes.ambient.allow)
    ? contract.scopes.ambient.allow : null;
  for (const raw of collectAmbientCandidatePaths(input)) {
    const cls = _classifyAmbientPath(raw);
    if (!cls || cls === "nonAmbient") continue;
    if (_isInsideProject(raw, projectRoot) && _PROJECT_LOCAL_AMBIENT_CLASSES.has(cls)) continue;
    // F16 PR-B v2: defer when we cannot prove the target is OUTSIDE projectRoot
    // — either projectRoot is unknown/empty, or the target is non-absolute and
    // has no anchor for prefix comparison — for ambient classes with a
    // legitimate in-project shape (.git/config, .vscode/, .claude/). Runtime
    // CLI wiring/review lanes are the right escalation; other ambient classes
    // (ssh, credentialHelper, shellRc, packageCache, ...) still fire.
    const _f16Abs = /^([A-Za-z]:[\\/]|\\\\|\/)/.test(raw);
    const _f16Shape = cls === "gitConfig" || cls === "ideSettings" || cls === "mcpConfig";
    if (_f16Shape && (!_f16Abs || !projectRoot)) continue;
    if (allow && _matchAmbientAllow(allow, cls, normAmbientPath(raw).toLowerCase())) continue;
    return { fire: true, ambientClass: cls, path: raw };
  }
  return { fire: false };
}

module.exports = { evalAmbientFloor, classifyAmbientTouch, collectAmbientCandidatePaths, normAmbientPath };
