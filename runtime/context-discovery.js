#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { findConfig } = require("./project-policy");

// Per-process memo for detectProjectShape. ~9 fs.existsSync per call when the
// shape isn't cached; gitRoot is stable within a process for any given repo
// so memoizing by resolved root is safe and big on macOS where existsSync is
// 5-10x slower than Linux.
const _shapeCache = new Map();
function detectProjectShape(projectRoot = "") {
  const root = String(projectRoot || "").trim();
  if (!root) return { hasConfig: false, markers: [], primaryStack: null };
  const cached = _shapeCache.get(root);
  if (cached !== undefined) return cached;
  if (!fs.existsSync(root)) {
    const empty = { hasConfig: false, markers: [], primaryStack: null };
    _shapeCache.set(root, empty);
    return empty;
  }

  const checks = [
    ["package.json", "node"],
    ["tsconfig.json", "typescript"],
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["go.mod", "golang"],
    ["Cargo.toml", "rust"],
    ["pom.xml", "java"],
    ["build.gradle", "java"],
    ["build.gradle.kts", "kotlin"],
  ];

  const markers = checks
    .filter(([file]) => fs.existsSync(path.join(root, file)))
    .map(([, marker]) => marker);

  const shape = {
    hasConfig: fs.existsSync(path.join(root, "lilara.config.json")),
    markers: [...new Set(markers)],
    primaryStack: markers[0] || null,
  };
  _shapeCache.set(root, shape);
  return shape;
}

// Per-process memo for safeGit. git rev-parse + symbolic-ref are spawned on
// every discover(), so 2-3 child_process.spawnSync per decide(). On macOS,
// each cold spawn is ~5-15 ms (vs ~1 ms on Linux). Repo branch/root state is
// stable within a process for bench/CI runs.
const _gitCache = new Map();
function safeGit(args, cwd) {
  const key = `${cwd || ""}\x00${args.join("\x00")}`;
  if (_gitCache.has(key)) return _gitCache.get(key);
  let out = "";
  try {
    out = execFileSync("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 1500,
    }).trim();
  } catch { /* git unavailable or non-repo cwd - cached as "" */ }
  _gitCache.set(key, out);
  return out;
}

function discover(input = {}) {
  const rawTarget = String(input.targetPath || "").trim();
  const rawProjectRoot = String(input.projectRoot || "").trim();
  const targetPath = rawTarget || rawProjectRoot || process.cwd();
  const configSearchRoot = rawProjectRoot || targetPath;
  const configPath = String(input.configPath || "").trim() || findConfig(configSearchRoot);
  const inferredRoot = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
  const projectRoot = configPath ? path.dirname(configPath) : (rawProjectRoot || inferredRoot);
  const gitRoot = safeGit(["rev-parse", "--show-toplevel"], projectRoot) || projectRoot;
  const branch = String(input.branch || "").trim()
    || safeGit(["symbolic-ref", "--short", "HEAD"], gitRoot)
    || safeGit(["rev-parse", "--abbrev-ref", "HEAD"], gitRoot);

  const shape = detectProjectShape(gitRoot);

  return {
    projectRoot: gitRoot,
    branch,
    configPath,
    hasConfig: shape.hasConfig,
    projectMarkers: shape.markers,
    primaryStack: shape.primaryStack,
  };
}

module.exports = { discover, detectProjectShape };
