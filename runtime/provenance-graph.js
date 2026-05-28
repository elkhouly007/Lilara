#!/usr/bin/env node
"use strict";

// provenance-graph.js — Session-scoped data-flow / kill-chain evaluation.
//
// F23 (ADR-017): Detects cross-call kill chains that single-shot scoring
// misses. Sources (file reads, web-fetch, mcp) are recorded at PostToolUse
// (content available). Propagation (write of tainted data to a new path) is
// detected at decide() PreToolUse. Sink evaluation fires F23 when the pending
// call closes a known chain shape.
//
// Three chain shapes:
//   staged-exfil       sensitive data → file → external network send  (block)
//   injection-to-exec  untrusted fetch → file → exec of that file     (escalate)
//   persistence        tainted data → write to shell/cron/git-hook     (escalate)
//
// Evidence bar: content token-hash overlap OR structural file-reference.
// Temporal-only correlation NEVER fires — too FP-prone on legit dev flows.
//
// Pure functions — zero I/O, fully testable, deterministic. Storage lives in
// session-context.js (loadProvenanceGraph/recordProvenanceStep).
//
// Zero external dependencies (Node crypto only).

const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const OVERLAP_THRESHOLD = 0.08; // Jaccard threshold — requires shared signal, not common words
const MIN_SHARED_COUNT  = 3;    // Minimum token-hash matches before overlap fires
const MAX_TOKEN_HASHES  = 64;   // Cap per source/derivative node
const TOKEN_MIN_LEN     = 6;    // Skip tokens shorter than this

// English + JS/Python stopwords unlikely to carry taint signal
const STOPWORDS = new Set([
  "export", "import", "function", "return", "const", "this", "from", "true",
  "false", "null", "undefined", "module", "require", "object", "string",
  "number", "boolean", "array", "default", "class", "static", "extends",
  "interface", "version", "license", "copyright", "package", "description",
  "readme", "install", "usage", "example", "note", "warning", "please",
  "should", "which", "there", "their", "would", "could", "might", "before",
  "after", "during", "about", "because", "config", "setting", "option",
  "value", "format", "output", "result", "status", "report",
]);

// ---------------------------------------------------------------------------
// Path / URL patterns
// ---------------------------------------------------------------------------

// Persistence write targets that would give an attacker lasting access
const PERSISTENCE_PATTERNS = [
  /[/\\]\.bashrc$/i,
  /[/\\]\.zshrc$/i,
  /[/\\]\.bash_profile$/i,
  /[/\\]\.profile$/i,
  /[/\\]\.bash_login$/i,
  /[/\\]\.zprofile$/i,
  /[/\\]\.zlogin$/i,
  /[/\\]\.ssh[/\\]authorized_keys$/i,
  /[/\\]\.ssh[/\\]config$/i,
  /[/\\]\.config[/\\]fish[/\\]config\.fish$/i,
  /[/\\]etc[/\\]cron/i,
  /[/\\]etc[/\\]profile/i,
  /[/\\]etc[/\\]bash\.bashrc/i,
  /[/\\]etc[/\\]environment$/i,
  /[/\\]systemd[/\\][^/\\]+\.service$/i,
  /[/\\]systemd[/\\][^/\\]+\.timer$/i,
  /[/\\]\.git[/\\]hooks[/\\]/i,
  /[/\\]\.config[/\\]autostart[/\\]/i,
  /[/\\](Library[/\\]LaunchAgents|launchagents)[/\\]/i,
  /[/\\](Library[/\\]LaunchDaemons|launchdaemons)[/\\]/i,
];

// Sensitive source file paths (reading these produces sensitive source nodes)
const SENSITIVE_PATH_PATTERNS = [
  /[/\\]\.ssh[/\\]/i,
  /[/\\]\.aws[/\\]/i,
  /[/\\]\.gnupg[/\\]/i,
  /[/\\]\.password-store[/\\]/i,
  /[/\\]\.kube[/\\]/i,
  /[/\\](vault|secrets?)[/\\]/i,
  /[/\\](id_rsa|id_ed25519|id_ecdsa|id_dsa)$/i,
  /[/\\](payments?|billing)[/\\]/i,
  /[/\\]private[-_]?key/i,
  /[/\\]credentials$/i,
  /[/\\]\.env[^/\\]*$/i,
  /[/\\]\.envrc$/i,
  /[/\\](prod(uction)?|staging|infra)[/\\]/i,
];

// Exempted package registries — network sends to these are not exfil
const PKG_REGISTRY_HOSTS = new Set([
  "registry.npmjs.org", "registry.yarnpkg.com",
  "pypi.org", "files.pythonhosted.org",
  "crates.io", "static.crates.io",
  "proxy.golang.org", "sum.golang.org",
  "rubygems.org", "packagist.org",
  "archive.ubuntu.com", "security.ubuntu.com",
  "formulae.brew.sh",
  "repo.maven.apache.org", "central.sonatype.com",
  "dl.google.com", "storage.googleapis.com",
  "objects.githubusercontent.com",
]);

// Package manager install commands don't exfil even if they touch the network
const PKG_MGR_PATTERN = /\b(npm|pnpm|yarn|pip|pip3|cargo|go\s+get|apt|apt-get|brew|gem|composer)\s+(install|add|get|publish|update|upgrade|download|ci)\b/i;

// Exec interpreter patterns — extract the file being executed
const EXEC_PATTERN = /\b(bash|sh|dash|zsh|fish|ksh|tcsh|csh|node|nodejs|python3?|ruby|perl|php|deno|bun)\s+(?:--?\w+\s+)*([^\s|&;><"'`\\]+(?:\.sh|\.py|\.rb|\.pl|\.js|\.mjs|\.ts|\.php|\.bash))\b/i;
const SOURCE_CMD_PATTERN = /\b(?:source|\.)\s+([^\s|&;><"'`\\]+)/i;

// ---------------------------------------------------------------------------
// Public pure helpers
// ---------------------------------------------------------------------------

/**
 * Compute a privacy-safe token hash set from text content.
 * Each hash is a 12-hex-char sha256 prefix of a normalized token.
 * Raw content is never stored — only irreversible hashes.
 */
function tokenHashSet(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const raw = text.toLowerCase().match(/[a-z0-9_\-.\/+=@]{6,}/g) || [];
  const seen = new Set();
  const out = [];
  for (const tok of raw) {
    if (tok.length < TOKEN_MIN_LEN) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(crypto.createHash("sha256").update(tok).digest("hex").slice(0, 12));
    if (out.length >= MAX_TOKEN_HASHES) break;
  }
  return out;
}

/**
 * Compute a stable path hash for graph node storage (privacy-safe).
 * Normalizes separators + case so cross-OS lookups match.
 */
function pathHash(p) {
  if (typeof p !== "string" || p.length === 0) return null;
  const norm = p.replace(/\\/g, "/").replace(/^~\//, "/home/user/").toLowerCase();
  return "ph:" + crypto.createHash("sha256").update(norm).digest("hex").slice(0, 20);
}

/**
 * Check whether a file path is a known sensitive source location.
 */
function classifyPathSensitivity(p) {
  if (!p || typeof p !== "string") return "low";
  return SENSITIVE_PATH_PATTERNS.some((rx) => rx.test(p)) ? "high" : "low";
}

/**
 * Jaccard-like overlap between two token hash arrays.
 * Returns { score: number, sharedCount: number }.
 */
function overlapScore(aHashes, bHashes) {
  if (!Array.isArray(aHashes) || !Array.isArray(bHashes) ||
      aHashes.length === 0 || bHashes.length === 0) {
    return { score: 0, sharedCount: 0 };
  }
  const setA = new Set(aHashes);
  const setB = new Set(bHashes);
  let shared = 0;
  for (const h of setA) { if (setB.has(h)) shared++; }
  const union = setA.size + setB.size - shared;
  return { score: union > 0 ? shared / union : 0, sharedCount: shared };
}

function _hasOverlap(aHashes, bHashes) {
  const { score, sharedCount } = overlapScore(aHashes, bHashes);
  return sharedCount >= MIN_SHARED_COUNT && score >= OVERLAP_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Sink classification
// ---------------------------------------------------------------------------

function _isPrivateIP(host) {
  if (!host) return false;
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^127\./.test(host) || host === "::1" || host === "localhost") return true;
  return false;
}

function _isExemptTarget(target, command) {
  if (!target || typeof target !== "object") return true;
  if (target.isLoopback) return true;
  if (target.ipLiteral && _isPrivateIP(target.host)) return true;
  if (PKG_REGISTRY_HOSTS.has(target.host)) return true;
  if (command && PKG_MGR_PATTERN.test(command)) return true;
  return false;
}

function _extractFileRefs(command) {
  if (!command) return [];
  const refs = [];
  // @file syntax (curl -d @path, wget --post-file @path, etc.)
  const atRefs = command.match(/@([^\s"'&|;><,]+)/g) || [];
  for (const r of atRefs) {
    const p = r.slice(1);
    if (p && !/^https?:\/\//i.test(p)) refs.push(p);
  }
  // cat file | curl ...
  const catM = command.match(/\bcat\s+([^\s|&;><"'`\\]+)/);
  if (catM && catM[1]) refs.push(catM[1]);
  return refs;
}

function _extractExecTarget(command) {
  if (!command) return null;
  const m = command.match(EXEC_PATTERN);
  if (m && m[2]) return m[2];
  const sm = command.match(SOURCE_CMD_PATTERN);
  if (sm && sm[1]) return sm[1];
  return null;
}

/**
 * Classify the pending IR as a sink type.
 * Returns { kind: "network-send"|"file-exec"|"persistence-write"|null, ... }
 * Pure — no I/O.
 */
function classifySink(ir) {
  if (!ir || typeof ir !== "object") return { kind: null };

  // Persistence-write (highest priority — persistence even before network)
  if (ir.toolKind === "file-write" && Array.isArray(ir.fileTargets)) {
    for (const ft of ir.fileTargets) {
      if (ft && ft.intent === "write" && ft.path &&
          PERSISTENCE_PATTERNS.some((rx) => rx.test(ft.path))) {
        return { kind: "persistence-write", persistTarget: ft.path };
      }
    }
  }

  // File-exec via interpreter
  if (ir.toolKind === "shell") {
    const cmd = ir.command || "";
    const execTarget = _extractExecTarget(cmd);
    if (execTarget) return { kind: "file-exec", execTarget };
  }

  // Network-send to a non-exempt host
  if (Array.isArray(ir.networkTargets) && ir.networkTargets.length > 0) {
    const cmd = ir.command || "";
    const nonExempt = ir.networkTargets.filter((t) => !_isExemptTarget(t, cmd));
    if (nonExempt.length > 0) {
      return {
        kind: "network-send",
        host: nonExempt[0].host || null,
        taintedRefs: _extractFileRefs(cmd),
      };
    }
  }

  // Shell with curl/wget that has @file args even when network targets aren't parsed
  if (ir.toolKind === "shell") {
    const cmd = ir.command || "";
    if (/\b(curl|wget|nc|ncat|socat)\b/.test(cmd) && !PKG_MGR_PATTERN.test(cmd)) {
      const refs = _extractFileRefs(cmd);
      if (refs.length > 0) {
        return { kind: "network-send", host: null, taintedRefs: refs };
      }
    }
  }

  return { kind: null };
}

// ---------------------------------------------------------------------------
// Kill-chain evaluation (pure)
// ---------------------------------------------------------------------------

const _NONE = Object.freeze({
  detected: false, chainType: null, severity: "none",
  wouldAction: null, evidence: [], confidence: null, steps: [],
});

function _stepRef(node) {
  const ph = node.targetPathHash || node.pathHash || null;
  const ref = node.host
    ? `<host:${node.host}>`
    : ph ? `<file:${ph.slice(0, 16)}>` : "<unknown>";
  return {
    role:        node.role        || "source",
    class:       node.sourceClass || "unknown",
    redactedRef: ref,
  };
}

/**
 * Evaluate whether the pending IR + graph constitutes a kill chain.
 * Pure — no I/O.
 *
 * @param {object}   ir    - canonical Action IR
 * @param {Array}    graph - provenance graph nodes (from loadProvenanceGraph)
 * @param {object}   [ctx] - optional { writeContentTokenHashes: string[] }
 * @returns {{ detected, chainType, severity, wouldAction, evidence, confidence, steps }}
 */
function evaluate(ir, graph, ctx) {
  if (!ir || !Array.isArray(graph) || graph.length === 0) return _NONE;

  const sink = classifySink(ir);
  if (!sink.kind) return _NONE;

  const writeTokens = (ctx && Array.isArray(ctx.writeContentTokenHashes))
    ? ctx.writeContentTokenHashes : [];

  // ── staged-exfil ───────────────────────────────────────────────────────────
  if (sink.kind === "network-send") {
    const { taintedRefs = [], host } = sink;

    // Evidence arm 1: structural — @file arg matches a graph node (derivative or sensitive source)
    for (const ref of taintedRefs) {
      const ph = pathHash(ref);
      if (!ph) continue;
      for (const node of graph) {
        const hitTarget = node.targetPathHash && ph === node.targetPathHash;
        const hitSource = node.pathHash && ph === node.pathHash && node.sourceClass === "sensitive";
        if (hitTarget || hitSource) {
          return {
            detected: true, chainType: "staged-exfil", severity: "critical",
            wouldAction: "block",
            evidence: [`structural-ref:${ref.length > 48 ? ref.slice(0, 24) + "…" : ref}`],
            confidence: "structural",
            steps: [_stepRef(node)],
          };
        }
      }
    }

    // Evidence arm 2: content overlap — command tokens overlap a source node's token hashes
    const cmdTokens = tokenHashSet(ir.command || "");
    if (cmdTokens.length >= MIN_SHARED_COUNT) {
      for (const node of graph) {
        if (!Array.isArray(node.tokenHashes) || node.tokenHashes.length === 0) continue;
        if (_hasOverlap(cmdTokens, node.tokenHashes)) {
          return {
            detected: true, chainType: "staged-exfil", severity: "critical",
            wouldAction: "block",
            evidence: [`content-overlap:host=${host || "unknown"}`],
            confidence: "content-overlap",
            steps: [_stepRef(node)],
          };
        }
      }
    }

    return _NONE;
  }

  // ── injection-to-exec ──────────────────────────────────────────────────────
  if (sink.kind === "file-exec") {
    const { execTarget } = sink;
    if (!execTarget) return _NONE;
    const ph = pathHash(execTarget);
    if (!ph) return _NONE;
    for (const node of graph) {
      if (node.sourceClass !== "untrusted") continue;
      if (node.targetPathHash && ph === node.targetPathHash) {
        return {
          detected: true, chainType: "injection-to-exec", severity: "high",
          wouldAction: "escalate",
          evidence: [`exec-of-untrusted-write:${execTarget.length > 48 ? execTarget.slice(0, 24) + "…" : execTarget}`],
          confidence: "structural",
          steps: [_stepRef(node)],
        };
      }
    }
    return _NONE;
  }

  // ── persistence ────────────────────────────────────────────────────────────
  if (sink.kind === "persistence-write") {
    const { persistTarget } = sink;
    // Require content-overlap between what's being written and a recorded source
    const tokensToCheck = writeTokens.length >= MIN_SHARED_COUNT
      ? writeTokens
      : tokenHashSet(ir.command || "");
    if (tokensToCheck.length >= MIN_SHARED_COUNT) {
      for (const node of graph) {
        if (!Array.isArray(node.tokenHashes) || node.tokenHashes.length === 0) continue;
        if (_hasOverlap(tokensToCheck, node.tokenHashes)) {
          return {
            detected: true, chainType: "persistence", severity: "high",
            wouldAction: "escalate",
            evidence: [`tainted-persistence-write:${_redactPath(persistTarget)}`],
            confidence: "content-overlap",
            steps: [_stepRef(node)],
          };
        }
      }
    }
    return _NONE;
  }

  return _NONE;
}

/**
 * Check whether writing content (as token hashes) overlaps a graph source.
 * Returns the first matching source node or null.
 * Used by decide() to record write-propagation (tainted derivative) nodes.
 */
function findPropagationSource(writeTokenHashes, graph) {
  if (!Array.isArray(writeTokenHashes) || writeTokenHashes.length < MIN_SHARED_COUNT) return null;
  if (!Array.isArray(graph) || graph.length === 0) return null;
  for (const node of graph) {
    if (!Array.isArray(node.tokenHashes) || node.tokenHashes.length === 0) continue;
    if (_hasOverlap(writeTokenHashes, node.tokenHashes)) return node;
  }
  return null;
}

function _redactPath(p) {
  if (!p) return "<unknown-path>";
  const parts = p.replace(/\\/g, "/").split("/");
  const last = parts[parts.length - 1] || "";
  return parts.length > 2 ? `<…/${last}>` : last || "<path>";
}

module.exports = {
  PERSISTENCE_PATTERNS,
  tokenHashSet,
  pathHash,
  classifyPathSensitivity,
  overlapScore,
  classifySink,
  evaluate,
  findPropagationSource,
};
