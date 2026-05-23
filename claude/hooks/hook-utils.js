#!/usr/bin/env node
// hook-utils.js — shared utilities for all Lilara hooks.
//
// Usage in each hook:
//   const { readStdin, commandFrom, collectText, ENFORCE, hookLog } = require("./hook-utils");

"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const runtime    = require(path.join(__dirname, "..", "..", "runtime"));
const statePaths = require(path.join(__dirname, "..", "..", "runtime", "state-paths"));
const { extractCommand: _extractCommand } = require(path.join(__dirname, "..", "..", "runtime", "command-normalize"));

const MAX_STDIN_BYTES = 5 * 1024 * 1024; // 5 MB — prevent memory exhaustion on oversized payloads

/**
 * Read all of stdin into a string.
 * Rejects (and exits 0) if the payload exceeds MAX_STDIN_BYTES to avoid
 * unbounded memory consumption when the harness sends large file contents.
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > MAX_STDIN_BYTES) {
        // Payload too large — skip hook processing, let the tool call proceed.
        process.stdin.destroy();
        reject(new Error("stdin exceeds MAX_STDIN_BYTES — hook skipped"));
        return;
      }
      data += chunk;
    });

    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/**
 * Extract the shell command string from a PreToolUse Bash payload.
 *
 * Adapter-facing wrapper around runtime/command-normalize.extractCommand —
 * the engine module owns the ADR-007 §4.2 precedence ladder (command, cmd,
 * tool_input.command|cmd, input.command|cmd, args.command|cmd,
 * args.tool_input.command|cmd, args.input.command|cmd). Keeping the public
 * surface in hook-utils.js means existing adapters do not need to be edited.
 */
function commandFrom(input) {
  return String(_extractCommand(input) || "");
}

/**
 * Recursively collect all string values from a JSON structure.
 * Used to scan prompt text for secrets or dangerous patterns.
 */
function collectText(value, depth = 0) {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => collectText(item, depth + 1)).join("\n");
  if (typeof value === "object") {
    return Object.values(value).map((item) => collectText(item, depth + 1)).join("\n");
  }
  return "";
}

/**
 * Whether LILARA_ENFORCE=1 is set in the environment.
 * When true, hooks should exit with code 2 to block the tool call instead of just warning.
 */
const ENFORCE = process.env.LILARA_ENFORCE === "1";

/**
 * Append-only hook event log.
 * Only writes when LILARA_HOOK_LOG=1 is set.
 *
 * Records METADATA ONLY — never payload content, commands, file paths, or secrets.
 * Fields: iso timestamp, hook name, event type, detection label.
 *
 * Log location: ~/.lilara/hook-events.log
 *
 * @param {string} hookName   — e.g. "dangerous-command-gate"
 * @param {string} eventType  — e.g. "WARN" | "BLOCK" | "PASS" | "SKIP"
 * @param {string} label      — short description e.g. "rm-rf" or "anthropic-key"
 */
function hookLog(hookName, eventType, label) {
  if (process.env.LILARA_HOOK_LOG !== "1") return;

  try {
    const eccDir  = statePaths.hookStateDir();
    const logFile = path.join(eccDir, "hook-events.log");

    // Create directory if needed (0700 — private to user)
    if (!fs.existsSync(eccDir)) {
      fs.mkdirSync(eccDir, { recursive: true, mode: 0o700 });
    }

    const ts        = new Date().toISOString();
    const safeName  = String(hookName).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    const safeEvent = String(eventType).replace(/[^A-Z_]/g, "").slice(0, 16);
    const safeLabel = String(label).replace(/[^\w. -]/g, "").slice(0, 128);

    const record = { ts, hook: safeName, event: safeEvent, label: safeLabel };
    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(logFile, line, { mode: 0o600 });
  } catch (_) {
    // Logging must never crash a hook — silently ignore all errors.
  }
}

/**
 * File-based rate limiter for hooks.
 *
 * Problem: Claude Code can fire 1000+ Bash commands/minute during a session,
 * spawning 3000+ Node.js processes if all three PreToolUse hooks fire on every
 * command — each hook runs in its own process.
 *
 * Solution: token-bucket rate limiter backed by a small JSON file in
 * ~/.lilara/rate-<hookName>.json.
 *
 * The bucket refills at `refillRate` tokens per second; each call consumes one
 * token. If the bucket is empty the hook returns false immediately (caller
 * should echo stdin and exit 0 — let the tool call proceed without checking).
 *
 * Default: 60 tokens, refill 30/s — allows short bursts while capping sustained
 * load to ~30 hook invocations per second per hook type.
 *
 * Set LILARA_RATE_LIMIT=0 to disable rate limiting (e.g. in CI or tests).
 *
 * @param {string} hookName    — used as the bucket file key, e.g. "dangerous-command-gate"
 * @param {number} capacity    — maximum token count (default: 60)
 * @param {number} refillRate  — tokens added per second (default: 30)
 * @returns {boolean}          — true = proceed, false = skip this invocation
 */
function rateLimitCheck(hookName, capacity = 60, refillRate = 30) {
  if (process.env.LILARA_RATE_LIMIT === "0") return true;

  try {
    const eccDir    = statePaths.hookStateDir();
    const stateFile = path.join(eccDir, `rate-${hookName.replace(/[^a-z0-9-]/g, "")}.json`);
    const lockFile  = stateFile + ".lock";

    if (!fs.existsSync(eccDir)) {
      fs.mkdirSync(eccDir, { recursive: true, mode: 0o700 });
    }

    // O_EXCL lock: atomic creation ensures exactly one writer at a time.
    // Contention → deny (rate-limit). Stale lock (>2 s) → steal and proceed.
    // FS catastrophe → outer catch → fail-open (rate limiting is best-effort).
    let lockFd = null;
    try {
      lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    } catch (lockErr) {
      if (lockErr.code === "EEXIST") {
        try {
          const lstat = fs.statSync(lockFile);
          if (Date.now() - lstat.mtimeMs > 2000) {
            // Stale lock (> 2000 ms = worst-case PostToolUse handler runtime on Windows-fs) — steal it.
            fs.rmSync(lockFile, { force: true });
            lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
          } else {
            return false; // actively held — rate-limit this call
          }
        } catch {
          return false; // could not inspect or steal stale lock → deny
        }
      } else {
        throw lockErr; // other FS error → outer catch → fail-open
      }
    }

    fs.closeSync(lockFd);
    try {
      const now = Date.now() / 1000;
      let state = { tokens: capacity, lastRefill: now };
      try {
        state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      } catch {
        // First call — use fresh state.
      }

      const elapsed = Math.max(0, now - (state.lastRefill || now));
      state.tokens = Math.min(capacity, (state.tokens || 0) + elapsed * refillRate);
      state.lastRefill = now;

      // D41: atomic state write via tmp+rename — prevents partial reads under
      // concurrent writers (same guarantee as policy.json and accepted-contracts.json).
      const stateTmp = stateFile + ".tmp";

      if (state.tokens < 1) {
        fs.writeFileSync(stateTmp, JSON.stringify(state), { mode: 0o600 });
        fs.renameSync(stateTmp, stateFile);
        return false;
      }

      state.tokens -= 1;
      fs.writeFileSync(stateTmp, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(stateTmp, stateFile);
      return true;
    } finally {
      try { fs.unlinkSync(lockFile); } catch { /* best-effort */ }
    }
  } catch (_) {
    // FS catastrophe — allow the hook to proceed.
    return true;
  }
}

/**
 * In-process payload classification for command strings.
 * Returns 'C' (secret/PII), 'B' (sensitive operational), or 'A' (default).
 * Mirrors the tier logic of scripts/classify-payload.sh without spawning a shell.
 */
function classifyCommandPayload(command) {
  const text = String(command || "");
  if (
    /api[_-]?key\s*[=:]/i.test(text) ||
    /password\s*[=:]/i.test(text) ||
    /secret\s*[=:]/i.test(text) ||
    /auth[_-]?token\s*[=:]/i.test(text) ||
    /-----BEGIN\s+(RSA|EC|OPENSSH)?\s*PRIVATE/i.test(text) ||
    /AWS_SECRET_ACCESS_KEY/i.test(text) ||
    /GITHUB_TOKEN|GH_TOKEN/i.test(text) ||
    /customer\s+(data|pii|email|list)/i.test(text)
  ) {
    return "C";
  }
  if (
    /internal[_-]?(only|project|memo)/i.test(text) ||
    /private[_-]?repo/i.test(text) ||
    /security[_-]?incident/i.test(text) ||
    /non[_-]?public/i.test(text) ||
    /financial[_-]?(data|report)/i.test(text)
  ) {
    return "B";
  }
  return "A";
}

/**
 * Classify the sensitivity of a file path.
 * Returns 'high' | 'medium' | 'low'.
 * Advisory only — never used as the sole block criterion.
 *
 * High: SSH keys, cloud credentials, password stores, browser cookies,
 *       vault/secrets dirs, .env files with credentials, payment paths.
 * Medium: Generic config files, production/staging dirs, infra/k8s dirs,
 *         terraform state, .envrc, project-level .env.
 */
function classifyPathSensitivity(targetPath) {
  const p = String(targetPath || "").replace(/\\/g, "/");
  if (
    /\/\.ssh\b/.test(p) ||
    /\/\.aws\b/.test(p) ||
    /\/\.gnupg\b/.test(p) ||
    /\/\.config\/(gcloud|op|1password|bitwarden)\b/i.test(p) ||
    /\/\.password-store\b/.test(p) ||
    /\/\.kube\b/.test(p) ||
    /\/\.docker\/config\b/.test(p) ||
    /\/(vault|secrets?)\b/i.test(p) ||
    /\/(id_rsa|id_ed25519|id_ecdsa)\b/i.test(p) ||
    /\/(payments?|billing)\b/i.test(p) ||
    /\/private[-_]?key\b/i.test(p) ||
    /\/(Cookies|Login Data|Web Data)\b/.test(p)
  ) {
    return "high";
  }
  if (
    /\/\.env[^/]*$/.test(p) ||
    /\/\.envrc$/.test(p) ||
    /\/(prod(uction)?|staging|infra|terraform|k8s|kubernetes)\b/i.test(p) ||
    /\/(internal|confidential)\b/i.test(p) ||
    /\bconfig\.(json|yml|yaml|toml)$/.test(p)
  ) {
    return "medium";
  }
  return "low";
}

/**
 * Read rolling session risk score (0–3) from persistent session state.
 * Returns 0 on any read failure so the hook degrades gracefully.
 */
function readSessionRisk() {
  try {
    return runtime.getSessionRisk();
  } catch {
    return 0;
  }
}

function runtimeDecision(input) {
  return runtime.decide(input);
}

function runtimeContext(input) {
  return runtime.discover(input);
}

/**
 * loadManifest(harness) — read <harness>/manifest.json and project it into the
 * shape `runPreToolGate` consumes. Cached per process so repeated adapter
 * invocations do not re-read disk. Lilara ADR-007 PR-B publishes one manifest per
 * harness declaring envelopeReporting, args/cwd fidelity, mcp/skill
 * interception, and outputChannels. Missing manifest → null (gate falls back
 * to EMPTY_IR conservative defaults).
 */
const _MANIFEST_CACHE = Object.create(null);

function loadManifest(harness) {
  if (Object.prototype.hasOwnProperty.call(_MANIFEST_CACHE, harness)) {
    return _MANIFEST_CACHE[harness];
  }
  let result = null;
  try {
    const file = path.join(__dirname, "..", "..", harness, "manifest.json");
    const raw = fs.readFileSync(file, "utf8");
    const m = JSON.parse(raw);
    result = {
      harness: String(m.harness || harness),
      harnessVersion: typeof m.harnessVersion === "string" ? m.harnessVersion : null,
      envelopeReporting: Boolean(m.envelopeReporting),
      trustMeta: {
        envelopeReporting: Boolean(m.envelopeReporting),
        argsFidelity: typeof m.argsFidelity === "string" ? m.argsFidelity : "best-effort",
        cwdFidelity: typeof m.cwdFidelity === "string" ? m.cwdFidelity : "best-effort",
        mcpInterception: typeof m.mcpInterception === "string" ? m.mcpInterception : "unverified",
        skillInterception: typeof m.skillInterception === "string" ? m.skillInterception : "unverified",
      },
      outputChannels: m.outputChannels && typeof m.outputChannels === "object" ? m.outputChannels : {},
    };
  } catch { /* missing or malformed — leave as null, gate will use EMPTY_IR defaults */ }
  _MANIFEST_CACHE[harness] = result;
  return result;
}

/**
 * Shared adapter factory for all six harness adapters (claude, openclaw,
 * opencode, codex, clawcode, antegravity). Handles stdin read, rate-limit
 * guard, JSON parse, pretool-gate delegation, stderr output, and hookLog —
 * reducing each adapter to a single createAdapter() call.
 *
 * @param {object} opts
 * @param {string} opts.harness         — harness name passed to runPreToolGate
 * @param {string} opts.rateLimitKey    — key used for rate-limit bucket and hookLog
 * @param {function} opts.extractCommand — (input) → command string
 * @param {function} opts.extractCwd    — (input) → cwd string
 * @param {function} opts.extractTool   — (input) → tool name string
 * @param {boolean}  [opts.envelopeReporting=false] — adapter can report F15 execution envelopes
 * @param {function} [opts.extractTrustMeta] — (input) → manifest snapshot used by
 *   action-ir to populate trustMeta + outputChannels. Lilara ADR-007 PR-B; pass
 *   `() => loadManifest("<harness>")` for the standard manifest-backed adapter.
 */
function createAdapter({ harness, rateLimitKey, extractCommand, extractCwd, extractTool, envelopeReporting = false, extractTrustMeta = null, harnessOutput = "echo" }) {
  const { runPreToolGate } = require(path.join(__dirname, "..", "..", "runtime", "pretool-gate"));
  readStdin()
    .then((raw) => {
      if (!rateLimitCheck(rateLimitKey)) {
        if (harnessOutput === "permission-json") process.stdout.write("{}");
        else process.stdout.write(raw);
        return;
      }
      let input = {};
      try { input = JSON.parse(raw || "{}"); } catch { /* malformed — proceed with empty */ }
      let manifest = null;
      if (typeof extractTrustMeta === "function") {
        try { manifest = extractTrustMeta(input); } catch { manifest = null; }
      }
      const { exitCode, stderrLines, logAction, logHitName } = runPreToolGate({
        harness,
        tool:           extractTool(input),
        command:        extractCommand(input),
        cwd:            extractCwd(input),
        rawInput:       input,
        sessionRisk:    readSessionRisk(),
        envelopeReporting,
        trustMeta:      manifest && manifest.trustMeta      ? manifest.trustMeta      : null,
        outputChannels: manifest && manifest.outputChannels ? manifest.outputChannels : null,
        harnessVersion: manifest && manifest.harnessVersion ? manifest.harnessVersion : null,
      });
      for (const line of stderrLines) process.stderr.write(line + "\n");
      if (logAction && logHitName) {
        try { hookLog(rateLimitKey, logAction, logHitName); } catch { /* non-fatal */ }
      }
      // Two adapter output protocols are supported:
      //   "echo" (default): stdout = raw stdin, exit 2 = block. Used by harnesses
      //     that read the exit code: Claude Code, OpenCode, OpenClaw, Codex,
      //     Antegravity.
      //   "permission-json": stdout = `{}` (allow) or
      //     `{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"..."}}`
      //     (block). Used by ClawCode, which parses stdout JSON for the decision
      //     and ignores the exit code. Verified against clawcode/plugin/hooks.py
      //     lines 38-51 (decision extraction) and 252-280 (subprocess invocation).
      //     Exit 2 is still emitted on block for cross-harness consistency.
      if (harnessOutput === "permission-json") {
        if (exitCode !== 0) {
          const reasonLine = stderrLines.find((l) => /Reason:/.test(l))
            || stderrLines.find((l) => /BLOCKED/.test(l))
            || stderrLines[0]
            || "Blocked by Agent Runtime Guard";
          const reason = String(reasonLine).replace(/^\[Agent Runtime Guard\]\s*/, "").slice(0, 500);
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              permissionDecision: "deny",
              permissionDecisionReason: reason,
            },
          }));
        } else {
          process.stdout.write("{}");
        }
      } else {
        process.stdout.write(raw);
      }
      if (exitCode !== 0) process.exit(exitCode);
    })
    .catch(() => process.exit(0));
}

module.exports = { readStdin, commandFrom, collectText, ENFORCE, hookLog, rateLimitCheck, MAX_STDIN_BYTES, runtimeDecision, runtimeContext, classifyCommandPayload, readSessionRisk, classifyPathSensitivity, createAdapter, loadManifest };
