#!/usr/bin/env node
"use strict";

// receipt-export.js — ADR-014 audit-grade receipt exporter. Pure, zero-dep.
// Reads `<HORUS_STATE_DIR>/decision-journal.jsonl`, filters, applies optional
// redaction, and emits canonical-JSON jsonl or deterministic CSV. The export
// bundle manifest sha256s the canonical content so two byte-stable exports of
// the same filtered slice produce the same bundleHash.

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const { canonicalJson } = require("./canonical-json");
const { stateDir } = require("./state-paths");
const { loadSchema } = require("./receipt-validator");

const EXPORT_VERSION = "1";
const DEFAULT_JOURNAL = "decision-journal.jsonl";

function _journalPath() { return path.join(stateDir(), DEFAULT_JOURNAL); }

// Read journal lines into entry objects. Malformed lines are skipped silently
// — the schema validator is the right tool to surface those.
function _readJournal(journalFile) {
  const file = journalFile || _journalPath();
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}

function _toMs(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function _matchesFilter(entry, filter) {
  if (!filter) return true;
  const sinceMs = _toMs(filter.since);
  const untilMs = _toMs(filter.until);
  if (sinceMs != null || untilMs != null) {
    const t = _toMs(entry.ts);
    if (t == null) return false;
    if (sinceMs != null && t < sinceMs) return false;
    if (untilMs != null && t > untilMs) return false;
  }
  if (filter.sessionId && entry.sessionId && entry.sessionId !== filter.sessionId) return false;
  if (filter.decisionAction && entry.action !== filter.decisionAction) return false;
  if (filter.riskLevel && entry.riskLevel !== filter.riskLevel) return false;
  if (filter.kind && entry.kind !== filter.kind) return false;
  return true;
}

// Redaction token format: [REDACTED:<class>:<sha-prefix>]. sha-prefix is the
// first 12 hex chars of sha256(value) so auditors can prove a value existed
// without recovering its plaintext. Byte-stable across re-export.
function _redactToken(klass, value) {
  const h = crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 12);
  return "[REDACTED:" + klass + ":" + h + "]";
}

const _F19_PATTERNS = [
  { class: "ssh-private-key",       pattern: /-----BEGIN\s+(?:[A-Z][A-Z ]*\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(?:[A-Z][A-Z ]*\s+)?PRIVATE KEY-----/ },
  { class: "aws-access-key-id",     pattern: /\bAKIA[A-Z0-9]{16}\b/g },
  { class: "github-pat",            pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { class: "openai-api-key",        pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { class: "slack-token",           pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { class: "aws-secret-access-key", pattern: /(?<=AWS_SECRET_ACCESS_KEY\s*[=:]\s*['"]?)([A-Za-z0-9/+=]{40})(?=['"]?)/g },
];

function _redactString(s) {
  let out = String(s == null ? "" : s);
  for (const { class: klass, pattern } of _F19_PATTERNS) {
    out = out.replace(pattern, (m) => _redactToken(klass, m));
  }
  return out;
}

// Walk an entry and redact every string leaf. Object/array structure is
// preserved so the schema still validates byte-stably on the redacted output.
function _redactEntry(entry) {
  function walk(v) {
    if (typeof v === "string") return _redactString(v);
    if (Array.isArray(v))      return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  }
  return walk(entry);
}

// Stable property order for CSV: pull from receipt.v1.json schema.properties
// keys in insertion order. Object-valued props are emitted as canonical-JSON
// strings so CSV stays one-row-per-entry.
function _csvColumns() { return Object.keys(loadSchema().properties); }

function _csvEscape(v) {
  if (v == null) return "";
  let s = typeof v === "string" ? v : canonicalJson(v);
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function _toCsv(entries) {
  const cols = _csvColumns();
  const lines = [cols.join(",")];
  for (const e of entries) {
    const row = [];
    for (const c of cols) row.push(_csvEscape(c in e ? e[c] : ""));
    lines.push(row.join(","));
  }
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

function _toJsonl(entries) {
  const parts = [];
  for (const e of entries) parts.push(canonicalJson(e) + "\n");
  return Buffer.from(parts.join(""), "utf8");
}

// exportReceipts(filter, format) — returns a Buffer of the rendered export.
//   filter: { since, until, sessionId, decisionAction, riskLevel, kind,
//             journalFile, redact }
//   format: "jsonl" | "csv"
function exportReceipts(filter, format) {
  const fmt = String(format || "jsonl").toLowerCase();
  if (fmt !== "jsonl" && fmt !== "csv") throw new Error("receipt-export: unknown format " + fmt);
  const f = filter || {};
  const raw = _readJournal(f.journalFile);
  const filtered = raw.filter((e) => _matchesFilter(e, f));
  const cooked = f.redact ? filtered.map(_redactEntry) : filtered;
  return fmt === "csv" ? _toCsv(cooked) : _toJsonl(cooked);
}

// buildExportManifest — sha256 over the canonical content of the buffer plus
// filter / count metadata. Matches the state-bundle pattern: bundleHash
// excludes createdAt so two identical exports produce identical hash.
function buildExportManifest(buffer, opts) {
  const o = opts || {};
  const m = {
    version: EXPORT_VERSION,
    format: String(o.format || "jsonl"),
    createdAt: String(o.createdAt || new Date().toISOString()),
    entryCount: Number(o.entryCount || 0),
    bytes: buffer.length,
    contentSha256: "sha256:" + crypto.createHash("sha256").update(buffer).digest("hex"),
    filter: o.filter || null,
    redact: Boolean(o.redact),
  };
  const copy = Object.assign({}, m); delete copy.createdAt;
  m.bundleHash = "sha256:" + crypto.createHash("sha256").update(canonicalJson(copy)).digest("hex");
  return m;
}

// roundTrip(buffer, format) — parse the rendered export back to entry objects
// then re-emit. Returns { ok, reEmitted, mismatch? }. ok=true means the
// re-emitted bytes equal the input buffer (canonical-stable). Used by the
// doctor CLI + tests to prove the exporter is its own inverse.
function roundTrip(buffer, format) {
  const fmt = String(format || "jsonl").toLowerCase();
  if (fmt !== "jsonl") return { ok: false, reason: "round-trip-only-implemented-for-jsonl" };
  const lines = buffer.toString("utf8").split("\n").filter(Boolean);
  const parsed = [];
  for (let i = 0; i < lines.length; i++) {
    try { parsed.push(JSON.parse(lines[i])); }
    catch (err) { return { ok: false, reason: "parse-error line=" + (i + 1) + " " + err.message }; }
  }
  const reEmitted = _toJsonl(parsed);
  if (reEmitted.length !== buffer.length || !reEmitted.equals(buffer)) {
    return { ok: false, reason: "byte-mismatch", reEmitted, parsedCount: parsed.length };
  }
  return { ok: true, reEmitted, parsedCount: parsed.length };
}

module.exports = {
  EXPORT_VERSION,
  exportReceipts,
  buildExportManifest,
  roundTrip,
  _readJournal,
  _redactEntry,
  _redactString,
  _redactToken,
  _csvColumns,
};
