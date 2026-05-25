"use strict";

const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");
const { stateDir } = require("./state-paths");
const { journalPaths } = require("./decision-journal");

// ---------------------------------------------------------------------------
// sarif-export.js
// Converts decision-journal entries with a truthy `floorFired` field into
// a SARIF 2.1.0 JSON document for import into GitHub code scanning or
// other SARIF-aware tooling.
// ---------------------------------------------------------------------------

const LILARA_VERSION = "0.2.0";

// Map riskLevel → SARIF level
function sarifLevel(riskLevel) {
  const l = (riskLevel || "").toLowerCase();
  if (l === "critical" || l === "high") return "error";
  if (l === "medium") return "warning";
  return "note";
}

function readLines(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.split("\n").filter(Boolean);
  } catch { return []; }
}

function readGzLines(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const raw = zlib.gunzipSync(buf).toString("utf8");
    return raw.split("\n").filter(Boolean);
  } catch { return []; }
}

function parseEntry(line) {
  try { return JSON.parse(line); } catch { return null; }
}

// Collect all journal entries from all rotation files (filtered by since if given).
function collectEntries(sinceMs) {
  const paths = journalPaths();
  const baseDir = paths.baseDir;
  const primary  = paths.logFile;
  const rotation1 = primary.replace(".jsonl", ".1.jsonl");
  const rotation2 = primary.replace(".jsonl", ".2.jsonl.gz");
  const rotation3 = primary.replace(".jsonl", ".3.jsonl.gz");

  const sources = [
    { file: primary,   read: readLines    },
    { file: rotation1, read: readLines    },
    { file: rotation2, read: readGzLines  },
    { file: rotation3, read: readGzLines  },
  ];

  const entries = [];
  for (const { file, read } of sources) {
    if (!fs.existsSync(file)) continue;
    for (const line of read(file)) {
      const e = parseEntry(line);
      if (!e) continue;
      if (sinceMs) {
        const ts = new Date(e.timestamp || 0).getTime();
        if (ts < sinceMs) continue;
      }
      entries.push(e);
    }
  }
  return entries;
}

// Build SARIF 2.1.0 document from journal entries.
function exportSarif({ since, outputPath, stateDirOverride } = {}) {
  const sinceMs = since ? new Date(since).getTime() : null;

  const allEntries = collectEntries(sinceMs);
  const floorEntries = allEntries.filter((e) => e.floorFired);

  // Collect unique rule IDs
  const ruleIds = [...new Set(floorEntries.map((e) => String(e.floorFired)))];

  const rules = ruleIds.map((id) => ({
    id,
    name: id.replace(/[^a-zA-Z0-9]/g, ""),
    shortDescription: { text: "Lilara floor fired: " + id },
    helpUri: "https://github.com/elkhouly007/Lilara/blob/master/docs/floors.md#" + id.toLowerCase(),
  }));

  const results = floorEntries.map((e) => {
    const ruleId = String(e.floorFired);
    const level  = sarifLevel(e.riskLevel);
    const uri    = e.targetPath ? e.targetPath.replace(/\\/g, "/") : "";

    const result = {
      ruleId,
      level,
      message: { text: e.notes || ("Floor " + ruleId + " fired.") },
    };

    if (uri) {
      result.locations = [{
        physicalLocation: {
          artifactLocation: { uri },
        },
      }];
    }

    // Partial fingerprints from irHash
    if (e.irHash) {
      result.partialFingerprints = { irHash: String(e.irHash) };
    }

    result.properties = {};
    if (e.reasonCodes)  result.properties.reasonCodes  = e.reasonCodes;
    if (e.riskScore)    result.properties.riskScore     = e.riskScore;
    if (e.tool)         result.properties.tool          = e.tool;
    if (e.branch)       result.properties.branch        = e.branch;
    if (e.intent)       result.properties.intent        = e.intent;
    if (e.contractId)   result.properties.contractId    = e.contractId;
    if (e.timestamp)    result.properties.timestamp     = e.timestamp;

    return result;
  });

  const sarif = {
    version: "2.1.0",
    $schema: "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "Lilara",
            version: LILARA_VERSION,
            informationUri: "https://github.com/elkhouly007/Lilara",
            rules,
          },
        },
        results,
      },
    ],
  };

  const json = JSON.stringify(sarif, null, 2) + "\n";

  if (outputPath) {
    fs.writeFileSync(outputPath, json, { mode: 0o600 });
    return { outputPath, resultCount: results.length, ruleCount: rules.length };
  }

  return { sarif, json, resultCount: results.length, ruleCount: rules.length };
}

module.exports = { exportSarif };
