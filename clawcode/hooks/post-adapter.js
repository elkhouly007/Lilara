#!/usr/bin/env node
// post-adapter.js — Claw Code PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
// TODO(F15/Task0.6): publish this via clawcode/manifest.json. Until then,
// treat Claw Code as envelopeReporting: false.
const ADAPTER_CAPABILITIES = { envelopeReporting: false };
void ADAPTER_CAPABILITIES;
createPostAdapter({ harnessName: "clawcode", rateLimitKey: "clawcode-post-adapter", envelopeReporting: ADAPTER_CAPABILITIES.envelopeReporting });
