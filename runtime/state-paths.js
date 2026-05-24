#!/usr/bin/env node
"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");

// ---------------------------------------------------------------------------
// Primary runtime state directory
// All runtime state (learned-policy, session-context, decision-journal) lives
// here. Override with LILARA_STATE_DIR for CI/testing isolation.
// ---------------------------------------------------------------------------
function stateDir() {
  return process.env.LILARA_STATE_DIR
    ? path.resolve(process.env.LILARA_STATE_DIR)
    : path.join(os.homedir(), ".lilara");
}

// ---------------------------------------------------------------------------
// Hook event log + rate-limit state directory
// Kept at the legacy ecc-safe-plus path for backward compatibility with
// existing hook-events.log consumers. Override with LILARA_HOOK_STATE_DIR.
// ---------------------------------------------------------------------------
function hookStateDir() {
  if (process.env.LILARA_HOOK_STATE_DIR) return path.resolve(process.env.LILARA_HOOK_STATE_DIR);
  if (process.env.LILARA_STATE_DIR) return path.resolve(process.env.LILARA_STATE_DIR);
  return path.join(os.homedir(), ".lilara");
}

// ---------------------------------------------------------------------------
// Instinct store directory
// Override with LILARA_INSTINCT_DIR.
// ---------------------------------------------------------------------------
function instinctDir() {
  return process.env.LILARA_INSTINCT_DIR
    ? path.resolve(process.env.LILARA_INSTINCT_DIR)
    : path.join(os.homedir(), ".lilara", "instincts");
}

// ---------------------------------------------------------------------------
// Ensure a directory exists at 0700. Silent on failure — callers must handle.
// ---------------------------------------------------------------------------
function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
  } catch {
    /* caller handles missing dir */
  }
}

module.exports = { stateDir, hookStateDir, instinctDir, ensureDir };
