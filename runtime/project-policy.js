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
    sensitivePathPatterns: Array.isArray(runtime.sensitive_path_patterns) && runtime.sensitive_path_patterns.length > 0
      ? runtime.sensitive_path_patterns.map(String)
      : fallback.sensitivePathPatterns,
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

function findConfig(startPath = "") {
  let current = path.resolve(startPath || process.cwd());
  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }

  while (true) {
    const candidate = path.join(current, "horus.config.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

function loadProjectPolicy(input = {}) {
  const explicitConfig = String(input.configPath || "").trim();
  const candidate = explicitConfig || findConfig(input.projectRoot || input.targetPath || process.cwd());
  if (!candidate) return defaultPolicy();

  try {
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
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
        process.stderr.write(`[ARG] WARNING: horus.config.json corrupt — backed up to ${path.basename(bak)}, using defaults.\n`);
        emitEvent("project-policy-corrupt", { file: "horus.config.json", errCode: String(err.code || "parse-error") });
      } catch { /* backup is best-effort */ }
    }
    return defaultPolicy();
  }
}

module.exports = { defaultPolicy, findConfig, loadProjectPolicy };
