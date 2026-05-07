#!/usr/bin/env node
"use strict";

const fs   = require("fs");
const path = require("path");

// Pattern file lives alongside the hook scripts.
const PATTERN_FILE = path.join(__dirname, "..", "claude", "hooks", "secret-patterns.json");

const FALLBACK_PATTERNS = [
  { name: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/i },
  { name: "GitHub token",         pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i },
  { name: "AWS access key",       pattern: /\bAKIA[A-Z0-9]{16}\b/ },
  { name: "Slack token",          pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/i },
  { name: "private key",          pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

// Module-level cache — valid for the lifetime of one Node.js process.
let _patterns = null;

function loadPatterns() {
  if (_patterns !== null) return _patterns;
  try {
    const raw  = fs.readFileSync(PATTERN_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data.patterns) && data.patterns.length > 0) {
      _patterns = data.patterns.map(({ name, pattern }) => ({
        name,
        pattern: new RegExp(pattern, "i"),
      }));
      return _patterns;
    }
  } catch { /* file missing or malformed — use fallback */ }
  _patterns = FALLBACK_PATTERNS;
  return _patterns;
}

/**
 * Scan text for secret patterns.
 *
 * @param {string} text — the text to scan (may include full payload)
 * @returns {{ name: string } | null} — first match found, or null if clean
 */
function scanSecrets(text) {
  const t = String(text || "");
  for (const { name, pattern } of loadPatterns()) {
    if (pattern.test(t)) return { name };
  }
  return null;
}

/**
 * Return the loaded pattern array (same set used by scanSecrets).
 * Callers that need to apply patterns to arbitrary text (e.g. journal redaction)
 * use this to avoid re-loading or duplicating the pattern list.
 *
 * @returns {{ name: string, pattern: RegExp }[]}
 */
function getPatterns() {
  return loadPatterns();
}

module.exports = { scanSecrets, getPatterns };
