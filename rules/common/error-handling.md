---
last_reviewed: 2026-05-26
version_target: 1.0.x
---

# Error Handling Rules

Prevent silent failures, undefined behavior, and opaque incidents by encoding error discipline at every layer.

- **Never swallow exceptions silently.** An empty `catch {}` or a bare `except: pass` hides bugs and makes incidents undiagnosable. At minimum, log the exception class, message, and stack trace at ERROR level, then decide whether to rethrow, wrap, or surface as a user-facing error. Silent suppression is only valid when the absence of the resource is explicitly the success case (e.g., checking file existence before creation).

- **Use a typed error hierarchy rooted at a domain base class.** Throwing a raw `Error` or `Exception` forces callers to match on strings. Define `DomainError → OperationalError / ProgrammerError` and subclass per failure mode (e.g., `AuthError`, `RateLimitError`, `ValidationError`). This makes `catch` clauses narrow and prevents catching errors the caller cannot handle.

- **Place error boundaries at every module seam.** Internal functions propagate typed errors; public API surfaces catch-and-wrap them into the caller's error vocabulary. A raw database `UniqueConstraintViolation` should never escape the data layer untrapped — it must be wrapped as `ConflictError` before crossing the module boundary, stripping internal detail that leaks schema.

- **Implement retry with exponential backoff and bounded jitter.** Transient failures (network timeouts, 429s, lock contention) must be retried with base×2^n delay plus ±10–30% jitter to prevent thundering-herd on the upstream. Cap total attempts (default: 3) and total elapsed time (default: 30 s). Log each retry attempt at WARN with attempt number, delay, and the underlying error.

- **Wire circuit breakers at integration boundaries.** Once an upstream service fails a configurable threshold (e.g., 5 failures in 10 s), open the circuit and return a fast fallback for the trip duration (e.g., 30 s) instead of queuing more failing requests. Libraries: `cockatiel` (Node), `resilience4j` (JVM), `circuitbreaker` (Go). A missing circuit breaker turns a downstream outage into a cascading one.

- **Define explicit graceful degradation paths.** Every feature that depends on an external service must have a documented fallback: return cached data, return a default, queue the request for later, or surface a user-friendly degraded-mode message. "The service is unavailable" with no fallback is a design gap. Document the fallback in the callee's interface contract.

- **Standardize the error envelope for all API responses.** Clients must parse one schema: `{ error: { code, message, details?, request_id } }`. Never return plain text errors, vary the envelope shape across endpoints, or expose raw exception messages. `details` is an array of field-level validation errors for 400 responses; it is omitted for server-side errors to prevent information disclosure.

- **Apply the log-once principle.** Log an error once, at the layer closest to the origin, then propagate the (now-logged) error upward without logging again. Multiple log entries for the same error instance make incident timelines noisy and give false signal on error frequency in alerting dashboards.

- **Never log-and-rethrow without re-wrapping.** `catch (e) { log(e); throw e; }` violates log-once. Instead, log the original error, wrap it as a higher-level typed error preserving the original as `cause`, and throw the wrapper. This gives the upper layer a clean typed error to handle while preserving the root cause in the causal chain for debugging.

- **Wrap errors with contextual metadata at every propagation point.** A bare rethrow discards the context of what the caller was doing. Add the operation name, input identifiers, and user/session context: `new PaymentError("charge failed", { cause: stripeErr, customerId, amount })`. Modern runtimes (Node 16+, Python 3.11+, Java) support structured cause chaining natively.

- **Classify errors as transient or permanent before retrying.** Retrying a 400 Bad Request, a 401 Unauthorized, or a `ValidationError` wastes time and can cause side effects. Only transient errors (network timeouts, 429, 503, lock conflicts) are retry candidates. Implement an `isRetryable(error)` predicate consulted before every retry decision; make the classification explicit and testable.

- **Account for errors in the error budget.** Track error rate per endpoint and per background job as a Service Level Indicator. Alert at 50% error budget consumption, not at 100%. This means the error rate threshold (e.g., 0.1% for a p99.9 SLO) must be wired into your observability platform before the feature ships, not after an incident.

- **Verify fallback data correctness before serving it.** Returning stale cache on primary failure is correct only if the cache content is still valid for the use case. Serving a price list cached 24 hours ago on a checkout flow is a correctness bug. Annotate every fallback path with its data-staleness tolerance and enforce it with a TTL check or a last-verified timestamp.

- **Enforce idempotency on retried operations.** Retried writes must produce the same net state as a single write. Implement idempotency via client-generated idempotency keys (UUID v4, persisted for the retry window), server-side deduplication on the key, and a response cache for the key TTL. Any non-idempotent operation that is retried on transient failure is a double-write bug waiting to happen.

- **Route unhandled errors to dead-letter destinations.** Background jobs, message queue consumers, and async workflows that exhaust retries must write the failed payload to a dead-letter queue (DLQ) or table with the full error, attempt count, and timestamp. Silently dropping the message on final failure is an invisible data-loss event. Alert when DLQ depth exceeds threshold.
