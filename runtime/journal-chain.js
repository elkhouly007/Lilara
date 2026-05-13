#!/usr/bin/env node
"use strict";

// journal-chain.js — ADR-004 PR 37A: tamper-evident hash-chained JSONL.
//
// Each entry: { seq, ts, type, payload, prevHash, entryHash }.
// entryHash = sha256 over canonical-JSON of the entry MINUS entryHash.
// Genesis additionally carries genesisSig = HMAC-SHA256(installKey, canonical
// genesis MINUS genesisSig). Install key is generated once and stored at
// <stateDir>/install.key with 0600 perms (best-effort on platforms where chmod
// is a no-op). Key bytes never appear in logs, receipts or thrown errors.
//
// A companion checkpoint file <chain>.checkpoint records the chain's terminal
// {lastSeq, lastHash, entryCount} after every append, HMAC'd with the install
// key. verify() compares the chain's terminal entry against this checkpoint so
// that tail truncation is detected — without the checkpoint the trailing prefix
// still verifies clean. The HMAC binds the checkpoint to the install key, so an
// attacker who can write the journal cannot forge a matching checkpoint.
//
// This module is detect-and-report only in PR 37A. It does not change runtime
// enforcement: no degraded-mode gating, no auto-snapshot. Call sites today are
// the verify CLI and the runtime test in tests/runtime/journal-chain.test.js.

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const { canonicalJson } = require("./canonical-json");
const { stateDir, ensureDir } = require("./state-paths");

const CHAIN_FILE = "journal-chain.jsonl";
const KEY_FILE   = "install.key";
const KEY_BYTES  = 32;
const CHECKPOINT_SUFFIX = ".checkpoint";

function chainPath() {
  return path.join(stateDir(), CHAIN_FILE);
}

function installKeyPath() {
  return path.join(stateDir(), KEY_FILE);
}

function checkpointPath(file) {
  return (file || chainPath()) + CHECKPOINT_SUFFIX;
}

// Read or create the install key. Generated on first use with 32 random bytes
// and persisted as hex with 0600 perms. Returns the raw key buffer; callers
// MUST NOT log it.
function getOrCreateInstallKey() {
  ensureDir(stateDir());
  const p = installKeyPath();
  try {
    const hex = fs.readFileSync(p, "utf8").trim();
    if (/^[0-9a-f]+$/i.test(hex) && hex.length >= KEY_BYTES * 2) {
      return Buffer.from(hex, "hex");
    }
  } catch { /* missing or unreadable — regenerate */ }
  const key = crypto.randomBytes(KEY_BYTES);
  fs.writeFileSync(p, key.toString("hex") + "\n", { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch { /* non-POSIX FS: best-effort */ }
  return key;
}

// Stable 8-char fingerprint of the install key (sha256 prefix). Safe to log —
// derived from a one-way hash, not the key itself.
function installKeyId(key) {
  return "k_" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

function sha256Hex(buf) {
  return "sha256:" + crypto.createHash("sha256").update(buf).digest("hex");
}

function computeEntryHash(entry) {
  const copy = { ...entry };
  delete copy.entryHash;
  return sha256Hex(canonicalJson(copy));
}

// HMAC binds the genesis content; we exclude entryHash (which encloses
// the signature in the chain) and genesisSig (the signature itself) so the
// canonical input is identical at write time and verify time.
function computeGenesisSig(entry, key) {
  const copy = { ...entry };
  delete copy.genesisSig;
  delete copy.entryHash;
  return "hmac-sha256:" + crypto.createHmac("sha256", key)
    .update(canonicalJson(copy)).digest("hex");
}

// Checkpoint HMAC binds {lastSeq, lastHash, entryCount} to the install key so
// an attacker who can write the journal cannot forge a checkpoint matching a
// truncated tail without also reading the 0600 install.key file.
function computeCheckpointHmac(cp, key) {
  const copy = { ...cp };
  delete copy.hmac;
  return "hmac-sha256:" + crypto.createHmac("sha256", key)
    .update(canonicalJson(copy)).digest("hex");
}

function writeCheckpoint(file, entry, count) {
  const key = getOrCreateInstallKey();
  const cp = { lastSeq: entry.seq, lastHash: entry.entryHash, entryCount: count };
  cp.hmac = computeCheckpointHmac(cp, key);
  const p = checkpointPath(file);
  fs.writeFileSync(p, JSON.stringify(cp) + "\n", { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch { /* best-effort on non-POSIX */ }
}

// Returns parsed checkpoint object, or null if missing/unreadable/malformed.
// Treating malformed as null is intentional: verify() will then report
// checkpoint-missing, which is itself a tamper signal.
function readCheckpoint(file) {
  try {
    const raw = fs.readFileSync(checkpointPath(file), "utf8").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function readEntries(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (err) { if (err.code === "ENOENT") return []; throw err; }
  const out = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try { out.push(JSON.parse(line)); }
    catch { const e = new Error(`malformed JSON on line ${i + 1}`); e.line = i + 1; throw e; }
  }
  return out;
}

// Append a chained entry. Auto-creates a genesis on first write. Returns the
// appended entry. project label is recorded in genesis only.
function append(type, payload, opts) {
  const o = opts || {};
  const file = o.file || chainPath();
  ensureDir(path.dirname(file));
  const entries = readEntries(file);
  const now = typeof o.ts === "number" ? o.ts : Date.now();
  if (entries.length === 0) {
    const key = getOrCreateInstallKey();
    const genesisPayload = {
      project: String(o.project || "agent-runtime-guard"),
      installKeyId: installKeyId(key),
    };
    const draft = { seq: 0, ts: now, type: "journal.genesis", payload: genesisPayload, prevHash: null };
    draft.genesisSig = computeGenesisSig(draft, key);
    draft.entryHash  = computeEntryHash(draft);
    fs.appendFileSync(file, JSON.stringify(draft) + "\n", { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* best-effort */ }
    writeCheckpoint(file, draft, 1);
    if (type === "journal.genesis") return draft;
    return append(type, payload, opts);
  }
  const prev = entries[entries.length - 1];
  const entry = {
    seq: prev.seq + 1,
    ts: now,
    type: String(type || "unknown"),
    payload: payload == null ? {} : payload,
    prevHash: prev.entryHash,
  };
  entry.entryHash = computeEntryHash(entry);
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", { mode: 0o600 });
  writeCheckpoint(file, entry, entries.length + 1);
  return entry;
}

// Walk the chain. Returns { ok, entryCount, errors: [{seq, line, reason}] }.
// Detects: malformed JSON, missing/incorrect entryHash (mutation), seq gaps
// or non-monotonic seq (deletion/reordering), prevHash mismatch (reordering,
// chain break), bad genesis HMAC (key swap / forgery), and — via the
// companion checkpoint file — tail truncation, checkpoint deletion, and
// checkpoint forgery without the install key.
function verify(opts) {
  const o = opts || {};
  const file = o.file || chainPath();
  const errors = [];
  let entries;
  try { entries = readEntries(file); }
  catch (err) {
    errors.push({ seq: null, line: err.line || null, reason: "malformed-json: " + err.message });
    return { ok: false, entryCount: 0, errors };
  }
  if (entries.length === 0) {
    return { ok: true, entryCount: 0, errors };
  }
  const genesis = entries[0];
  if (genesis.seq !== 0) {
    errors.push({ seq: genesis.seq, line: 1, reason: "genesis-seq-not-zero" });
  }
  if (genesis.type !== "journal.genesis") {
    errors.push({ seq: genesis.seq, line: 1, reason: "genesis-type-mismatch" });
  }
  if (genesis.prevHash !== null) {
    errors.push({ seq: genesis.seq, line: 1, reason: "genesis-prevhash-not-null" });
  }
  // Genesis HMAC: re-sign with the on-disk install key and compare.
  let key;
  try { key = getOrCreateInstallKey(); } catch { /* unreadable */ }
  if (key) {
    const expectSig = computeGenesisSig(genesis, key);
    if (!genesis.genesisSig || genesis.genesisSig !== expectSig) {
      errors.push({ seq: 0, line: 1, reason: "genesis-hmac-mismatch" });
    }
  } else {
    errors.push({ seq: 0, line: 1, reason: "install-key-unreadable" });
  }
  // Entry-by-entry hash check + chain linkage.
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const expectHash = computeEntryHash(e);
    if (e.entryHash !== expectHash) {
      errors.push({ seq: e.seq, line: i + 1, reason: "entryhash-mismatch" });
    }
    if (i > 0) {
      const prev = entries[i - 1];
      if (e.seq !== prev.seq + 1) {
        errors.push({ seq: e.seq, line: i + 1, reason: "seq-discontinuity prev=" + prev.seq });
      }
      if (e.prevHash !== prev.entryHash) {
        errors.push({ seq: e.seq, line: i + 1, reason: "prevhash-mismatch" });
      }
    }
  }
  // Checkpoint binds the chain's terminal state to the install key. Required
  // whenever the chain has any entries — its absence (or HMAC mismatch, or
  // disagreement with the journal's terminal entry) means the tail has been
  // truncated or the checkpoint has been forged without the install key.
  const last = entries[entries.length - 1];
  const cp = readCheckpoint(file);
  if (!cp) {
    errors.push({ seq: last.seq, line: entries.length, reason: "checkpoint-missing" });
  } else {
    let cpHmacOk = false;
    if (key) {
      const expected = computeCheckpointHmac(cp, key);
      if (cp.hmac && cp.hmac === expected) cpHmacOk = true;
    }
    if (!cpHmacOk) {
      errors.push({ seq: cp.lastSeq, line: null, reason: "checkpoint-hmac-mismatch" });
    }
    if (cp.lastSeq !== last.seq) {
      errors.push({ seq: last.seq, line: entries.length, reason: "checkpoint-seq-mismatch expected=" + cp.lastSeq });
    }
    if (cp.lastHash !== last.entryHash) {
      errors.push({ seq: last.seq, line: entries.length, reason: "checkpoint-hash-mismatch" });
    }
    if (cp.entryCount !== entries.length) {
      errors.push({ seq: last.seq, line: entries.length, reason: "checkpoint-count-mismatch expected=" + cp.entryCount });
    }
  }
  return { ok: errors.length === 0, entryCount: entries.length, errors };
}

module.exports = {
  chainPath,
  installKeyPath,
  checkpointPath,
  installKeyId,
  getOrCreateInstallKey,
  computeEntryHash,
  computeGenesisSig,
  computeCheckpointHmac,
  readEntries,
  readCheckpoint,
  append,
  verify,
};
