#!/usr/bin/env bash
# check-project-scope.sh — L6 project-scoped learned-policy gate.
#
# Proves the learned-allow store is scoped to the originating project:
#   1. cross-project isolation  — an approval in project A does NOT apply in project B
#   2. in-project regression    — an approval in project A still applies within project A
#   3. fail-safe (unknown scope) — when no stable project identity is derivable, a
#                                  learned-allow never matches (never falls back to global)
#   4. legacy orphaning         — pre-L6 unscoped entries are never honored after migration
#
# Self-contained: builds throwaway git repos under a temp dir, exercises the real
# policy-store API (no mocks), and cleans up on exit. Requires node + git.
#
# Exit 0 = all properties hold.  Exit 1 = a property failed (e.g. cross-project leak).
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

printf '[check-project-scope]\n'

if ! command -v node >/dev/null 2>&1; then
  printf '  ERROR  node not found on PATH\n' >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  printf '  ERROR  git not found on PATH\n' >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

LILARA_STATE_DIR="$tmp/state" HOME="$tmp/home" LILARA_DECISION_JOURNAL=0 \
  node - "$root" "$tmp" <<'NODE' || exit 1
"use strict";
const path = require("path");
const fs   = require("fs");
const cp   = require("child_process");
const root = process.argv[2];
const tmp  = process.argv[3];

process.env.LILARA_STATE_DIR = path.join(tmp, "state");

const ps = require(path.join(root, "runtime/policy-store.js"));
const { fineKey } = require(path.join(root, "runtime/decision-key.js"));

function fail(m) { process.stderr.write("  ERROR  " + m + "\n"); process.exit(1); }
function ok(m)   { process.stdout.write("  ok     " + m + "\n"); }

// Build two throwaway git repos with DISTINCT remotes under the temp dir.
function mkrepo(name, remote) {
  const d = fs.mkdtempSync(path.join(tmp, "repo-" + name + "-"));
  cp.execFileSync("git", ["init"], { cwd: d, stdio: "ignore" });
  cp.execFileSync("git", ["remote", "add", "origin", remote], { cwd: d, stdio: "ignore" });
  const realpath = fs.realpathSync.native || fs.realpathSync;
  try { return realpath(d); } catch { return d; }
}
const repoA = mkrepo("a", "https://example.com/org/project-a.git");
const repoB = mkrepo("b", "https://example.com/org/project-b.git");

// Same destructive op in each repo → byte-identical fineKey (same relative path
// bucket "build"). Only the PROJECT differs. This is the exact shape that leaks today.
const mk = (repo) => ({ tool: "Bash", command: "rm -rf build", targetPath: path.join(repo, "build"), projectRoot: repo, branch: "feature/x" });
const a = mk(repoA);
const b = mk(repoB);

if (fineKey(a) !== fineKey(b)) {
  fail("test precondition: inputs must share a fineKey to prove project isolation, got " + fineKey(a) + " vs " + fineKey(b));
}

// (2) in-project regression: an approval in A applies within A.
ps.setLearnedAllow(a, true);
if (!ps.isLearnedAllowed(a)) fail("in-project regression: approval recorded in project A must apply within A");
ok("in-project: approval in A still applies within A");

// (1) cross-project isolation: that same approval must NOT apply in B.
if (ps.isLearnedAllowed(b)) fail("CROSS-PROJECT LEAK: a learned-allow recorded in project A applied in project B");
ok("cross-project isolation: approval in A does NOT apply in B");

// (3) fail-safe: when the project identity is unknown/unstable, never match.
const unknown = { tool: "Bash", command: "rm -rf build", targetPath: "build", projectRoot: "", branch: "feature/x" };
ps.setLearnedAllow(unknown, true);            // must be a no-op under a null scope
if (ps.isLearnedAllowed(unknown)) fail("fail-safe: a learned-allow must NOT match when the project scope is unknown");
ok("fail-safe: unknown/unstable project scope never matches (no false-permit fallback)");

// (4) migration: a pre-L6 unscoped entry in the store is orphaned (never honored).
const c = { tool: "Bash", command: "git push --force origin main", targetPath: path.join(repoA, "x"), projectRoot: repoA, branch: "feature/y" };
const legacy = fineKey(c);                      // bare 5-part key, as written before L6
const pol = ps.loadPolicy();
pol.learnedAllows[legacy] = true;              // simulate an existing global grant
ps.savePolicy(pol);
if (ps.isLearnedAllowed(c)) fail("migration: a legacy unscoped learned-allow must be orphaned, not honored");
ok("migration: legacy unscoped entries are orphaned (never matched)");

process.stdout.write("\nproject-scope checks passed.\n");
NODE
