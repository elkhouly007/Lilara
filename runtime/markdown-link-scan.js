#!/usr/bin/env node
"use strict";

const fs   = require("fs");
const path = require("path");

// 64 KB scan cap — mirrors secret-scan.js
const SCAN_CAP = 64 * 1024;

// JSON pattern file lives alongside the hook scripts.
const PATTERN_FILE = path.join(__dirname, "..", "claude", "hooks", "markdown-link-patterns.json");

// Baked-in patterns (used when PATTERN_FILE is absent).
const BUILTIN_PATTERNS = [
  {
    id:       "MD-LINK-JS-SCHEME",
    regex:    /\]\(\s*javascript\s*:/i,
    severity: "high",
  },
  {
    id:       "MD-LINK-DATA-SCHEME",
    regex:    /\]\(\s*data\s*:/i,
    severity: "high",
  },
  {
    id:       "MD-LINK-USERINFO",
    regex:    /\]\(\s*https?:\/\/[^/@\s)]+:[^/@\s)]+@/i,
    severity: "medium",
  },
  {
    id:       "MD-LINK-TOKEN-IN-QUERY",
    regex:    /\]\(\s*https?:\/\/[^\s)]+\?[^)]*\b(?:api_key|access_token|auth_token|token|password|secret)=/i,
    severity: "high",
  },
];

// Module-level cache for patterns loaded from the JSON file.
let _patterns = null;

function loadPatterns() {
  if (_patterns !== null) return _patterns;
  try {
    const raw  = fs.readFileSync(PATTERN_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data.patterns) && data.patterns.length > 0) {
      _patterns = data.patterns.map(({ id, pattern, severity }) => ({
        id,
        regex:    new RegExp(pattern, "i"),
        severity: severity || "high",
      }));
      return _patterns;
    }
  } catch {
    /* fall through to built-ins if file absent or unparseable */
  }
  _patterns = BUILTIN_PATTERNS;
  return _patterns;
}

/**
 * Scan markdown text for dangerous link patterns.
 *
 * Returns an array of { id, severity, match, index } — one entry per match.
 * Caps input at 64 KB to prevent runaway scans on huge payloads.
 */
function scanMarkdownLinks(text) {
  const str      = String(text || "").slice(0, SCAN_CAP);
  const patterns = loadPatterns();
  const findings = [];

  for (const { id, regex, severity } of patterns) {
    // Use a fresh, non-global regex per call to avoid lastIndex state issues.
    const r = new RegExp(regex.source, regex.flags.replace("g", ""));
    const m = str.match(r);
    if (m) {
      findings.push({ id, severity, match: m[0], index: m.index });
    }
  }

  return findings;
}

module.exports = { scanMarkdownLinks };
