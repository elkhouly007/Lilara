# Skill: dockerfile-generator

---
name: dockerfile-generator
description: Generates a production Dockerfile from project analysis: multi-stage build with builder and runtime stages, non-root user, distroless or slim base image, layer-order optimization for cache efficiency, HEALTHCHECK instruction, and a companion .dockerignore. Also estimates the resulting image size and explains every design decision. Cross-references rules/infrastructure/docker-security.md for compliance with ARG security baselines.
---

# Dockerfile Generator

Produce a production-grade, security-hardened Dockerfile from a project analysis — multi-stage, non-root, layer-optimized — instead of iterating from a naive single-stage file.

## When to Use

- A project is being containerized for the first time and needs a production-ready starting point
- An existing Dockerfile is single-stage, runs as root, or has a known oversized image problem
- Preparing a service for Kubernetes deployment where image size, non-root execution, and HEALTHCHECK are required
- Auditing a Dockerfile against `rules/infrastructure/docker-security.md` before a container registry push

## Process

1. **Analyze the project** — determine the runtime environment from:

   | Signal | Inference |
   |---|---|
   | `package.json` with `"start"` script | Node.js runtime |
   | `pyproject.toml` / `requirements.txt` with gunicorn/uvicorn dep | Python WSGI/ASGI |
   | `go.mod` | Go (single static binary) |
   | `Cargo.toml` with `[[bin]]` | Rust (single static binary) |
   | `pom.xml` / `build.gradle` with Spring Boot plugin | JVM / Spring Boot |
   | `Dockerfile` already exists | Read and audit rather than generate from scratch |

   Also determine: exposed port (from `PORT` env usage, `app.listen`, `server.Serve`), healthcheck endpoint (`/health`, `/ping`, `/ready`), and build artifact path (`dist/`, `build/`, the compiled binary).

2. **Select the base images** — follow security-minimal selection (per **Use slim or distroless base images** in `rules/infrastructure/docker-security.md`):

   | Runtime | Builder | Runner |
   |---|---|---|
   | Node.js | `node:20-alpine` | `node:20-alpine` (slim) or `gcr.io/distroless/nodejs20-debian12` |
   | Python | `python:3.12-slim` | `python:3.12-slim` |
   | Go | `golang:1.22-alpine` | `gcr.io/distroless/static-debian12` (static binary) |
   | Rust | `rust:1.78-alpine` | `gcr.io/distroless/static-debian12` |
   | JVM | `eclipse-temurin:21-jdk-alpine` | `eclipse-temurin:21-jre-alpine` |

3. **Generate the multi-stage Dockerfile** — use two stages: `builder` and `runtime`:

   ```dockerfile
   # syntax=docker/dockerfile:1
   ARG NODE_VERSION=20
   FROM node:${NODE_VERSION}-alpine AS builder
   WORKDIR /app

   # Install dependencies first — cached unless lockfile changes
   COPY package*.json ./
   RUN npm ci --omit=dev

   # Copy source and build
   COPY . .
   RUN npm run build

   # ---- Runtime stage ----
   FROM node:${NODE_VERSION}-alpine AS runtime
   WORKDIR /app

   # Non-root user (per docker-security.md: Run containers as a non-root user)
   RUN addgroup -S appgroup && adduser -S appuser -G appgroup

   # Copy only production artifacts
   COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
   COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
   COPY --from=builder --chown=appuser:appgroup /app/package.json ./

   USER appuser

   ENV NODE_ENV=production
   EXPOSE 3000

   HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
     CMD wget -qO- http://localhost:3000/health || exit 1

   CMD ["node", "dist/index.js"]
   ```

4. **Apply layer-order optimization** — copy and install in this order to maximize cache hits:
   - `COPY` only the dependency manifest first (`package*.json`, `requirements.txt`, `go.mod + go.sum`, `Cargo.toml + Cargo.lock`)
   - `RUN` the install/download step (cached until the manifest changes)
   - `COPY . .` source last (invalidates on any source change, but re-uses the dependency cache)

5. **Generate the companion `.dockerignore`**:

   ```
   # Build output already in dist/ from builder — exclude source
   node_modules
   npm-debug.log*
   .env*
   .git
   .github
   tests/
   *.test.ts
   coverage/
   .eslintrc*
   .prettierrc*
   Dockerfile*
   docker-compose*
   README.md
   ```

6. **Estimate image size** — compute approximate size:

   ```
   alpine base:          ~7 MB
   Node.js runtime:      ~50 MB
   node_modules (prod):  <size of node_modules --omit=dev>
   dist/:                <size of build output>
   ──────────────────────
   Estimated total:      ~XX MB
   ```

   Flag if estimated size > 300 MB for a web service — suggest switching to distroless or auditing `node_modules` with `npx bundlephobia`.

7. **Cross-reference docker-security.md** — verify the generated Dockerfile complies with:
   - **Pin exact image digest or tag** (use `node:20-alpine`, not `node:latest`)
   - **Run containers as a non-root user** (done in step 3)
   - **Use slim or distroless base images** (done in step 2)
   - **Do not copy secrets into the image** (`.dockerignore` excludes `.env*`)
   - **Use multi-stage builds** (done in step 3)
   - **Add a HEALTHCHECK instruction** (done in step 3)

   List any rules not satisfied and the reason.

## Output Format

```
## Dockerfile Generator — Output

Runtime: Node.js 20 (npm)
Builder base: node:20-alpine
Runtime base: node:20-alpine
Non-root user: appuser (UID auto-assigned by adduser -S)
Healthcheck: GET /health — interval 30s, timeout 5s, retries 3
Exposed port: 3000
Build artifact: dist/

Generated: Dockerfile
Generated: .dockerignore

### Estimated Image Size

alpine base:            7 MB
Node.js 20 runtime:    51 MB
node_modules (prod):   42 MB  (based on package.json dependencies)
dist/:                  3 MB  (estimated from source size)
─────────────────────────────
Estimated total:      ~103 MB

Verdict: Within target (< 300 MB). ✓

### docker-security.md Compliance

| Rule | Status | Notes |
|---|---|---|
| Pin exact image tag | ✓ | node:20-alpine (consider pinning to sha256 for reproducibility) |
| Non-root user | ✓ | appuser / appgroup created and switched |
| Slim base image | ✓ | alpine variant |
| No secrets in image | ✓ | .dockerignore excludes .env* |
| Multi-stage build | ✓ | builder + runtime stages |
| HEALTHCHECK | ✓ | wget /health, 30s interval |

### Build & Run

docker build -t myapp:local .
docker run -p 3000:3000 --read-only myapp:local

### Next Steps

1. Replace /health with the actual health endpoint path.
2. Set NODE_VERSION build arg in docker-compose.yml or CI.
3. Consider pinning to a sha256 digest for production: node:20-alpine@sha256:<digest>.
4. Run 'docker scout cves myapp:local' to check for known CVEs in the base image.
```

## Constraints

- Cross-references `rules/infrastructure/docker-security.md` by rule name, not by URL — the rule file must be present in the project tree for the compliance table to be generated.
- For Go and Rust static binaries, the generated `CMD` uses the binary path directly; the runtime stage uses `gcr.io/distroless/static-debian12`, which has no shell — do not add `CMD ["/bin/sh", "-c", "..."]` in those cases.
- `HEALTHCHECK` uses `wget` for Alpine-based images and `curl` for Debian-based images — the choice is made automatically based on the detected base image. Distroless images have neither; for those, set up a separate sidecar healthcheck container.
- The `.dockerignore` excludes `tests/` by default — if the test runner must be packaged (e.g., for a test image variant), this exclusion must be removed from the test-image build context.
- The skill generates the Dockerfile locally; it does not build, tag, or push any image.
