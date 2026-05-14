#!/usr/bin/env node
"use strict";

// cross-agent-lock.js — F17 cross-agent-lock floor helper (PR-A).
//
// First enforcement slice for HAP v0.5 cross-agent-lock floor. The runtime
// reads lock records that live under
// `<HORUS_STATE_DIR>/cross-agent-locks/*.json` — one record per file. A
// lock with a DIFFERENT owner that is not expired and overlaps the current
// decision's write-target path (or projectRoot, for project-scope locks)
// causes F17 to fire (block).
//
// Scope of this PR:
//   - read-only consumer of lock state (no acquire/release API yet)
//   - state-dir-local, single-host (NOT a distributed lock manager)
//   - no harness wiring; floor is engine-baked only
//
// Lock record shape (minimal):
//   {
//     "lockId":      "<string>",       // optional
//     "owner":       "<string>",       // required — agent/session identity
//     "projectRoot": "<absolute>",     // optional — scope when paths empty
//     "paths":       ["<absolute>"],   // optional — explicit path scope
//     "expiresAt":   <epoch-ms>|null,  // optional — null = never expires
//     "createdAt":   <epoch-ms>        // optional — informational
//   }
//
// Fail-closed semantics for the engine wire-up:
//   - lock dir absent → no-op
//   - lock dir exists + all files parse + no conflict → no-op
//   - lock dir exists + any file is unreadable or malformed → engine treats
//     as fail-closed for WRITE-LIKE calls so a broken-state corpus cannot
//     silently bypass the floor. The engine surfaces this via `state.ok=false`
//     + a non-empty `state.malformed[]`.
//
// Zero dependencies. Pure file I/O (fs only). No process.env reads (caller
// supplies stateDir so HORUS_STATE_DIR can be honored externally).

const fs   = require("fs");
const path = require("path");

const LOCK_SUBDIR = "cross-agent-locks";

// Path-string normalization mirrors runtime/ambient.js helpers: forward
// slashes only, strip `file://`, trim trailing slash. Pure string — no
// path.resolve() so cross-host shape compares stable.
function normalizePath(p) {
  if (typeof p !== "string" || p.length === 0) return "";
  let s = p.replace(/\\/g, "/").replace(/^file:\/\//i, "");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function _lowerNorm(p) { return normalizePath(p).toLowerCase(); }

function lockDir(stateDirPath) {
  return path.join(String(stateDirPath || ""), LOCK_SUBDIR);
}

function _validRecord(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (typeof rec.owner !== "string" || rec.owner.length === 0) return false;
  const hasPaths = Array.isArray(rec.paths) && rec.paths.some(
    (p) => typeof p === "string" && p.length > 0
  );
  const hasRoot  = typeof rec.projectRoot === "string" && rec.projectRoot.length > 0;
  if (!hasPaths && !hasRoot) return false;
  if (rec.expiresAt != null) {
    const n = Number(rec.expiresAt);
    if (!Number.isFinite(n)) return false;
  }
  return true;
}

function _isExpired(rec, now) {
  if (rec.expiresAt == null) return false;
  return Number(rec.expiresAt) <= Number(now);
}

// Read all lock files in `<stateDir>/cross-agent-locks/`.
// Returns { ok, locks, malformed }:
//   ok        — true when every file parsed + every record validated
//   locks     — array of valid records (regardless of expiry)
//   malformed — array of { file, reason } for unreadable/invalid files
function readLockState(stateDirPath) {
  const out = { ok: true, locks: [], malformed: [] };
  if (!stateDirPath || typeof stateDirPath !== "string") return out;
  const dir = lockDir(stateDirPath);
  if (!fs.existsSync(dir)) return out;
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch (err) {
    out.ok = false;
    out.malformed.push({ file: dir, reason: "readdir-failed:" + (err && err.message || err) });
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(dir, name);
    let raw;
    try { raw = fs.readFileSync(full, "utf8"); }
    catch (err) {
      out.ok = false;
      out.malformed.push({ file: full, reason: "read-failed:" + (err && err.message || err) });
      continue;
    }
    let rec;
    try { rec = JSON.parse(raw); }
    catch (err) {
      out.ok = false;
      out.malformed.push({ file: full, reason: "parse-failed:" + (err && err.message || err) });
      continue;
    }
    if (!_validRecord(rec)) {
      out.ok = false;
      out.malformed.push({ file: full, reason: "invalid-record" });
      continue;
    }
    out.locks.push(rec);
  }
  return out;
}

// Segment-aligned, case-insensitive bidirectional prefix match: a candidate
// path conflicts with a locked path when they are equal, when the candidate
// is INSIDE the lock (candidate has lock as a prefix), or when the lock is
// inside the candidate (e.g. lock=/proj/file.txt, candidate=/proj writing
// many files). Bidirectional check defends against a write that walks up
// out of a narrowly-scoped lock.
function _pathOverlap(candidate, lockedPaths) {
  if (!Array.isArray(lockedPaths) || lockedPaths.length === 0) return false;
  const cn = _lowerNorm(candidate);
  if (!cn) return false;
  for (const lp of lockedPaths) {
    const ln = _lowerNorm(lp);
    if (!ln) continue;
    if (cn === ln) return true;
    if (cn.startsWith(ln + "/")) return true;
    if (ln.startsWith(cn + "/")) return true;
  }
  return false;
}

// findConflict({ owner, projectRoot, paths, locks, now }) → lockRecord|null.
// Returns the first lock that is owned by another party, not expired, and
// either overlaps one of the candidate write paths (when the lock declares
// paths[]) or matches our projectRoot (project-scope lock).
function findConflict(args) {
  const a = args || {};
  const myOwner = typeof a.owner === "string" ? a.owner : "";
  const nowMs   = (typeof a.now === "number" && Number.isFinite(a.now)) ? a.now : Date.now();
  const myRoot  = _lowerNorm(a.projectRoot || "");
  const myPaths = Array.isArray(a.paths) ? a.paths.filter(
    (p) => typeof p === "string" && p.length > 0
  ) : [];
  const locks   = Array.isArray(a.locks) ? a.locks : [];
  for (const rec of locks) {
    if (!_validRecord(rec)) continue;
    if (rec.owner === myOwner) continue;
    if (_isExpired(rec, nowMs)) continue;
    const hasLockedPaths = Array.isArray(rec.paths) && rec.paths.some(
      (p) => typeof p === "string" && p.length > 0
    );
    if (hasLockedPaths) {
      let matched = false;
      for (const cp of myPaths) {
        if (_pathOverlap(cp, rec.paths)) { matched = true; break; }
      }
      if (matched) return rec;
    } else if (rec.projectRoot) {
      if (myRoot && _lowerNorm(rec.projectRoot) === myRoot) return rec;
    }
  }
  return null;
}

module.exports = {
  LOCK_SUBDIR,
  lockDir,
  normalizePath,
  readLockState,
  findConflict,
};
