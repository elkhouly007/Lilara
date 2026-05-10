#!/usr/bin/env node
// post-adapter.js — OpenCode PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
// TODO(F15/Task0.6): publish this via opencode/manifest.json. Until then,
// treat OpenCode as envelopeReporting: false.
const ADAPTER_CAPABILITIES = { envelopeReporting: false };
void ADAPTER_CAPABILITIES;
createPostAdapter({ harnessName: "opencode", rateLimitKey: "opencode-post-adapter", envelopeReporting: ADAPTER_CAPABILITIES.envelopeReporting });
