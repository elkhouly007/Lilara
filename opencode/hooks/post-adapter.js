#!/usr/bin/env node
// post-adapter.js — OpenCode PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
createPostAdapter({ harnessName: "opencode", rateLimitKey: "opencode-post-adapter" });
