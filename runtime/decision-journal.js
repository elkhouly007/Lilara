#!/usr/bin/env node
"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const zlib = require("zlib");
const { stateDir }    = require("./state-paths");
const { redact } = require("./secret-scan");

// Maximum size before rotation. Override with HORUS_JOURNAL_MAX_MB (integer MB).
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_GENERATIONS   = 3;               // keep .1.jsonl, .2.jsonl.gz, .3.jsonl.gz

function journalPaths() {
  const baseDir = stateDir();
  return {
    baseDir,
    logFile: path.join(baseDir, "decision-journal.jsonl"),
  };
}

function ensureBaseDir() {
  const { baseDir } = journalPaths();
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  }
}

function maxBytes() {
  const mb = Number(process.env.HORUS_JOURNAL_MAX_MB);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : DEFAULT_MAX_BYTES;
}

// Rotate: shift .2.jsonl.gz → .3.jsonl.gz, .1.jsonl → .2.jsonl.gz, active → .1.jsonl
function rotateIfNeeded(logFile) {
  try {
    const stat = fs.statSync(logFile);
    if (stat.size < maxBytes()) return;
  } catch {
    return; // file doesn't exist yet; nothing to rotate
  }

  try {
    const base = logFile; // decision-journal.jsonl

    // Drop the oldest generation if it exists.
    const oldest = `${base}.${MAX_GENERATIONS}.jsonl.gz`;
    try { fs.unlinkSync(oldest); } catch { /* didn't exist */ }

    // Shift generations 2..MAX-1 down by one.
    for (let g = MAX_GENERATIONS - 1; g >= 2; g--) {
      const src  = `${base}.${g}.jsonl.gz`;
      const dest = `${base}.${g + 1}.jsonl.gz`;
      try { fs.renameSync(src, dest); } catch { /* gap is fine */ }
    }

    // Compress .1.jsonl → .2.jsonl.gz if it exists.
    const gen1 = `${base}.1.jsonl`;
    const gen2 = `${base}.2.jsonl.gz`;
    if (fs.existsSync(gen1)) {
      try {
        const content   = fs.readFileSync(gen1);
        const compressed = zlib.gzipSync(content);
        fs.writeFileSync(gen2, compressed, { mode: 0o600 });
        fs.unlinkSync(gen1);
      } catch { /* compression failure — leave gen1 in place */ }
    }

    // Move the active log to .1.jsonl.
    try { fs.renameSync(base, gen1); } catch {
      // Rename may fail on Windows if another process has the file open.
      try {
        fs.copyFileSync(base, gen1);
        fs.writeFileSync(base, "", { mode: 0o600 }); // truncate
      } catch { /* best-effort */ }
    }
  } catch { /* rotation failure must never crash callers */ }
}

// Redact free-text using secret-scan.redact() (D27/D29).
// Applied before truncation so a secret that spans the 256-char boundary is
// still caught. Uses per-pattern labels, e.g. [REDACTED:aws-access-key-id].
function redactText(text) {
  return redact(text);
}

function append(entry) {
  if (process.env.HORUS_DECISION_JOURNAL === "0") return false;
  if (process.env.HORUS_READONLY_CONTRACT === "1") return false;
  if (process.env.ARG_DECISION_JOURNAL === "0") {
    process.stderr.write("[ARG_DECISION_JOURNAL] deprecated — use HORUS_DECISION_JOURNAL=0 instead\n");
    return false;
  }
  ensureBaseDir();
  const { logFile } = journalPaths();
  rotateIfNeeded(logFile);
  const shouldRedact = Boolean(entry.redact);
  const clean = shouldRedact ? redactText : (t) => String(t || "");
  // D28: redaction policy — only targetPath and notes pass through clean().
  // action, riskLevel, riskScore, reasonCodes, tool, branch, intent, scopeHit,
  // floorFired, taintSource, taintReason are retained verbatim (never secrets).
  const record = {
    ts: new Date().toISOString(),
    kind: String(entry.kind || "decision"),
    action: String(entry.action || "unknown"),
    riskLevel: String(entry.riskLevel || "unknown"),
    riskScore: Number(entry.riskScore || 0),
    reasonCodes: Array.isArray(entry.reasonCodes) ? entry.reasonCodes.slice(0, 12) : [],
    tool: String(entry.tool || ""),
    branch: String(entry.branch || ""),
    targetPath: clean(String(entry.targetPath || "")).slice(0, 256),
    notes: clean(String(entry.notes || "")).slice(0, 256),
    ...(shouldRedact ? { redactInJournal: true } : {}),
    // Optional pass-through fields — present only when populated by caller
    ...(entry.contractId    ? { contractId: String(entry.contractId), contractRevision: entry.contractRevision != null ? String(entry.contractRevision) : undefined } : {}),
    ...(entry.scopeHit      ? { scopeHit: String(entry.scopeHit) } : {}),
    ...(entry.floorFired    ? { floorFired: String(entry.floorFired) } : {}),
    ...(entry.taintSource   ? { taintSource: String(entry.taintSource), taintReason: String(entry.taintReason || "") } : {}),
    ...(entry.intent        ? { intent: String(entry.intent) } : {}),
    // ADR-009 PR-C: ambient-touch receipt fields (pass-through; engine computes).
    ...(entry.ambientClass  ? { ambientClass: String(entry.ambientClass) } : {}),
    ...(entry.ambientPath   ? { ambientPath:  String(entry.ambientPath)  } : {}),
    // ADR-004 PR 37B: degraded-mode marker pass-through. Engine sets this
    // when the journal hash chain has failed verify; absent otherwise so
    // existing journals stay byte-identical for healthy chains.
    ...(entry.degradedMode && typeof entry.degradedMode === "object" ? { degradedMode: entry.degradedMode } : {}),
    // HAP ADR-007 PR-B: additive IR fields. decision-engine only forwards
    // these when HORUS_IR_JOURNAL=1 so existing receipts stay byte-identical
    // by default. Receipts already on disk continue to validate; new-format
    // receipts gain stable cross-call identity via irHash + lattice anchors.
    ...(entry.irHash         ? { irHash: String(entry.irHash) } : {}),
    ...(entry.latticeVersion ? { latticeVersion: String(entry.latticeVersion) } : {}),
    ...(entry.rung != null && Number.isFinite(Number(entry.rung)) ? { rung: Number(entry.rung) } : {}),
  };
  fs.appendFileSync(logFile, JSON.stringify(record) + "\n", { mode: 0o600 });
  return true;
}

module.exports = { append, journalPaths };
