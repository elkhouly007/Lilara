#!/usr/bin/env node
"use strict";

const fs   = require("fs");
const path = require("path");
const { stateDir, ensureDir } = require("./state-paths");
const { ensureBaseDirSafe } = require("./state-dir");

// ---------------------------------------------------------------------------
// Lightweight append-only telemetry log for internal runtime events.
// Records corruption events, state-migration events, and similar anomalies.
// Never records payload content, commands, file paths, or secrets.
//
// Log location: <stateDir>/telemetry.jsonl
// Only writes when LILARA_TELEMETRY !== "0".
// ---------------------------------------------------------------------------

function telemetryFile() {
  return path.join(stateDir(), "telemetry.jsonl");
}

function emitEvent(eventName, fields = {}) {
  // ADR-032: state-dir guard
  if (!ensureBaseDirSafe(stateDir())) return;
  if (process.env.LILARA_TELEMETRY === "0") return;
  try {
    const base = stateDir();
    ensureDir(base);
    const record = {
      ts: new Date().toISOString(),
      event: String(eventName).slice(0, 64),
      ...Object.fromEntries(
        Object.entries(fields)
          .slice(0, 8)
          .map(([k, v]) => [String(k).slice(0, 32), String(v ?? "").slice(0, 128)])
      ),
    };
    fs.appendFileSync(telemetryFile(), JSON.stringify(record) + "\n", { mode: 0o600 });
  } catch {
    /* telemetry must never crash callers */
  }
}

/**
 * Read all telemetry events from the JSONL log.
 * Returns an empty array if the file does not exist or cannot be parsed.
 */
function readTelemetry() {
  try {
    const file = telemetryFile();
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Summarize telemetry events grouped by event type.
 * Returns: { totalEvents, dateRange, byEvent: { [name]: { count, lastSeen } } }
 */
function summarizeTelemetry() {
  const events = readTelemetry();
  if (events.length === 0) return { totalEvents: 0, dateRange: null, byEvent: {} };

  const byEvent = {};
  let earliest = events[0].ts || "";
  let latest = events[0].ts || "";

  for (const ev of events) {
    const name = ev.event || "unknown";
    if (!byEvent[name]) byEvent[name] = { count: 0, lastSeen: ev.ts || "" };
    byEvent[name].count++;
    if (ev.ts > byEvent[name].lastSeen) byEvent[name].lastSeen = ev.ts;
    if (ev.ts < earliest) earliest = ev.ts;
    if (ev.ts > latest) latest = ev.ts;
  }

  return {
    totalEvents: events.length,
    dateRange: { earliest, latest },
    byEvent,
  };
}

module.exports = { emitEvent, readTelemetry, summarizeTelemetry };
