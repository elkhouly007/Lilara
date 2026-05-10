#!/usr/bin/env node
"use strict";

// action-ir.js — Canonical Action IR skeleton (HAP ADR-007 PR-A).
//
// The Canonical Action IR is the single normalized shape that every adapter
// produces before floors run (scope §4.1 invariant 9). Floors then read the
// IR instead of harness-specific raw payloads.
//
// PR-A intentionally lands the SHAPE + helpers only:
//   - EMPTY_IR    : the canonical empty record (frozen). Used as the
//                   default + reference shape for parity tests.
//   - build()     : conservative best-effort builder. Accepts a flat legacy
//                   input + optional ctx and returns a frozen IR. It never
//                   throws on missing fields; it simply leaves them at their
//                   EMPTY_IR defaults so PR-B can layer adapter-specific
//                   normalization without changing call sites.
//   - validate()  : structural check returning { ok, reason }. Cheap.
//   - canonicalize(): deterministic shape-stable copy used by tests.
//   - irHash()    : sha256 of canonicalJson(ir with irHash="").
//   - IR_VERSION  : frozen "1"; bump only via scope amendment.
//
// PR-B will (a) wire build() into pretool-gate.js as a back-compat shim,
// (b) add cross-adapter parity fixtures, and (c) attach `irHash` to the
// decision journal under HORUS_IR_JOURNAL=1. PR-A does NOT change any
// floor predicates, ordering, or runtime behavior.
//
// Pure functions. Zero I/O. Zero external dependencies (Node builtins only).

const crypto = require("crypto");
const path = require("path");
const { canonicalJson } = require("./canonical-json");

const IR_VERSION = "1";

// Allowed values per IR field — PR-A keeps them small + conservative; PR-B
// expands fileTargets/networkTargets/etc. with adapter-side extractors.
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
  return Object.freeze(a.slice());
}

function _classifyTool(tool) {
  const t = _str(tool);
  if (!t) return "unknown";
  // Pattern-based — adapter-agnostic. PR-B will refine when adapters land.
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
  if (h && KNOWN_HARNESSES.indexOf(h) === -1) {
    // unknown harness names are preserved as-is so PR-B can surface them
    // explicitly through validation rather than silently bucket them.
    return h;
  }
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
      input.working_directory;
    if (typeof c === "string" && c.length > 0) return c;
  }
  if (ctx && typeof ctx.cwd === "string" && ctx.cwd.length > 0) return ctx.cwd;
  return null;
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// build(input, ctx) — conservative IR builder.
//
// `input` is the legacy flat payload (matches the shape decision-engine.decide
// receives today); `ctx` is optional adapter context. The function:
//   - never throws on missing/odd inputs
//   - returns a deeply-frozen IR
//   - leaves all unknown fields at EMPTY_IR defaults
//   - computes `rawPayloadHash` from the original input when possible
//   - leaves `irHash` to the caller (or to `irHash(ir)` below) so the hash is
//     reproducible across processes/machines
//
// PR-B will replace the bodies of _pickX with adapter-specific extractors;
// the public signature stays stable.
function build(input, ctx) {
  const safeInput = _isPlainObject(input) ? input : {};
  const safeCtx = _isPlainObject(ctx) ? ctx : {};

  const harness = _pickHarness(safeInput, safeCtx);
  const command = _pickCommand(safeInput);
  const tool = _strOrNull(safeInput.tool || safeInput.tool_name) || null;
  const toolKind = _classifyTool(tool);
  const cwd = _pickCwd(safeInput, safeCtx);
  const projectRoot = _strOrNull(
    safeInput.projectRoot || (safeCtx && safeCtx.projectRoot)
  );
  const branch = _strOrNull(safeInput.branch || (safeCtx && safeCtx.branch));

  let payloadClass = String(safeInput.payloadClass || "A").toUpperCase();
  if (KNOWN_PAYLOAD_CLASS.indexOf(payloadClass) === -1) payloadClass = "A";

  const argv0 = command ? command.trim().split(/\s+/, 1)[0] || null : null;

  const writeIntent = toolKind === "file-write" || _bool(safeInput.writeIntent);
  const destructive = _bool(safeInput.destructive);

  const ir = {
    irVersion: IR_VERSION,
    harness: harness,
    harnessVersion: _strOrNull(safeInput.harnessVersion),
    sessionId: _strOrNull(safeInput.sessionId || (safeCtx && safeCtx.sessionId)),
    toolUseId: _strOrNull(safeInput.toolUseId || safeInput.tool_use_id),
    agentIdentity: _strOrNull(
      safeInput.agentIdentity || (safeCtx && safeCtx.agentIdentity)
    ),
    ts: _strOrNull(safeInput.ts || (safeCtx && safeCtx.ts)),

    cwd: cwd ? path.resolve(cwd) : null,
    projectRoot: projectRoot,
    branch: branch,
    envDelta: _frozenObj(
      _isPlainObject(safeInput.envDelta) ? safeInput.envDelta : {}
    ),

    tool: tool,
    toolKind: toolKind,
    command: command,
    commandTokens: _frozenArr(
      Array.isArray(safeInput.commandTokens) ? safeInput.commandTokens : []
    ),
    commandClass: _strOrNull(safeInput.commandClass) || "unknown",
    argv0: argv0,

    fileTargets: _frozenArr(
      Array.isArray(safeInput.fileTargets) ? safeInput.fileTargets : []
    ),
    networkTargets: _frozenArr(
      Array.isArray(safeInput.networkTargets) ? safeInput.networkTargets : []
    ),
    mcpServer: _strOrNull(safeInput.mcpServer),
    skillName: _strOrNull(safeInput.skillName),

    writeIntent: writeIntent,
    destructive: destructive,
    payloadClass: payloadClass,

    outputChannels: _isPlainObject(safeInput.outputChannels)
      ? _frozenObj({ ...EMPTY_IR.outputChannels, ...safeInput.outputChannels })
      : EMPTY_IR.outputChannels,

    declaredGoal: _strOrNull(safeInput.declaredGoal),
    planEnvelopeId: _strOrNull(safeInput.planEnvelopeId),

    trustMeta: _isPlainObject(safeInput.trustMeta)
      ? _frozenObj({ ...EMPTY_IR.trustMeta, ...safeInput.trustMeta })
      : EMPTY_IR.trustMeta,

    rawPayloadHash: _safeRawHash(safeInput),
    irHash: null,
  };

  return Object.freeze(ir);
}

// validate(ir) — structural check against EMPTY_IR shape.
// Returns { ok: bool, reason: string|null }.
// Cheap: confirms keys + scalar types; does not normalize.
function validate(ir) {
  if (!_isPlainObject(ir)) return { ok: false, reason: "ir-not-object" };

  if (ir.irVersion !== IR_VERSION) {
    return { ok: false, reason: "ir-version-mismatch" };
  }

  // Every EMPTY_IR key must be present on ir (presence-only check; null OK).
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
// Returns a fresh frozen object whose canonicalJson serialization is stable
// across machines for byte-equal comparison.
function canonicalize(ir) {
  const v = validate(ir);
  if (!v.ok) {
    throw new Error("canonicalize: invalid IR (" + v.reason + ")");
  }
  // Drop irHash before re-hashing so result is reproducible.
  const copy = { ...ir, irHash: "" };
  return Object.freeze(copy);
}

// irHash(ir) — sha256 of canonicalJson(canonicalize(ir)).
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
};
