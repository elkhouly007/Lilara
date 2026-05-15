#!/usr/bin/env node
"use strict";

// snapshot.js — ADR-013 pre-destructive-op file-tree snapshot helper.
// Zero-dep. Pure Node + node:zlib. Writes a bundle under
// `<HORUS_STATE_DIR>/snapshots/<snapshotId>/` containing a canonical-JSON
// manifest plus one gzip blob per captured file. Side-effect rail only —
// snapshot decisions NEVER change a decision-engine action; failures
// fail-open. See references/adr-013-auto-snapshot.md.

const fs     = require("node:fs");
const path   = require("node:path");
const crypto = require("node:crypto");
const zlib   = require("node:zlib");
const { canonicalJson } = require("./canonical-json");
const { stateDir, ensureDir } = require("./state-paths");

const SNAPSHOT_VERSION = "1";
const MAX_PATHS        = 5000;
const MAX_BYTES        = 256 * 1024 * 1024;        // 256 MiB per snapshot
const MAX_KEPT         = 50;
const MAX_AGE_MS       = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_TOTAL_BYTES  = 4 * 1024 * 1024 * 1024;   // 4 GiB total

function snapshotsDir(opts) {
  const o = opts || {};
  return o.baseDir ? String(o.baseDir) : path.join(stateDir(), "snapshots");
}
function _sha(buf)  { return crypto.createHash("sha256").update(buf).digest("hex"); }
function _isDir(p)  { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function _readManifest(snapDir) {
  try { return JSON.parse(fs.readFileSync(path.join(snapDir, "manifest.json"), "utf8")); }
  catch { return null; }
}

// planSnapshotScope(ir, opts) — minimal set of paths to capture.
// fileTargets[].path that exists as a regular file is captured directly;
// for `commandClass: destructive-delete` against an existing directory the
// whole subtree is enumerated (symlinks skipped). Truncates at MAX_PATHS.
function planSnapshotScope(ir, opts) {
  const o = opts || {};
  const reason = String(o.reason || (ir && ir.commandClass) || "destructive");
  const cmdClass = String((ir && ir.commandClass) || "");
  const seen = Object.create(null);
  const paths = [];
  let estBytes = 0;
  let truncated = false;

  function push(p, size) {
    if (paths.length >= MAX_PATHS) { truncated = true; return; }
    const np = path.resolve(p);
    if (!np || seen[np]) return;
    seen[np] = true; paths.push(np); estBytes += Number(size || 0);
  }
  function walk(dir) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const e of ents) {
      if (paths.length >= MAX_PATHS) { truncated = true; return; }
      const child = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { walk(child); continue; }
      if (!e.isFile()) continue;
      let st = null; try { st = fs.statSync(child); } catch { continue; }
      push(child, st.size);
    }
  }
  const targets = Array.isArray(ir && ir.fileTargets) ? ir.fileTargets : [];
  for (const t of targets) {
    if (!t || typeof t.path !== "string" || t.path.length === 0) continue;
    const abs = path.resolve(t.path);
    let st = null; try { st = fs.lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isFile()) { push(abs, st.size); continue; }
    if (st.isDirectory() && cmdClass === "destructive-delete") walk(abs);
    // Non-delete intents on a directory: nothing to snapshot here — only
    // explicit children listed in fileTargets[] are captured.
  }
  return { paths, reason, estBytes, truncated };
}

// createSnapshot(scope, destDir, opts) — write a snapshot bundle. Returns
// { snapshotId, manifest, bytes, status, reason, truncated }.
// status ∈ {"created","truncated","scope-too-large"}. scope-too-large is
// returned BEFORE any blob is written so the store stays consistent.
function createSnapshot(scope, destDirOpt, opts) {
  const o = opts || {};
  const baseDir = destDirOpt || snapshotsDir(o);
  ensureDir(baseDir);
  const planPaths = Array.isArray(scope && scope.paths) ? scope.paths : [];
  const reason    = String(scope && scope.reason || "destructive");
  const truncated = Boolean(scope && scope.truncated);

  let projected = 0;
  const staged = [];
  for (const p of planPaths) {
    let st = null; try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    projected += st.size;
    if (projected > MAX_BYTES) {
      return { snapshotId: null, manifest: null, bytes: 0,
        status: "scope-too-large", reason: "scope-too-large", truncated };
    }
    staged.push({ path: p, mode: st.mode & 0o777 });
  }
  staged.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

  let totalBytes = 0;
  const entries = [];
  const blobs   = [];
  for (const s of staged) {
    let data; try { data = fs.readFileSync(s.path); } catch { continue; }
    const sha = _sha(data);
    totalBytes += data.length;
    entries.push({ path: s.path, size: data.length, sha256: "sha256:" + sha, mode: s.mode });
    blobs.push({ sha, data });
  }
  const createdAt = String(o.createdAt || new Date().toISOString());
  const manifestNoId = {
    version: SNAPSHOT_VERSION, createdAt, reason,
    decisionKey: String(o.decisionKey || ""),
    irHash:      o.irHash ? String(o.irHash) : null,
    truncated, fileCount: entries.length, totalBytes, entries,
  };
  // snapshotId derives from canonical-JSON of the (createdAt-blank) manifest
  // so two identical states yield identical hashes modulo createdAt.
  const idCanon = canonicalJson({ ...manifestNoId, createdAt: "" });
  const snapshotId = createdAt.replace(/[:.]/g, "-") + "-" + _sha(Buffer.from(idCanon)).slice(0, 12);
  const manifest = { ...manifestNoId, snapshotId };
  manifest.manifestHash = "sha256:" + _sha(Buffer.from(canonicalJson(manifest)));

  const snapDir = path.join(baseDir, snapshotId);
  const dataDir = path.join(snapDir, "data");
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const written = Object.create(null);
    for (const b of blobs) {
      if (written[b.sha]) continue;
      const blobPath = path.join(dataDir, b.sha);
      const tmp = blobPath + ".tmp-" + process.pid;
      fs.writeFileSync(tmp, zlib.gzipSync(b.data), { mode: 0o600 });
      fs.renameSync(tmp, blobPath);
      written[b.sha] = true;
    }
    const mp = path.join(snapDir, "manifest.json");
    const tmpM = mp + ".tmp-" + process.pid;
    fs.writeFileSync(tmpM, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmpM, mp);
  } catch (err) {
    try { fs.rmSync(snapDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    throw err;
  }

  pruneSnapshots({ baseDir });
  return { snapshotId, manifest, bytes: totalBytes,
    status: truncated ? "truncated" : "created", reason, truncated };
}

function listSnapshots(opts) {
  const baseDir = snapshotsDir(opts);
  let kids = []; try { kids = fs.readdirSync(baseDir); } catch { return []; }
  const out = [];
  for (const k of kids) {
    const dir = path.join(baseDir, k);
    if (!_isDir(dir)) continue;
    const m = _readManifest(dir);
    if (!m) continue;
    out.push({
      snapshotId:  String(m.snapshotId || k),
      createdAt:   String(m.createdAt || ""),
      sizeBytes:   Number(m.totalBytes || 0),
      reason:      String(m.reason || ""),
      decisionKey: String(m.decisionKey || ""),
      truncated:   Boolean(m.truncated),
      fileCount:   Number(m.fileCount || 0),
    });
  }
  out.sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  return out;
}

// restoreSnapshot(id, opts) — atomic per-file rewrite. Refuses to overwrite
// a target whose current sha256 differs from the captured baseline unless
// opts.force === true. Returns { ok, restored[], skipped[], conflicts[] }.
function restoreSnapshot(snapshotId, opts) {
  const o = opts || {};
  const baseDir = snapshotsDir(o);
  const snapDir = path.join(baseDir, String(snapshotId));
  const manifest = _readManifest(snapDir);
  if (!manifest) return { ok: false, reason: "snapshot-not-found",
    restored: [], skipped: [], conflicts: [] };

  const force = Boolean(o.force), dryRun = Boolean(o.dryRun);
  const restored = [], skipped = [], conflicts = [];
  for (const e of (manifest.entries || [])) {
    const target = String(e.path);
    let current = null; try { current = fs.readFileSync(target); } catch { /* missing */ }
    if (current) {
      const actual = "sha256:" + _sha(current);
      if (actual !== e.sha256 && !force) {
        conflicts.push({ path: target, captured: e.sha256, current: actual });
        skipped.push(target); continue;
      }
    }
    const sha = String(e.sha256).replace(/^sha256:/, "");
    let gz = null; try { gz = fs.readFileSync(path.join(snapDir, "data", sha)); } catch {}
    if (!gz) { skipped.push(target); continue; }
    let data; try { data = zlib.gunzipSync(gz); } catch { skipped.push(target); continue; }
    if ("sha256:" + _sha(data) !== e.sha256) { skipped.push(target); continue; }
    if (dryRun) { restored.push(target); continue; }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = target + ".horus-restore-" + process.pid + "-" + Date.now();
      fs.writeFileSync(tmp, data, { mode: e.mode != null ? Number(e.mode) : 0o644 });
      fs.renameSync(tmp, target);
      restored.push(target);
    } catch { skipped.push(target); }
  }
  return { ok: conflicts.length === 0 || force, restored, skipped, conflicts, manifest };
}

// pruneSnapshots(opts) — LRU prune by age, then count, then total bytes.
function pruneSnapshots(opts) {
  const baseDir = snapshotsDir(opts);
  const items = listSnapshots({ baseDir });
  const now = Date.now();
  const deleted = [];
  const kept = [];
  for (const it of items) {
    let t = 0; try { t = new Date(it.createdAt).getTime(); } catch {}
    if (t && (now - t) > MAX_AGE_MS) {
      try { fs.rmSync(path.join(baseDir, it.snapshotId), { recursive: true, force: true }); deleted.push(it.snapshotId); } catch {}
    } else { kept.push(it); }
  }
  while (kept.length > MAX_KEPT) {
    const drop = kept.shift();
    try { fs.rmSync(path.join(baseDir, drop.snapshotId), { recursive: true, force: true }); deleted.push(drop.snapshotId); } catch {}
  }
  let total = 0; for (const it of kept) total += it.sizeBytes || 0;
  while (total > MAX_TOTAL_BYTES && kept.length > 0) {
    const drop = kept.shift();
    total -= drop.sizeBytes || 0;
    try { fs.rmSync(path.join(baseDir, drop.snapshotId), { recursive: true, force: true }); deleted.push(drop.snapshotId); } catch {}
  }
  return { kept: kept.map((it) => it.snapshotId), deleted };
}

// doctor(opts) — verify the snapshot store. Re-hashes blobs and flags
// missing/orphan blobs and unparseable manifests.
function doctor(opts) {
  const baseDir = snapshotsDir(opts);
  let kids = []; try { kids = fs.readdirSync(baseDir); } catch { return { ok: true, problems: [], snapshots: [] }; }
  const problems = [], snapshots = [];
  for (const k of kids) {
    const snapDir = path.join(baseDir, k);
    if (!_isDir(snapDir)) continue;
    const m = _readManifest(snapDir);
    if (!m) { problems.push({ snapshotId: k, reason: "manifest-unreadable" }); continue; }
    const expected = m.entries || [];
    let okCount = 0;
    const expectedShas = Object.create(null);
    for (const e of expected) {
      const sha = String(e.sha256 || "").replace(/^sha256:/, "");
      expectedShas[sha] = true;
      try {
        const gz = fs.readFileSync(path.join(snapDir, "data", sha));
        const data = zlib.gunzipSync(gz);
        if ("sha256:" + _sha(data) === e.sha256 && data.length === e.size) okCount++;
        else problems.push({ snapshotId: k, reason: "blob-mismatch", path: e.path });
      } catch { problems.push({ snapshotId: k, reason: "blob-missing", path: e.path }); }
    }
    let dataKids = []; try { dataKids = fs.readdirSync(path.join(snapDir, "data")); } catch {}
    let orphans = 0; for (const c of dataKids) if (!expectedShas[c]) { problems.push({ snapshotId: k, reason: "orphan-blob", blob: c }); orphans++; }
    snapshots.push({ snapshotId: k, fileCount: expected.length, ok: okCount === expected.length && orphans === 0 });
  }
  return { ok: problems.length === 0, problems, snapshots };
}

module.exports = {
  SNAPSHOT_VERSION, MAX_PATHS, MAX_BYTES, MAX_KEPT, MAX_AGE_MS, MAX_TOTAL_BYTES,
  snapshotsDir, planSnapshotScope, createSnapshot, listSnapshots,
  restoreSnapshot, pruneSnapshots, doctor,
};
