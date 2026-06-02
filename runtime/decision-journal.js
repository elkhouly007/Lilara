#!/usr/bin/env node
"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const zlib = require("zlib");
const { stateDir }    = require("./state-paths");
const { redact } = require("./secret-scan");
const { ensureBaseDirSafe } = require("./state-dir"); // ADR-028

// Maximum size before rotation. Override with LILARA_JOURNAL_MAX_MB (integer MB).
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
  const mb = Number(process.env.LILARA_JOURNAL_MAX_MB);
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
  if (process.env.LILARA_DECISION_JOURNAL === "0") return false;
  if (process.env.LILARA_READONLY_CONTRACT === "1") return false;
  if (process.env.ARG_DECISION_JOURNAL === "0") {
    process.stderr.write("[ARG_DECISION_JOURNAL] deprecated — use LILARA_DECISION_JOURNAL=0 instead\n");
    return false;
  }
  // ADR-028: validate state dir before any write. A poisoned journal dir could
  // let an attacker forge the hash chain; warn-and-disable is the correct fallback
  // (same as LILARA_DECISION_JOURNAL=0 — action output is unaffected).
  const { baseDir, logFile } = journalPaths();
  if (!ensureBaseDirSafe(baseDir)) return false;
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
    // F19 (ADR-010): output-exfil receipt detail. Pass-through object; the
    // engine populates it on every F19 fire (confirmed/suspicious/compensating)
    // and absent otherwise so existing journals stay byte-identical.
    ...(entry.f19Detail && typeof entry.f19Detail === "object" ? { f19Detail: entry.f19Detail } : {}),
    // F20 (ADR-012): change-intent drift receipt key. Pass-through; the
    // engine populates it on every F20 evaluation (declared or not).
    ...(entry.changeIntent && typeof entry.changeIntent === "object" ? { changeIntent: entry.changeIntent } : {}),
    // ADR-013: snapshot receipt key pass-through. Engine sets this on
    // destructive-allow decisions; absent otherwise so existing journals
    // stay byte-identical.
    ...(entry.snapshot && typeof entry.snapshot === "object" ? { snapshot: entry.snapshot } : {}),
    // ADR-015 PR-η: notification result pass-through. notify.js writes a
    // dedicated `kind:"notify"` entry per event; absent on every other path
    // so existing journals stay byte-identical.
    ...(Array.isArray(entry.notifyResult) ? { notifyResult: entry.notifyResult } : {}),
    // Lilara ADR-007 PR-B: additive IR fields. decision-engine only forwards
    // these when LILARA_IR_JOURNAL=1 so existing receipts stay byte-identical
    // by default. Receipts already on disk continue to validate; new-format
    // receipts gain stable cross-call identity via irHash + lattice anchors.
    ...(entry.irHash         ? { irHash: String(entry.irHash) } : {}),
    ...(entry.latticeVersion ? { latticeVersion: String(entry.latticeVersion) } : {}),
    ...(entry.rung != null && Number.isFinite(Number(entry.rung)) ? { rung: Number(entry.rung) } : {}),
  };
  // ADR-014 dev-mode receipt validation. Off by default (production hot
  // path skips). When LILARA_VALIDATE_RECEIPTS=1, every assembled record is
  // schema-checked before journaling; an invalid record throws so the bug
  // surfaces in tests instead of corrupting the audit trail.
  if (process.env.LILARA_VALIDATE_RECEIPTS === "1") {
    const { validateReceipt } = require("./receipt-validator");
    const r = validateReceipt(record);
    if (!r.valid) {
      const first = r.errors.slice(0, 3).map((e) => e.path + ":" + e.message).join("; ");
      throw new Error("receipt-validation-failed: " + first);
    }
  }
  fs.appendFileSync(logFile, JSON.stringify(record) + "\n", { mode: 0o600 });
  return true;
}

module.exports = { append, journalPaths };
