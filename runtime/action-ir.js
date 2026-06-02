#!/usr/bin/env node
"use strict";

// action-ir.js — Canonical Action IR (Lilara ADR-007 PR-A skeleton + PR-B builders).
//
// The Canonical Action IR is the single normalized shape that every adapter
// produces before floors run (scope §4.1 invariant 9). Floors then read the
// IR instead of harness-specific raw payloads.
//
// PR-A (already shipped): module shape + helpers, no adapter wiring.
// PR-B (this PR): build() now extracts commandTokens, commandClass, fileTargets,
// networkTargets, payloadClass, mcpServer, destructive, writeIntent, and
// computes irHash automatically. pretool-gate calls build() on every gate
// invocation; the result is byte-identical across the 6 adapters for the same
// logical action (modulo harness/tool/manifest fields).
//
// Pure functions. Zero I/O. Zero external dependencies (Node builtins + local
// runtime/* only).

const crypto = require("crypto");
const path = require("path");
const { canonicalJson } = require("./canonical-json");
const { extractArgs, extractPaths } = require("./arg-extractor");
const { classifyCommandDual } = require("./decision-key");

// secret-scan is optional — fixtures rename it to *.disabled-test-bak to verify
// fail-open. Cached as null when absent; payloadClass falls back to inline
// classification only.
let _scanSecrets = null;
try { _scanSecrets = require("./secret-scan").scanSecrets; } catch { /* optional */ }

const IR_VERSION = "1";

// Allowed values per IR field — PR-B keeps them small + conservative.
const KNOWN_HARNESSES = Object.freeze([
  "claude",
  "opencode",
  "openclaw",
  "codex",
  "clawcode",
  "antegravity",
]);

const KNOWN_TOOL_KINDS = Object.freeze([
  "shell",
  "file-read",
  "file-write",
  "network",
  "mcp",
  "skill",
  "final-message",
  "unknown",
]);

const KNOWN_ARGS_FIDELITY = Object.freeze(["exact", "best-effort", "opaque"]);
const KNOWN_CWD_FIDELITY = Object.freeze(["exact", "best-effort", "opaque"]);
const KNOWN_INTERCEPTION = Object.freeze(["supported", "unsupported", "unverified"]);
const KNOWN_OUTPUT_CHANNEL_STATE = Object.freeze(["intercept", "observe", "none"]);
const KNOWN_PAYLOAD_CLASS = Object.freeze(["A", "B", "C"]);

// commandClass values that imply destructive write semantics. Mirrors the
// destructive set decision-engine.js keys off; centralized here so floors can
// reason about destructiveness via IR rather than re-classifying the command.
const DESTRUCTIVE_CLASSES = new Set([
  "destructive-delete",
  "force-push",
  "hard-reset",
  "destructive-db",
  "disk-write",
]);

// commandClass values that imply write intent (broader than destructive — also
// covers package installs, remote exec, sudo elevation).
const WRITE_INTENT_CLASSES = new Set([
  "destructive-delete",
  "force-push",
  "hard-reset",
  "destructive-db",
  "disk-write",
  "global-pkg-install",
  "remote-exec",
  "auto-download",
  "sudo",
]);

// Frozen empty IR — used as the default skeleton + the reference shape that
// `validate()` checks against. Every field present (null/empty allowed) so
// downstream consumers never have to defend against missing keys.
const EMPTY_IR = Object.freeze({
  // 1. Identity / actor
  irVersion: IR_VERSION,
  harness: null,
  harnessVersion: null,
  sessionId: null,
  toolUseId: null,
  agentIdentity: null,
  ts: null,

  // 2. Context
  cwd: null,
  projectRoot: null,
  branch: null,
  envDelta: Object.freeze({}),

  // 3. Action
  tool: null,
  toolKind: "unknown",
  command: "",
  commandTokens: Object.freeze([]),
  commandClass: "unknown",
  argv0: null,

  // 4. Targets
  fileTargets: Object.freeze([]),
  networkTargets: Object.freeze([]),
  mcpServer: null,
  skillName: null,

  // 5. Intent
  writeIntent: false,
  destructive: false,
  payloadClass: "A",

  // 6. Output channels (all default "none" until manifest layer lands in PR-B)
  outputChannels: Object.freeze({
    toolOutput: "none",
    generatedFiles: "none",
    commitText: "none",
    prText: "none",
    finalMessage: "none",
    terminal: "none",
    screenshots: "none",
  }),

  // 6a. F19 (ADR-010) additive output records. Both arrays are zero-length
  // until adapters or callers populate them:
  //   - outputs[]         — PostToolUse observed output the adapter can
  //                         report. Shape: { channel, content, sizeBytes,
  //                         truncated, observedBy }.
  //   - declaredOutput[]  — PreToolUse declared output for write-to-channel
  //                         actions (commit/PR body/etc.). Same shape as
  //                         outputs[].
  // Floors that don't care (F1..F18) ignore these fields; F19 reads them.
  outputs: Object.freeze([]),
  declaredOutput: Object.freeze([]),

  // 7. Declared goal (plan-envelope hookpoint)
  declaredGoal: null,
  planEnvelopeId: null,

  // 8. Trust / capability metadata
  trustMeta: Object.freeze({
    envelopeReporting: false,
    argsFidelity: "best-effort",
    cwdFidelity: "best-effort",
    mcpInterception: "unverified",
    skillInterception: "unverified",
  }),

  // 9. Provenance hooks (not yet load-bearing)
  rawPayloadHash: null,
  irHash: null,
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function _str(v) {
  return typeof v === "string" ? v : "";
}

function _strOrNull(v) {
  if (typeof v !== "string") return null;
  return v.length === 0 ? null : v;
}

function _bool(v) {
  return v === true;
}

function _frozenObj(o) {
  return Object.freeze({ ...o });
}

function _frozenArr(a) {
  return Object.freeze(a.map((item) =>
    _isPlainObject(item) ? Object.freeze({ ...item }) : item
  ));
}

function _classifyTool(tool) {
  const t = _str(tool);
  if (!t) return "unknown";
  // Pattern-based — adapter-agnostic. claude/opencode use "Bash";
  // openclaw uses "shell"; codex/clawcode/antegravity may use "bash".
  if (/^Bash$|^bash$|^shell$/.test(t)) return "shell";
  if (/^Read$|^Grep$|^Glob$/.test(t)) return "file-read";
  if (/^Edit$|^Write$|^MultiEdit$|^NotebookEdit$/.test(t)) return "file-write";
  if (/^WebFetch$|^WebSearch$/.test(t)) return "network";
  if (/^mcp__/.test(t)) return "mcp";
  if (/^Skill$|^skill$/.test(t)) return "skill";
  return "unknown";
}

function _pickHarness(input, ctx) {
  const h =
    _strOrNull(input && input.harness) ||
    _strOrNull(ctx && ctx.harness) ||
    null;
  return h;
}

function _pickCommand(input) {
  if (!input) return "";
  // Order mirrors plan §4 normalization rule 2.
  const candidates = [
    input.command,
    input.cmd,
    input.tool_input && input.tool_input.command,
    input.input && input.input.command,
    input.args && input.args.command,
    input.params && input.params.command,
  ];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (typeof c === "string" && c.length > 0) return c;
  }
  return "";
}

function _pickCwd(input, ctx) {
  if (input) {
    const c =
      input.cwd ||
      (input.tool_input && input.tool_input.cwd) ||
      input.workdir ||
      input.working_directory ||
      (input.args && input.args.cwd);
    if (typeof c === "string" && c.length > 0) return c;
  }
  if (ctx && typeof ctx.cwd === "string" && ctx.cwd.length > 0) return ctx.cwd;
  return null;
}

function _pickTool(input, ctx) {
  if (ctx) {
    const t = ctx.tool;
    if (typeof t === "string" && t.length > 0) return t;
  }
  if (input) {
    const t = input.tool || input.tool_name || input.type;
    if (typeof t === "string" && t.length > 0) return t;
  }
  return null;
}

// Mirror of pretool-gate.classifyCommandPayload so action-ir is self-contained.
// Kept pattern-identical so payloadClass stays byte-stable across the gate +
// IR build paths.
function _classifyPayloadInline(text) {
  const t = String(text || "");
  if (
    /api[_-]?key\s*[=:]/i.test(t) || /password\s*[=:]/i.test(t) ||
    /secret\s*[=:]/i.test(t) || /auth[_-]?token\s*[=:]/i.test(t) ||
    /-----BEGIN\s+(RSA|EC|OPENSSH)?\s*PRIVATE/i.test(t) ||
    /AWS_SECRET_ACCESS_KEY/i.test(t) || /GITHUB_TOKEN|GH_TOKEN/i.test(t) ||
    /customer\s+(data|pii|email|list)/i.test(t)
  ) return "C";
  if (
    /internal[_-]?(only|project|memo)/i.test(t) || /private[_-]?repo/i.test(t) ||
    /security[_-]?incident/i.test(t) || /non[_-]?public/i.test(t) ||
    /financial[_-]?(data|report)/i.test(t)
  ) return "B";
  return "A";
}

function _classifyPathSensitivity(p) {
  const s = String(p || "").replace(/\\/g, "/");
  if (
    /\/\.ssh\b/.test(s) || /\/\.aws\b/.test(s) || /\/\.gnupg\b/.test(s) ||
    /\/\.password-store\b/.test(s) || /\/\.kube\b/.test(s) ||
    /\/(vault|secrets?)\b/i.test(s) || /\/(id_rsa|id_ed25519|id_ecdsa)\b/.test(s) ||
    /\/(payments?|billing)\b/i.test(s) || /\/private[-_]?key\b/i.test(s)
  ) return "high";
  if (
    /\/\.env[^/]*$/.test(s) || /\/\.envrc$/.test(s) ||
    /\/(prod(uction)?|staging|infra|terraform)\b/i.test(s) ||
    /\/(internal|confidential)\b/i.test(s)
  ) return "medium";
  return "low";
}

function _extractMcpServer(tool) {
  if (typeof tool !== "string") return null;
  const m = tool.match(/^mcp__([^_]+(?:_[^_]+)*?)__/);
  return m ? m[1] : null;
}

/**
 * Classify a file path's deployment category for risk scoring.
 * Returns "cicd" | "lockfile" | "system" | null.
 *
 * Deliberately NOT stored on the IR (no IR field, no irHash churn).
 * Called on-the-fly by risk-score.js and decision-engine.js F24.
 */
function classifyDeployTarget(p) {
  const s = String(p || "").replace(/\\/g, "/");
  if (
    /\/\.github\/workflows\b/i.test(s) ||
    /\/\.gitlab-ci\.ya?ml$/i.test(s) ||
    /\/\.circleci\b/i.test(s) ||
    /(^|\/)Jenkinsfile(\.[^/]+)?$/i.test(s) ||
    /\/azure-pipelines\.ya?ml$/i.test(s) ||
    /\/(\.travis\.yml|bitbucket-pipelines\.yml)$/i.test(s)
  ) return "cicd";
  if (
    /\/package-lock\.json$/.test(s) ||
    /\/yarn\.lock$/.test(s) ||
    /\/pnpm-lock\.ya?ml$/.test(s) ||
    /\/go\.sum$/.test(s) ||
    /\/Cargo\.lock$/.test(s) ||
    /\/poetry\.lock$/.test(s) ||
    /\/composer\.lock$/.test(s) ||
    /\/Gemfile\.lock$/.test(s)
  ) return "lockfile";
  if (
    /^\/etc\//.test(s) || /^\/usr\//.test(s) ||
    /^\/bin\//.test(s) || /^\/sbin\//.test(s) ||
    /^\/boot\//.test(s) || /^\/lib\//.test(s) ||
    /^\/Windows\//i.test(s) || /^[A-Z]:\/Windows\//i.test(s)
  ) return "system";
  return null;
}

function _extractNetworkTargets(command) {
  if (!command) return [];
  const matches = String(command).match(/https?:\/\/[^\s'"|]+/g) || [];
  const out = [];
  for (const url of matches) {
    let host = "";
    let scheme = null;
    try {
      const u = new URL(url);
      host = u.hostname;
      scheme = u.protocol.replace(":", "");
    } catch { /* unparseable URL — keep raw */ }
    const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const ipLiteral = host.length > 0 && (
      /^[0-9.]+$/.test(host) || /^\[?[0-9a-f:]+\]?$/i.test(host)
    );
    out.push({ host, scheme, ipLiteral, isLoopback, raw: url });
  }
  return out;
}

// F19 (ADR-010): canonical normalizer for outputs[] / declaredOutput[]
// records. Each record is reshaped to a fixed key order so canonical-JSON
// hashing remains byte-stable; unknown keys are dropped. Returns a deeply-
// frozen array of frozen records. Non-array input becomes [].
function _normalizeOutputRecords(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return Object.freeze([]);
  const out = [];
  for (const r of arr) {
    if (!_isPlainObject(r)) continue;
    const channel = typeof r.channel === "string" ? r.channel : "";
    if (channel.length === 0) continue;
    const content = typeof r.content === "string" ? r.content : "";
    const sizeBytes = Number.isFinite(r.sizeBytes) ? Number(r.sizeBytes) : content.length;
    const truncated = r.truncated === true;
    const observedBy = typeof r.observedBy === "string" ? r.observedBy : null;
    out.push(Object.freeze({
      channel,
      content,
      sizeBytes,
      truncated,
      observedBy,
    }));
  }
  return Object.freeze(out);
}

// Deterministic, platform-independent POSIX resolve. Unlike path.resolve(),
// never injects a host drive for a POSIX-absolute input — path.resolve("/data/old")
// becomes "C:\\data\\old" on Windows, which would make the Action IR and its irHash
// diverge across platforms. Output is byte-identical to path.resolve() on Linux for
// the absolute-cwd / relative-or-absolute-target inputs the IR sees.
function _resolvePosix(cwd, p) {
  const fold  = (s) => String(s == null ? "" : s).replace(/\\/g, "/");
  const strip = (s) => (s.length > 1 ? s.replace(/\/+$/, "") : s);
  const pp = fold(p);
  if (/^\//.test(pp) || /^[A-Za-z]:\//.test(pp)) return strip(path.posix.normalize(pp));
  const base = cwd != null && cwd !== "" ? fold(cwd) : fold(process.cwd());
  return strip(path.posix.normalize(base.replace(/\/+$/, "") + "/" + pp));
}

function _extractFileTargets(command, cwd, toolKind, commandClass, input) {
  const targets = [];
  // Explicit file_path on file tools wins (Edit/Read on Claude shape).
  const explicitPath =
    (input.tool_input && input.tool_input.file_path) ||
    input.file_path ||
    null;
  if (explicitPath && (toolKind === "file-write" || toolKind === "file-read")) {
    const abs = cwd ? _resolvePosix(cwd, explicitPath) : explicitPath;
    const intent = toolKind === "file-write" ? "write" : "read";
    targets.push({
      path: abs,
      intent,
      sensitivity: _classifyPathSensitivity(abs),
    });
    return targets;
  }
  if (!command) return targets;
  // Filter URLs out of the path candidates so curl-style commands don't
  // surface https://example.com/setup.sh as a "file target".
  const paths = extractPaths(command).filter((p) => !/^[a-z]+:\/\//i.test(p));
  let intent = "read";
  if (commandClass === "destructive-delete") intent = "delete";
  else if (DESTRUCTIVE_CLASSES.has(commandClass) || /\b(cp|mv|dd|chmod|chown|ln|tee)\b/.test(command)) {
    intent = "write";
  }
  for (const p of paths) {
    const abs = cwd ? _resolvePosix(cwd, p) : p;
    targets.push({
      path: abs,
      intent,
      sensitivity: _classifyPathSensitivity(abs),
    });
  }
  return targets;
}

function _safeRawHash(input) {
  if (!input) return null;
  try {
    const json = canonicalJson(input);
    return "sha256:" + crypto.createHash("sha256").update(json).digest("hex");
  } catch {
    return null;
  }
}

function _computeIrHash(ir) {
  // Hash the canonical JSON of the IR with irHash placeholder so the result is
  // reproducible across processes/machines. canonical-json sorts keys.
  const src = canonicalJson({ ...ir, irHash: "" });
  return "sha256:" + crypto.createHash("sha256").update(src).digest("hex");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// build(input, ctx) — canonical IR builder.
//
// `input` is the harness-side raw payload (after JSON parse). `ctx` is the
// adapter-side normalized context (harness, command, cwd, tool, manifest data).
// ctx values take precedence over input where both are present so the gate can
// pass already-extracted command/cwd/tool without re-parsing.
//
// The function:
//   - never throws on missing/odd inputs
//   - returns a deeply-frozen IR
//   - leaves all unknown fields at EMPTY_IR defaults
//   - computes `commandTokens`, `commandClass`, `argv0`, `fileTargets`,
//     `networkTargets`, `mcpServer`, `payloadClass`, `destructive`, `writeIntent`
//     deterministically from the (extracted) command + cwd + tool
//   - computes `rawPayloadHash` from the original input
//   - auto-computes `irHash` so callers don't have to call irHash() separately
function build(input, ctx) {
  const safeInput = _isPlainObject(input) ? input : {};
  const safeCtx = _isPlainObject(ctx) ? ctx : {};

  const harness = _pickHarness(safeInput, safeCtx);
  const harnessVersion = _strOrNull(
    safeCtx.harnessVersion || safeInput.harnessVersion
  );
  const tool = _pickTool(safeInput, safeCtx);
  const toolKind = _classifyTool(tool);
  const command =
    typeof safeCtx.command === "string" && safeCtx.command.length > 0
      ? safeCtx.command
      : _pickCommand(safeInput);
  const commandTokens = command ? extractArgs(command) : [];
  // ADR-026 (Khouly authorized re-baseline, 2026-06-02): classifyCommandDual
  // defeats Unicode look-alike bypasses (Cyrillic рm, full-width ｒｍ) so that
  // receipt commandClass, ir.destructive, ir.writeIntent, and irHash all reflect
  // the true semantic class. The 2 adversarial corpus entries whose irHash was
  // recorded under the old raw classification have been re-baselined — see
  // tests/fixtures/replay-corpus/adversarial.jsonl and the PR commit message.
  const commandClass = command ? classifyCommandDual(command) : "unknown";
  const argv0 = commandTokens.length > 0 ? commandTokens[0] : null;

  const cwdRaw =
    typeof safeCtx.cwd === "string" && safeCtx.cwd.length > 0
      ? safeCtx.cwd
      : _pickCwd(safeInput, safeCtx);
  const cwd = cwdRaw ? _resolvePosix(null, cwdRaw) : null;

  const projectRoot = _strOrNull(
    safeInput.projectRoot || safeCtx.projectRoot
  );
  const branch = _strOrNull(safeInput.branch || safeCtx.branch);

  // payloadClass: explicit input wins; otherwise inline classify + secret scan.
  let payloadClass = String(safeInput.payloadClass || "A").toUpperCase();
  if (KNOWN_PAYLOAD_CLASS.indexOf(payloadClass) === -1) payloadClass = "A";
  if (payloadClass !== "C" && command) {
    const cls = _classifyPayloadInline(command);
    if (cls === "C") payloadClass = "C";
    else if (payloadClass === "A" && cls === "B") payloadClass = "B";
    if (payloadClass !== "C" && _scanSecrets) {
      try {
        if (_scanSecrets(command)) payloadClass = "C";
      } catch { /* secret-scan unavailable — fall through */ }
    }
  }

  const destructive =
    DESTRUCTIVE_CLASSES.has(commandClass) || _bool(safeInput.destructive);
  const writeIntent =
    toolKind === "file-write" ||
    destructive ||
    WRITE_INTENT_CLASSES.has(commandClass) ||
    _bool(safeInput.writeIntent);

  const fileTargets = Array.isArray(safeInput.fileTargets)
    ? safeInput.fileTargets.slice()
    : _extractFileTargets(command, cwd, toolKind, commandClass, safeInput);
  const networkTargets = Array.isArray(safeInput.networkTargets)
    ? safeInput.networkTargets.slice()
    : _extractNetworkTargets(command);

  const mcpServer = _strOrNull(safeInput.mcpServer) || _extractMcpServer(tool);
  const skillName = _strOrNull(safeInput.skillName);

  // outputChannels + trustMeta: ctx (manifest-derived) wins, then input, then
  // EMPTY_IR defaults. Conservative defaults preserved for missing manifests.
  const outputChannels = _isPlainObject(safeCtx.outputChannels)
    ? _frozenObj({ ...EMPTY_IR.outputChannels, ...safeCtx.outputChannels })
    : _isPlainObject(safeInput.outputChannels)
      ? _frozenObj({ ...EMPTY_IR.outputChannels, ...safeInput.outputChannels })
      : EMPTY_IR.outputChannels;
  const trustMeta = _isPlainObject(safeCtx.trustMeta)
    ? _frozenObj({ ...EMPTY_IR.trustMeta, ...safeCtx.trustMeta })
    : _isPlainObject(safeInput.trustMeta)
      ? _frozenObj({ ...EMPTY_IR.trustMeta, ...safeInput.trustMeta })
      : EMPTY_IR.trustMeta;

  const ir = {
    irVersion: IR_VERSION,
    harness,
    harnessVersion,
    sessionId: _strOrNull(
      safeInput.sessionId || safeInput.session_id || safeCtx.sessionId
    ),
    toolUseId: _strOrNull(safeInput.toolUseId || safeInput.tool_use_id),
    agentIdentity: _strOrNull(
      safeInput.agentIdentity || safeCtx.agentIdentity
    ),
    ts: _strOrNull(safeInput.ts || safeCtx.ts),

    cwd,
    projectRoot,
    branch,
    envDelta: _frozenObj(
      _isPlainObject(safeInput.envDelta) ? safeInput.envDelta : {}
    ),

    tool,
    toolKind,
    command,
    commandTokens: _frozenArr(commandTokens),
    commandClass,
    argv0,

    fileTargets: _frozenArr(fileTargets),
    networkTargets: _frozenArr(networkTargets),
    mcpServer,
    skillName,

    writeIntent,
    destructive,
    payloadClass,

    outputChannels,
    // F19 additive arrays. Prefer ctx-provided records (manifest/adapter
    // populated) over input; both reach build() as canonical shapes after
    // _normalizeOutputRecords(). Empty by default so existing IR shapes
    // produced by floors that pre-date F19 stay byte-identical.
    outputs: _normalizeOutputRecords(
      Array.isArray(safeCtx.outputs) ? safeCtx.outputs : safeInput.outputs
    ),
    declaredOutput: _normalizeOutputRecords(
      Array.isArray(safeCtx.declaredOutput) ? safeCtx.declaredOutput : safeInput.declaredOutput
    ),
    declaredGoal: _strOrNull(safeInput.declaredGoal),
    planEnvelopeId: _strOrNull(safeInput.planEnvelopeId),

    trustMeta,

    rawPayloadHash: _safeRawHash(safeInput),
    irHash: null,
  };

  ir.irHash = _computeIrHash(ir);
  return Object.freeze(ir);
}

// validate(ir) — structural check against EMPTY_IR shape.
// Returns { ok: bool, reason: string|null }.
function validate(ir) {
  if (!_isPlainObject(ir)) return { ok: false, reason: "ir-not-object" };

  if (ir.irVersion !== IR_VERSION) {
    return { ok: false, reason: "ir-version-mismatch" };
  }

  const expectedKeys = Object.keys(EMPTY_IR);
  for (let i = 0; i < expectedKeys.length; i++) {
    const k = expectedKeys[i];
    if (!Object.prototype.hasOwnProperty.call(ir, k)) {
      return { ok: false, reason: "missing-field:" + k };
    }
  }

  if (ir.harness != null && typeof ir.harness !== "string") {
    return { ok: false, reason: "harness-not-string" };
  }
  if (typeof ir.command !== "string") {
    return { ok: false, reason: "command-not-string" };
  }
  if (KNOWN_TOOL_KINDS.indexOf(ir.toolKind) === -1) {
    return { ok: false, reason: "tool-kind-invalid" };
  }
  if (KNOWN_PAYLOAD_CLASS.indexOf(ir.payloadClass) === -1) {
    return { ok: false, reason: "payload-class-invalid" };
  }
  if (!Array.isArray(ir.commandTokens)) {
    return { ok: false, reason: "command-tokens-not-array" };
  }
  if (!Array.isArray(ir.fileTargets)) {
    return { ok: false, reason: "file-targets-not-array" };
  }
  if (!Array.isArray(ir.networkTargets)) {
    return { ok: false, reason: "network-targets-not-array" };
  }
  if (!_isPlainObject(ir.envDelta)) {
    return { ok: false, reason: "env-delta-not-object" };
  }
  if (!_isPlainObject(ir.outputChannels)) {
    return { ok: false, reason: "output-channels-not-object" };
  }
  // F19 (ADR-010): outputs/declaredOutput must be arrays. Each record must be
  // a plain object with a non-empty `channel` string; other fields are
  // optional but typed when present. Empty arrays are the common case.
  if (!Array.isArray(ir.outputs)) {
    return { ok: false, reason: "outputs-not-array" };
  }
  if (!Array.isArray(ir.declaredOutput)) {
    return { ok: false, reason: "declared-output-not-array" };
  }
  for (let i = 0; i < ir.outputs.length; i++) {
    const r = ir.outputs[i];
    if (!_isPlainObject(r)) return { ok: false, reason: "outputs-record-not-object:" + i };
    if (typeof r.channel !== "string" || r.channel.length === 0) {
      return { ok: false, reason: "outputs-channel-invalid:" + i };
    }
    if (r.content != null && typeof r.content !== "string") {
      return { ok: false, reason: "outputs-content-not-string:" + i };
    }
  }
  for (let i = 0; i < ir.declaredOutput.length; i++) {
    const r = ir.declaredOutput[i];
    if (!_isPlainObject(r)) return { ok: false, reason: "declared-output-record-not-object:" + i };
    if (typeof r.channel !== "string" || r.channel.length === 0) {
      return { ok: false, reason: "declared-output-channel-invalid:" + i };
    }
  }
  if (!_isPlainObject(ir.trustMeta)) {
    return { ok: false, reason: "trust-meta-not-object" };
  }
  if (
    ir.trustMeta.argsFidelity != null &&
    KNOWN_ARGS_FIDELITY.indexOf(ir.trustMeta.argsFidelity) === -1
  ) {
    return { ok: false, reason: "args-fidelity-invalid" };
  }
  if (
    ir.trustMeta.cwdFidelity != null &&
    KNOWN_CWD_FIDELITY.indexOf(ir.trustMeta.cwdFidelity) === -1
  ) {
    return { ok: false, reason: "cwd-fidelity-invalid" };
  }
  if (
    ir.trustMeta.mcpInterception != null &&
    KNOWN_INTERCEPTION.indexOf(ir.trustMeta.mcpInterception) === -1
  ) {
    return { ok: false, reason: "mcp-interception-invalid" };
  }
  if (
    ir.trustMeta.skillInterception != null &&
    KNOWN_INTERCEPTION.indexOf(ir.trustMeta.skillInterception) === -1
  ) {
    return { ok: false, reason: "skill-interception-invalid" };
  }
  const ocKeys = Object.keys(EMPTY_IR.outputChannels);
  for (let i = 0; i < ocKeys.length; i++) {
    const k = ocKeys[i];
    const v = ir.outputChannels[k];
    if (v != null && KNOWN_OUTPUT_CHANNEL_STATE.indexOf(v) === -1) {
      return { ok: false, reason: "output-channel-invalid:" + k };
    }
  }

  return { ok: true, reason: null };
}

// canonicalize(ir) — deterministic shape-stable copy. Used by tests/parity.
// Drops irHash so the result re-hashes deterministically.
function canonicalize(ir) {
  const v = validate(ir);
  if (!v.ok) {
    throw new Error("canonicalize: invalid IR (" + v.reason + ")");
  }
  const copy = { ...ir, irHash: "" };
  return Object.freeze(copy);
}

// irHash(ir) — sha256 of canonicalJson(canonicalize(ir)). Pure helper for
// callers that want to recompute the hash explicitly (build() already sets
// ir.irHash on its result).
function irHash(ir) {
  const canonical = canonicalize(ir);
  return (
    "sha256:" +
    crypto.createHash("sha256").update(canonicalJson(canonical)).digest("hex")
  );
}

module.exports = {
  EMPTY_IR,
  IR_VERSION,
  KNOWN_HARNESSES,
  KNOWN_TOOL_KINDS,
  KNOWN_PAYLOAD_CLASS,
  build,
  validate,
  canonicalize,
  irHash,
  classifyDeployTarget,
  classifyPathSensitivity: _classifyPathSensitivity,
};
