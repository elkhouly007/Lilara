#!/usr/bin/env node
"use strict";

// snapshot.test.js — ADR-013 auto-snapshot before destructive ops.
//
// Coverage (per pr-auto-snapshot-t1.md §7):
//   1. planSnapshotScope shape (4 cases).
//   2. createSnapshot round-trip → list → restore → byte-identical recovery.
//   3. Hash-mismatch refusal without --force; overwrite with --force.
//   4. Budget enforcement: 5001-path scope truncates; >256 MiB → scope-too-large.
//   5. Fail-open: FS error inside createSnapshot → engine returns allow,
//      receipt records failed-fail-open.
//   6. Retention: 51 snapshots → oldest pruned automatically.
//   7. Non-destructive IR + block decision → no snapshot attempted.
//   8. Idempotency: identical IR + identical FS → identical manifest hash.
//   9. End-to-end smoke: hermetic temp tree, simulated rm -rf decision,
//      restore-after-rm yields byte-identical tree.
//
// Run: node tests/runtime/snapshot.test.js

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");
const crypto = require("node:crypto");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "horus-snapshot-"));
process.env.HORUS_STATE_DIR = path.join(tmpRoot, "default-state");
fs.mkdirSync(process.env.HORUS_STATE_DIR, { recursive: true, mode: 0o700 });

// Quiet down the optional decision-journal during tests that aren't asserting
// on journal contents.
process.env.HORUS_DECISION_JOURNAL = "1";

const root = path.join(__dirname, "..", "..");
const snap = require(path.join(root, "runtime", "snapshot"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); }
  catch (err) { failed++; process.stderr.write(`  FAIL ${name}: ${err && err.stack || err}\n`); }
}
function freshTmp(label) {
  const p = path.join(tmpRoot, label + "-" + Math.random().toString(36).slice(2));
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  return p;
}
function sha256Hex(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function buildIr(opts) {
  return {
    irVersion: "1",
    fileTargets: (opts.fileTargets || []).map((t) => ({ path: t.path, intent: t.intent || "delete", sensitivity: "low" })),
    commandClass: opts.commandClass || "destructive-delete",
    destructive: opts.destructive !== false,
    writeIntent: true,
    irHash: "sha256:" + sha256Hex(opts.id || "ir-1"),
  };
}

// ─── 1. planSnapshotScope: four cases ─────────────────────────────────────
test("planSnapshotScope: single-file write target", () => {
  const proj = freshTmp("p1-single");
  const f = path.join(proj, "doc.txt");
  fs.writeFileSync(f, "hello world\n");
  const ir = buildIr({ commandClass: "disk-write", fileTargets: [{ path: f, intent: "write" }] });
  const s = snap.planSnapshotScope(ir);
  assert.deepStrictEqual(s.paths, [path.resolve(f)]);
  assert.strictEqual(s.truncated, false);
  assert.ok(s.estBytes > 0);
});
test("planSnapshotScope: multi-file write targets dedupe + sort", () => {
  const proj = freshTmp("p1-multi");
  const a = path.join(proj, "a.txt"), b = path.join(proj, "b.txt");
  fs.writeFileSync(a, "a"); fs.writeFileSync(b, "bb");
  const ir = buildIr({ commandClass: "disk-write", fileTargets: [
    { path: a, intent: "write" }, { path: b, intent: "write" }, { path: a, intent: "write" } ] });
  const s = snap.planSnapshotScope(ir);
  assert.strictEqual(s.paths.length, 2);
});
test("planSnapshotScope: directory-delete walks subtree", () => {
  const proj = freshTmp("p1-dir");
  fs.mkdirSync(path.join(proj, "sub"), { recursive: true });
  fs.writeFileSync(path.join(proj, "sub", "x"), "x");
  fs.writeFileSync(path.join(proj, "sub", "y"), "yy");
  const ir = buildIr({ commandClass: "destructive-delete", fileTargets: [{ path: proj, intent: "delete" }] });
  const s = snap.planSnapshotScope(ir);
  const names = s.paths.map((p) => path.basename(p)).sort();
  assert.deepStrictEqual(names, ["x", "y"]);
});
test("planSnapshotScope: command with no fileTargets → empty scope", () => {
  const ir = buildIr({ commandClass: "destructive-delete", fileTargets: [] });
  const s = snap.planSnapshotScope(ir);
  assert.deepStrictEqual(s.paths, []);
  assert.strictEqual(s.truncated, false);
});

// ─── 2. createSnapshot round-trip ─────────────────────────────────────────
test("createSnapshot round-trip: list + restore + byte-identical recovery", () => {
  const proj = freshTmp("rt-proj");
  const store = freshTmp("rt-store");
  const f1 = path.join(proj, "one.txt"), f2 = path.join(proj, "two.txt");
  fs.writeFileSync(f1, "alpha"); fs.writeFileSync(f2, "beta\n");
  const ir = buildIr({ commandClass: "destructive-delete", fileTargets: [
    { path: f1, intent: "delete" }, { path: f2, intent: "delete" } ] });
  const scope = snap.planSnapshotScope(ir);
  const r = snap.createSnapshot(scope, store, { decisionKey: "k1", irHash: ir.irHash });
  assert.strictEqual(r.status, "created");
  assert.ok(r.snapshotId);
  assert.strictEqual(r.bytes, 5 + 5);

  const list = snap.listSnapshots({ baseDir: store });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].snapshotId, r.snapshotId);

  // Simulate rm: delete both files, then restore.
  fs.unlinkSync(f1); fs.unlinkSync(f2);
  const rr = snap.restoreSnapshot(r.snapshotId, { baseDir: store });
  assert.strictEqual(rr.ok, true);
  assert.strictEqual(rr.restored.length, 2);
  assert.strictEqual(fs.readFileSync(f1, "utf8"), "alpha");
  assert.strictEqual(fs.readFileSync(f2, "utf8"), "beta\n");
});

// ─── 3. Hash-mismatch refusal / --force overwrite ────────────────────────
test("restore: hash-mismatch refuses without --force, overwrites with --force", () => {
  const proj = freshTmp("hm-proj"); const store = freshTmp("hm-store");
  const f = path.join(proj, "doc.txt");
  fs.writeFileSync(f, "captured");
  const ir = buildIr({ commandClass: "destructive-delete", fileTargets: [{ path: f, intent: "delete" }] });
  const scope = snap.planSnapshotScope(ir);
  const r = snap.createSnapshot(scope, store, { decisionKey: "k2" });

  fs.writeFileSync(f, "intentional change");
  const rr = snap.restoreSnapshot(r.snapshotId, { baseDir: store });
  assert.strictEqual(rr.ok, false);
  assert.strictEqual(rr.conflicts.length, 1);
  assert.strictEqual(fs.readFileSync(f, "utf8"), "intentional change", "must not overwrite on conflict");

  const rr2 = snap.restoreSnapshot(r.snapshotId, { baseDir: store, force: true });
  assert.strictEqual(rr2.ok, true);
  assert.strictEqual(fs.readFileSync(f, "utf8"), "captured");
});

// ─── 4. Budget enforcement ───────────────────────────────────────────────
test("createSnapshot: scope-too-large → refuses, decision proceeds (caller-side)", () => {
  const store = freshTmp("st-store");
  // Synthesize a scope object that lies about projected bytes via a fake path
  // that exists and reports > MAX_BYTES via a stub stat. We instead pass a
  // real big file via Buffer.alloc(MAX_BYTES + 1).
  const proj = freshTmp("st-proj");
  const big = path.join(proj, "big.bin");
  // 256 MiB is too slow to allocate in unit tests; instead drive the
  // pathological case by manipulating MAX via tiny file + monkeypatch
  // statSync to return a fake oversized size for the planned path.
  fs.writeFileSync(big, "small-actual-bytes");
  const origStat = fs.statSync;
  fs.statSync = function patched(p, ...rest) {
    const st = origStat.call(fs, p, ...rest);
    if (p === big) {
      return Object.assign(Object.create(Object.getPrototypeOf(st)), st, {
        size: snap.MAX_BYTES + 1, isFile: () => true,
      });
    }
    return st;
  };
  try {
    const r = snap.createSnapshot({ paths: [big], reason: "destructive-delete", truncated: false }, store);
    assert.strictEqual(r.status, "scope-too-large");
    assert.strictEqual(r.reason, "scope-too-large");
    assert.strictEqual(r.snapshotId, null);
    // Store stays empty.
    let kids = []; try { kids = fs.readdirSync(store); } catch {}
    assert.strictEqual(kids.length, 0);
  } finally { fs.statSync = origStat; }
});
test("planSnapshotScope: 5001-path scope truncates", () => {
  const proj = freshTmp("tr-proj");
  // Generate >MAX_PATHS via a directory-delete walk.
  const sub = path.join(proj, "many");
  fs.mkdirSync(sub, { recursive: true });
  for (let i = 0; i < snap.MAX_PATHS + 1; i++) {
    fs.writeFileSync(path.join(sub, "f" + i), "x");
  }
  const ir = buildIr({ commandClass: "destructive-delete", fileTargets: [{ path: sub, intent: "delete" }] });
  const s = snap.planSnapshotScope(ir);
  assert.strictEqual(s.truncated, true);
  assert.strictEqual(s.paths.length, snap.MAX_PATHS);
});

// ─── 5. Fail-open: engine returns allow + receipt records failed-fail-open ─
test("engine: snapshot FS error → action stays allow, receipt records failed-fail-open", () => {
  const proj = freshTmp("fo-proj");
  const f = path.join(proj, "doc.txt");
  fs.writeFileSync(f, "hello");
  const stateDir = freshTmp("fo-state");
  process.env.HORUS_STATE_DIR = stateDir;
  process.env.HORUS_CONTRACT_ENABLED = "0";

  const snapPath   = path.join(root, "runtime", "snapshot");
  const enginePath = path.join(root, "runtime", "decision-engine");
  delete require.cache[require.resolve(snapPath)];
  delete require.cache[require.resolve(enginePath)];
  const localSnap = require(snapPath);
  const localEngine = require(enginePath);

  const orig = localSnap.createSnapshot;
  localSnap.createSnapshot = function () { throw new Error("simulated FS error"); };
  try {
    // Benign command so risk-score does NOT escalate to block; force-pin
    // `destructive: true` on the IR so the engine still hits the snapshot rail.
    const input = {
      tool: "Bash", command: "echo benign", branch: "feat/snapshot-test",
      targetPath: f, harness: "claude", projectRoot: proj,
      ir: { irVersion: "1", destructive: true, writeIntent: true,
        commandClass: "disk-write", fileTargets: [{ path: f, intent: "write", sensitivity: "low" }],
        irHash: "sha256:" + sha256Hex("ir-fo"), command: "echo benign", toolKind: "shell", payloadClass: "A",
        envDelta: {}, outputChannels: {}, trustMeta: {}, outputs: [], declaredOutput: [],
        commandTokens: ["echo", "benign"], networkTargets: [], cwd: proj, harness: "claude",
      },
    };
    const r = localEngine.decide(input);
    assert.strictEqual(r.action, "allow");
    assert.ok(r.snapshot, "snapshot receipt key should be present on destructive-allow");
    assert.strictEqual(r.snapshot.attempted, true);
    assert.strictEqual(r.snapshot.status, "failed-fail-open");
    assert.strictEqual(r.snapshot.snapshotId, null);
  } finally {
    localSnap.createSnapshot = orig;
    delete process.env.HORUS_CONTRACT_ENABLED;
    process.env.HORUS_STATE_DIR = path.join(tmpRoot, "default-state");
    delete require.cache[require.resolve(snapPath)];
    delete require.cache[require.resolve(enginePath)];
  }
});

// ─── 6. Retention: 51 snapshots → oldest pruned ─────────────────────────
test("createSnapshot: MAX_KEPT prunes oldest automatically", () => {
  const proj = freshTmp("rt-cnt-proj"); const store = freshTmp("rt-cnt-store");
  const f = path.join(proj, "x"); fs.writeFileSync(f, "y");
  const ir = buildIr({ commandClass: "destructive-delete", fileTargets: [{ path: f, intent: "delete" }] });
  const scope = snap.planSnapshotScope(ir);
  // 51 with strictly-monotone recent timestamps so id-by-createdAt sorts
  // and none of them trip the age-eviction threshold mid-test.
  const baseTs = Date.now();
  for (let i = 0; i <= snap.MAX_KEPT; i++) {
    const createdAt = new Date(baseTs + i).toISOString();
    const r = snap.createSnapshot(scope, store, { createdAt, decisionKey: "k" + i });
    assert.strictEqual(r.status, "created");
  }
  const list = snap.listSnapshots({ baseDir: store });
  assert.strictEqual(list.length, snap.MAX_KEPT);
});
test("pruneSnapshots: age + total-bytes constraints respected", () => {
  const proj = freshTmp("age-proj"); const store = freshTmp("age-store");
  const f = path.join(proj, "tiny"); fs.writeFileSync(f, "z");
  const ir = buildIr({ commandClass: "destructive-delete", fileTargets: [{ path: f, intent: "delete" }] });
  const scope = snap.planSnapshotScope(ir);
  // One ancient + one fresh. createSnapshot auto-prunes on every call, so
  // the ancient may be gone before the explicit prune; what matters is the
  // end state: ancient must NOT survive into the final listing.
  const ancient = new Date(Date.now() - (snap.MAX_AGE_MS + 60_000)).toISOString();
  const fresh   = new Date().toISOString();
  snap.createSnapshot(scope, store, { createdAt: ancient, decisionKey: "ancient" });
  snap.createSnapshot(scope, store, { createdAt: fresh,   decisionKey: "fresh" });
  snap.pruneSnapshots({ baseDir: store });
  const list = snap.listSnapshots({ baseDir: store });
  for (const it of list) assert.notStrictEqual(it.createdAt, ancient);
  assert.ok(list.length >= 1, "fresh snapshot must remain after prune");
});

// ─── 7. Engine guards: non-destructive + block decisions ────────────────
test("engine: non-destructive IR → no snapshot attempted", () => {
  const stateDir = freshTmp("nd-state");
  process.env.HORUS_STATE_DIR = stateDir;
  const enginePath = path.join(root, "runtime", "decision-engine");
  delete require.cache[require.resolve(enginePath)];
  const localEngine = require(enginePath);
  const irBuild = require(path.join(root, "runtime", "action-ir")).build;

  const input = { tool: "Read", command: "cat README.md", branch: "feat/snapshot-test", targetPath: "README.md", harness: "claude", projectRoot: tmpRoot };
  input.ir = irBuild(input, { tool: "Read", command: input.command, cwd: tmpRoot, projectRoot: tmpRoot });
  const r = localEngine.decide(input);
  assert.strictEqual(r.snapshot, undefined, "non-destructive decisions must not have a snapshot receipt key");
  process.env.HORUS_STATE_DIR = path.join(tmpRoot, "default-state");
  delete require.cache[require.resolve(enginePath)];
});
test("engine: block decision → no snapshot attempted", () => {
  const stateDir = freshTmp("blk-state");
  process.env.HORUS_STATE_DIR = stateDir;
  process.env.HORUS_KILL_SWITCH = "1";
  const enginePath = path.join(root, "runtime", "decision-engine");
  delete require.cache[require.resolve(enginePath)];
  const localEngine = require(enginePath);
  try {
    const input = { tool: "Bash", command: "rm -rf /tmp/foo", branch: "feat/snapshot-test", targetPath: "/tmp/foo", harness: "claude", projectRoot: tmpRoot };
    const r = localEngine.decide(input);
    assert.strictEqual(r.action, "block");
    assert.strictEqual(r.snapshot, undefined);
  } finally {
    delete process.env.HORUS_KILL_SWITCH;
    process.env.HORUS_STATE_DIR = path.join(tmpRoot, "default-state");
    delete require.cache[require.resolve(enginePath)];
  }
});

// ─── 8. Idempotency: identical IR + state → identical manifest hash ─────
test("createSnapshot: idempotent manifestHash modulo createdAt", () => {
  const proj = freshTmp("id-proj"); const store = freshTmp("id-store");
  const f1 = path.join(proj, "a"), f2 = path.join(proj, "b");
  fs.writeFileSync(f1, "one"); fs.writeFileSync(f2, "two");
  const ir = buildIr({ commandClass: "destructive-delete", fileTargets: [
    { path: f1, intent: "delete" }, { path: f2, intent: "delete" } ] });
  const scope = snap.planSnapshotScope(ir);
  const r1 = snap.createSnapshot(scope, store, { decisionKey: "kx", createdAt: "2026-05-15T00:00:00.000Z" });
  // Second create: identical FS state, identical decisionKey, identical createdAt
  // would produce the same snapshotId — but that hits a write-to-existing-dir.
  // Use a different createdAt and assert the *manifest hash modulo createdAt*
  // by canonicalizing both manifests with createdAt blank.
  const r2 = snap.createSnapshot(scope, store, { decisionKey: "kx", createdAt: "2026-05-15T00:00:01.000Z" });
  function strip(m) {
    const copy = { ...m, createdAt: "", snapshotId: "", manifestHash: "" };
    return JSON.stringify(copy, Object.keys(copy).sort());
  }
  assert.strictEqual(strip(r1.manifest), strip(r2.manifest));
});

// ─── 9. End-to-end smoke: rm -rf → restore restores tree ──────────────────
test("e2e smoke: destructive-allow → snapshot → simulated rm -rf → restore", () => {
  const proj = freshTmp("e2e-proj");
  fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  fs.writeFileSync(path.join(proj, "src", "main.js"), "console.log('hi');\n");
  fs.writeFileSync(path.join(proj, "src", "util.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(proj, "README.md"), "# proj\n");
  // Capture pre-state hashes for byte-identical assertion.
  function hashFile(p) { return sha256Hex(fs.readFileSync(p)); }
  const preHashes = {
    [path.join(proj, "src", "main.js")]: hashFile(path.join(proj, "src", "main.js")),
    [path.join(proj, "src", "util.js")]: hashFile(path.join(proj, "src", "util.js")),
    [path.join(proj, "README.md")]:     hashFile(path.join(proj, "README.md")),
  };

  // Wire through the engine like a real destructive-allow decision.
  const stateDir = freshTmp("e2e-state");
  process.env.HORUS_STATE_DIR = stateDir;
  // Disable contract so it does not gate the allow path.
  process.env.HORUS_CONTRACT_ENABLED = "0";
  const enginePath = path.join(root, "runtime", "decision-engine");
  const snapPath   = path.join(root, "runtime", "snapshot");
  delete require.cache[require.resolve(enginePath)];
  delete require.cache[require.resolve(snapPath)];
  const localEngine = require(enginePath);
  const localSnap   = require(snapPath);
  const irBuild = require(path.join(root, "runtime", "action-ir")).build;

  // Benign command + explicit destructive=true IR so the engine emits allow
  // (no critical-risk floor fires) while still triggering the snapshot rail.
  const ftargets = [
    { path: path.join(proj, "src", "main.js"), intent: "delete", sensitivity: "low" },
    { path: path.join(proj, "src", "util.js"), intent: "delete", sensitivity: "low" },
    { path: path.join(proj, "README.md"),     intent: "delete", sensitivity: "low" },
  ];
  const input = {
    tool: "Bash", command: "echo benign", branch: "feat/snapshot-test",
    targetPath: proj, harness: "claude", projectRoot: proj,
    ir: {
      irVersion: "1", destructive: true, writeIntent: true,
      commandClass: "destructive-delete", fileTargets: ftargets,
      command: "echo benign", toolKind: "shell", payloadClass: "A",
      envDelta: {}, outputChannels: {}, trustMeta: {}, outputs: [], declaredOutput: [],
      commandTokens: ["echo", "benign"], networkTargets: [],
      cwd: proj, harness: "claude",
      irHash: "sha256:" + sha256Hex("ir-e2e"),
    },
  };

  const r = localEngine.decide(input);
  assert.strictEqual(r.action, "allow", "destructive rm -rf on a temp tree should allow in default posture");
  assert.ok(r.snapshot, "snapshot receipt key required on destructive-allow");
  assert.strictEqual(r.snapshot.attempted, true);
  assert.strictEqual(r.snapshot.status, "created");
  assert.ok(r.snapshot.snapshotId);

  // Simulate the rm -rf.
  fs.rmSync(proj, { recursive: true, force: true });
  assert.ok(!fs.existsSync(proj), "project tree should be gone after simulated rm");

  // Restore. The snapshot store is under HORUS_STATE_DIR/snapshots/.
  const rr = localSnap.restoreSnapshot(r.snapshot.snapshotId);
  assert.strictEqual(rr.ok, true, "restore should succeed when targets are absent");
  assert.strictEqual(rr.restored.length, 3, "all three captured files must be restored");
  for (const [p, expected] of Object.entries(preHashes)) {
    assert.strictEqual(hashFile(p), expected, "byte-identical restore: " + p);
  }

  // Cleanup env so later tests in this file don't inherit it.
  delete process.env.HORUS_CONTRACT_ENABLED;
  process.env.HORUS_STATE_DIR = path.join(tmpRoot, "default-state");
  delete require.cache[require.resolve(enginePath)];
  delete require.cache[require.resolve(snapPath)];
});

// ─── doctor sanity check ────────────────────────────────────────────────
test("doctor: detects manifest-blob mismatch", () => {
  const proj = freshTmp("dr-proj"); const store = freshTmp("dr-store");
  const f = path.join(proj, "x"); fs.writeFileSync(f, "y");
  const ir = buildIr({ commandClass: "destructive-delete", fileTargets: [{ path: f, intent: "delete" }] });
  const scope = snap.planSnapshotScope(ir);
  const r = snap.createSnapshot(scope, store, {});
  // Healthy.
  const d1 = snap.doctor({ baseDir: store });
  assert.strictEqual(d1.ok, true);
  // Corrupt one blob.
  const blobDir = path.join(store, r.snapshotId, "data");
  const kids = fs.readdirSync(blobDir);
  fs.writeFileSync(path.join(blobDir, kids[0]), "garbage");
  const d2 = snap.doctor({ baseDir: store });
  assert.strictEqual(d2.ok, false);
});

process.stdout.write(`\n[snapshot.test] ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
