#!/usr/bin/env node
"use strict";

// state-bundle.test.js — ADR-011.
//
// Coverage:
//   1. round-trip a fully-populated hermetic state dir → byte-identical
//      journal chain tip, byte-identical canonical-JSON of receipts subset,
//      no blacklisted files in the bundle;
//   2. corrupted-manifest rejection;
//   3. tampered-journal rejection (mutate one chained entry, verify import
//      refuses);
//   4. same-machine restore succeeds; cross-machine restore (hostFingerprint
//      changed) is refused without --accept-cross-host and succeeds with it;
//   5. secret-file exclusion: a `.key` file in the source is absent from
//      the bundle;
//   6. bundle hash byte-stability across two consecutive exports of the
//      same state (modulo `createdAt`).
//
// Run: node tests/runtime/state-bundle.test.js

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");
const crypto = require("node:crypto");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "horus-state-bundle-"));

// Default HORUS_STATE_DIR so any helper that calls stateDir() without an
// explicit dir uses an isolated location. We override per-test with opts.
process.env.HORUS_STATE_DIR = path.join(tmpRoot, "default-state");
fs.mkdirSync(process.env.HORUS_STATE_DIR, { recursive: true, mode: 0o700 });

const sb = require(path.join(__dirname, "..", "..", "runtime", "state-bundle"));
const journal = require(path.join(__dirname, "..", "..", "runtime", "journal-chain"));
const { canonicalJson } = require(path.join(__dirname, "..", "..", "runtime", "canonical-json"));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  ok  ${name}\n`); }
  catch (err) { failed += 1; process.stderr.write(`  FAIL ${name}: ${err && err.stack || err}\n`); }
}

// Fully-populated hermetic state dir: hash chain (with checkpoint + install
// key), learned-policy, receipts, project-policy registrations, a lattice
// fixture pin, plus blacklisted files (install.key, a .pem, a secrets/ entry,
// and operator-tokens.jsonl) that must NOT cross the bundle boundary.
function seedStateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Hash chain — append 3 entries. This also generates install.key.
  const chainFile = path.join(dir, "journal-chain.jsonl");
  process.env.HORUS_STATE_DIR = dir;
  journal.append("decision.allow", { i: 0, note: "seed-0" }, { file: chainFile });
  journal.append("decision.allow", { i: 1, note: "seed-1" }, { file: chainFile });
  journal.append("decision.allow", { i: 2, note: "seed-2" }, { file: chainFile });
  // Operator-owned state.
  fs.writeFileSync(path.join(dir, "learned-policy.json"),
    JSON.stringify({ learnedAllows: { "bash|rm|x|A": true }, approvalCounts: {} }, null, 2));
  fs.writeFileSync(path.join(dir, "session-context.json"),
    JSON.stringify({ recent: [], updatedAt: null }, null, 2));
  fs.writeFileSync(path.join(dir, "accepted-contracts.json"),
    JSON.stringify([{ contractId: "c1", contractHash: "h" }], null, 2));
  fs.mkdirSync(path.join(dir, "receipts"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "receipts", "r1.json"),
    JSON.stringify({ kind: "decision", action: "allow", risk: 1 }, null, 2));
  fs.mkdirSync(path.join(dir, "lattice-fixtures"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "lattice-fixtures", "pin-1.json"),
    JSON.stringify({ rung: 1, latticeVersion: "1" }, null, 2));
  fs.writeFileSync(path.join(dir, "registered-projects.json"),
    JSON.stringify([{ projectRoot: "/p1" }], null, 2));
  // Blacklisted: install.key already exists from chain append. Add more.
  fs.writeFileSync(path.join(dir, "server.pem"), "-----BEGIN PRIVATE KEY-----\nx\n");
  fs.writeFileSync(path.join(dir, "extra.priv"), "private-stuff");
  fs.writeFileSync(path.join(dir, "operator-tokens.jsonl"),
    JSON.stringify({ token: "t1", createdAt: "now" }) + "\n");
  fs.mkdirSync(path.join(dir, "secrets"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "secrets", "ops.json"), JSON.stringify({ token: "boom" }));
}

function freshTmp(label) {
  const p = path.join(tmpRoot, label + "-" + Math.random().toString(36).slice(2));
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  return p;
}

// 1. ── round-trip ──────────────────────────────────────────────────────────
test("round-trip: identical chain tip + receipt bytes after restore", () => {
  const src = freshTmp("src");
  seedStateDir(src);
  const srcChainTipPre = sb.readChainTip(src);
  assert.match(srcChainTipPre, /^sha256:[0-9a-f]{64}$/, "chain tip should be present");

  const bundlePath = path.join(tmpRoot, "rt-" + Math.random().toString(36).slice(2) + ".tar");
  const manifest = sb.exportBundle({ stateDir: src, outPath: bundlePath });

  // No blacklisted entries in manifest.
  for (const e of manifest.entries) {
    assert.ok(!sb.isBlacklisted(e.path), "bundle must not include " + e.path);
  }
  // Read the tar back: confirm no blacklisted data files either.
  const buf = fs.readFileSync(bundlePath);
  const tarFiles = sb.readTar(buf);
  for (const f of tarFiles) {
    if (f.path === sb.MANIFEST_NAME) continue;
    const rel = f.path.replace(/^data\//, "");
    assert.ok(!sb.isBlacklisted(rel), "tar must not contain " + rel);
  }
  // Specifically: install.key, server.pem, operator-tokens.jsonl, secrets/ must be absent.
  for (const banned of ["install.key", "server.pem", "extra.priv", "operator-tokens.jsonl", "secrets/ops.json"]) {
    assert.ok(!tarFiles.some((f) => f.path === "data/" + banned),
      "blacklisted file leaked into bundle: " + banned);
  }

  // Restore into a fresh, empty dir.
  const dst = freshTmp("dst-empty"); fs.rmSync(dst, { recursive: true, force: true });
  const restored = sb.importBundle(bundlePath, { stateDir: dst, apply: true });
  assert.strictEqual(restored.ok, true, "restore should succeed: " + JSON.stringify(restored.problems || []));

  // Chain tip after import equals chain tip before export.
  const dstChainTip = sb.readChainTip(dst);
  assert.strictEqual(dstChainTip, srcChainTipPre, "chain tip must round-trip byte-identical");

  // Receipt bytes (learned-policy + receipts/r1.json) round-trip byte-identical
  // under canonical-JSON normalization.
  const learnedSrc = JSON.parse(fs.readFileSync(path.join(src, "learned-policy.json"), "utf8"));
  const learnedDst = JSON.parse(fs.readFileSync(path.join(dst, "learned-policy.json"), "utf8"));
  assert.strictEqual(canonicalJson(learnedDst), canonicalJson(learnedSrc),
    "learned-policy canonical JSON must round-trip exactly");
  const r1Src = JSON.parse(fs.readFileSync(path.join(src, "receipts", "r1.json"), "utf8"));
  const r1Dst = JSON.parse(fs.readFileSync(path.join(dst, "receipts", "r1.json"), "utf8"));
  assert.strictEqual(canonicalJson(r1Dst), canonicalJson(r1Src),
    "receipt canonical JSON must round-trip exactly");
});

// 2. ── corrupted-manifest rejection ────────────────────────────────────────
test("corrupted manifest: import refuses with bundle-hash-mismatch", () => {
  const src = freshTmp("src2"); seedStateDir(src);
  const bundlePath = path.join(tmpRoot, "corrupt-" + Math.random().toString(36).slice(2) + ".tar");
  sb.exportBundle({ stateDir: src, outPath: bundlePath });
  // Re-read, mutate the manifest's fileCount, re-write tar (recompute checksums).
  const { manifest, dataFiles } = sb.readBundle(bundlePath);
  manifest.fileCount = manifest.fileCount + 999;     // tamper without updating bundleHash
  const files = [{ path: sb.MANIFEST_NAME, data: Buffer.from(JSON.stringify(manifest), "utf8") }];
  for (const f of dataFiles) files.push({ path: "data/" + f.path, data: f.data });
  fs.writeFileSync(bundlePath, sb.writeTar(files));
  const dst = freshTmp("dst-corrupt"); fs.rmSync(dst, { recursive: true, force: true });
  const r = sb.importBundle(bundlePath, { stateDir: dst, apply: true });
  assert.strictEqual(r.ok, false, "corrupted manifest must be rejected");
  assert.ok(r.problems.some((p) => p === "bundle-hash-mismatch"),
    "expected bundle-hash-mismatch, got " + JSON.stringify(r.problems));
});

// 3. ── tampered-journal rejection ──────────────────────────────────────────
test("tampered journal: import refuses on chain-entryhash-mismatch", () => {
  const src = freshTmp("src3"); seedStateDir(src);
  const bundlePath = path.join(tmpRoot, "tj-" + Math.random().toString(36).slice(2) + ".tar");
  sb.exportBundle({ stateDir: src, outPath: bundlePath });
  // Mutate the journal-chain.jsonl payload of seq=2 inside the bundle. Recompute
  // its sha256 so manifest binding survives → only the chain-internal hash
  // breaks. Recompute bundleHash so we hit the journal check, not the manifest
  // check.
  const { manifest, dataFiles } = sb.readBundle(bundlePath);
  const idx = dataFiles.findIndex((f) => f.path === "journal-chain.jsonl");
  assert.ok(idx >= 0, "expected journal-chain.jsonl in bundle");
  const lines = dataFiles[idx].data.toString("utf8").split("\n").filter(Boolean);
  const target = JSON.parse(lines[2]);
  target.payload.note = "TAMPERED";       // leave entryHash + prevHash as-is
  lines[2] = JSON.stringify(target);
  const tampered = Buffer.from(lines.join("\n") + "\n", "utf8");
  dataFiles[idx].data = tampered;
  const mEntry = manifest.entries.find((e) => e.path === "journal-chain.jsonl");
  mEntry.size = tampered.length;
  mEntry.sha256 = "sha256:" + crypto.createHash("sha256").update(tampered).digest("hex");
  manifest.totalBytes = manifest.entries.reduce((s, e) => s + e.size, 0);
  // Re-bind bundleHash so it doesn't trip first.
  delete manifest.bundleHash;
  manifest.bundleHash = sb.computeBundleHash(manifest);
  const files = [{ path: sb.MANIFEST_NAME, data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8") }];
  for (const f of dataFiles) files.push({ path: "data/" + f.path, data: f.data });
  fs.writeFileSync(bundlePath, sb.writeTar(files));

  const dst = freshTmp("dst-tampered"); fs.rmSync(dst, { recursive: true, force: true });
  const r = sb.importBundle(bundlePath, { stateDir: dst, apply: true });
  assert.strictEqual(r.ok, false, "tampered chain must be rejected");
  assert.ok(r.problems.some((p) => /journal-chain: chain-entryhash-mismatch/.test(p)),
    "expected chain-entryhash-mismatch problem, got " + JSON.stringify(r.problems));
  // Target dir must be untouched (atomic-import guarantee).
  assert.ok(!fs.existsSync(dst) || fs.readdirSync(dst).length === 0,
    "target must be untouched on rejected import");
});

// 4. ── same-machine vs cross-machine ───────────────────────────────────────
test("cross-machine: refused without --accept-cross-host, succeeds with it", () => {
  const src = freshTmp("src4"); seedStateDir(src);
  const bundlePath = path.join(tmpRoot, "xh-" + Math.random().toString(36).slice(2) + ".tar");
  sb.exportBundle({ stateDir: src, outPath: bundlePath, hostname: "alpha-host", platform: "linux", arch: "x64" });
  // Same machine → succeeds.
  const dst1 = freshTmp("dst-same"); fs.rmSync(dst1, { recursive: true, force: true });
  const same = sb.importBundle(bundlePath, { stateDir: dst1, apply: true, hostname: "alpha-host", platform: "linux", arch: "x64" });
  assert.strictEqual(same.ok, true, "same-machine restore must succeed: " + JSON.stringify(same.problems || []));
  assert.strictEqual(same.crossHost, false);

  // Different machine → refused.
  const dst2 = freshTmp("dst-cross"); fs.rmSync(dst2, { recursive: true, force: true });
  const refused = sb.importBundle(bundlePath, { stateDir: dst2, apply: true, hostname: "beta-host", platform: "linux", arch: "x64" });
  assert.strictEqual(refused.ok, false, "cross-host without flag must be refused");
  assert.strictEqual(refused.crossHost, true);
  assert.ok(refused.problems.some((p) => /cross-host-restore/.test(p)),
    "expected cross-host-restore problem, got " + JSON.stringify(refused.problems));

  // Different machine + acceptCrossHost → succeeds with crossHost: true.
  const dst3 = freshTmp("dst-cross-ok"); fs.rmSync(dst3, { recursive: true, force: true });
  const accepted = sb.importBundle(bundlePath, { stateDir: dst3, apply: true, acceptCrossHost: true, hostname: "beta-host", platform: "linux", arch: "x64" });
  assert.strictEqual(accepted.ok, true, "cross-host with flag must succeed: " + JSON.stringify(accepted.problems || []));
  assert.strictEqual(accepted.crossHost, true);
});

// 5. ── secret-file exclusion ───────────────────────────────────────────────
test("secret-file exclusion: a .key file is absent from the bundle", () => {
  const src = freshTmp("src5"); seedStateDir(src);
  // Add an extra .key file specifically for this assertion.
  fs.writeFileSync(path.join(src, "explicit.key"), "S3CRET-KEY-MATERIAL");
  const bundlePath = path.join(tmpRoot, "sx-" + Math.random().toString(36).slice(2) + ".tar");
  const manifest = sb.exportBundle({ stateDir: src, outPath: bundlePath });
  // Not in manifest entries.
  for (const e of manifest.entries) assert.notStrictEqual(e.path, "explicit.key", ".key file must not appear in manifest entries");
  // Not in the tar payload either.
  const tarFiles = sb.readTar(fs.readFileSync(bundlePath));
  for (const f of tarFiles) {
    assert.notStrictEqual(f.path, "data/explicit.key", ".key file must not appear in tar");
    assert.notStrictEqual(f.path, "data/install.key", "install.key must not appear in tar");
  }
  // Excluded list records it.
  assert.ok(manifest.excluded.some((x) => x.path === "explicit.key" && x.reason === "secret-blacklist"),
    "excluded list must record the rejection: " + JSON.stringify(manifest.excluded));
});

// 6. ── bundle hash byte-stability ──────────────────────────────────────────
test("bundleHash: byte-stable across two consecutive exports of same state", () => {
  const src = freshTmp("src6"); seedStateDir(src);
  const out1 = path.join(tmpRoot, "stab1-" + Math.random().toString(36).slice(2) + ".tar");
  const out2 = path.join(tmpRoot, "stab2-" + Math.random().toString(36).slice(2) + ".tar");
  // Distinct createdAt — every other field must be identical.
  const m1 = sb.exportBundle({ stateDir: src, outPath: out1, hostname: "h", platform: "p", arch: "a", createdAt: "2026-05-14T00:00:00.000Z" });
  const m2 = sb.exportBundle({ stateDir: src, outPath: out2, hostname: "h", platform: "p", arch: "a", createdAt: "2026-05-14T01:00:00.000Z" });
  assert.notStrictEqual(m1.createdAt, m2.createdAt, "createdAt MUST differ to make the assertion meaningful");
  assert.strictEqual(m1.bundleHash, m2.bundleHash, "bundleHash must be identical when only createdAt differs");
  // And recomputing from the same manifest minus createdAt + bundleHash agrees.
  assert.strictEqual(sb.computeBundleHash(m1), m1.bundleHash);
  assert.strictEqual(sb.computeBundleHash(m2), m2.bundleHash);
});

// 7. ── dry-run is the default; --apply required to write ──────────────────
test("dry-run default: no files written, --apply required to restore", () => {
  const src = freshTmp("src7"); seedStateDir(src);
  const bundlePath = path.join(tmpRoot, "dr-" + Math.random().toString(36).slice(2) + ".tar");
  sb.exportBundle({ stateDir: src, outPath: bundlePath });
  const dst = freshTmp("dst-dryrun"); fs.rmSync(dst, { recursive: true, force: true });
  const dry = sb.importBundle(bundlePath, { stateDir: dst });
  assert.strictEqual(dry.ok, true);
  assert.strictEqual(dry.dryRun, true);
  assert.ok(!fs.existsSync(dst) || fs.readdirSync(dst).length === 0,
    "dry-run must not write to the target dir");
});

// ── summary ────────────────────────────────────────────────────────────────
process.stdout.write(`\nstate-bundle.test: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
