#!/usr/bin/env node
// post-adapter.js — antegravity AfterTool adapter for Lilara (verified via upstream source).
//
// Hook protocol verified against google-gemini/gemini-cli (Apache-2.0):
//   Payload shape:  packages/core/src/hooks/types.ts — AfterToolInput
//   Output field:   tool_response (AfterToolInput.tool_response: Record<string, unknown>)
//
// Wire as "AfterTool" event in .gemini/settings.json (NOT "PostToolUse").
"use strict";

const path = require("path");
const { createPostAdapter } = require("../../runtime/post-adapter-factory");

// Capabilities are sourced from antegravity/manifest.json so the hook and the
// published capability manifest cannot drift. If the manifest is unreadable
// at hook load (e.g. partial install), fall back to the conservative
// envelopeReporting=false default — never assume more capability than the
// manifest declares.
let envelopeReporting = false;
try {
  const manifest = require(path.join(__dirname, "..", "manifest.json"));
  envelopeReporting = manifest.envelopeReporting === true;
} catch (_) {
  // keep conservative default
}

createPostAdapter({
  harnessName: "antegravity",
  rateLimitKey: "antegravity-post-adapter",
  envelopeReporting,
});
