"use strict";

// Date.now-only shim. Returns a restore() function. Other Date methods are
// left untouched so we steer only the engine's hash-chain timestamp path.

function freezeClockAt(epochMs) {
  const fixed = Number(epochMs);
  if (!Number.isFinite(fixed)) throw new Error("freezeClockAt: epochMs must be finite");
  const orig = Date.now;
  Date.now = function frozen() { return fixed; };
  let done = false;
  return function restore() { if (done) return; done = true; Date.now = orig; };
}

module.exports = { freezeClockAt };
