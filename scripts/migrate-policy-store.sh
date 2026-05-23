#!/usr/bin/env bash
# migrate-policy-store.sh — Convert legacy 4-part learned-allow keys to 5-part fineKey.
#
# Background: policy-store.js switched from a 4-part key (tool|commandClass|targetClass|payloadClass)
# to a 5-part key (tool|commandClass|pathBucket|branchBucket|payloadClass) in v2.0.1.
# The one-release compat shim that read both key formats was removed in v3.0.0.
# Operators who had learned-allow entries recorded under v2.0.x must run this script once
# to lift their approvals into the current key format.
#
# Migration: for each 4-part key in approvalCounts, insert "unknown-branch" as the
# branchBucket (between targetClass and payloadClass). The approval count is preserved.
# 5-part keys are left unchanged.
#
# Usage:
#   bash scripts/migrate-policy-store.sh [--dry-run]   # default: dry-run
#   bash scripts/migrate-policy-store.sh --apply       # write the migrated file
#
# Flags:
#   --dry-run  (default) print what would change, do not write
#   --apply    write the migrated learned-policy.json in-place (backup first)

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  printf 'Error: node not found on PATH — migrate-policy-store.sh requires Node.js\n' >&2
  exit 1
fi

dry_run=1
for arg in "$@"; do
  case "$arg" in
    --apply)   dry_run=0 ;;
    --dry-run) dry_run=1 ;;
    *) printf 'Unknown argument: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

printf '[migrate-policy-store]\n'
if [ "$dry_run" -eq 1 ]; then
  printf '  Mode: dry-run (pass --apply to write changes)\n'
else
  printf '  Mode: apply (will write migrated learned-policy.json)\n'
fi

node - "$root" "$dry_run" <<'NODESCRIPT'
"use strict";
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const root   = process.argv[2];
const dryRun = process.argv[3] === "1";

process.chdir(root);

const stateDir = process.env.LILARA_STATE_DIR ||
  (() => {
    const home = process.env.HOME || os.homedir();
    return path.join(home.replace(/\\/g, "/"), ".lilara");
  })();

const policyFile = path.join(stateDir, "learned-policy.json");

if (!fs.existsSync(policyFile)) {
  console.log(`  No learned-policy.json found at ${policyFile} — nothing to migrate.`);
  process.exit(0);
}

let policy;
try {
  policy = JSON.parse(fs.readFileSync(policyFile, "utf8"));
} catch (err) {
  process.stderr.write(`  ERROR: could not parse learned-policy.json: ${err.message}\n`);
  process.exit(1);
}

const counts = policy.approvalCounts || {};
let legacyCount  = 0;
let modernCount  = 0;
const migrated = {};

for (const [key, val] of Object.entries(counts)) {
  const parts = key.split("|");
  if (parts.length === 4) {
    // Legacy 4-part: tool|commandClass|targetClass|payloadClass
    // Insert "unknown-branch" between targetClass (index 2) and payloadClass (index 3)
    const newKey = [parts[0], parts[1], parts[2], "unknown-branch", parts[3]].join("|");
    console.log(`  MIGRATE: "${key}" → "${newKey}" (count=${val})`);
    migrated[newKey] = Number(val);
    legacyCount++;
  } else if (parts.length === 5) {
    migrated[key] = Number(val);
    modernCount++;
  } else {
    // Unexpected — preserve as-is with a warning
    process.stderr.write(`  WARN: skipping key with unexpected segment count (${parts.length}): "${key}"\n`);
    migrated[key] = Number(val);
  }
}

console.log(`  Found: ${legacyCount} legacy 4-part keys, ${modernCount} modern 5-part keys`);

if (legacyCount === 0) {
  console.log("  No legacy keys found — learned-policy.json is already up-to-date.");
  process.exit(0);
}

if (dryRun) {
  console.log(`  Dry-run: ${legacyCount} key(s) would be migrated. Pass --apply to write.`);
  process.exit(0);
}

// Apply: backup and write
const backup = `${policyFile}.pre-migration-${Date.now()}.bak`;
fs.copyFileSync(policyFile, backup);
console.log(`  Backup written: ${backup}`);

policy.approvalCounts = migrated;
fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2) + "\n", "utf8");
console.log(`  Migrated learned-policy.json: ${legacyCount} key(s) updated.`);
NODESCRIPT
