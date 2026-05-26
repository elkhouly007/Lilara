# Skill: api-contract-validator

---
name: api-contract-validator
description: Validate a live API surface against an OpenAPI 3.x or Swagger 2.0 specification and classify every discrepancy as additive (safe), non-breaking (client-compatible), or breaking (requires coordination). Discovers routes from framework files (Express, FastAPI, Rails, Gin) or from a spec-diff if two spec versions are provided. Emits a structured finding report with severity and recommended action per deviation.
---

# API Contract Validator

Catch API drift before it reaches clients — compare the routes, parameters, and response shapes that the code actually exposes against the specification that consumers depend on.

## When to Use

- Before a release to confirm no undocumented breaking changes crept into the API
- After a major refactor that touched route handlers or serialisers
- When onboarding a new service to an API gateway that enforces spec compliance
- Comparing two OpenAPI spec versions to classify changes as breaking or non-breaking for a versioning decision

## Process

1. **Locate the OpenAPI spec** — find the canonical spec file:

   ```bash
   ls openapi.{yaml,yml,json} swagger.{yaml,yml,json} \
      docs/api.yaml api/openapi.yaml 2>/dev/null | head -5
   ```

   If two spec files exist (e.g. `openapi-v1.yaml` and `openapi-v2.yaml`), compare spec-to-spec. Otherwise compare spec-to-code.

2. **Extract the live route table from code** — detect framework and extract routes:

   ```bash
   # Express / Node — find router declarations
   grep -rn --include='*.{js,ts}' -E "router\.(get|post|put|patch|delete|all)\(" src/

   # FastAPI / Python
   grep -rn --include='*.py' -E "@(app|router)\.(get|post|put|patch|delete)\(" .

   # Rails
   grep -rn --include='*.rb' -E "^\s+(get|post|put|patch|delete|resources?)\b" config/routes.rb

   # Gin / Go
   grep -rn --include='*.go' -E "\.(GET|POST|PUT|PATCH|DELETE|Any)\(" .
   ```

3. **Build the spec route table** — parse the spec file for `paths` entries and their HTTP methods. Extract: path pattern, method, required parameters, request body schema reference, response codes and schema references.

4. **Diff the two route tables** — compare spec routes vs live routes:

   | Finding category       | Definition |
   |------------------------|------------|
   | **Spec-only**          | Route defined in spec but not found in code (documentation drift or dead endpoint) |
   | **Code-only**          | Route found in code but not in spec (undocumented endpoint) |
   | **Parameter mismatch** | Route exists in both but parameter names, types, or required flags differ |
   | **Response mismatch**  | Route exists in both but response status codes or schema refs differ |

5. **Classify each finding** — apply the breaking-change rubric:

   | Finding | Breaking? | Severity |
   |---------|-----------|----------|
   | Code-only route (added) | No | Additive |
   | Spec-only route (removed from code) | Yes — if clients call it | HIGH |
   | Required parameter removed | Yes | HIGH |
   | Required parameter added | Yes | HIGH |
   | Optional parameter removed | Non-breaking | MEDIUM |
   | Response field removed from schema | Yes | HIGH |
   | Response field added to schema | Non-breaking | LOW |
   | Status code removed (e.g. 200 → 204 only) | Yes | HIGH |
   | Status code added | Non-breaking | LOW |

6. **Emit the findings report** — structure as severity buckets with a recommended action per finding.

## Output Format

```
## API Contract Validation Report

Spec: openapi.yaml (OpenAPI 3.0.3)
Routes in spec:  42
Routes in code:  45  (3 undocumented)

### ❌ Breaking Changes (3)
  POST /users/{id}/deactivate
    → Route exists in code but spec says it was removed in this version.
    → Action: restore the route or update the spec to 404 + deprecation notice.

  GET /orders — required parameter `currency` added in code, missing from spec
    → Existing spec-compliant clients will receive 422 Unprocessable Entity.
    → Action: add `currency` to spec as required, or make it optional with a default.

  GET /products/{id} — response schema removed field `legacyCode`
    → Clients parsing `legacyCode` will silently receive undefined.
    → Action: keep field in schema as deprecated, or coordinate removal with consumers.

### ⚠ Non-Breaking Changes (5)
  GET /health — code-only route (undocumented)
  POST /users — optional field `referralCode` added to request body
  …

### ✅ Additive Changes (2)
  GET /v2/reports — new endpoint, not yet in spec
  …

### 📋 Summary
  HIGH severity (breaking): 3
  MEDIUM severity: 5
  LOW / Additive: 2
  Spec-code match: 37/42 spec routes fully matched
```

## Constraints

- Static route extraction may miss dynamically-registered routes (e.g. plugin-based frameworks that register routes at runtime).
- Does not execute the API — all validation is static file analysis.
- Schema compatibility is checked at the reference level (schema names), not deep structural JSON Schema diff; nested schema changes require a dedicated JSON Schema diff tool.
- Spec parsing supports OpenAPI 3.0/3.1 and Swagger 2.0 YAML/JSON; vendor extensions (`x-*`) are ignored.
- Path parameter names are normalised for comparison (`{id}` and `:id` are treated as equivalent).
