#!/usr/bin/env node
// post-adapter.js — Claw Code PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
createPostAdapter({ harnessName: "clawcode", rateLimitKey: "clawcode-post-adapter" });
