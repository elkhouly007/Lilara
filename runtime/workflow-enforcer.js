"use strict";

const fs   = require("fs");
const path = require("path");
const { stateDir, ensureDir } = require("./state-paths");
const { ensureStateDirSafe, ensureBaseDirSafe } = require("./state-dir");

// ---------------------------------------------------------------------------
// workflow-enforcer.js
// Config-driven required-steps tracker. Reads workflow.required_steps from
// lilara.config.json in the current working directory, maintains per-session
// step state under <stateDir>/workflow-state.json.
// ---------------------------------------------------------------------------

const WORKFLOW_STATE_FILE = "workflow-state.json";

function workflowStatePath(stateDirOverride) {
  const base = stateDirOverride || stateDir();
  return path.join(base, WORKFLOW_STATE_FILE);
}

// Read workflow config from cwd/lilara.config.json. Returns null if absent.
function readConfig(cwdOverride) {
  const cfgPath = path.join(cwdOverride || process.cwd(), "lilara.config.json");
  try {
    const raw = fs.readFileSync(cfgPath, "utf8");
    const cfg = JSON.parse(raw);
    if (!cfg.workflow) return null;
    return {
      required_steps: Array.isArray(cfg.workflow.required_steps) ? cfg.workflow.required_steps : [],
      step_order: cfg.workflow.step_order === "strict" ? "strict" : "lenient",
    };
  } catch {
    return null;
  }
}

// Load current workflow state. Returns { completedSteps: string[], sessionId: string }.
function loadState(stateDirOverride) {
  // ADR-032: state-dir guard
  if (!ensureStateDirSafe(stateDir())) return { completedSteps: [], sessionId: null };
  const p = workflowStatePath(stateDirOverride);
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return { completedSteps: [], sessionId: null };
  }
}

function saveState(state, stateDirOverride) {
  // ADR-032: state-dir guard
  if (!ensureBaseDirSafe(stateDir())) return;
  const base = stateDirOverride || stateDir();
  ensureDir(base);
  const p = workflowStatePath(stateDirOverride);
  const tmp = p + ".tmp-" + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    try { fs.renameSync(tmp, p); } catch {
      fs.copyFileSync(tmp, p);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  } catch { /* state write is optional */ }
}

// Mark a workflow step as completed for this session.
function markStep(name, opts) {
  const stateDirOverride = (opts && opts.stateDirOverride) || null;
  const state = loadState(stateDirOverride);
  if (!state.completedSteps.includes(name)) {
    state.completedSteps.push(name);
  }
  saveState(state, stateDirOverride);
  return state.completedSteps;
}

// Check whether all required steps are complete.
// Returns { satisfied: bool, missing: string[], mode: string, blocked: bool }
function checkSteps(opts) {
  const stateDirOverride = (opts && opts.stateDirOverride) || null;
  const cwdOverride      = (opts && opts.cwdOverride) || null;
  const enforce          = !!(process.env.LILARA_ENFORCE === "1" || (opts && opts.enforce));

  const cfg = readConfig(cwdOverride);
  if (!cfg || cfg.required_steps.length === 0) {
    return { satisfied: true, missing: [], mode: "disabled", blocked: false };
  }

  const state = loadState(stateDirOverride);
  const completed = state.completedSteps || [];

  // Strict mode: steps must appear in declared order; also means each prior step
  // must have been marked before the next. Here we check presence only.
  const missing = cfg.required_steps.filter((s) => !completed.includes(s));
  const satisfied = missing.length === 0;
  const blocked = enforce && cfg.step_order === "strict" && !satisfied;

  return {
    satisfied,
    missing,
    mode: cfg.step_order,
    blocked,
  };
}

// Reset workflow state (new session).
function resetSteps(opts) {
  const stateDirOverride = (opts && opts.stateDirOverride) || null;
  saveState({ completedSteps: [], sessionId: Date.now().toString() }, stateDirOverride);
}

module.exports = { readConfig, markStep, checkSteps, resetSteps, workflowStatePath };
