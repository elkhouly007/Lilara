"use strict";
// project-scope.js — L6: derive a stable, project-distinct scope tag for the
// learned-policy store. An approval recorded while working in one project must
// never match a lookup in another, even when the two share an identical fineKey
// (same tool / command-class / relative path bucket / branch / payload class).
//
// The scope is layered, most-stable-and-rename-resistant first:
//
//   "r:<hash>"  git `remote.origin.url`     — survives directory renames AND re-clones
//   "t:<hash>"  git work-tree toplevel path — local-only repos; stable per checkout
//   "d:<hash>"  absolute project-root path  — non-git dirs; still project-distinct
//   null        no project root derivable   — caller MUST NOT match (fail-safe)
//
// Fail-safe direction: when no stable identity exists we return null and the
// policy store treats that as "never matches" — strictly safer than the old
// global behavior, never falsely-permissive. A directory rename only ever
// *loses* a learned-allow (re-prompt), never grants one across projects.
//
// `LILARA_PROJECT_ID` overrides everything (operator escape hatch: pin a scope
// explicitly, e.g. to share trust across the sub-projects of a monorepo).
//
// Zero external deps. git probing uses a local fail-closed, per-process-memoized
// runner (see _git below), so the hot decide() path spawns git at most once per
// project root per process and a probe failure never throws.

const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

// Self-contained, fail-closed, per-process-memoized git probe. Kept local
// (rather than importing context-discovery's safeGit, which is NOT exported) so
// project-scope.js has no internal-module coupling and stays independently
// testable. Any failure — git absent, non-repo cwd, bad path — is swallowed and
// cached as "", so a scope derivation can never throw into the hot decide() path.
const _gitMemo = new Map();
function _git(args, cwd) {
  const key = String(cwd || "") + "\x00" + args.join("\x00");
  if (_gitMemo.has(key)) return _gitMemo.get(key);
  let out = "";
  try {
    out = execFileSync("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 1500,
    }).trim();
  } catch { /* git unavailable / non-repo cwd / bad path -> cached as "" */ }
  _gitMemo.set(key, out);
  return out;
}

function _hash(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
}

// Light normalization so trivial remote-string differences map to one scope on
// a given machine: lowercase, strip a trailing ".git", strip trailing slashes.
// Deliberately conservative — we want project-DISTINCTNESS, not cross-host
// canonicalization (the store is per-machine, so protocol variants are rare).
function _normalizeRemote(url) {
  return String(url).trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
}

// projectScope(input) -> scope tag string, or null when no stable identity exists.
// `input` may carry { projectRoot } (preferred — already resolved by the engine's
// context-discovery), or { cwd }; otherwise process.cwd() is the probe dir.
function projectScope(input = {}) {
  const override = String(process.env.LILARA_PROJECT_ID || "").trim();
  if (override) return "x:" + _hash(override);

  // Resolve the directory to probe. An explicitly-supplied projectRoot/cwd is
  // honored verbatim (including an empty string, which asserts "no project
  // context" and trips the fail-safe); only a fully-absent field falls back to
  // process.cwd().
  let probe;
  if (input && input.projectRoot != null) probe = String(input.projectRoot);
  else if (input && input.cwd != null) probe = String(input.cwd);
  else probe = process.cwd();
  probe = probe.trim();
  if (!probe) return null; // fail-safe: no derivable project root -> never match

  const abs = path.resolve(probe);

  // Only probe git when the directory exists, so a stale/typo path does not
  // spawn git against a bad cwd. A non-existent path still yields a stable
  // d:-tag (project-distinct), which is the correct fail-safe-but-usable scope.
  let exists = false;
  try { exists = fs.existsSync(abs); } catch { exists = false; }
  if (exists) {
    const remote = _git(["config", "--get", "remote.origin.url"], abs);
    if (remote) return "r:" + _hash(_normalizeRemote(remote));
    const top = _git(["rev-parse", "--show-toplevel"], abs);
    if (top) return "t:" + _hash(path.resolve(top));
  }
  return "d:" + _hash(abs);
}

module.exports = { projectScope };
