"use strict";

// Synthetic adapter wrapper that throws a rate-limit-shaped error on the
// Nth call. Simulates the kind of error decide() would observe if a
// downstream dependency rate-limited.

class RateLimitError extends Error {
  constructor(msg) { super(msg); this.name = "RateLimitError"; this.code = "RATE_LIMITED"; this.status = 429; }
}

function makeRateLimitedAdapter(opts) {
  const failOnCall = Math.max(1, Number((opts && opts.failOnCall) || 1));
  const message = String((opts && opts.message) || "rate limit exceeded");
  let calls = 0;
  return {
    fetchInfo() { calls += 1; if (calls >= failOnCall) throw new RateLimitError(message); return { ok: true, calls }; },
    callsMade() { return calls; },
  };
}

module.exports = { makeRateLimitedAdapter, RateLimitError };
