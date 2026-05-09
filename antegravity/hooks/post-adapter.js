#!/usr/bin/env node
// post-adapter.js — antegravity PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
// TODO(F15/Task0.6): publish this via antegravity/manifest.json. Until then,
// treat antegravity as envelopeReporting: false.
const ADAPTER_CAPABILITIES = { envelopeReporting: false };
void ADAPTER_CAPABILITIES;
createPostAdapter({ harnessName: "antegravity", rateLimitKey: "antegravity-post-adapter", envelopeReporting: ADAPTER_CAPABILITIES.envelopeReporting });
