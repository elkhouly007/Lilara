#!/usr/bin/env node
"use strict";

// notify.js — ADR-015 notification router (v0.5 Stage D wave-4).
// Pure, zero-dep. Allowlist scrubber + transport fan-out + per-channel retry.
// notify() ALWAYS resolves (never throws) so the engine can fire-and-forget.

const { canonicalJson } = require("./canonical-json");
const { append } = require("./decision-journal");

const PER_CHANNEL_TIMEOUT_MS = 5000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [200, 1000, 5000];
const SEVERITY_RANK = Object.freeze({ info: 1, warning: 2, critical: 3 });

// Receipt keys safe to forward to a webhook. Anything not listed is dropped.
const KEEP_KEYS = Object.freeze([
  "action", "riskLevel", "reasonCodes", "floorFired", "decisionKey",
  "contractRevision", "timestamp", "ambientClass",
]);

function _isValidChannel(ch) {
  if (!ch || typeof ch !== "object") return false;
  const t = ch.type;
  return t === "discord" || t === "slack" || t === "email";
}

function loadNotifyConfig(contract) {
  if (!contract || !contract.notifications || contract.notifications.enabled !== true) {
    return { enabled: false, channels: [], severityFloor: "info" };
  }
  const n = contract.notifications;
  const channels = Array.isArray(n.channels) ? n.channels.filter(_isValidChannel) : [];
  const sf = typeof n.severityFloor === "string" && SEVERITY_RANK[n.severityFloor]
    ? n.severityFloor : "info";
  return { enabled: true, channels, severityFloor: sf };
}

function scrubForNotify(receipt) {
  const out = {};
  if (!receipt || typeof receipt !== "object") return out;
  for (const k of KEEP_KEYS) {
    const v = receipt[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      out[k] = v.filter((x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean").slice(0, 24);
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = typeof v === "string" ? v.slice(0, 256) : v;
    }
  }
  if (receipt.snapshot && typeof receipt.snapshot === "object" && typeof receipt.snapshot.snapshotId === "string") {
    out.snapshotId = receipt.snapshot.snapshotId.slice(0, 128);
  } else if (typeof receipt.snapshotId === "string") {
    // Re-scrub of an already-flat scrubbed payload stays idempotent.
    out.snapshotId = receipt.snapshotId.slice(0, 128);
  }
  return out;
}

function notify(event, opts) {
  let cfg;
  try {
    const o = opts || {};
    if (o.contract) cfg = loadNotifyConfig(o.contract);
    else cfg = {
      enabled: o.enabled !== false,
      channels: Array.isArray(o.channels) ? o.channels.filter(_isValidChannel) : [],
      severityFloor: typeof o.severityFloor === "string" && SEVERITY_RANK[o.severityFloor] ? o.severityFloor : "info",
    };
  } catch { return Promise.resolve([]); }
  if (!cfg.enabled || cfg.channels.length === 0) return Promise.resolve([]);

  const ev = event || {};
  if ((SEVERITY_RANK[ev.severity] || 0) < (SEVERITY_RANK[cfg.severityFloor] || 0)) return Promise.resolve([]);

  const matching = cfg.channels.filter((ch) => {
    const events = Array.isArray(ch.events) ? ch.events : ["*"];
    return events.includes("*") || events.includes(ev.kind);
  });
  if (matching.length === 0) return Promise.resolve([]);

  return Promise.all(matching.map((ch) => _sendChannel(ch, ev))).then((results) => {
    try {
      append({
        kind: "notify", action: String(ev.kind || "notify"),
        riskLevel: String(ev.severity || "info"), riskScore: 0,
        reasonCodes: [String(ev.kind || "notify")],
        tool: "", branch: "", targetPath: "",
        notes: `notify:${ev.kind || "unknown"}:${ev.severity || "info"}`,
        notifyResult: results,
      });
    } catch { /* journal best-effort */ }
    return results;
  }, () => []);
}

async function _sendChannel(ch, event) {
  const type = String(ch.type || "");
  let transport;
  try {
    if (type === "discord") transport = require("./notify/discord");
    else if (type === "slack") transport = require("./notify/slack");
    else if (type === "email") transport = require("./notify/email");
    else return _result(type, false, 0, "unknown-transport");
  } catch { return _result(type, false, 0, "transport-load-failed"); }

  let lastErr = null;
  let lastStatus = 0;
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (i > 0) await _sleep(RETRY_DELAYS_MS[i - 1] || 1000);
    let r;
    try {
      r = await _withTimeout(transport.send(ch, event), PER_CHANNEL_TIMEOUT_MS);
    } catch (err) {
      lastErr = err && err.message ? String(err.message) : "transport-error";
      continue;
    }
    if (r && r.ok) return _result(type, true, r.status || 200, null);
    lastStatus = r && r.status ? r.status : 0;
    lastErr = r && r.error ? String(r.error) : `http-${lastStatus || "unknown"}`;
    if (lastStatus >= 400 && lastStatus < 500) return _result(type, false, lastStatus, lastErr);
  }
  return _result(type, false, lastStatus, `degraded-mode:exhausted-retries:${lastErr || "unknown"}`);
}

function _result(channel, ok, status, error) {
  return { channel, ok: Boolean(ok), status: Number(status) || 0, error: error ? String(error).slice(0, 200) : null };
}

function _sleep(ms) { return new Promise((r) => setTimeout(r, Math.max(0, ms | 0))); }

function _withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (done) return; done = true; reject(new Error("notify-timeout")); }, ms);
    Promise.resolve(p).then((v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); },
      (err) => { if (done) return; done = true; clearTimeout(timer); reject(err); });
  });
}

// Shared HTTP POST used by discord + slack transports. http:// allowed only
// when LILARA_NOTIFY_INSECURE=1 so the transport tests can stub a localhost
// server without binding TLS certs.
function postJson(targetUrl, body) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(targetUrl); } catch { return resolve({ ok: false, status: 0, error: "invalid-url" }); }
    const isHttp = u.protocol === "http:";
    const mod = isHttp ? require("node:http") : require("node:https");
    const payload = typeof body === "string" ? body : canonicalJson(body);
    const req = mod.request({
      method: "POST", hostname: u.hostname, port: u.port || (isHttp ? 80 : 443),
      path: (u.pathname || "/") + (u.search || ""),
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "user-agent": "horus-notify/1" },
    }, (res) => {
      let chunks = "";
      res.on("data", (d) => { chunks += d; });
      res.on("end", () => {
        const status = res.statusCode || 0;
        const ok = status >= 200 && status < 300;
        resolve({ ok, status, error: ok ? null : `http-${status}`, body: chunks.slice(0, 256) });
      });
    });
    req.on("error", (err) => resolve({ ok: false, status: 0, error: (err && err.message) || "request-error" }));
    req.setTimeout(PER_CHANNEL_TIMEOUT_MS, () => req.destroy(new Error("notify-http-timeout")));
    req.write(payload); req.end();
  });
}

module.exports = {
  notify, loadNotifyConfig, scrubForNotify, postJson,
  PER_CHANNEL_TIMEOUT_MS, MAX_RETRIES, RETRY_DELAYS_MS, SEVERITY_RANK, KEEP_KEYS,
};
