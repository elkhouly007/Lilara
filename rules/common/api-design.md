---
last_reviewed: 2026-05-26
version_target: 1.0.x
---

# API Design Rules

Enforce surface consistency, predictable semantics, and forward-compatibility across REST and GraphQL APIs.

- **Use correct HTTP verbs matched to their RFC 9110 semantics.** `GET` is safe and idempotent — no side effects; `POST` creates a subordinate resource or triggers a non-idempotent action; `PUT` fully replaces a resource; `PATCH` partially updates it; `DELETE` removes it. Misusing verbs (e.g., `GET /deleteUser`) breaks HTTP caching, browser prefetch, and REST client assumptions.

- **Name resources as plural nouns in URL paths, not verbs.** `/orders`, `/users/{id}`, `/invoices/{id}/line-items` describe resources; `/getOrders`, `/processPayment`, `/deleteUser` describe actions. Action-oriented URLs belong to RPC-style APIs (gRPC, GraphQL mutations) — for REST, keep all URLs as noun hierarchies.

- **Implement cursor-based pagination rather than offset-based for production endpoints.** Offset pagination (`?page=3&size=20`) is inconsistent under concurrent writes (items shift positions between pages). Cursor pagination (`?cursor=<opaque_token>&limit=20`) is stable, scalable to large datasets, and works correctly on append-only streams. The response envelope must include `next_cursor` (null when exhausted) and optionally `total_count`.

- **Version the API at the URL path or via a stable versioning header.** URL versioning (`/v1/orders`) is explicit, cache-friendly, and discoverable. Header versioning (`API-Version: 2024-01-01`) avoids URL proliferation for date-versioned APIs (Stripe model). Never use query-string versioning (`?version=2`) — it breaks caching and is invisible to load balancers. Document the deprecation policy (minimum 6-month sunset window) in the API contract.

- **Return errors in a single, documented envelope across all endpoints.** Every non-2xx response must conform to `{ error: { code: string, message: string, details?: object[], request_id: string } }`. Never return a different error schema for 4xx vs 5xx, never return HTML error pages to JSON callers, and never omit `request_id` — it is the primary link between client-side errors and server-side logs.

- **Require idempotency keys on all non-idempotent POST endpoints.** Clients pass a UUID v4 in `Idempotency-Key: <uuid>` (RFC draft); the server stores the key with a TTL (minimum 24 hours) and returns the cached response for duplicate requests within the window. Without this, network retries on payment, order creation, and notification endpoints cause duplicate side effects that are expensive to reverse.

- **Support content negotiation via `Accept` and `Content-Type` headers.** Default to `application/json`. If the API serves multiple formats (JSON, CSV, PDF), inspect `Accept` and return `406 Not Acceptable` when the requested format is unsupported rather than silently returning JSON. Include `Content-Type` in every response — never let the client infer the format from the URL extension.

- **Include HATEOAS links in resource responses for state-machine resources.** Resources that have a lifecycle (e.g., `Order` with states draft → submitted → fulfilled → cancelled) must include a `links` map listing the valid next-state transitions for the current state: `{ links: { submit: "/orders/42/submit", cancel: "/orders/42/cancel" } }`. This allows clients to discover valid actions without hardcoding state logic.

- **Emit rate-limit headers on every response and return 429 with retry guidance.** Include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (Unix epoch of next window) on every response so clients can self-throttle. On limit breach, return 429 with a `Retry-After` header. Do not silently drop requests with 200 or return 500 when the real cause is rate limiting.

- **Separate authentication schemes from authorization schemes in design.** `Authorization: Bearer <token>` identifies the caller; a separate RBAC or ABAC layer authorizes the action. Never encode role checks in the authentication middleware — this conflates two concerns and makes role changes require auth-layer deploys. Map `403 Forbidden` (authenticated but unauthorized) and `401 Unauthorized` (not authenticated) to their correct status codes.

- **Use `PATCH` with a partial-update body and `PUT` only for full-replacement semantics.** `PATCH /orders/42` with `{ "status": "cancelled" }` updates a single field; `PUT /orders/42` replaces the full resource and must include all required fields. Clients that send `PUT` with partial payloads cause field-reset bugs on fields they omit. If the API only supports partial updates, document that `PUT` is disallowed and return `405 Method Not Allowed`.

- **Design batch endpoints with per-item status in the response.** `POST /orders/batch` that processes 100 items must return a response with per-item results: `[{ id, status: "ok" | "error", error?: { code, message } }]`. A single top-level 200 or 500 for a batch is meaningless — clients cannot determine which items succeeded, which failed, and which need retry.

- **Verify webhook payloads with an HMAC signature.** Sign each webhook payload with `HMAC-SHA256` using a shared secret, emit the hex digest in `X-Webhook-Signature` (or equivalent), and document the exact canonicalization (headers + body order, encoding). Reject replays by requiring a `X-Webhook-Timestamp` within ±5 minutes. Without signature verification, webhooks are a viable SSRF and spoofed-event attack surface.

- **Emit deprecation headers before removing any field or endpoint.** Use `Deprecation: true` and `Sunset: <RFC7231 date>` headers on deprecated endpoints for the full sunset window. For deprecated response fields, document them in the OpenAPI spec with `deprecated: true` and a migration note. Never remove a field or endpoint without a documented sunset period — breaking changes without notice violate the implicit API contract.

- **Enforce request/response symmetry for CRUD resources.** The fields accepted in a `POST /resource` body should map 1:1 to the fields returned in `GET /resource/{id}`, minus computed/server-generated fields (`id`, `created_at`, `etag`). Asymmetric APIs where the create body and the read response have different field names force clients to maintain two schemas. Document every asymmetry in the OpenAPI spec with a `x-read-only` or `x-write-only` extension.
