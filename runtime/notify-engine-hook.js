#!/usr/bin/env node
"use strict";

// ADR-015 (PR-η): notification hook helpers. Extracted from
// runtime/decision-engine.js by the monolith-decomposition sprint (2026-06).
//
// Fire-and-forget side-effect rail; the hook NEVER blocks the engine return
// path and notification failure NEVER changes a decision. require()d lazily
// inside the hook so a malformed module can't impact the decide() hot path
// startup.

const { getEntry } = require("./decision-lattice");
const _F1 = getEntry("F1"); // kill-switch — used in _classifyNotifyEvent

// Lazy-loaded notify module — cached null when absent.
let _notifyModule = null;
function _getNotify() {
  if (_notifyModule) return _notifyModule;
  try { _notifyModule = require("./notify"); } catch { _notifyModule = null; }
  return _notifyModule;
}

// Process-lifetime de-dup for "degraded-mode-entered" event.
// Stays module-level so a single process fires this notification at most once
// (matches the original DE.js semantics exactly).
let _notifyDegradedSeen = false;

// ADR-015: derive the notification event from a finalized decision result.
// Returns null when the decision is not one of the four wave-4 trigger kinds
// (so the hook stays a no-op). Severity mapping matches the brief: kill-switch
// and adversarial-bypass are critical; require-review is info; degraded-mode
// is warning. Adversarial-bypass keys on a G-series floor producing `block` —
// currently a forward-compatible no-op since no G-floor ships yet.
function _classifyNotifyEvent(result) {
  if (!result) return null;
  const ff = String(result.floorFired || "");
  if (ff === _F1.name || ff === "kill-switch") return { kind: "kill-switch-fire", severity: "critical" };
  if (/^G/.test(ff) && result.action === "block") return { kind: "adversarial-bypass-detected", severity: "critical" };
  if (result.degradedMode && typeof result.degradedMode === "object" && !_notifyDegradedSeen) {
    _notifyDegradedSeen = true;
    return { kind: "degraded-mode-entered", severity: "warning" };
  }
  if (result.action === "require-review") return { kind: "approval-request", severity: "info" };
  return null;
}

// Fire-and-forget notification hook. NEVER awaited; NEVER throws; NEVER
// mutates the decision. Sets `result.notifyAttempted = true` only if the
// hook actually invoked notify() (contract enabled + matching event).
function fireNotifyHook(result, contract, decisionKey) {
  try {
    const mod = _getNotify();
    if (!mod) return;
    const cfg = mod.loadNotifyConfig(contract);
    if (!cfg.enabled) return;
    const ev = _classifyNotifyEvent(result);
    if (!ev) return;
    result.notifyAttempted = true;
    const payload = {
      kind: ev.kind,
      severity: ev.severity,
      decisionKey: decisionKey || result.policyKey || null,
      summary: result.explanation || `${ev.kind}:${result.action || ""}`,
      scrubbedReceipt: mod.scrubForNotify(result),
      timestamp: new Date().toISOString(),
    };
    const p = mod.notify(payload, { contract });
    if (p && typeof p.catch === "function") p.catch(() => { /* swallow */ });
  } catch { /* notify hook must never block engine */ }
}

module.exports = { fireNotifyHook };
