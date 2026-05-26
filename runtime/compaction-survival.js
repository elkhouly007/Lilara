#!/usr/bin/env node
"use strict";

// compaction-survival.js — F21 prompt-injection pattern scanner (ADR-016).
//
// Scans tool output text for patterns that attempt to survive context
// compaction or inject instructions. Zero external dependencies; regex-only.
//
// Hard cap: scan first 64 KB only to stay <1 ms on large outputs.
// All pattern matches are case-insensitive.

const SCAN_LIMIT = 64 * 1024; // 64 KB

const PATTERNS = Object.freeze([
  {
    id: "CS-001",
    re: /ignore (all )?previous instructions/i,
    severity: "high",
  },
  {
    id: "CS-002",
    re: /disregard (the )?system prompt/i,
    severity: "high",
  },
  {
    id: "CS-003",
    re: /when summarizing,? retain (this|the following)/i,
    severity: "medium",
  },
  {
    id: "CS-004",
    re: /this directive is permanent/i,
    severity: "medium",
  },
  {
    id: "CS-005",
    re: /preserve (this|the following)\b.*\b(through|across|during) (compaction|summarization|compression)/i,
    severity: "high",
  },
  {
    id: "CS-006",
    re: /<\s*sudo\s*>|<\s*admin\s*>/i,
    severity: "medium",
  },
  {
    id: "CS-007",
    re: /```(json|yaml)[\s\S]{0,40}"role"\s*:\s*"(system|assistant)"/i,
    severity: "high",
  },
  {
    id: "CS-008",
    re: /disregard\s+(your|the|all)\s+(instructions|rules|guidelines)/i,
    severity: "high",
  },
]);

/**
 * scanForInjection(text) → { matched: boolean, hits: Array<{id, severity, snippet}> }
 *
 * Returns matched=false + empty hits when no pattern matches.
 * Each snippet is ≤80 chars centred on the match for operator review.
 */
function scanForInjection(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { matched: false, hits: [] };
  }
  const slice = text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT) : text;
  const hits = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(slice);
    if (m) {
      const start = Math.max(0, m.index - 20);
      const end   = Math.min(slice.length, m.index + m[0].length + 20);
      const raw   = slice.slice(start, end).replace(/\n/g, "\\n");
      const snippet = raw.length > 80 ? raw.slice(0, 77) + "..." : raw;
      hits.push({ id: p.id, severity: p.severity, snippet });
    }
  }
  return { matched: hits.length > 0, hits };
}

module.exports = { PATTERNS, scanForInjection, SCAN_LIMIT };
