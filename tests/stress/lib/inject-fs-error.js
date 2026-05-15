"use strict";

// chmod-based read-only injector. Returns a restore() callback.
const fs = require("node:fs");

function makeReadOnly(dir) {
  let prev = null;
  try { prev = fs.statSync(dir).mode; } catch { /* ignore */ }
  try { fs.chmodSync(dir, 0o500); } catch { /* best-effort */ }
  let done = false;
  return function restore() {
    if (done) return;
    done = true;
    try { fs.chmodSync(dir, prev != null ? prev : 0o700); } catch { /* ignore */ }
  };
}

module.exports = { makeReadOnly };
