#!/usr/bin/env node
// post-adapter.js — Codex PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
// TODO(F15/Task0.6): publish this via codex/manifest.json. Until then,
// treat Codex as envelopeReporting: false.
const ADAPTER_CAPABILITIES = { envelopeReporting: false };
void ADAPTER_CAPABILITIES;
createPostAdapter({ harnessName: "codex", rateLimitKey: "codex-post-adapter", envelopeReporting: ADAPTER_CAPABILITIES.envelopeReporting });
