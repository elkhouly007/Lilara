#!/usr/bin/env node
"use strict";

const fs   = require("fs");
const path = require("path");
const { stateDir }       = require("./state-paths");
const { currentSessionId } = require("./session-context");

const MAX_CHARS = 500;

/**
 * Build a compact summary of the most recent prior session.
 *
 * Pure function — no writes, no side-effects. Safe to call from SessionStart
 * hooks where the new session ID has already been written by startSession().
 *
 * Returns { text, sessionCount, decisionsSummarized, openTodos, generatedAt }
 * where text === "" means no prior session data is available.
 */
function buildSummary({ stateDirOverride } = {}) {
  const dir         = stateDirOverride ? path.resolve(stateDirOverride) : stateDir();
  const sessionFile = path.join(dir, "session-context.json");

  let state;
  try {
    state = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  } catch {
    return _empty();
  }

  const sessions  = state.sessions || {};
  const activeSid = currentSessionId();

  // All previous sessions (exclude the session just started by startSession())
  const prevSids = Object.keys(sessions).filter((sid) => sid !== activeSid);

  if (prevSids.length === 0) return _empty();

  // Pick the most recent previous session by the last entry's timestamp
  let latestSid = prevSids[0];
  let latestTs  = 0;
  for (const sid of prevSids) {
    const entries = sessions[sid];
    if (Array.isArray(entries) && entries.length > 0) {
      const ts = _parseTs(entries[entries.length - 1].ts);
      if (ts > latestTs) { latestTs = ts; latestSid = sid; }
    }
  }

  const entries = Array.isArray(sessions[latestSid]) ? sessions[latestSid] : [];
  const total   = entries.length;
  const blocks  = entries.filter((e) => e.action === "block").length;
  const warns   = entries.filter((e) => ["escalate", "require-review"].includes(e.action)).length;

  // Top 3 reason codes by frequency
  const codeCounts = {};
  for (const e of entries) {
    if (Array.isArray(e.reasonCodes)) {
      for (const c of e.reasonCodes) codeCounts[c] = (codeCounts[c] || 0) + 1;
    }
  }
  const topCodes = Object.entries(codeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c]) => c);

  // Last protected-branch or payload-class-C decision
  let lastHighlight = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (Array.isArray(e.reasonCodes) &&
        (e.reasonCodes.includes("protected-branch") ||
         e.reasonCodes.includes("payload-class-c"))) {
      lastHighlight = e;
      break;
    }
  }

  // Open todos from <stateDir>/todos.json (graceful no-op — lilara todo not on master)
  let openTodos = 0;
  try {
    const todos = JSON.parse(fs.readFileSync(path.join(dir, "todos.json"), "utf8"));
    openTodos = Array.isArray(todos) ? todos.filter((t) => !t.done).length : 0;
  } catch { /* todos.json is optional */ }

  // Build summary text ≤500 chars
  const parts = [
    `Last session: ${total} decision${total !== 1 ? "s" : ""}, ${blocks} block${blocks !== 1 ? "s" : ""}, ${warns} warn${warns !== 1 ? "s" : ""}.`,
  ];
  if (topCodes.length > 0) parts.push(`Top codes: ${topCodes.join(", ")}.`);
  if (lastHighlight) {
    const tag = lastHighlight.reasonCodes.includes("protected-branch")
      ? "protected-branch" : "payload-class-C";
    parts.push(`Last ${tag} decision: ${lastHighlight.action}.`);
  }
  if (openTodos > 0) parts.push(`Open todos: ${openTodos}.`);

  let text = parts.join(" ");
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 1) + "…";

  return { text, sessionCount: prevSids.length, decisionsSummarized: total, openTodos, generatedAt: new Date().toISOString() };
}

function _empty() {
  return { text: "", sessionCount: 0, decisionsSummarized: 0, openTodos: 0, generatedAt: new Date().toISOString() };
}

function _parseTs(ts) {
  if (!ts) return 0;
  try { return new Date(ts).getTime(); } catch { return 0; }
}

module.exports = { buildSummary };
