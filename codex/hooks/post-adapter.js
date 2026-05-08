#!/usr/bin/env node
// post-adapter.js — Codex PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
createPostAdapter({ harnessName: "codex", rateLimitKey: "codex-post-adapter" });
