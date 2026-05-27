#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { emitEvent } = require("./telemetry");

function defaultPolicy() {
  return {
    projectRoot: "",
    projectScope: "global",
    trustPosture: "balanced",
    protectedBranches: ["main", "master"],
    hasExplicitProtectedBranches: false,
    sensitivePathPatterns: ["prod", "production", "secrets", "credentials", ".env", "terraform", "infra"],
    taintMinTokenLength: 6,
  taintSafeToolClasses: ["Read", "Grep", "Glob", "LS", "NotebookRead"],
  };
}

function normalizeRuntimeConfig(runtime = {}, projectRoot = "") {
  const fallback = defaultPolicy();
  const config = {
    projectRoot,
    projectScope: projectRoot || fallback.projectScope,
    trustPosture: ["relaxed", "balanced", "strict"].includes(runtime.trust_posture) ? runtime.trust_posture : fallback.trustPosture,
    protectedBranches: Array.isArray(runtime.protected_branches) && runtime.protected_branches.length > 0
      ? runtime.protected_branches.map(String)
      : fallback.protectedBranches,
    hasExplicitProtectedBranches:
      Array.isArray(runtime.protected_branches) && runtime.protected_branches.length > 0,
    sensitivePathPatterns: Array.isArray(runtime.sensitive_path_patterns) && runtime.sensitive_path_patterns.length > 0
      ? runtime.sensitive_path_patterns.map(String)
      : fallback.sensitivePathPatterns,
    // Taint defaults — preserved so a config file that omits the `taint` section
    // still grants Grep/Read/Glob their F10 exemption (D37).  loadProjectPolicy
    // overrides these below when taint.safeToolClasses / taint.minTokenLength
    // are explicitly provided by the operator config.
    taintMinTokenLength: fallback.taintMinTokenLength,
    taintSafeToolClasses: fallback.taintSafeToolClasses,
  };

  if (Array.isArray(runtime.languages) && runtime.languages.length > 0) {
    const markers = runtime.languages.map(String).filter(Boolean);
    config.projectMarkers = [...new Set(markers)];
    if (!config.primaryStack) {
      config.primaryStack = markers.find((item) => item !== 'common' && item !== 'infrastructure') || markers[0] || null;
    }
  }

  return config;
}

// Per-process memo for findConfig walk-up. The walk does ~6 fs.existsSync per
// call on a deep cwd; decide() invokes findConfig 3x per call (via discover(),
// loadProjectPolicy, and taint.correlateCommand). On macOS those existsSync
// calls are ~5-10x slower than on Linux, so memoizing by resolved start path
// is the dominant lever for the macOS p99. Cache is invalidated only on
// process restart - acceptable because lilara.config.json is project-level
// and not expected to materialize mid-session.
const KNOWN_TOP_LEVEL_KEYS = new Set([
  // schema-defined (schemas/lilara.config.schema.json)
  "_comment", "profile", "languages", "agents", "skills", "extra_rules", "runtime", "workflow",
  // used by installer scripts but not yet in schema
  "hooks",
  // used by runtime parser (loadProjectPolicy + taint.js) but not yet in schema
  "taint",
]);
const _warnedConfigs = new Set();
const _findConfigCache = new Map();
function findConfig(startPath = "") {
  const start = path.resolve(startPath || process.cwd());
  const cached = _findConfigCache.get(start);
  if (cached !== undefined) return cached;

  let current = start;
  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }

  let found = "";
  while (true) {
    const candidate = path.join(current, "lilara.config.json");
    if (fs.existsSync(candidate)) { found = candidate; break; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  _findConfigCache.set(start, found);
  return found;
}

function loadProjectPolicy(input = {}) {
  const explicitConfig = String(input.configPath || "").trim();
  const candidate = explicitConfig || findConfig(input.projectRoot || input.targetPath || process.cwd());
  if (!candidate) return defaultPolicy();

  try {
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
    if (!_warnedConfigs.has(candidate)) {
      const unknown = Object.keys(parsed).filter((k) => !KNOWN_TOP_LEVEL_KEYS.has(k));
      if (unknown.length > 0) {
        process.stderr.write(
          `[Lilara] WARNING: ${path.basename(candidate)} has unrecognized top-level keys (${unknown.join(", ")}) — see schemas/lilara.config.schema.json. These will be ignored; runtime falls back to defaults for the affected sections.\n`
        );
        emitEvent("project-policy-unknown-keys", {
          file: path.basename(candidate),
          keys: unknown.slice(0, 8).join(","),
        });
      }
      try {
        const { validateConfig } = require("./config-validator");
        const validationResult = validateConfig(parsed);
        if (validationResult && !validationResult.valid && Array.isArray(validationResult.errors) && validationResult.errors.length > 0) {
          process.stderr.write(
            `[Lilara] WARNING: ${path.basename(candidate)} failed schema validation: ${validationResult.errors.slice(0, 3).join("; ")}\n`
          );
          emitEvent("project-policy-schema-invalid", {
            file: path.basename(candidate),
            errorCount: String(validationResult.errors.length),
          });
        }
      } catch { /* config-validator unavailable — validation is best-effort */ }
      _warnedConfigs.add(candidate);
    }
    const normalized = normalizeRuntimeConfig(parsed.runtime || {}, path.dirname(candidate));
    if (Array.isArray(parsed.languages) && parsed.languages.length > 0) {
      const markers = parsed.languages.map(String).filter(Boolean);
      normalized.projectMarkers = [...new Set(markers)];
      normalized.primaryStack = markers.find((item) => item !== 'common' && item !== 'infrastructure') || markers[0] || null;
    }
    const taintCfg = parsed.taint || {};
    if (typeof taintCfg.minTokenLength === "number") {
      const mtl = Math.round(taintCfg.minTokenLength);
      if (mtl >= 4 && mtl <= 32) normalized.taintMinTokenLength = mtl;
    }
    if (Array.isArray(taintCfg.safeToolClasses) && taintCfg.safeToolClasses.length > 0) {
      normalized.taintSafeToolClasses = taintCfg.safeToolClasses.map(String).filter(Boolean);
    }
    return normalized;
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      try {
        const bak = `${candidate}.corrupt-${Date.now()}.bak`;
        fs.copyFileSync(candidate, bak);
        process.stderr.write(`[ARG] WARNING: lilara.config.json corrupt — backed up to ${path.basename(bak)}, using defaults.\n`);
        emitEvent("project-policy-corrupt", { file: "lilara.config.json", errCode: String(err.code || "parse-error") });
      } catch { /* backup is best-effort */ }
    }
    return defaultPolicy();
  }
}

module.exports = { defaultPolicy, normalizeRuntimeConfig, findConfig, loadProjectPolicy };
