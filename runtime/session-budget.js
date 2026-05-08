"use strict";

const fs   = require("node:fs");
const path = require("node:path");
const { stateDir, ensureDir } = require("./state-paths");

function _budgetPath(sessionId) {
  const dir = path.join(stateDir(), "session-budget");
  ensureDir(dir);
  return path.join(dir, `${sessionId}.json`);
}

function _readCounters(sessionId) {
  try {
    const raw = fs.readFileSync(_budgetPath(sessionId), "utf8");
    const obj = JSON.parse(raw);
    return {
      destructiveOps: Number(obj.destructiveOps) || 0,
      externalBytes:  Number(obj.externalBytes)  || 0,
      startTime:      Number(obj.startTime)      || Date.now(),
    };
  } catch {
    return { destructiveOps: 0, externalBytes: 0, startTime: Date.now() };
  }
}

function _writeCounters(sessionId, c) {
  const file = _budgetPath(sessionId);
  const tmp  = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function getCounters({ sessionId } = {}) {
  if (!sessionId) return { destructiveOps: 0, externalBytes: 0, startTime: Date.now() };
  const c = _readCounters(sessionId);
  if (!fs.existsSync(_budgetPath(sessionId))) _writeCounters(sessionId, c);
  return c;
}

function recordDestructiveOp({ sessionId } = {}) {
  if (!sessionId) return;
  const c = _readCounters(sessionId);
  c.destructiveOps += 1;
  _writeCounters(sessionId, c);
}

function recordExternalBytes(bytes, { sessionId } = {}) {
  if (!sessionId || !Number.isFinite(bytes) || bytes <= 0) return;
  const c = _readCounters(sessionId);
  c.externalBytes += Math.floor(bytes);
  _writeCounters(sessionId, c);
}

function resetCounters({ sessionId } = {}) {
  if (!sessionId) return;
  _writeCounters(sessionId, { destructiveOps: 0, externalBytes: 0, startTime: Date.now() });
}

module.exports = { getCounters, recordDestructiveOp, recordExternalBytes, resetCounters };
