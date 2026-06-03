#!/usr/bin/env node
"use strict";

// F23 (ADR-017): cross-call data-flow / kill-chain detection floor.
// Extracted from runtime/decision-engine.js by the quad-track bundle sprint
// (2026-06). Previously blocked from extraction because the provenance-graph
// optional-require pattern was inline in decision-engine.js; extraction is now
// clean because this module OWNS its optional deps and is itself always loadable.
//
// decision-engine.js requires this module non-optionally. If provenance-graph
// or session-context are unavailable, evalKillChain() returns
// { f23Detail: null, f23PreviewAction: null } — F23 fails open (observe-mode
// only), identical to the prior inline behaviour.
//
// Pure in the sense that all I/O is delegated to session-context (graph
// persistence) and provenance-graph (hash computation). No direct FS access.

// ---------------------------------------------------------------------------
// Optional deps — F23 fails open when either is absent.
// ---------------------------------------------------------------------------
let _pg = null; // provenance-graph module
let _sc = null; // session-context (graph I/O)
try { _pg = require("./provenance-graph"); } catch { /* F23 fails open */ }
try { _sc = require("./session-context"); } catch { /* F23 fails open */ }

// ---------------------------------------------------------------------------
// evalKillChain(input, enforceMode)
//
// Evaluates whether the pending tool call closes a data-flow kill chain,
// records derivative provenance nodes when applicable, and returns the two
// local vars that decide() needs for its late-override block.
//
// Parameters:
//   input        — the materialised decide() input object (same shape as
//                  the inline F23 block consumed)
//   enforceMode  — Boolean; true when LILARA_KILL_CHAIN_ENFORCE === "1"
//
// Returns: { f23Detail, f23PreviewAction }
//   f23Detail        — detection receipt object | null (no chain / module absent)
//   f23PreviewAction — "block" | "escalate" | null (enforce mode only)
//
// Never throws — all paths are wrapped in the outer try/catch for parity with
// the inline "F23 must never throw out — fail open" comment.
// ---------------------------------------------------------------------------
function evalKillChain(input, enforceMode) {
  let f23Detail        = null;
  let f23PreviewAction = null;

  try {
    if (!_pg || !_sc) return { f23Detail, f23PreviewAction };

    const _loadProvenanceGraph  = _sc.loadProvenanceGraph;
    const _recordProvenanceStep = _sc.recordProvenanceStep;

    if (!_loadProvenanceGraph) return { f23Detail, f23PreviewAction };

    const _f23Graph = _loadProvenanceGraph();
    const _ir23     = input && input.ir;

    if (_ir23) {
      // Extract write content for propagation + persistence detection
      const _writeContent = String(
        (input.tool_input && (input.tool_input.content || input.tool_input.new_string || "")) ||
        (typeof input.content === "string" ? input.content : "") ||
        (typeof input.new_string === "string" ? input.new_string : "")
      );
      const _writeTokens = _writeContent.length >= 20
        ? _pg.tokenHashSet(_writeContent)
        : [];

      // Evaluate whether pending call closes a kill chain
      const _f23Eval = _pg.evaluate(_ir23, _f23Graph, {
        writeContentTokenHashes: _writeTokens,
      });

      if (_f23Eval.detected) {
        f23Detail = {
          chainType:   _f23Eval.chainType,
          severity:    _f23Eval.severity,
          detected:    true,
          enforced:    enforceMode,
          wouldAction: _f23Eval.wouldAction,
          confidence:  _f23Eval.confidence,
          evidence:    Array.isArray(_f23Eval.evidence) ? _f23Eval.evidence : [],
          steps:       Array.isArray(_f23Eval.steps)    ? _f23Eval.steps    : [],
        };
        if (enforceMode) {
          f23PreviewAction = _f23Eval.wouldAction; // "block" or "escalate"
        }
      }

      // Propagation recording: if writing tainted data, mark target as derivative.
      // Gated on interesting IR (file-write with content, non-empty graph).
      if (_ir23.toolKind === "file-write" && _writeTokens.length >= 3 &&
          _f23Graph.length > 0 && _recordProvenanceStep) {
        const _srcNode = _pg.findPropagationSource(_writeTokens, _f23Graph);
        if (_srcNode) {
          for (const ft of (_ir23.fileTargets || [])) {
            if (ft && ft.intent === "write" && ft.path) {
              try {
                _recordProvenanceStep({
                  role:           "derivative",
                  sourceClass:    _srcNode.sourceClass,
                  targetPathHash: _pg.pathHash(ft.path),
                  tokenHashes:    _writeTokens.slice(0, 32),
                  ts:             Date.now(),
                });
              } catch { /* best-effort */ }
            }
          }
        }
      }
    }
  } catch { /* F23 must never throw out — fail open */ }

  return { f23Detail, f23PreviewAction };
}

module.exports = { evalKillChain };
