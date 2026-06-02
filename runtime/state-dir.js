#!/usr/bin/env node
"use strict";

// state-dir.js — State-directory permission validation helper (ADR-024).
//
// Validates that a state directory is safe to use for security-sensitive writes
// (pins, learned-policy, decision-journal, etc.) before any I/O occurs.
//
// Threat model: a world-writable or foreign-owned LILARA_STATE_DIR lets an
// attacker pre-seed, corrupt, or race-overwrite security state — most critically
// the mcp-pin store (ADR-018), which is the enforcement trigger for rug-pull
// escalation.
//
// POSIX validation (non-Windows):
//   - Must be a directory.
//   - Must NOT be world-writable (st.mode & 0o002). Group-writable (0o020) is
//     intentionally allowed — common on shared CI runner groups; flagging it
//     would cause false-positive operational breaks.
//   - Must be owned by the current user (st.uid === process.getuid()).
//   Symlinked state dir: statSync follows the link and validates the TARGET's
//   permissions/owner — the security-relevant properties. Stricter lstat-based
//   symlink rejection is noted as a follow-up (ADR-028) to avoid FP on
//   legitimate symlinked LILARA_STATE_DIR paths.
//
// Windows (process.platform === "win32"):
//   POSIX mode bits are synthesized (always 0o666 for files / 0o777 for dirs)
//   and process.getuid() is undefined. The POSIX checks are meaningless on NTFS
//   (ACL-based). On Windows: check only that the path is a directory; return
//   safe otherwise. NTFS ACL hardening is a follow-up.
//
// Returns:
//   true  — directory exists and passes all applicable checks; safe to use.
//   false — directory is absent, not a directory, or fails a permission check.
//           Callers MUST NOT read from or write to the poisoned location.
//
// Side-effects:
//   - Writes a one-shot warning to stderr per process (guarded by _warnedDirs)
//     when a directory fails a check, so operators see the problem without log
//     spam on every invocation.

const fs = require("fs");

// Set of state-dir paths already warned this process — prevents log spam when
// decide() is called many times with an insecure state dir.
const _warnedDirs = new Set();

/**
 * ensureStateDirSafe(dir) → boolean
 *
 * @param {string} dir — absolute path to the candidate state directory.
 * @returns {boolean}  — true iff the directory is safe for security-critical I/O.
 */
function ensureStateDirSafe(dir) {
  try {
    let st;
    try {
      st = fs.statSync(dir); // follows symlinks — validates the target
    } catch {
      // stat failed: directory absent or inaccessible → unsafe
      return false;
    }

    if (!st.isDirectory()) {
      _warn(dir, `not a directory (mode: ${(st.mode & 0o777).toString(8)})`);
      return false;
    }

    // Windows: POSIX mode bits and getuid() are not meaningful.
    if (process.platform === "win32") {
      return true; // directory exists — that's all we can reliably check
    }

    // POSIX: world-writable check.
    // 0o002 = others-write bit. Sticky bit (0o1000) does NOT protect against
    // pre-creation attacks — an attacker can create the mcp-pins subdir and
    // pins.json before Lilara does, even with sticky bit set.
    if (st.mode & 0o002) {
      _warn(
        dir,
        `world-writable (mode: ${(st.mode & 0o777).toString(8)}) — ` +
        "pin and journal integrity cannot be guaranteed; " +
        "set to chmod o-w or point LILARA_STATE_DIR at a user-only directory."
      );
      return false;
    }

    // POSIX: owner check.
    const uid = process.getuid ? process.getuid() : null;
    if (uid !== null && st.uid !== uid) {
      _warn(
        dir,
        `not owned by current user (dir uid=${st.uid}, process uid=${uid}) — ` +
        "a foreign-owned state dir can be pre-seeded to suppress rug-pull detection."
      );
      return false;
    }

    return true;
  } catch {
    // Belt-and-suspenders: any unexpected error in the validator itself → unsafe.
    return false;
  }
}

function _warn(dir, detail) {
  if (_warnedDirs.has(dir)) return;
  _warnedDirs.add(dir);
  process.stderr.write(
    `[lilara] WARNING: LILARA_STATE_DIR is insecure (${dir}): ${detail}\n`
  );
}

module.exports = { ensureStateDirSafe };
