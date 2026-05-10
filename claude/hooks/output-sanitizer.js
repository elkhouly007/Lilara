#!/usr/bin/env node
// output-sanitizer.js — Claude PostToolUse hook (D38: delegates to createPostAdapter).
//
// Scans tool output for secrets and records external-source content for the
// F10 taint floor. PostToolUse hooks cannot block; warns to stderr only.
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
const ADAPTER_CAPABILITIES = { envelopeReporting: true };
void ADAPTER_CAPABILITIES;
createPostAdapter({ harnessName: "claude", rateLimitKey: "output-sanitizer", envelopeReporting: ADAPTER_CAPABILITIES.envelopeReporting });
