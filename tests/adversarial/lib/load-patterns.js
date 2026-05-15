"use strict";

// Adversarial pattern loader (locked scope §5.1). Reads JSONL pattern files
// from the replay-corpus directory plus any tests/fixtures/adversarial/**/*.jsonl
// and normalizes each line into the shape the driver and weekly summary
// consume. Malformed lines are skipped with a warning so a single corrupt
// entry does not break the nightly harness.

const fs   = require("node:fs");
const path = require("node:path");

const ROOT          = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_DIR   = path.join(ROOT, "tests", "fixtures", "replay-corpus");
const DEFAULT_FILES = ["adversarial.jsonl", "f16-adversarial.jsonl"];
const EXTRA_DIR     = path.join(ROOT, "tests", "fixtures", "adversarial");

function* walkJsonl(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walkJsonl(full);
    else if (ent.isFile() && ent.name.endsWith(".jsonl")) yield full;
  }
}

function parseLines(text, file, warnings) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    try { out.push({ lineNo: i + 1, value: JSON.parse(raw) }); }
    catch (err) { warnings.push(`${path.relative(ROOT, file)}:${i + 1}: parse error (${err.message})`); }
  }
  return out;
}

function normalize(entry, file, lineNo, warnings) {
  const id             = entry && (entry.tag || entry.id);
  const expectedAction = entry && entry.expected && entry.expected.action;
  const action         = entry && entry.input;
  const rel            = path.relative(ROOT, file);
  if (!id || typeof id !== "string") {
    warnings.push(`${rel}:${lineNo}: missing tag/id — skipping`);
    return null;
  }
  if (!expectedAction || typeof expectedAction !== "string") {
    warnings.push(`${rel}:${lineNo}: missing expected.action — skipping`);
    return null;
  }
  if (!action || typeof action !== "object") {
    warnings.push(`${rel}:${lineNo}: missing input/action — skipping`);
    return null;
  }
  const intent = (entry.intent && typeof entry.intent === "string" && entry.intent.length > 0)
    ? entry.intent
    : `(no-declared-intent) ${id}`;
  return { id, expectedAction, action, intent, source: rel };
}

function readFile(full, warnings, patterns) {
  if (!fs.existsSync(full)) { warnings.push(`${path.relative(ROOT, full)}: not found — skipping`); return; }
  const text = fs.readFileSync(full, "utf8");
  for (const { lineNo, value } of parseLines(text, full, warnings)) {
    const p = normalize(value, full, lineNo, warnings);
    if (p) patterns.push(p);
  }
}

function loadPatterns(opts) {
  const o            = opts || {};
  const dir          = o.dir || DEFAULT_DIR;
  const includeFiles = Array.isArray(o.includeFiles) && o.includeFiles.length > 0
    ? o.includeFiles : DEFAULT_FILES;
  const extraDir     = o.extraDir || EXTRA_DIR;
  const warnings     = [];
  const patterns     = [];
  for (const name of includeFiles) readFile(path.join(dir, name), warnings, patterns);
  for (const full of walkJsonl(extraDir)) readFile(full, warnings, patterns);
  return { patterns, warnings };
}

module.exports = { loadPatterns, DEFAULT_DIR, DEFAULT_FILES, EXTRA_DIR };
