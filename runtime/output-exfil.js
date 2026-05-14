#!/usr/bin/env node
"use strict";

// output-exfil.js — F19 output-channel-exfiltration classifier + floor
// evaluator (ADR-010 / scope §5.1). Pure, zero-dep, no I/O. Receipts hash
// deterministically because match iteration + redacted sample are byte-stable.

const { redact: _redactSecrets } = require("./secret-scan");

// Engine-baked patterns. Severity is the audit tag F19 uses to route the
// decision: confirmed → block (non-demotable), suspicious → require-review
// (operator-token-only demotion). Class names are receipt-stable.
const F19_PATTERNS = Object.freeze([
  Object.freeze({ name: "SSH private key",                class: "ssh-private-key",       pattern: /-----BEGIN\s+(?:[A-Z][A-Z ]*\s+)?PRIVATE KEY-----/, severity: "confirmed" }),
  Object.freeze({ name: "AWS access key id",              class: "aws-access-key-id",     pattern: /\bAKIA[A-Z0-9]{16}\b/,                              severity: "confirmed" }),
  // Anchor the 40-char base64 secret to the `AWS_SECRET_ACCESS_KEY=` form;
  // bare 40-char strings are too noisy to flag as confirmed.
  Object.freeze({ name: "AWS secret access key (named)",  class: "aws-secret-access-key", pattern: /AWS_SECRET_ACCESS_KEY\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/, severity: "confirmed" }),
  Object.freeze({ name: "GitHub personal access token",   class: "github-pat",            pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,                   severity: "confirmed" }),
  Object.freeze({ name: "OpenAI API key",                 class: "openai-api-key",        pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/,                         severity: "confirmed" }),
  Object.freeze({ name: "Slack token",                    class: "slack-token",           pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,                  severity: "confirmed" }),
  // 32+ hex runs are sometimes legitimate (git SHAs, build hashes); flagged
  // `suspicious` so F19 routes to require-review instead of block.
  Object.freeze({ name: "high-entropy hex (32+)",         class: "high-entropy-hex",      pattern: /\b[a-fA-F0-9]{32,}\b/,                              severity: "suspicious" }),
]);

const SEVERITY_RANK = Object.freeze({ null: 0, none: 0, suspicious: 1, confirmed: 2 });
const SAMPLE_MAX = 32;
const F19_CHANNEL_OBS_DEFAULT = "not-observed";

function classifyOutput(content, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const limit = Number.isFinite(o.limit) && o.limit > 0 ? Math.floor(o.limit) : 8;
  const text = typeof content === "string" ? content : "";
  if (text.length === 0) return { matches: [], severity: null, redactedSample: "" };

  const matches = [];
  const seen = Object.create(null);
  let maxSeverity = null;
  for (const entry of F19_PATTERNS) {
    if (matches.length >= limit) break;
    if (seen[entry.class]) continue;
    if (entry.pattern.test(text)) {
      matches.push({ class: entry.class, name: entry.name, severity: entry.severity });
      seen[entry.class] = true;
      if (maxSeverity === null || SEVERITY_RANK[entry.severity] > SEVERITY_RANK[maxSeverity]) {
        maxSeverity = entry.severity;
      }
    }
  }

  // Sample: run secret-scan.redact() first so the dynamic corpus is also
  // scrubbed, then mask any F19-only hits the dynamic corpus missed.
  let sample = "";
  try { sample = _redactSecrets(text); } catch { sample = ""; }
  for (const entry of F19_PATTERNS) {
    sample = sample.replace(entry.pattern, "[REDACTED:" + entry.class + "]");
  }
  sample = sample.replace(/\s+/g, " ").trim();
  if (sample.length > SAMPLE_MAX) sample = sample.slice(0, SAMPLE_MAX);

  return { matches, severity: maxSeverity, redactedSample: sample };
}

// classifyOutputs(outputs) — iterates records, returns the highest-severity
// classification + the channel that produced it. First confirmed wins.
function classifyOutputs(outputs, opts) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return { fired: false, severity: null, matches: [], channel: null, redactedSample: "" };
  }
  let best = null;
  for (const rec of outputs) {
    if (!rec || typeof rec !== "object") continue;
    const channel = typeof rec.channel === "string" ? rec.channel : "";
    const c = classifyOutput(typeof rec.content === "string" ? rec.content : "", opts);
    if (!c.severity) continue;
    if (best === null || SEVERITY_RANK[c.severity] > SEVERITY_RANK[best.severity]) {
      best = { severity: c.severity, matches: c.matches, channel, redactedSample: c.redactedSample };
      if (best.severity === "confirmed") break;
    }
  }
  if (best === null) return { fired: false, severity: null, matches: [], channel: null, redactedSample: "" };
  return { fired: true, severity: best.severity, matches: best.matches, channel: best.channel, redactedSample: best.redactedSample };
}

function _hasArr(o, k) { return o && Array.isArray(o[k]) && o[k].length > 0; }
function _pickArr(input, irKey, inKey) {
  if (input && input.ir && Array.isArray(input.ir[irKey]) && input.ir[irKey].length > 0) return input.ir[irKey];
  if (Array.isArray(input && input[inKey]) && input[inKey].length > 0) return input[inKey];
  return [];
}
function _pickMap(input, key) {
  if (input && input[key] && typeof input[key] === "object") return input[key];
  if (input && input.ir && input.ir[key] && typeof input.ir[key] === "object") return input.ir[key];
  return null;
}

function isWriteToChannelAction(input) {
  if (!input) return false;
  if (_hasArr(input, "outputs") || _hasArr(input, "declaredOutput")) return true;
  if (input.ir && (_hasArr(input.ir, "outputs") || _hasArr(input.ir, "declaredOutput"))) return true;
  return false;
}

// evaluateFloor(input) — engine-facing F19 decision. Pure; never touches disk.
//   { fire: false }
//   { fire: true, severity, channel, matches, redactedSample, phase,
//     channelObservability, compensatingRestriction, compensatingApplied }
function evaluateFloor(input) {
  if (!isWriteToChannelAction(input)) return { fire: false };
  const observability = _pickMap(input, "outputChannelObservability");
  const compensations = _pickMap(input, "outputChannelCompensations");

  const outputs = _pickArr(input, "outputs", "outputs");
  if (outputs.length > 0) {
    const r = classifyOutputs(outputs);
    if (r.fired) {
      const cs = observability && r.channel && typeof observability[r.channel] === "string"
        ? observability[r.channel] : F19_CHANNEL_OBS_DEFAULT;
      return { fire: true, severity: r.severity, channel: r.channel, matches: r.matches, redactedSample: r.redactedSample, phase: "post", channelObservability: cs, compensatingRestriction: null, compensatingApplied: false };
    }
  }

  const declared = _pickArr(input, "declaredOutput", "declaredOutput");
  if (declared.length > 0) {
    const r = classifyOutputs(declared);
    if (r.fired) {
      const cs = observability && r.channel && typeof observability[r.channel] === "string"
        ? observability[r.channel] : F19_CHANNEL_OBS_DEFAULT;
      return { fire: true, severity: r.severity, channel: r.channel, matches: r.matches, redactedSample: r.redactedSample, phase: "pre", channelObservability: cs, compensatingRestriction: null, compensatingApplied: false };
    }
    // Clean content on a not-observed channel → compensating stricter rule.
    for (const rec of declared) {
      const ch = typeof rec.channel === "string" ? rec.channel : "";
      if (!ch) continue;
      const cs = observability && typeof observability[ch] === "string"
        ? observability[ch] : F19_CHANNEL_OBS_DEFAULT;
      if (cs !== "not-observed") continue;
      const comp = compensations && typeof compensations[ch] === "string" && compensations[ch].length > 0
        ? compensations[ch] : null;
      return { fire: true, severity: "compensating", channel: ch, matches: [], redactedSample: "", phase: "pre", channelObservability: "not-observed", compensatingRestriction: comp, compensatingApplied: true };
    }
  }
  return { fire: false };
}

module.exports = { F19_PATTERNS, SEVERITY_RANK, classifyOutput, classifyOutputs, isWriteToChannelAction, evaluateFloor };
