#!/usr/bin/env node
"use strict";

// contract.js — Upfront security contract enforcement for Agent Runtime Guard.
//
// Implements the contract lifecycle defined in the v2.0 plan (Section 4):
//   - load()        — read + validate horus.contract.json for the current project
//   - verify()      — recompute contractHash and compare to accepted-contracts.json
//   - scopeMatch()  — check a decision input against contract scopes
//   - generate()    — write horus.contract.json.draft (used by horus-cli contract init)
//   - accept()      — finalise a draft → horus.contract.json + accepted-contracts record
//   - contractId()  — generate a fresh contract ID (zero-dep, no ULID library)
//
// Hard floors (Section 4.5) are enforced in decision-engine.js, not here.
// Zero external dependencies.

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const os     = require("os");

const { canonicalJson }    = require("./canonical-json");
const { validateContract } = require("./config-validator");
const { globMatch }        = require("./glob-match");
const { classifyCommand }  = require("./decision-key");
const { extractPaths }     = require("./arg-extractor");
const { stateDir }         = require("./state-paths");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function contractFilePath(projectRoot) {
  return path.join(String(projectRoot || process.cwd()), "horus.contract.json");
}

function draftFilePath(projectRoot) {
  return path.join(String(projectRoot || process.cwd()), "horus.contract.json.draft");
}

function acceptedContractsPath() {
  return path.join(stateDir(), "accepted-contracts.json");
}

// ---------------------------------------------------------------------------
// Contract ID generation (no ULID library)
// ---------------------------------------------------------------------------

function newContractId() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand  = crypto.randomBytes(6).toString("hex");
  return `hap-${today}-${rand}`;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function hashContract(doc) {
  const { contractHash: _omit, ...rest } = doc; // eslint-disable-line no-unused-vars
  const canon = canonicalJson(rest);
  return "sha256:" + crypto.createHash("sha256").update(canon, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Load + validate
// ---------------------------------------------------------------------------

let _cache = null;
let _cacheKey = null;

/**
 * Load and validate horus.contract.json for the given project root.
 * Returns null if no contract file exists.
 * Throws if the file exists but fails schema validation.
 *
 * @param {string} projectRoot
 * @returns {object|null}
 */
function load(projectRoot) {
  const filePath = contractFilePath(projectRoot);
  const cacheKey = filePath;
  if (_cache !== null && _cacheKey === cacheKey) return _cache;

  if (!fs.existsSync(filePath)) {
    _cache = null;
    _cacheKey = cacheKey;
    return null;
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`contract.js: failed to parse ${filePath}: ${err.message}`);
  }

  const { valid, errors } = validateContract(doc);
  if (!valid) {
    throw new Error(`contract.js: schema validation failed:\n  ${errors.join("\n  ")}`);
  }

  _cache = doc;
  _cacheKey = cacheKey;
  return doc;
}

/** Invalidate the module-level cache (used in tests). */
function invalidateCache() {
  _cache = null;
  _cacheKey = null;
}

// ---------------------------------------------------------------------------
// Accepted-contracts registry
// ---------------------------------------------------------------------------

function loadAccepted() {
  const filePath = acceptedContractsPath();
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function saveAccepted(data) {
  const filePath = acceptedContractsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  try { fs.renameSync(tmp, filePath); } catch {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// Verify — recompute hash and compare to accepted registry
// ---------------------------------------------------------------------------

/**
 * Verify the contract hash for the given project root.
 *
 * @param {string} projectRoot
 * @returns {{ ok: boolean, reason?: string, contractId?: string }}
 */
function verify(projectRoot) {
  const doc = load(projectRoot);
  if (!doc) return { ok: false, reason: "no-contract-file" };

  const computed = hashContract(doc);
  if (computed !== doc.contractHash) {
    return { ok: false, reason: "hash-mismatch", contractId: doc.contractId };
  }

  const accepted = loadAccepted();
  const key = path.resolve(String(projectRoot || process.cwd()));
  const record = accepted[key];

  if (!record) {
    return { ok: false, reason: "not-accepted", contractId: doc.contractId };
  }
  if (record.contractHash !== doc.contractHash) {
    return { ok: false, reason: "accepted-hash-mismatch", contractId: doc.contractId };
  }

  return { ok: true, contractId: doc.contractId };
}

// ---------------------------------------------------------------------------
// Accept — finalise a draft into horus.contract.json
// ---------------------------------------------------------------------------

/**
 * Accept horus.contract.json.draft:
 *   1. Validate schema.
 *   2. Reject revision downgrade.
 *   3. Compute and embed contractHash.
 *   4. Write horus.contract.json.
 *   5. Record in accepted-contracts.json.
 *
 * @param {string} projectRoot
 * @returns {{ contractId: string, contractHash: string }}
 */
// ---------------------------------------------------------------------------
// Operator-token support (B3/Q2: positive operator signal for accept())
// ---------------------------------------------------------------------------

function operatorTokensPath() {
  return path.join(stateDir(), "operator-tokens.jsonl");
}

/**
 * Mint a one-shot 32-byte hex operator token.
 * Appends to ~/.horus/operator-tokens.jsonl (mode 0600) and returns the token.
 *
 * @param {string} [label] — optional human label for audit trail
 * @returns {string} 64-character hex token
 */
function mintOperatorToken(label) {
  const token  = crypto.randomBytes(32).toString("hex");
  const tokensPath = operatorTokensPath();
  const dir    = path.dirname(tokensPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const record = JSON.stringify({
    token,
    label: label || null,
    createdAt: new Date().toISOString(),
    usedAt: null,
  });
  fs.appendFileSync(tokensPath, record + "\n", { mode: 0o600 });
  return token;
}

/**
 * Consume a one-shot operator token.
 * Marks the first matching unused token as consumed (one-shot semantics).
 *
 * @param {string} token
 * @returns {boolean} true if consumed; false if invalid or already used
 */
function consumeOperatorToken(token) {
  if (!token) return false;
  const tokensPath = operatorTokensPath();
  const lockFile = tokensPath + ".lock";
  const dir = path.dirname(tokensPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  // O_EXCL lock: prevents concurrent consume() calls from racing on the JSONL store.
  // Contention on a fresh lock (< 2000 ms old) → return false (deny second consumer).
  // Stale lock (> 2000 ms, from a crashed process) → steal and proceed.
  let lockFd = null;
  try {
    lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  } catch (lockErr) {
    if (lockErr.code === "EEXIST") {
      try {
        const lstat = fs.statSync(lockFile);
        if (Date.now() - lstat.mtimeMs > 2000) {
          fs.rmSync(lockFile, { force: true });
          lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
        } else {
          return false; // lock actively held — deny concurrent consumer
        }
      } catch { return false; }
    } else { return false; }
  }
  fs.closeSync(lockFd);

  try {
    let lines;
    try {
      lines = fs.readFileSync(tokensPath, "utf8").split("\n").filter(Boolean);
    } catch { return false; }

    let consumed = false;
    const updated = lines.map((line) => {
      try {
        const rec = JSON.parse(line);
        if (rec.token === token && !rec.usedAt) {
          consumed = true;
          return JSON.stringify({ ...rec, usedAt: new Date().toISOString() });
        }
      } catch { /* skip malformed lines */ }
      return line;
    });

    if (!consumed) return false;

    const tmp = tokensPath + ".tmp";
    fs.writeFileSync(tmp, updated.join("\n") + "\n", { mode: 0o600 });
    // D43: drop rename-fallback — a failed rename means the store is intact;
    // returning false keeps accept() fail-closed rather than risking a partial write.
    try { fs.renameSync(tmp, tokensPath); } catch { return false; }
    return true;
  } finally {
    try { fs.unlinkSync(lockFile); } catch { /* best-effort */ }
  }
}

/**
 * Require a positive operator signal before accepting a contract.
 * (B3/Q2 fix: replaces the harness env-var allowlist — defense by absence.)
 *
 * Passes when: (a) stdin is a TTY (operator at interactive terminal), or
 *              (b) HORUS_OPERATOR_TOKEN matches a valid one-shot token.
 *
 * @throws {Error} if neither condition is satisfied
 */
function _checkOperatorSignal() {
  // (a) Interactive terminal — operator is physically present
  if (process.stdin.isTTY) return;

  // (b) One-shot operator token — pre-issued by an operator for scripted acceptance
  const token = process.env.HORUS_OPERATOR_TOKEN || "";
  if (token) {
    if (consumeOperatorToken(token)) return;
    throw new Error(
      "contract.js: HORUS_OPERATOR_TOKEN is invalid or already consumed. " +
      "Run 'horus-cli operator-token mint' to generate a fresh one-shot token."
    );
  }

  throw new Error(
    "contract.js: refusing to accept a contract outside an interactive terminal. " +
    "Run 'horus-cli contract accept' in an interactive terminal (stdin is a TTY), or " +
    "pre-issue a one-shot token with 'horus-cli operator-token mint' and pass it via " +
    "HORUS_OPERATOR_TOKEN."
  );
}

function accept(projectRoot) {
  // B3/Q2: require a positive operator signal — either stdin is a TTY or a
  // one-shot operator token is presented. Drops the previous env-var allowlist
  // (defense by absence: novel harnesses whose env var wasn't listed bypassed it).
  _checkOperatorSignal();

  const draftPath    = draftFilePath(projectRoot);
  const contractPath = contractFilePath(projectRoot);

  if (!fs.existsSync(draftPath)) {
    throw new Error(`contract.js: no draft found at ${draftPath}. Run 'horus-cli contract init' first.`);
  }

  let draft;
  try {
    draft = JSON.parse(fs.readFileSync(draftPath, "utf8"));
  } catch (err) {
    throw new Error(`contract.js: failed to parse draft: ${err.message}`);
  }

  // Reject revision downgrade
  if (fs.existsSync(contractPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(contractPath, "utf8"));
      if (typeof existing.revision === "number" && draft.revision <= existing.revision) {
        throw new Error(`contract.js: revision downgrade rejected (existing=${existing.revision}, draft=${draft.revision}). Bump revision in the draft.`);
      }
    } catch (err) {
      if (err.message.includes("revision downgrade")) throw err;
      // existing file unreadable — proceed
    }
  }

  // Strip any existing hash before recomputing
  delete draft.contractHash;
  draft.contractHash = hashContract(draft);

  // Validate final document
  const { valid, errors } = validateContract(draft);
  if (!valid) {
    throw new Error(`contract.js: draft schema validation failed:\n  ${errors.join("\n  ")}`);
  }

  // Write final contract
  invalidateCache();
  fs.writeFileSync(contractPath, JSON.stringify(draft, null, 2) + "\n", { mode: 0o600 });

  // Record acceptance
  const accepted = loadAccepted();
  const key = path.resolve(String(projectRoot || process.cwd()));
  accepted[key] = {
    contractHash: draft.contractHash,
    contractId:   draft.contractId,
    revision:     draft.revision,
    acceptedAt:   new Date().toISOString(),
  };
  saveAccepted(accepted);

  // Remove draft
  try { fs.unlinkSync(draftPath); } catch { /* best-effort */ }

  return { contractId: draft.contractId, contractHash: draft.contractHash };
}

// ---------------------------------------------------------------------------
// Generate (init) — write a sensible default draft
// ---------------------------------------------------------------------------

/**
 * Write horus.contract.json.draft with sensible defaults.
 *
 * @param {string} projectRoot
 * @param {object} opts — { harnesses?, trustPosture?, existingRevision? }
 */
function generate(projectRoot, opts = {}) {
  const harnesses     = Array.isArray(opts.harnesses)  ? opts.harnesses  : ["claude"];
  const trustPosture  = opts.trustPosture || "balanced";
  const revision      = Number(opts.existingRevision || 0) + 1;
  const draftPath     = draftFilePath(projectRoot);
  const projRootNorm  = String(projectRoot || process.cwd()).replace(/\\/g, "/");

  const draft = {
    version:      1,
    contractId:   newContractId(),
    revision,
    acceptedAt:   new Date().toISOString(),
    acceptedBy:   os.userInfo().username || "unknown",
    expiresAt:    null,
    harnessScope: harnesses,
    trustPosture,
    scopes: {
      filesystem: {
        readAllow:        [`${projRootNorm}/**`],
        writeAllow:       [`${projRootNorm}/src/**`, `${projRootNorm}/tests/**`],
        writeDeny:        ["**/.env*", "**/*.pem", "**/secrets/**"],
        destructiveAllow: [],
      },
      network: {
        outboundAllow:   [],
        outboundDeny:    ["*"],
        remoteExecAllow: [],
      },
      secrets: {
        scanMode:        "block",
        redactInJournal: true,
      },
      elevation: {
        sudoAllow:         false,
        sudoAllowCommands: [],
      },
      branches: {
        protected:      ["main", "master", "release/*"],
        pushAllow:      ["feature/*", "fix/*"],
        forcePushAllow: [],
      },
      shell: {
        toolAllow:          [],
        toolDeny:           ["curl", "wget", "nc"],
        globalInstallAllow: false,
      },
      payloadClasses: { A: "allow", B: "warn", C: "block" },
    },
    contractHash: "sha256:" + "0".repeat(64), // placeholder, recomputed on accept
  };

  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2) + "\n", { mode: 0o600 });
  return draftPath;
}

// ---------------------------------------------------------------------------
// scopeMatch — check whether a decision input is covered by the contract
// ---------------------------------------------------------------------------

// Gated capability classes (Section 4.5a): require contract coverage in strict mode
const GATED_CLASSES = new Set([
  "destructive-delete", "force-push", "remote-exec", "auto-download",
  "hard-reset", "destructive-db", "disk-write", "sudo", "global-pkg-install",
  "network-outbound", "unknown",
]);

/**
 * Determine whether the contract allows or gates a given decision input.
 *
 * @param {object} contract  — loaded contract document
 * @param {object} input     — { command, commandClass, targetPath, branch, payloadClass, harness, projectRoot }
 * @returns {{ allowed: boolean, reason: string, gated: boolean }}
 */
function scopeMatch(contract, input) {
  if (!contract) return { allowed: false, reason: "no-contract", gated: true };

  const cmdClass = input.commandClass || classifyCommand(input.command || "");
  const ctx      = { projectRoot: input.projectRoot || "" };
  const scopes   = contract.scopes || {};
  const isGated  = GATED_CLASSES.has(cmdClass);

  // Payload class check
  const payloadClass = String(input.payloadClass || "A").toUpperCase();
  const pcAction = scopes.payloadClasses?.[payloadClass] || "allow";
  if (pcAction === "block") return { allowed: false, reason: `payload-class-${payloadClass}-blocked`, gated: true };

  // Secret class C — always block regardless of scope (hard floor complement)
  if (payloadClass === "C") return { allowed: false, reason: "payload-class-C", gated: true };

  // B2 commit 3: scopes.tools.perToolAllow — per-tool command + path allowlists.
  // Checked before class-specific gates so an explicit per-tool match wins.
  const perToolAllow = scopes.tools?.perToolAllow || [];
  if (perToolAllow.length > 0 && input.tool) {
    const toolName = String(input.tool);
    const cmdStr   = String(input.command || "");
    const pathStr  = String(input.targetPath || "");
    for (const entry of perToolAllow) {
      if (!entry || entry.tool !== toolName) continue;
      const cmdGlobs  = Array.isArray(entry.commandGlobs) ? entry.commandGlobs : null;
      const pathGlobs = Array.isArray(entry.pathGlobs)    ? entry.pathGlobs    : null;
      const cmdOk  = !cmdGlobs  || cmdGlobs.length  === 0 || cmdGlobs.some((p)  => globMatch(cmdStr,  p, ctx));
      const pathOk = !pathGlobs || pathGlobs.length === 0 || pathGlobs.some((p) => globMatch(pathStr, p, ctx));
      if (cmdOk && pathOk) {
        return { allowed: true, reason: "tool-allow-tool-scope", gated: true };
      }
    }
  }

  // Destructive-delete with multi-target all-or-nothing allowlist.
  // Extracts all path-like targets from the command; every target must match
  // an allow entry. Symlink / ".." escape is rejected after path resolution.
  if (cmdClass === "destructive-delete") {
    const allowed_list = scopes.filesystem?.destructiveAllow || [];
    if (allowed_list.length === 0) {
      return { allowed: false, reason: "destructive-delete-not-in-scope", gated: true };
    }

    // Extract path-like tokens; fall back to input.targetPath for bare relative paths.
    const rawPaths  = extractPaths(input.command || "");
    const candidates = rawPaths.length > 0 ? rawPaths : [String(input.targetPath || "")];
    const projRoot   = String(input.projectRoot || ctx.projectRoot || process.cwd());

    // Resolve and validate each target. Fail closed on any escape attempt.
    const resolvedPaths = [];
    for (const raw of candidates) {
      if (!raw) continue;
      const abs = path.resolve(projRoot, raw);
      const rel = path.relative(projRoot, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return { allowed: false, reason: "destructive-delete-path-escape", gated: true };
      }
      // Resolve symlinks. If path doesn't exist yet, use abs (no symlink to follow).
      let real = abs;
      try {
        real = fs.realpathSync(abs);
        const realRel = path.relative(projRoot, real);
        if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
          return { allowed: false, reason: "destructive-delete-symlink-escape", gated: true };
        }
      } catch { /* nonexistent path — no symlink possible, use abs */ }
      resolvedPaths.push(real);
    }

    if (resolvedPaths.length === 0) {
      return { allowed: false, reason: "destructive-delete-no-targets", gated: true };
    }

    // All-or-nothing: every resolved target must match at least one allow entry.
    for (const rp of resolvedPaths) {
      const ok = allowed_list.some(
        (entry) => entry.commandClass === "destructive-delete" &&
          globMatch(rp, entry.pathGlob, ctx)
      );
      if (!ok) return { allowed: false, reason: "destructive-delete-path-not-in-scope", gated: true };
    }
    return { allowed: true, reason: "destructive-allow-matched", gated: true };
  }

  // Force-push
  if (cmdClass === "force-push") {
    const branch        = String(input.branch || "");
    const forcePushAllow = scopes.branches?.forcePushAllow || [];
    const ok = forcePushAllow.some((pat) => globMatch(branch, pat, ctx));
    if (!ok) return { allowed: false, reason: "force-push-not-in-scope", gated: true };
    return { allowed: true, reason: "force-push-branch-allowed", gated: true };
  }

  // Shell tool-allow: explicit per-tool pre-approval for high-risk-non-destructive commands.
  // Checked after destructive-delete and force-push (those keep their own safety checks)
  // but before remote-exec/sudo/global-install/auto-download so a named pre-approval can
  // demote escalate→allow for commands like "npx -y", "curl | bash", "npm install -g". (W11)
  const toolAllow = scopes.shell?.toolAllow || [];
  if (toolAllow.length > 0) {
    const cmd = String(input.command || "").trim();
    const matched = toolAllow.some((pattern) => {
      const p = String(pattern).trim();
      return cmd === p || cmd.startsWith(p + " ") || cmd.startsWith(p + "\t");
    });
    if (matched) return { allowed: true, reason: "tool-allow-matched", gated: true };
  }

  // Remote exec
  if (cmdClass === "remote-exec") {
    const remoteExecAllow = scopes.network?.remoteExecAllow || [];
    if (remoteExecAllow.length === 0) {
      return { allowed: false, reason: "remote-exec-not-in-scope", gated: true };
    }
    return { allowed: true, reason: "remote-exec-allowed", gated: true };
  }

  // Sudo
  if (cmdClass === "sudo") {
    const sudoAllow    = scopes.elevation?.sudoAllow === true;
    const allowedCmds  = scopes.elevation?.sudoAllowCommands || [];
    const cmd          = String(input.command || "");
    const cmdOk = sudoAllow || allowedCmds.some((c) => cmd.includes(c));
    if (!cmdOk) return { allowed: false, reason: "sudo-not-in-scope", gated: true };
    return { allowed: true, reason: "sudo-allowed", gated: true };
  }

  // Global package install
  if (cmdClass === "global-pkg-install") {
    if (!scopes.shell?.globalInstallAllow) {
      return { allowed: false, reason: "global-install-not-in-scope", gated: true };
    }
    return { allowed: true, reason: "global-install-allowed", gated: true };
  }

  // Auto-download (npx -y) — allowed only when remoteExecAllow is non-empty
  if (cmdClass === "auto-download") {
    const remoteExecAllow = scopes.network?.remoteExecAllow || [];
    if (remoteExecAllow.length === 0) {
      return { allowed: false, reason: "auto-download-not-in-scope", gated: true };
    }
    return { allowed: true, reason: "auto-download-remote-exec-allowed", gated: true };
  }

  // Hard-reset / destructive-db / disk-write — covered by destructiveAllow by commandClass.
  // No path resolution needed for hard-reset (git ref target) or destructive-db (DB operation);
  // disk-write could have a device target but class-level allow is the correct granularity here.
  if (cmdClass === "hard-reset" || cmdClass === "destructive-db" || cmdClass === "disk-write") {
    const allowed_list = scopes.filesystem?.destructiveAllow || [];
    const ok = allowed_list.some((entry) => entry.commandClass === cmdClass);
    if (!ok) return { allowed: false, reason: `${cmdClass}-not-in-scope`, gated: true };
    return { allowed: true, reason: `${cmdClass}-allow-matched`, gated: true };
  }

  // Non-gated classes — not covered by scope, not gated either
  if (!isGated) return { allowed: true, reason: "non-gated-class", gated: false };

  // Fallback for other gated classes
  return { allowed: false, reason: `gated-class-${cmdClass}-no-coverage`, gated: true };
}

// ---------------------------------------------------------------------------
// Harness scope check
// ---------------------------------------------------------------------------

/**
 * Check whether the given harness is covered by the contract.
 * @param {object} contract
 * @param {string} harness
 * @returns {boolean}
 */
function harnessInScope(contract, harness) {
  if (!contract) return false;
  return Array.isArray(contract.harnessScope) && contract.harnessScope.includes(harness);
}

// ---------------------------------------------------------------------------
// v2 validity helpers — active-hours and active-days window checks
// ---------------------------------------------------------------------------

function getValidity(contract) {
  if (!contract || typeof contract !== "object") return null;
  return contract.validity || null;
}

const _DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Check whether the current time falls within the contract's validity window.
 * @param {object} contract
 * @param {Date}   [now]  defaults to new Date() — UTC-aware
 * @returns {{ inWindow: boolean, reason: string }}
 */
function isInActiveWindow(contract, now = new Date()) {
  const validity = getValidity(contract);
  if (!validity) return { inWindow: true, reason: "no-validity-block" };

  const utc    = new Date(now.getTime());
  const dayName = _DAY_NAMES[utc.getUTCDay()];

  if (Array.isArray(validity.activeDays) && validity.activeDays.length > 0) {
    if (!validity.activeDays.includes(dayName)) {
      return { inWindow: false, reason: `day-${dayName}-not-in-activeDays` };
    }
  }

  const win = validity.activeHoursUtc;
  if (win && typeof win.start === "string" && typeof win.end === "string") {
    const [sh, sm] = win.start.split(":").map(Number);
    const [eh, em] = win.end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin   = eh * 60 + em;
    const nowMin   = utc.getUTCHours() * 60 + utc.getUTCMinutes();
    const inWindow = startMin <= endMin
      ? (nowMin >= startMin && nowMin <= endMin)
      : (nowMin >= startMin || nowMin <= endMin); // crosses midnight
    if (!inWindow) {
      return { inWindow: false, reason: `time-${win.start}-${win.end}-utc-not-active` };
    }
  }

  return { inWindow: true, reason: "in-window" };
}

// ---------------------------------------------------------------------------
// v2 contextTrust helper — per-branch trust posture override
// ---------------------------------------------------------------------------

/**
 * Return the first matching contextTrust entry's trustPosture for the given branch,
 * or null if no entry matches. First-match-wins per schema description.
 * @param {object} contract
 * @param {string} branch
 * @returns {string|null}
 */
function getContextTrust(contract, branch) {
  if (!contract || !branch) return null;
  const list = Array.isArray(contract.contextTrust) ? contract.contextTrust : null;
  if (!list || list.length === 0) return null;
  const { globMatch } = require("./glob-match");
  for (const entry of list) {
    if (!entry || typeof entry.branchPattern !== "string") continue;
    if (globMatch(branch, entry.branchPattern, {})) {
      const p = String(entry.trustPosture || "").trim();
      if (p === "strict" || p === "balanced" || p === "relaxed") return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// v3 helpers: scopes.mcp + scopes.skills
// ---------------------------------------------------------------------------

function getMcpPolicy(contract, serverName) {
  if (!contract || !serverName) return null;
  const map = contract.scopes && contract.scopes.mcp;
  if (!map || typeof map !== "object") return null;
  const entry = map[serverName];
  if (!entry || typeof entry.policy !== "string") return null;
  const p = entry.policy;
  return (p === "allow" || p === "warn" || p === "block") ? p : null;
}

function getSkillPolicy(contract, skillName) {
  if (!contract || !skillName) return null;
  const map = contract.scopes && contract.scopes.skills;
  if (!map || typeof map !== "object") return null;
  const entry = map[skillName];
  if (!entry || typeof entry.policy !== "string") return null;
  const p = entry.policy;
  return (p === "allow" || p === "warn" || p === "block") ? p : null;
}

function extractMcpServerName(toolName) {
  if (!toolName || typeof toolName !== "string") return null;
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(toolName);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// v3 helpers: scopes.session + scopes.budget
// ---------------------------------------------------------------------------

function getSessionConstraints(contract) {
  if (!contract || !contract.scopes || !contract.scopes.session) return null;
  return contract.scopes.session;
}

function getBudgetLimits(contract) {
  if (!contract || !contract.scopes || !contract.scopes.budget) return null;
  return contract.scopes.budget;
}

module.exports = {
  load,
  verify,
  accept,
  generate,
  scopeMatch,
  harnessInScope,
  hashContract,
  newContractId,
  invalidateCache,
  GATED_CLASSES,
  contractFilePath,
  draftFilePath,
  acceptedContractsPath,
  operatorTokensPath,
  mintOperatorToken,
  consumeOperatorToken,
  getValidity,
  isInActiveWindow,
  getContextTrust,
  getMcpPolicy,
  getSkillPolicy,
  extractMcpServerName,
  getSessionConstraints,
  getBudgetLimits,
};
