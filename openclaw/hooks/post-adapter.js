#!/usr/bin/env node
// post-adapter.js — OpenClaw PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
createPostAdapter({ harnessName: "openclaw", rateLimitKey: "openclaw-post-adapter" });
