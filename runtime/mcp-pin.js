"use strict";
// mcp-pin.js — behavioral rug-pull / tool-drift detection.
//
// Records a hash of the arg SHAPE (sorted key-set + coarse value-type classes,
// never raw values) for each {server, tool} pair. On subsequent calls, flags
// if the shape has changed (arg-schema drift, a.k.a. rug-pull signal).
//
// All I/O is on <stateDir()>/mcp-pins/pins.json  where stateDir() resolves to
// $LILARA_STATE_DIR when set, else ~/.lilara (auto-created on first use).
// ADR-033: previously fell back to os.tmpdir() when LILARA_STATE_DIR was unset;
// that made pins invisible to state-bundle backup and disabled drift detection
// on systems with world-writable /tmp. Now unified with every other consumer.
//
// Fail behaviour (ADR-024):
//   - State-dir insecure (world-writable / foreign-owned): return
//     { drift: false, reason: "state-dir-insecure" } and perform NO I/O to
//     the poisoned location. A one-shot warning is emitted to stderr.
//   - Other I/O error: return { drift: false } (fail-open) so detection
//     failures never block the agent.

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
// ADR-033: use the shared stateDir() resolver (LILARA_STATE_DIR → ~/.lilara)
// instead of the previous process.env.LILARA_STATE_DIR || os.tmpdir() pattern.
const { stateDir: _stateDir } = require("./state-paths");
const { ensureStateDirSafe, ensureBaseDirSafe } = require("./state-dir");

// ADR-029: one-shot warning set — avoids log spam when _readPins() is called
// repeatedly (e.g. in tests) with the same corrupt file.
const _corruptWarnedPaths = new Set();

// Returns a coarse type label for a value — never reveals the raw value.
function _typeClass(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v; // "string" | "number" | "boolean" | "object"
}

// Compute a stable shape-hash for an argument object.
// The hash covers only the sorted key names + coarse value-type classes.
// null, undefined, and {} all normalize to "empty" to avoid false drift
// between MCP clients that represent no-args differently.
// exported for unit-test access — not part of the public API.
function argShapeHash(args) {
  if (!args || typeof args !== "object" || Object.keys(args).length === 0) return "empty";
  const pairs = Object.keys(args).sort().map(k => `${k}:${_typeClass(args[k])}`);
  return crypto.createHash("sha256").update(pairs.join(",")).digest("hex").slice(0, 16);
}

// Returns the path to the pin store file, creating the mcp-pins subdir as needed.
// Does NOT validate state-dir permissions — that is done by checkArgShapeDrift()
// (via ensureBaseDirSafe) before any I/O, so the subdir is only created under a
// validated root.  Resolves via _stateDir() (LILARA_STATE_DIR → ~/.lilara).
function _pinStorePath() {
  const dir = path.join(_stateDir(), "mcp-pins");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, "pins.json");
}

// ADR-029: emit a one-shot stderr warning when pins.json cannot be parsed,
// so the operator sees the problem without log spam across multiple invocations.
function _warnCorruptOnce(pinPath, err) {
  if (_corruptWarnedPaths.has(pinPath)) return;
  _corruptWarnedPaths.add(pinPath);
  process.stderr.write(
    `[lilara] WARNING: mcp-pins/pins.json is unreadable (${err && err.message || err}); ` +
    "drift detection suspended for this invocation. Remove or repair the file to resume.\n"
  );
}

// Read the pin store (keyed by "<server>/<tool>").
// ADR-029: ENOENT (no file yet = legit first-sight) and JSON parse-error (corruption)
// are now handled separately. A corrupt pin store no longer silently resets all drift
// history to first-sight — instead a sentinel { _corrupt: true } is returned so the
// caller can produce an explicit { drift: false, reason: "pin-store-corrupt" } rather
// than silently re-pinning to the (possibly rug-pulled) current arg shape.
function _readPins() {
  const p = _pinStorePath();
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") return {}; // legitimate: no pin file yet
    // Parse error or other I/O error — possible corruption. Do NOT silently reset.
    // Forensic copy (best-effort, original stays so detection remains visibly suspended
    // until the operator removes the file; this is intentional — the backup preserves
    // evidence while the original keeps signaling the problem on every call).
    try { fs.copyFileSync(p, `${p}.corrupt.${Date.now()}.bak`); } catch { /* best-effort */ }
    _warnCorruptOnce(p, err);
    return { _corrupt: true }; // sentinel — causes caller to suspend drift detection
  }
}

// Write the pin store atomically (ADR-024 Option 2).
// Mirrors the pattern established in runtime/policy-store.js:savePolicy —
// write to a .tmp file then rename to avoid partial-write corruption.
// On Windows, atomic rename can fail with EPERM when another process has the
// file open (AV, indexer); fall back to direct write in that case.
function _writePins(pins) {
  const pinPath = _pinStorePath();
  const data    = JSON.stringify(pins);
  const tmp     = pinPath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, data, { encoding: "utf8", mode: 0o600 });
  try {
    fs.renameSync(tmp, pinPath);
  } catch {
    // Atomic rename failed (e.g. EPERM on Windows when file is locked).
    // Fall back to direct write — slightly less atomic but functionally correct.
    try {
      fs.writeFileSync(pinPath, data, { encoding: "utf8", mode: 0o600 });
    } catch { /* best-effort fallback */ }
    try { fs.unlinkSync(tmp); } catch { /* tmp cleanup is best-effort */ }
  }
}

/**
 * checkArgShapeDrift({ server, tool, args }) → { drift: boolean, reason?: string }
 *
 * On first call: records the arg shape hash and returns { drift: false }.
 * On subsequent calls: if the hash differs, returns { drift: true, reason }.
 * On drift: updates pin to new hash; sets lastChangedAt and increments changeCount.
 *
 * Fail behaviour:
 *   - Insecure state-dir: { drift: false, reason: "state-dir-insecure" } + stderr warning.
 *     No reads or writes to the poisoned location.
 *   - Other I/O errors: { drift: false } (fail-open, same as before ADR-024).
 */
function checkArgShapeDrift({ server, tool, args }) {
  try {
    if (!server || !tool) return { drift: false };

    // ADR-024 / ADR-033: validate the state directory before any I/O.
    // ensureBaseDirSafe (write guard) is used instead of ensureStateDirSafe so
    // a first-run ~/.lilara that doesn't exist yet is auto-created at mode 0o700
    // and then validated — resolving the first-run ENOENT FP from ADR-033.
    // On unsafe (world-writable / foreign-owned) dirs, returns false; we emit
    // the explicit reason field to distinguish from silent fail-open.
    if (!ensureBaseDirSafe(_stateDir())) {
      return { drift: false, reason: "state-dir-insecure" };
    }

    const key    = `${server}/${tool}`;
    const hash   = argShapeHash(args);
    const pins   = _readPins();
    // ADR-029: sentinel from _readPins() means the pin file is corrupt (not merely absent).
    // Suspend drift detection explicitly rather than silently treating this as first-sight.
    if (pins && pins._corrupt) return { drift: false, reason: "pin-store-corrupt" };
    const stored = pins[key];
    if (!stored) {
      // First sight — record the hash.
      pins[key] = { hash, seenAt: new Date().toISOString(), changeCount: 0 };
      _writePins(pins);
      return { drift: false };
    }
    if (stored.hash !== hash) {
      // Shape changed — drift detected; re-pin so subsequent identical calls return drift:false.
      const changeCount = (stored.changeCount || 0) + 1;
      pins[key] = { hash, seenAt: stored.seenAt, lastChangedAt: new Date().toISOString(), changeCount };
      _writePins(pins);
      return { drift: true, reason: `arg-shape changed: ${stored.hash} → ${hash}`, changeCount };
    }
    return { drift: false };
  } catch {
    return { drift: false }; // fail-open for unexpected errors
  }
}

module.exports = { checkArgShapeDrift, argShapeHash };
