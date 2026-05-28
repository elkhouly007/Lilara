"use strict";
// mcp-pin.js — behavioral rug-pull / tool-drift detection.
//
// Records a hash of the arg SHAPE (sorted key-set + coarse value-type classes,
// never raw values) for each {server, tool} pair. On subsequent calls, flags
// if the shape has changed (arg-schema drift, a.k.a. rug-pull signal).
//
// All I/O is on LILARA_STATE_DIR/mcp-pins/pins.json. Fail-open: any I/O
// error returns { drift: false } so detection failures never block the agent.

const fs     = require("fs");
const os     = require("os");
const path   = require("path");
const crypto = require("crypto");

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

// Returns the path to the pin store file, creating directories as needed.
function _pinStorePath() {
  const stateDir = process.env.LILARA_STATE_DIR || os.tmpdir();
  const dir = path.join(stateDir, "mcp-pins");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, "pins.json");
}

// Read the pin store (keyed by "<server>/<tool>").
function _readPins() {
  const p = _pinStorePath();
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

// Write the pin store.
function _writePins(pins) {
  fs.writeFileSync(_pinStorePath(), JSON.stringify(pins), { encoding: "utf8", mode: 0o600 });
}

/**
 * checkArgShapeDrift({ server, tool, args }) → { drift: boolean, reason?: string }
 *
 * On first call: records the arg shape hash and returns { drift: false }.
 * On subsequent calls: if the hash differs, returns { drift: true, reason }.
 * Always fail-open: I/O errors return { drift: false }.
 */
function checkArgShapeDrift({ server, tool, args }) {
  try {
    if (!server || !tool) return { drift: false };
    const key    = `${server}/${tool}`;
    const hash   = argShapeHash(args);
    const pins   = _readPins();
    const stored = pins[key];
    if (!stored) {
      // First sight — record the hash.
      pins[key] = { hash, seenAt: new Date().toISOString() };
      _writePins(pins);
      return { drift: false };
    }
    if (stored.hash !== hash) {
      // Shape changed — drift detected.
      return { drift: true, reason: `arg-shape changed: ${stored.hash} → ${hash}` };
    }
    return { drift: false };
  } catch {
    return { drift: false }; // fail-open
  }
}

module.exports = { checkArgShapeDrift, argShapeHash };
