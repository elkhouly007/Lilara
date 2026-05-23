#!/usr/bin/env node
// post-adapter.js — OpenClaw PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const path = require("path");
const { createPostAdapter } = require("../../runtime/post-adapter-factory");

// Capabilities are sourced from openclaw/manifest.json so the hook and the
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
  harnessName: "openclaw",
  rateLimitKey: "openclaw-post-adapter",
  envelopeReporting,
});
