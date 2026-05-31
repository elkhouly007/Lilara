#!/usr/bin/env node
"use strict";

// change-intent.js — F20 declared-envelope vs Action-IR drift evaluator
// (Lilara ADR-012 / scope §5.1 v0.5 Stage D wave 2).
//
// Compares the declared-intent envelope (envelope.declaredIntent) against the
// canonical Action IR built by adapters. Out-of-intent actuals are tagged with
// a drift class + severity that decision-engine routes through F20.
//
// Pure, zero-dep, no I/O. Byte-stable: identical envelope + identical IR
// produce identical output (sorted classes, deterministic detail order,
// first-five truncation). Fail-open: any internal exception returns
// { drift:false, classes:[], details:[], severity:"none", error:"<msg>" } —
// the engine journals the error as a degraded-mode marker and continues.

const { globMatch } = require("./glob-match");
const { classifyIntent } = require("./intent-classifier");

const DRIFT_CLASSES = Object.freeze({
  fileWrite:    "file-write-out-of-scope",
  fileDelete:   "file-delete-out-of-scope",
  command:      "command-out-of-scope",
  commandClass: "command-class-out-of-scope",
  networkHost:  "network-host-out-of-scope",
  policyEdit:   "policy-edit-not-declared",
});

// Paths that mutate Lilara policy / contracts. Any write/delete against one of
// these — when allowedOps.policyEdits is not explicitly true — escalates
// severity to `high` regardless of the other drift classes.
const POLICY_PATH_PATTERNS = Object.freeze([
  // The contract file is lilara.contract.json (renamed from horus.contract.json
  // at the Lilara rebrand, PR #59). The pattern below was left as the dead
  // pre-rebrand name, so F20's policy-edit drift escalation silently stopped
  // firing for edits to the real contract file. Restored to the live name so
  // contract tampering is caught again (default-deny: see the policyEdits check).
  /(^|\/)lilara\.contract(\.v\d+)?\.json(\.example)?$/i,
  /(^|\/)CONTRACT\.md$/i,
  /(^|\/)references\/adr-\d+/i,
  /(^|\/)runtime\/decision-engine\.js$/i,
  /(^|\/)runtime\/decision-lattice\.js$/i,
  /(^|\/)runtime\/contract\.js$/i,
]);

const DETAIL_MAX = 5;
const DETAIL_VALUE_MAX = 64;

function _truncate(s) {
  const t = String(s == null ? "" : s);
  return t.length > DETAIL_VALUE_MAX ? t.slice(0, DETAIL_VALUE_MAX) : t;
}

function _addDetail(details, cls, value) {
  if (details.length >= DETAIL_MAX) return;
  details.push({ class: cls, value: _truncate(value) });
}

function _matchPathAny(value, patterns) {
  if (!Array.isArray(patterns)) return false;
  for (const pat of patterns) {
    if (typeof pat !== "string" || pat.length === 0) continue;
    try {
      if (globMatch(value, pat)) return true;
    } catch { /* malformed pattern — skip */ }
  }
  return false;
}

function _hostMatchAny(host, allow) {
  if (typeof host !== "string" || host.length === 0) return false;
  if (!Array.isArray(allow)) return false;
  const h = host.toLowerCase();
  for (const a of allow) {
    if (typeof a !== "string" || a.length === 0) continue;
    const al = a.toLowerCase();
    if (al === h) return true;
    if (al.startsWith(".") && h.endsWith(al)) return true;          // .example.com
    if (al.startsWith("*.") && h.endsWith(al.slice(1))) return true; // *.example.com
  }
  return false;
}

function _isPolicyPath(p) {
  const s = String(p || "").replace(/\\/g, "/");
  if (!s) return false;
  for (const re of POLICY_PATH_PATTERNS) if (re.test(s)) return true;
  return false;
}

// diffEnvelopeVsIr(envelope, ir) — compare each declared allowedOps.* scope
// against the IR-built actuals. Returns:
//   { drift, classes[], details[], severity, error? }
//
// drift     : boolean — any class triggered
// classes   : sorted unique drift-class identifiers
// details   : up to 5 { class, value(<=64 chars) } entries
// severity  : "none" | "low" | "medium" | "high"
// error     : optional, present only when the helper fail-opened
function diffEnvelopeVsIr(envelope, ir) {
  try {
    const declared = envelope && envelope.declaredIntent;
    const allowed = declared && declared.allowedOps;
    if (!declared || !allowed || typeof allowed !== "object") {
      return { drift: false, classes: [], details: [], severity: "none" };
    }
    if (!ir || typeof ir !== "object") {
      return { drift: false, classes: [], details: [], severity: "none" };
    }

    const fileTargets    = Array.isArray(ir.fileTargets)    ? ir.fileTargets    : [];
    const networkTargets = Array.isArray(ir.networkTargets) ? ir.networkTargets : [];
    const classes = new Set();
    const details = [];

    if (Array.isArray(allowed.fileWrites)) {
      for (const t of fileTargets) {
        if (!t || t.intent !== "write") continue;
        const p = String(t.path || "");
        if (!p) continue;
        if (!_matchPathAny(p, allowed.fileWrites)) {
          classes.add(DRIFT_CLASSES.fileWrite);
          _addDetail(details, DRIFT_CLASSES.fileWrite, p);
        }
      }
    }

    if (Array.isArray(allowed.fileDeletes)) {
      for (const t of fileTargets) {
        if (!t || t.intent !== "delete") continue;
        const p = String(t.path || "");
        if (!p) continue;
        if (!_matchPathAny(p, allowed.fileDeletes)) {
          classes.add(DRIFT_CLASSES.fileDelete);
          _addDetail(details, DRIFT_CLASSES.fileDelete, p);
        }
      }
    }

    if (Array.isArray(allowed.commands)) {
      const argv0 = typeof ir.argv0 === "string" ? ir.argv0 : "";
      const cmdName = argv0 ? argv0.split(/[\\/]/).pop() : "";
      if (cmdName) {
        const al = allowed.commands.map((c) => String(c || ""));
        if (al.indexOf(cmdName) === -1) {
          classes.add(DRIFT_CLASSES.command);
          _addDetail(details, DRIFT_CLASSES.command, cmdName);
        }
      }
    }

    if (Array.isArray(allowed.commandClasses)) {
      const cmd = typeof ir.command === "string" ? ir.command : "";
      if (cmd) {
        const result = classifyIntent(cmd);
        const intent = result && typeof result.intent === "string" ? result.intent : "unknown";
        if (intent && intent !== "unknown" && allowed.commandClasses.indexOf(intent) === -1) {
          classes.add(DRIFT_CLASSES.commandClass);
          _addDetail(details, DRIFT_CLASSES.commandClass, intent);
        }
      }
    }

    if (Array.isArray(allowed.networkHosts)) {
      for (const n of networkTargets) {
        if (!n || typeof n.host !== "string" || !n.host) continue;
        if (!_hostMatchAny(n.host, allowed.networkHosts)) {
          classes.add(DRIFT_CLASSES.networkHost);
          _addDetail(details, DRIFT_CLASSES.networkHost, n.host);
        }
      }
    }

    // policyEdits: only enforced when explicitly declared false. `true` means
    // operator-allowed; `null/undefined` means undeclared (no constraint).
    if (allowed.policyEdits === false) {
      for (const t of fileTargets) {
        if (!t || (t.intent !== "write" && t.intent !== "delete")) continue;
        const p = String(t.path || "");
        if (!p) continue;
        if (_isPolicyPath(p)) {
          classes.add(DRIFT_CLASSES.policyEdit);
          _addDetail(details, DRIFT_CLASSES.policyEdit, p);
          break;
        }
      }
    }

    const classArr = [...classes].sort();
    const drift = classArr.length > 0;
    let severity = "none";
    if (drift) {
      const hasPolicy   = classes.has(DRIFT_CLASSES.policyEdit);
      const destructive = Boolean(ir.destructive);
      const hasWriteOrDelete =
        classes.has(DRIFT_CLASSES.fileWrite) || classes.has(DRIFT_CLASSES.fileDelete);
      if (hasPolicy || destructive || classArr.length >= 2) {
        severity = "high";
      } else if (hasWriteOrDelete) {
        severity = "medium";
      } else {
        severity = "low";
      }
    }

    return { drift, classes: classArr, details, severity };
  } catch (err) {
    return {
      drift: false,
      classes: [],
      details: [],
      severity: "none",
      error: err && err.message ? String(err.message) : String(err),
    };
  }
}

module.exports = { diffEnvelopeVsIr, DRIFT_CLASSES };
