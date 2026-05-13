#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { extractArgs, extractPaths } = require("./arg-extractor");
const { canonicalJson } = require("./canonical-json");
const { currentSessionId } = require("./session-context");
const { stateDir, ensureDir } = require("./state-paths");

const HEAD_BYTES = 4096;
const DEFAULT_ENV_KEYS = ["PATH", "LD_LIBRARY_PATH", "NODE_PATH", "PATHEXT", "ComSpec", "SHELL", "BASH_ALIASES"];

function sha256(textOrBuffer) {
  return "sha256:" + crypto.createHash("sha256").update(textOrBuffer).digest("hex");
}

function safeRealpath(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function safeStat(targetPath, lstat = false) {
  try {
    return lstat ? fs.lstatSync(targetPath) : fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function safeGitHead(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 1500,
    }).trim();
  } catch {
    return "";
  }
}

function trackedEnvKeys(env, extraKeys = []) {
  const keys = new Set(DEFAULT_ENV_KEYS);
  for (const key of Object.keys(env || {})) {
    if (key.startsWith("HORUS_")) keys.add(key);
  }
  for (const key of String(process.env.HORUS_ENVELOPE_ENV_KEYS || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    keys.add(key);
  }
  for (const key of (Array.isArray(extraKeys) ? extraKeys : [])) {
    if (key) keys.add(String(key));
  }
  return [...keys].sort();
}

function snapshotEnv(env, keys) {
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key)) out[key] = String(env[key]);
  }
  return out;
}

function baselineDir() {
  const dir = path.join(stateDir(), "envelope-baselines");
  ensureDir(dir);
  return dir;
}

function pendingDir() {
  const dir = path.join(stateDir(), "pending-envelopes");
  ensureDir(dir);
  return dir;
}

function baselineId(input = {}) {
  const raw = String(
    input.envelopeBaselineId ||
    input.sessionId ||
    currentSessionId() ||
    `${input.harness || "global"}:${input.cwd || process.cwd()}`
  );
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function baselinePath(input = {}) {
  return path.join(baselineDir(), `${baselineId(input)}.json`);
}

function loadBaseline(input = {}, env, keys) {
  if (input.envBaseline && typeof input.envBaseline === "object") return input.envBaseline;
  const file = baselinePath(input);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    const fresh = snapshotEnv(env, keys);
    if (input.persistEnvBaseline !== false && process.env.HORUS_READONLY_CONTRACT !== "1") {
      try {
        fs.writeFileSync(file + ".tmp", JSON.stringify(fresh), { mode: 0o600 });
        fs.renameSync(file + ".tmp", file);
      } catch {
        try { fs.unlinkSync(file + ".tmp"); } catch { /* best-effort */ }
      }
    }
    return fresh;
  }
}

function diffEnv(baseline, current) {
  const added = [];
  const removed = [];
  const changed = [];
  const keys = [...new Set([...Object.keys(baseline || {}), ...Object.keys(current || {})])].sort();
  for (const key of keys) {
    const before = Object.prototype.hasOwnProperty.call(baseline || {}, key);
    const after = Object.prototype.hasOwnProperty.call(current || {}, key);
    if (!before && after) added.push(key);
    else if (before && !after) removed.push(key);
    else if (before && after && String(baseline[key]) !== String(current[key])) changed.push(key);
  }
  return { added, removed, changed };
}

function parseAliasBlob(blob) {
  const aliases = {};
  const text = String(blob || "");
  if (!text) return aliases;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    aliases[key] = value;
  }
  return aliases;
}

function aliasMap(env, input = {}) {
  const merged = {
    ...parseAliasBlob(env?.BASH_ALIASES || ""),
    ...(input.aliases && typeof input.aliases === "object" ? input.aliases : {}),
  };
  const out = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value != null && value !== "") out[String(key)] = String(value);
  }
  return out;
}

function normalizeCommandAst(command, env, input = {}) {
  const tokens = extractArgs(command);
  const aliases = aliasMap(env, input);
  const first = tokens[0] || "";
  const aliasValue = aliases[first] || null;
  const aliasTokens = aliasValue ? extractArgs(aliasValue) : [];
  let argv = tokens;
  if (tokens.length >= 3 && ["bash", "sh", "zsh"].includes(path.basename(tokens[0] || "")) && /^-l?c$/.test(tokens[1])) {
    argv = [tokens[0], tokens[1], extractArgs(tokens[2] || "")];
  }
  return {
    argv,
    alias: aliasValue ? { name: first, value: aliasTokens } : null,
  };
}

function expandHome(targetPath) {
  if (!targetPath.startsWith("~")) return targetPath;
  return path.join(os.homedir(), targetPath.slice(1));
}

function commandHead(commandAst) {
  if (!commandAst || typeof commandAst !== "object") return "";
  const aliasHead = commandAst.alias?.value?.[0];
  if (aliasHead) return String(aliasHead);
  if (Array.isArray(commandAst.argv) && typeof commandAst.argv[0] === "string") return commandAst.argv[0];
  return "";
}

function resolveExecutable(commandAst, cwd, env) {
  const requested = commandHead(commandAst);
  if (!requested) {
    return {
      requested: "",
      resolved: "",
      dev: null,
      ino: null,
      fromPathEntry: null,
      viaAlias: commandAst?.alias?.name || null,
    };
  }

  const withStat = (resolved, fromPathEntry) => {
    const stat = safeStat(resolved);
    return {
      requested,
      resolved,
      dev: stat ? Number(stat.dev) : null,
      ino: stat ? Number(stat.ino) : null,
      fromPathEntry,
      viaAlias: commandAst?.alias?.name || null,
    };
  };

  const expanded = expandHome(requested);
  if (expanded.includes("/")) {
    const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
    return withStat(safeRealpath(absolute), null);
  }

  const pathEntries = String(env?.PATH || "").split(path.delimiter).filter(Boolean);
  const pathexts = process.platform === "win32"
    ? String(env?.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];

  for (const entry of pathEntries) {
    const baseEntry = expandHome(entry);
    for (const ext of pathexts) {
      const candidate = path.join(baseEntry, process.platform === "win32" ? requested + ext : requested);
      const stat = safeStat(candidate);
      if (stat && stat.isFile()) return withStat(safeRealpath(candidate), baseEntry);
    }
  }

  return {
    requested,
    resolved: requested,
    dev: null,
    ino: null,
    fromPathEntry: null,
    viaAlias: commandAst?.alias?.name || null,
  };
}

function targetCandidates(input = {}, cwd) {
  const fromCommand = extractPaths(input.command || "");
  const extra = Array.isArray(input.trackPaths)
    ? input.trackPaths
    : String(process.env.HORUS_ENVELOPE_TRACK_PATHS || "").split(path.delimiter);
  const raw = [];
  if (fromCommand.length > 0) raw.push(...fromCommand);
  if (input.targetPath && input.targetPath !== cwd) raw.push(input.targetPath);
  raw.push(...extra.filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const resolved = path.isAbsolute(item)
      ? path.resolve(expandHome(item))
      : path.resolve(cwd, expandHome(item));
    if (!seen.has(resolved)) {
      seen.add(resolved);
      out.push(resolved);
    }
  }
  return out.sort();
}

function targetMeta(targetPath) {
  const lstat = safeStat(targetPath, true);
  const stat = safeStat(targetPath);
  const real = safeRealpath(targetPath);
  if (!stat) {
    return { path: targetPath, realpath: real, exists: false, dev: null, ino: null, mtime: null, headSha: null, symlink: Boolean(lstat?.isSymbolicLink()) };
  }

  let headSha = null;
  if (stat.isFile()) {
    try {
      const fd = fs.openSync(targetPath, "r");
      try {
        const buf = Buffer.alloc(Math.min(HEAD_BYTES, Number(stat.size) || HEAD_BYTES));
        const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
        headSha = sha256(buf.subarray(0, bytes));
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      headSha = null;
    }
  }

  return {
    path: targetPath,
    realpath: real,
    exists: true,
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    mtime: Math.floor(stat.mtimeMs),
    headSha,
    symlink: Boolean(lstat?.isSymbolicLink()),
  };
}

function cwdMeta(cwd) {
  const real = safeRealpath(cwd);
  const stat = safeStat(real);
  return {
    path: real,
    dev: stat ? Number(stat.dev) : null,
    ino: stat ? Number(stat.ino) : null,
  };
}

function hashEnvelope(envelope) {
  const copy = { ...envelope };
  delete copy.hash;
  return sha256(canonicalJson(copy));
}

function normalizeNetworkTargets(raw) {
  // Defensive normalisation so the field stays canonical regardless of how
  // callers shape it. Entries with no host or no resolvedIps are dropped.
  // Sort hosts, ports, and the IP list itself for deterministic hashing.
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const host = String(e.host || "").toLowerCase();
    if (!host) continue;
    const port = e.port == null ? null : Number(e.port);
    const scheme = e.scheme == null ? null : String(e.scheme);
    const ips = Array.isArray(e.resolvedIps)
      ? [...new Set(e.resolvedIps.map((x) => String(x)).filter(Boolean))].sort()
      : [];
    if (ips.length === 0) continue;
    out.push({ host, port, scheme, resolvedIps: ips });
  }
  if (out.length === 0) return null;
  out.sort((a, b) => {
    if (a.host !== b.host) return a.host < b.host ? -1 : 1;
    const ap = a.port == null ? -1 : a.port;
    const bp = b.port == null ? -1 : b.port;
    if (ap !== bp) return ap - bp;
    const as = a.scheme || "";
    const bs = b.scheme || "";
    return as < bs ? -1 : as > bs ? 1 : 0;
  });
  return out;
}

function build(input = {}) {
  const env = input.env && typeof input.env === "object" ? input.env : process.env;
  const cwd = path.resolve(String(input.cwd || input.projectRoot || process.cwd()));
  const envKeys = trackedEnvKeys(env, input.envKeys);
  const current = snapshotEnv(env, envKeys);
  const baseline = loadBaseline(input, env, envKeys);
  const commandAst = normalizeCommandAst(input.command || "", env, input);
  const envelope = {
    version: 1,
    cwd: cwdMeta(cwd),
    gitHead: safeGitHead(input.projectRoot || cwd),
    commandAst,
    envDiff: diffEnv(baseline, current),
    execPath: resolveExecutable(commandAst, cwd, env),
    targets: targetCandidates(input, cwd).map(targetMeta),
  };
  // ADR-005 FC #5: optionally bind resolved network targets (host, port,
  // scheme, resolvedIps) into the envelope. Additive: when no targets are
  // supplied, the field is omitted entirely and the envelope hash is
  // identical to pre-ADR-005 envelopes (backward compat for F15 fixtures).
  const networkTargets = normalizeNetworkTargets(input.networkTargets);
  if (networkTargets) envelope.networkTargets = networkTargets;
  envelope.hash = hashEnvelope(envelope);
  return envelope;
}

function compareTargetLists(expectedTargets = [], observedTargets = []) {
  const left = new Map(expectedTargets.map((item) => [String(item.path), item]));
  const right = new Map(observedTargets.map((item) => [String(item.path), item]));
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  const mismatches = [];
  for (const itemPath of paths) {
    const a = left.get(itemPath) || null;
    const b = right.get(itemPath) || null;
    if (!a || !b) {
      mismatches.push({ code: "target-set", path: itemPath });
      continue;
    }
    const keys = ["realpath", "exists", "dev", "ino", "mtime", "headSha", "symlink"];
    for (const key of keys) {
      if ((a[key] ?? null) !== (b[key] ?? null)) {
        mismatches.push({ code: `target-${key}`, path: itemPath });
        break;
      }
    }
  }
  return mismatches;
}

function verify(expectedEnvelope, observedEnvelope, options = {}) {
  const expected = expectedEnvelope || {};
  const observed = observedEnvelope || {};
  const mismatches = [];

  if (String(expected.hash || "") !== hashEnvelope(expected)) {
    mismatches.push({ code: "expected-hash-invalid" });
  }
  if (String(observed.hash || "") !== hashEnvelope(observed)) {
    mismatches.push({ code: "observed-hash-invalid" });
  }
  if (canonicalJson(expected.cwd || {}) !== canonicalJson(observed.cwd || {})) mismatches.push({ code: "cwd" });
  if (String(expected.gitHead || "") !== String(observed.gitHead || "")) mismatches.push({ code: "git-head" });
  if (canonicalJson(expected.commandAst || {}) !== canonicalJson(observed.commandAst || {})) mismatches.push({ code: "command-ast" });
  if (canonicalJson(expected.execPath || {}) !== canonicalJson(observed.execPath || {})) mismatches.push({ code: "exec-path" });

  const enforceEnvDiff = options.enforceEnvDiff !== false;
  if (enforceEnvDiff && canonicalJson(expected.envDiff || {}) !== canonicalJson(observed.envDiff || {})) mismatches.push({ code: "env-diff" });

  mismatches.push(...compareTargetLists(expected.targets || [], observed.targets || []));

  return {
    ok: mismatches.length === 0,
    reason: mismatches[0]?.code || null,
    mismatches,
    expectedHash: String(expected.hash || ""),
    observedHash: String(observed.hash || ""),
  };
}

function pendingPath(toolUseId) {
  const safeId = String(toolUseId || "").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return path.join(pendingDir(), `${safeId}.json`);
}

function rememberPending(toolUseId, envelope) {
  if (!toolUseId || !envelope || process.env.HORUS_READONLY_CONTRACT === "1") return false;
  try {
    const file = pendingPath(toolUseId);
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function loadPending(toolUseId, consume = false) {
  if (!toolUseId) return null;
  try {
    const file = pendingPath(toolUseId);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (consume) {
      try { fs.unlinkSync(file); } catch { /* best-effort */ }
    }
    return data;
  } catch {
    return null;
  }
}

module.exports = { build, verify, rememberPending, loadPending };
