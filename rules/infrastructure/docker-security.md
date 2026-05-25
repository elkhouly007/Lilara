---
last_reviewed: 2026-05-26
version_target: ">=0.2.0"
---

# Docker Security Rules

Best practices for writing secure, reproducible Dockerfiles.

- **Pin base images to digest or exact version tag.** Using `FROM ubuntu:latest` or `FROM node` without a version tag makes builds non-reproducible and silently pulls unreviewed updates. Use `FROM node:20.11-alpine3.19` or pin via `@sha256:...` digest for maximum reproducibility.
- **Run as a non-root user.** Containers running as root escalate any container escape to full host access. Create a dedicated user with `RUN adduser --no-create-home --disabled-password appuser` and switch with `USER appuser` before the final `CMD`/`ENTRYPOINT`.
- **Never put secrets in ENV, ARG, or RUN commands.** Environment variables and build args are baked into image layers and visible via `docker inspect`. Pass runtime secrets via mounted files or a secrets manager; use `--mount=type=secret` for build-time secrets in BuildKit.
- **Use multi-stage builds to minimize the final image surface.** Compile dependencies in a builder stage; copy only the required binary or artifact into a slim final stage. This excludes build tools, dev dependencies, and intermediate files from the shipped image.
- **Scope COPY instructions tightly.** Avoid `COPY . .` — it pulls in `.git`, secrets files, and dev config. Use `.dockerignore` and explicit paths: `COPY src/ /app/src/` and `COPY package*.json /app/`.
- **Declare a HEALTHCHECK instruction.** Containers without a HEALTHCHECK are marked as healthy by default regardless of application state. Define a meaningful check: `HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8080/healthz || exit 1`.
- **Use slim or distroless base images.** Smaller images reduce attack surface (fewer binaries, no shell in distroless). Prefer `alpine`, `debian-slim`, or `gcr.io/distroless/nodejs` over full OS images where the application permits.
- **Restrict exposed ports.** Only `EXPOSE` the ports the application actually listens on. Do not expose management ports (debug, profiling, admin UI) in production images — wire those through separate sidecars or omit entirely.
- **Emit an SBOM for production images.** Generate a Software Bill of Materials at build time (`syft` / `docker sbom`) and attach it as an image attestation. This enables vulnerability scanning to trace CVEs to specific packages in the image.
- **Sign and verify images in CI/CD.** Use Cosign or Docker Content Trust to sign built images and enforce signature verification on pull in production environments. An unsigned image could be a supply-chain substitution.
