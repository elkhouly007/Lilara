#!/usr/bin/env node
"use strict";
// migrateV1ToV2.js — Upgrade an lilara.contract.json from schema version 1 to version 2.
//
// What changes:
//   - version: 1 → 2
//   - revision: incremented by 1
//   - acceptedAt: updated to now
//   - contractHash: recomputed over the new document body
//   - New optional v2 sections added with commented examples in a companion .md:
//       validity       — UTC time-window and day-of-week restrictions
//       contextTrust   — per-branch trust posture overrides
//       scopes.tools   — per-tool command/path allowlists
//
// Usage:
//   node scripts/migrateV1ToV2.js [--input <path>] [--output <path>] [--dry-run]
//
//   --input   path to lilara.contract.json (default: lilara.contract.json in cwd)
//   --output  destination path          (default: same as input — in-place upgrade)
//   --dry-run print the migrated contract without writing

const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");

const root = path.join(__dirname, "..");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

let inputPath  = path.join(process.cwd(), "lilara.contract.json");
let outputPath = null;
let dryRun     = false;

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--dry-run")                       { dryRun = true; }
  else if (arg === "--input"  && process.argv[i + 1]) { inputPath  = path.resolve(process.argv[++i]); }
  else if (arg === "--output" && process.argv[i + 1]) { outputPath = path.resolve(process.argv[++i]); }
  else if (arg.startsWith("--input="))           { inputPath  = path.resolve(arg.slice(8)); }
  else if (arg.startsWith("--output="))          { outputPath = path.resolve(arg.slice(9)); }
}

outputPath = outputPath || inputPath;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

function hashContract(doc) {
  const { contractHash: _omit, ...rest } = doc;
  return "sha256:" + crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
}

function validateV2(doc) {
  const { validateContract } = require(path.join(root, "runtime/config-validator.js"));
  return validateContract(doc);
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

if (!fs.existsSync(inputPath)) {
  console.error(`migrateV1ToV2: input not found: ${inputPath}`);
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (err) {
  console.error(`migrateV1ToV2: failed to parse ${inputPath}: ${err.message}`);
  process.exit(1);
}

if (doc.version === 2) {
  console.log(`migrateV1ToV2: contract is already version 2 — nothing to do.`);
  process.exit(0);
}

if (doc.version !== 1) {
  console.error(`migrateV1ToV2: expected version 1, got ${doc.version}`);
  process.exit(1);
}

// Build the v2 document — all v2 additions are optional and start empty.
const v2 = {
  ...doc,
  version:    2,
  revision:   (doc.revision || 1) + 1,
  acceptedAt: new Date().toISOString(),
  // validity and contextTrust are new top-level v2 fields; omit them by default
  // so the migrated contract is minimal. Operators add them as needed.
  scopes: {
    ...doc.scopes,
    // tools scope is new in v2; omit by default.
  },
};

// Recompute hash over the new body (strip old hash first, then hash).
delete v2.contractHash;
v2.contractHash = hashContract(v2);

// Validate against the updated schema (which now accepts version 2).
const { valid, errors } = validateV2(v2);
if (!valid) {
  console.error(`migrateV1ToV2: migrated document failed schema validation:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const serialised = JSON.stringify(v2, null, 2) + "\n";

if (dryRun) {
  console.log(serialised);
  console.log(`[dry-run] would write to ${outputPath}`);
  process.exit(0);
}

fs.writeFileSync(outputPath, serialised, { mode: 0o600 });
console.log(`migrateV1ToV2: contract upgraded to version 2 → ${outputPath}`);
console.log(`  contractId: ${v2.contractId}`);
console.log(`  revision:   ${v2.revision}`);
console.log(`  hash:       ${v2.contractHash}`);
console.log(`\nOptional v2 fields (add to contract as needed):`);
console.log(`  validity       — UTC time-windows (activeHoursUtc, activeDays)`);
console.log(`  contextTrust   — per-branch trust posture overrides`);
console.log(`  scopes.tools   — per-tool commandGlobs / pathGlobs allowlists`);
console.log(`\nRun 'lilara-cli contract show' to review the migrated contract.`);
