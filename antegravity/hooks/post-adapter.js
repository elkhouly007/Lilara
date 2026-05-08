#!/usr/bin/env node
// post-adapter.js — antegravity PostToolUse adapter (D38: delegates to createPostAdapter).
"use strict";

const { createPostAdapter } = require("../../runtime/post-adapter-factory");
createPostAdapter({ harnessName: "antegravity", rateLimitKey: "antegravity-post-adapter" });
