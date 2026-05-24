#!/usr/bin/env node
"use strict";

const fs   = require("node:fs");
const path = require("node:path");

function main() {
  const inPath  = process.argv[2] || path.join(process.cwd(), "lilara.contract.json");
  const outPath = process.argv[3] || path.join(process.cwd(), "lilara.contract.json.draft");

  if (!fs.existsSync(inPath)) {
    console.error(`migrateV2ToV3: input not found: ${inPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, "utf8");
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) {
    console.error(`migrateV2ToV3: invalid JSON in ${inPath}: ${e.message}`);
    process.exit(1);
  }

  if (doc.version === 3) {
    process.stderr.write("migrateV2ToV3: already version 3, no migration needed\n");
    process.exit(0);
  }
  if (doc.version !== 1 && doc.version !== 2) {
    console.error(`migrateV2ToV3: unsupported version ${doc.version}`);
    process.exit(1);
  }

  if (fs.existsSync(outPath)) {
    console.error(`migrateV2ToV3: ${outPath} already exists — refusing to overwrite. Remove the draft first.`);
    process.exit(1);
  }

  const next = JSON.parse(JSON.stringify(doc));
  next.version = 3;
  delete next.contractHash;

  const { hashContract } = require(path.join(process.cwd(), "runtime", "contract"));
  next.contractHash = hashContract(next);

  const { validateContract } = require(path.join(process.cwd(), "runtime", "config-validator"));
  const v = validateContract(next);
  if (!v.valid) {
    console.error("migrateV2ToV3: migrated draft fails schema validation:");
    for (const err of v.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  fs.writeFileSync(outPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`migrateV2ToV3: wrote ${outPath} (version=3, hash=${next.contractHash.slice(0, 19)}...)`);
  console.log("Next: review the draft, then 'lilara-cli.sh contract accept' to finalize.");
}

main();
