#!/usr/bin/env node
"use strict";

// state-bundle.js — ADR-011 portable export/import of Lilara state under
// LILARA_STATE_DIR. Zero-dep. Format: hand-rolled POSIX-ustar tar carrying a
// root `bundle-manifest.json` plus `data/<rel>` for each included file. Regular
// files only; symlinks/sockets/FIFOs and secrets/lock/tmp files are excluded
// via SECRET_BLACKLIST. Chain-continuity-on-import is enforced via
// journal-chain.computeEntryHash without HMAC checks (the install.key is
// rightly excluded — cross-host HMAC limitation is documented in ADR-011).

const fs     = require("fs");
const os     = require("os");
const path   = require("path");
const crypto = require("crypto");
const { canonicalJson } = require("./canonical-json");
const { stateDir } = require("./state-paths");
const { readEntries: readChainEntries, computeEntryHash } = require("./journal-chain");

const BUNDLE_VERSION = "1";
const MANIFEST_NAME  = "bundle-manifest.json";
const DATA_PREFIX    = "data/";
const CHAIN_FILE     = "journal-chain.jsonl";

// install.key / operator-tokens.jsonl are live credentials; secrets/ is the
// operator vault; .sock/.fifo are runtime IPC; .lock/.tmp/.swp are host-local.
const SECRET_BLACKLIST = [
  /(^|\/)install\.key$/, /(^|\/)operator-tokens\.jsonl$/,
  /\.key$/, /\.pem$/, /\.priv$/, /(^|\/)secrets\//,
  /\.sock$/, /\.fifo$/, /\.lock$/, /\.tmp$/, /\.swp$/,
];
function isBlacklisted(rel) { for (const re of SECRET_BLACKLIST) if (re.test(rel)) return true; return false; }

function hostFingerprint(opts) {
  const o = opts || {};
  const h = String(o.hostname != null ? o.hostname : os.hostname());
  const p = String(o.platform != null ? o.platform : os.platform());
  const a = String(o.arch     != null ? o.arch     : os.arch());
  return "hf_" + crypto.createHash("sha256").update(h + "|" + p + "|" + a).digest("hex").slice(0, 16);
}

function readChainTip(dir) {
  try {
    const e = readChainEntries(path.join(dir, CHAIN_FILE));
    return e.length === 0 ? null : e[e.length - 1].entryHash;
  } catch { return null; }
}

function enumerateFiles(baseDir) {
  const files = [], skipped = [];
  function walk(rel) {
    const abs = rel === "" ? baseDir : path.join(baseDir, rel);
    let st; try { st = fs.lstatSync(abs); } catch { return; }
    if (st.isSymbolicLink()) { skipped.push({ path: rel, reason: "symlink" }); return; }
    if (st.isDirectory()) {
      let kids = []; try { kids = fs.readdirSync(abs).sort(); } catch { return; }
      for (const c of kids) walk(rel ? rel + "/" + c : c);
      return;
    }
    if (!st.isFile())          { skipped.push({ path: rel, reason: "non-regular" });     return; }
    if (isBlacklisted(rel))    { skipped.push({ path: rel, reason: "secret-blacklist" }); return; }
    files.push({ rel, abs, size: st.size });
  }
  try { if (fs.existsSync(baseDir)) walk(""); } catch { /* empty bundle on missing dir */ }
  files.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  skipped.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, skipped };
}

function buildExportManifest(dir, opts) {
  const o = opts || {};
  const baseDir = dir || stateDir();
  const { files, skipped } = enumerateFiles(baseDir);
  const entries = []; let totalBytes = 0;
  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    entries.push({ path: f.rel, size: data.length, sha256: "sha256:" + crypto.createHash("sha256").update(data).digest("hex") });
    totalBytes += data.length;
  }
  return {
    version: BUNDLE_VERSION,
    createdAt: String(o.createdAt || new Date().toISOString()),
    exportedBy: {
      hostname: String(o.hostname != null ? o.hostname : os.hostname()),
      platform: String(o.platform != null ? o.platform : os.platform()),
    },
    hostFingerprint: hostFingerprint(o),
    journalChainTipAt: readChainTip(baseDir),
    fileCount: entries.length,
    totalBytes,
    entries,
    excluded: skipped,
  };
}

// bundleHash excludes itself + createdAt so two consecutive exports of the
// same state produce identical bundleHash (brief: byte-stability check).
function computeBundleHash(manifest) {
  const copy = Object.assign({}, manifest);
  delete copy.bundleHash; delete copy.createdAt;
  return "sha256:" + crypto.createHash("sha256").update(canonicalJson(copy)).digest("hex");
}

// ─── POSIX-ustar tar (regular files only, 512-byte blocks) ──────────────────
function toOctal(n, len) { return n.toString(8).padStart(len, "0"); }

function ustarHeader(name, size, mtime) {
  const buf = Buffer.alloc(512);
  const nb = Buffer.from(name, "utf8");
  if (nb.length <= 100) nb.copy(buf, 0);
  else {
    let split = -1;
    for (let i = Math.min(nb.length - 1, 154); i >= 0; i--) if (nb[i] === 0x2f) { split = i; break; }
    if (split < 0 || nb.length - split - 1 > 100 || split > 155) throw new Error("state-bundle: path too long for ustar: " + name);
    nb.slice(split + 1).copy(buf, 0); nb.slice(0, split).copy(buf, 345);
  }
  buf.write(toOctal(0o644, 7) + "\0", 100, 8, "ascii");
  buf.write("0000000\0", 108, 8, "ascii"); buf.write("0000000\0", 116, 8, "ascii");
  buf.write(toOctal(size, 11) + "\0", 124, 12, "ascii");
  buf.write(toOctal(Math.floor(mtime), 11) + "\0", 136, 12, "ascii");
  buf.fill(0x20, 148, 156); buf[156] = 0x30;
  buf.write("ustar\0", 257, 6, "ascii"); buf.write("00", 263, 2, "ascii");
  buf.write("0000000\0", 329, 8, "ascii"); buf.write("0000000\0", 337, 8, "ascii");
  let sum = 0; for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(toOctal(sum, 6) + "\0 ", 148, 8, "ascii");
  return buf;
}

function parseOctal(buf, off, len) {
  let s = "";
  for (let i = 0; i < len; i++) { const c = buf[off + i]; if (c === 0 || c === 0x20) break; s += String.fromCharCode(c); }
  return s ? parseInt(s, 8) : 0;
}
function readNullTerm(buf, off, len) {
  let end = off + len;
  for (let i = off; i < off + len; i++) if (buf[i] === 0) { end = i; break; }
  return buf.subarray(off, end).toString("utf8");
}

function writeTar(files) {
  const chunks = [];
  for (const f of files) {
    chunks.push(ustarHeader(f.path, f.data.length, f.mtime || 0));
    chunks.push(f.data);
    const pad = (512 - (f.data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function readTar(buf) {
  const out = []; let off = 0;
  while (off + 512 <= buf.length) {
    const hdr = buf.subarray(off, off + 512);
    let allZero = true;
    for (let i = 0; i < 512; i++) if (hdr[i] !== 0) { allZero = false; break; }
    if (allZero) break;
    const stored = parseOctal(hdr, 148, 8);
    let sum = 0; for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 0x20 : hdr[i];
    if (stored !== sum) throw new Error("state-bundle: tar checksum mismatch at offset " + off);
    if (!hdr.subarray(257, 263).toString("ascii").startsWith("ustar")) throw new Error("state-bundle: not a ustar archive");
    const tf = String.fromCharCode(hdr[156]);
    if (tf !== "0" && tf !== "\0") throw new Error("state-bundle: unsupported typeflag '" + tf + "'");
    const prefix = readNullTerm(hdr, 345, 155);
    const name   = readNullTerm(hdr, 0, 100);
    const full   = prefix ? prefix + "/" + name : name;
    const size   = parseOctal(hdr, 124, 12);
    off += 512;
    out.push({ path: full, data: Buffer.from(buf.subarray(off, off + size)) });
    off += size + ((512 - (size % 512)) % 512);
  }
  return out;
}

function exportBundle(opts) {
  const o = opts || {};
  const srcDir  = o.stateDir || stateDir();
  const outPath = String(o.outPath || "");
  if (!outPath) throw new Error("state-bundle: outPath required");
  if (fs.existsSync(outPath) && !o.force) throw new Error("state-bundle: refusing to overwrite " + outPath + " (pass force=true / --force)");
  const m = buildExportManifest(srcDir, o);
  m.bundleHash = computeBundleHash(m);
  const files = [{ path: MANIFEST_NAME, data: Buffer.from(JSON.stringify(m, null, 2) + "\n", "utf8"), mtime: 0 }];
  for (const e of m.entries) files.push({ path: DATA_PREFIX + e.path, data: fs.readFileSync(path.join(srcDir, e.path)), mtime: 0 });
  const tmp = outPath + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, writeTar(files), { mode: 0o600 });
  fs.renameSync(tmp, outPath);
  return m;
}

function readBundle(bundlePath) {
  const files = readTar(fs.readFileSync(bundlePath));
  const me = files.find((f) => f.path === MANIFEST_NAME);
  if (!me) throw new Error("state-bundle: bundle missing " + MANIFEST_NAME);
  let manifest;
  try { manifest = JSON.parse(me.data.toString("utf8")); }
  catch (err) { throw new Error("state-bundle: manifest is not valid JSON: " + err.message); }
  const dataFiles = files.filter((f) => f.path.startsWith(DATA_PREFIX))
    .map((f) => ({ path: f.path.slice(DATA_PREFIX.length), data: f.data }));
  return { manifest, dataFiles };
}

function validateImportManifest(m, opts) {
  const o = opts || {};
  const problems = [];
  if (!m || typeof m !== "object") return { ok: false, problems: ["manifest-not-object"], crossHost: false, localHostFingerprint: hostFingerprint(o) };
  if (m.version !== BUNDLE_VERSION) problems.push("version-mismatch: expected " + BUNDLE_VERSION + ", got " + m.version);
  if (!Array.isArray(m.entries))    problems.push("entries-not-array");
  if (m.bundleHash !== computeBundleHash(m)) problems.push("bundle-hash-mismatch");
  if (Array.isArray(m.entries)) for (const e of m.entries) {
    if (!e || typeof e.path !== "string") { problems.push("manifest-entry-malformed"); continue; }
    if (isBlacklisted(e.path)) problems.push("blacklisted-entry-in-manifest: " + e.path);
  }
  const local = hostFingerprint(o);
  return { ok: problems.length === 0, problems, crossHost: m.hostFingerprint !== local, localHostFingerprint: local };
}

// Walks the chain using only entryHash/prevHash/seq + tip. HMAC checks
// (genesis, checkpoint) are skipped because the source install.key is
// blacklisted — see ADR-011 for the cross-host limitation.
function validateChainContinuity(chainBytes, expectedTip) {
  if (!chainBytes || chainBytes.length === 0)
    return expectedTip == null ? { ok: true } : { ok: false, reason: "expected-tip-but-no-chain" };
  const lines = chainBytes.toString("utf8").split("\n");
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    try { entries.push(JSON.parse(lines[i])); }
    catch { return { ok: false, reason: "chain-malformed-json line=" + (i + 1) }; }
  }
  if (entries.length === 0)
    return expectedTip == null ? { ok: true } : { ok: false, reason: "expected-tip-but-empty-chain" };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.entryHash !== computeEntryHash(e)) return { ok: false, reason: "chain-entryhash-mismatch", seq: e.seq };
    if (i > 0) {
      const prev = entries[i - 1];
      if (e.seq !== prev.seq + 1)        return { ok: false, reason: "chain-seq-discontinuity", seq: e.seq };
      if (e.prevHash !== prev.entryHash) return { ok: false, reason: "chain-prevhash-mismatch", seq: e.seq };
    }
  }
  const last = entries[entries.length - 1];
  if (last.entryHash !== expectedTip) return { ok: false, reason: "chain-tip-mismatch", expected: expectedTip, actual: last.entryHash };
  return { ok: true };
}

function validateBundle(bundlePath, opts) {
  const o = opts || {};
  const { manifest, dataFiles } = readBundle(bundlePath);
  const mv = validateImportManifest(manifest, o);
  const problems = mv.problems.slice();
  const byPath = new Map(dataFiles.map((f) => [f.path, f]));
  if (Array.isArray(manifest.entries)) for (const e of manifest.entries) {
    const f = byPath.get(e.path);
    if (!f) { problems.push("missing-data-file: " + e.path); continue; }
    const actual = "sha256:" + crypto.createHash("sha256").update(f.data).digest("hex");
    if (actual !== e.sha256)      problems.push("file-sha256-mismatch: " + e.path);
    if (f.data.length !== e.size) problems.push("file-size-mismatch: "   + e.path);
  }
  for (const f of dataFiles) if (isBlacklisted(f.path)) problems.push("blacklisted-data-file: " + f.path);
  const chainEntry = dataFiles.find((f) => f.path === CHAIN_FILE);
  const cr = validateChainContinuity(chainEntry ? chainEntry.data : Buffer.alloc(0), manifest.journalChainTipAt);
  if (!cr.ok) problems.push("journal-chain: " + cr.reason + (cr.seq != null ? " seq=" + cr.seq : ""));
  return { ok: problems.length === 0, problems, manifest, dataFiles, crossHost: mv.crossHost, localHostFingerprint: mv.localHostFingerprint };
}

function importBundle(bundlePath, opts) {
  const o = opts || {};
  const r = validateBundle(bundlePath, o);
  if (!r.ok) return { ok: false, problems: r.problems, manifest: r.manifest, crossHost: r.crossHost };
  if (r.crossHost && !o.acceptCrossHost)
    return { ok: false, problems: ["cross-host-restore: hostFingerprint differs (pass acceptCrossHost=true / --accept-cross-host)"], manifest: r.manifest, crossHost: true };
  if (!o.apply) return { ok: true, dryRun: true, manifest: r.manifest, crossHost: r.crossHost };
  const targetDir = o.stateDir || stateDir();
  if (fs.existsSync(targetDir)) {
    let kids = []; try { kids = fs.readdirSync(targetDir); } catch { /* unreadable */ }
    if (kids.length > 0 && !o.force)
      return { ok: false, problems: ["target-non-empty: " + targetDir + " (pass force=true / --force)"], manifest: r.manifest, crossHost: r.crossHost };
  }
  const parent  = path.dirname(path.resolve(targetDir));
  const staging = path.join(parent, "." + path.basename(targetDir) + ".import-staging-" + process.pid + "-" + Date.now());
  try { fs.mkdirSync(parent, { recursive: true }); } catch { /* may exist */ }
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
  let backup = null;
  try {
    for (const f of r.dataFiles) {
      const out = path.join(staging, f.path);
      fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
      fs.writeFileSync(out, f.data, { mode: 0o600 });
    }
    if (fs.existsSync(targetDir)) {
      backup = targetDir + ".pre-import-" + Date.now();
      fs.renameSync(targetDir, backup);
    }
    fs.renameSync(staging, targetDir);
    return { ok: true, applied: true, manifest: r.manifest, backupPath: backup, crossHost: r.crossHost };
  } catch (err) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best-effort */ }
    if (backup && !fs.existsSync(targetDir)) { try { fs.renameSync(backup, targetDir); } catch { /* best-effort */ } }
    return { ok: false, problems: ["import-write-failed: " + err.message], manifest: r.manifest, crossHost: r.crossHost };
  }
}

module.exports = {
  BUNDLE_VERSION, MANIFEST_NAME, SECRET_BLACKLIST,
  isBlacklisted, hostFingerprint, readChainTip,
  buildExportManifest, computeBundleHash,
  validateImportManifest, validateChainContinuity, validateBundle,
  exportBundle, importBundle, readBundle, writeTar, readTar,
};
