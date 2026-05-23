#!/usr/bin/env node
"use strict";

/**
 * provenance-correlator.js — Overlap detection between shell commands and
 * recently-read external content.
 *
 * Detects when a shell command's tokens appear in content that was recently
 * read from an external source (browser, MCP, web-fetch, curl/wget output).
 * This is the low-level algorithm; taint.js is the high-level API.
 *
 * Zero external dependencies.
 */

const MIN_TOKEN_LENGTH = 6; // default; overridable via lilara.config.json taint.minTokenLength

/**
 * Correlate a shell command against a list of external read records.
 *
 * @param {string} command — shell command string to analyze
 * @param {Array<{content: string, source: string, ts: number}>} externalReads
 * @param {number} [minTokenLength] — override for MIN_TOKEN_LENGTH (range 4–32; default 6)
 * @returns {{ tainted: boolean, reason?: string, source?: string, matchedToken?: string }}
 */
function correlate(command, externalReads, minTokenLength) {
  const MIN = (typeof minTokenLength === "number" && minTokenLength >= 4 && minTokenLength <= 32)
    ? Math.round(minTokenLength)
    : MIN_TOKEN_LENGTH;
  const cmd = String(command || "").trim();
  if (!cmd || !Array.isArray(externalReads) || externalReads.length === 0) {
    return { tainted: false };
  }

  // Extract significant tokens (skip short tokens and flag-style args)
  const tokens = cmd
    .split(/\s+/)
    .filter((t) => t.length >= MIN && !/^-{1,2}[a-z]/i.test(t));

  for (const read of externalReads) {
    const content = String(read.content || "");
    if (!content) continue;

    // Exact substring: full command appears in external content
    if (cmd.length >= MIN && content.includes(cmd)) {
      return {
        tainted:  true,
        reason:   "command-in-external-read",
        source:   read.source || "external",
      };
    }

    // Token-level overlap: any significant command token appears in external content
    for (const token of tokens) {
      if (content.includes(token)) {
        return {
          tainted:      true,
          reason:       "command-token-in-external-read",
          source:       read.source || "external",
          matchedToken: token,
        };
      }
    }
  }

  return { tainted: false };
}

module.exports = { correlate };
