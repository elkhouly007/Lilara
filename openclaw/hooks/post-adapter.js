#!/usr/bin/env node
// post-adapter.js — OpenClaw PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
// TODO(F15/Task0.6): publish this via openclaw/manifest.json. Until then,
// treat OpenClaw as envelopeReporting: false.
const ADAPTER_CAPABILITIES = { envelopeReporting: false };
void ADAPTER_CAPABILITIES;
createPostAdapter({ harnessName: "openclaw", rateLimitKey: "openclaw-post-adapter", envelopeReporting: ADAPTER_CAPABILITIES.envelopeReporting });
