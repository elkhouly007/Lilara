# Skill: secrets-rotation-planner

---
name: secrets-rotation-planner
description: Inventory all secrets referenced in a project (env files, CI variables, secret manager references, hardcoded patterns flagged by secrets-history-scan), classify each by blast radius and rotation complexity, and emit a zero-downtime rotation plan. Each secret in the plan gets a rotation procedure with the exact steps: new-secret-issued → dual-accept window → consumers updated → old-secret-revoked → verification.
---

# Secrets Rotation Planner

Turn a scattered set of secrets into a structured, zero-downtime rotation plan — ordered by blast radius so the highest-risk secrets are rotated first, with a dual-accept window that prevents service interruption.

## When to Use

- A secret has been exposed (in git history, logs, a PR comment, or a breach report)
- Performing a security audit that requires proof of secret lifecycle management
- Rotating all credentials before a SOC 2 audit or at a quarterly rotation schedule
- After a team member leaves and their personal API tokens need to be revoked

## Process

1. **Inventory secret references** — scan the project for all secret reference sites:

   ```bash
   # .env files and dotenv patterns
   find . -name '.env*' ! -name '.env.example' ! -path './.git/*' | xargs grep -l '=' 2>/dev/null

   # CI variable references (GitHub Actions)
   grep -rn --include='*.yml' -E '\$\{\{ secrets\.' .github/

   # AWS Secrets Manager / Vault / Parameter Store references
   grep -rn --include='*.{ts,js,py,go}' \
     -E "(secretsmanager|SecretString|getSecret|vault\.read|ssm\.getParameter)" src/

   # Hardcoded patterns (from secrets-history-scan findings)
   grep -rn --include='*.{ts,js,py,go,env}' \
     -E "(AKIA[A-Z0-9]{16}|sk-[a-zA-Z0-9]{32,}|ghp_[a-zA-Z0-9]{36})" . 2>/dev/null
   ```

2. **Build the secret inventory** — for each secret found, record:

   | Field | Description |
   |-------|-------------|
   | Secret name | Canonical reference name (e.g. `DATABASE_URL`, `STRIPE_SECRET_KEY`) |
   | Type | API key / OAuth token / DB credential / TLS cert / SSH key / other |
   | Reference sites | File paths + CI/CD pipeline names where the secret is consumed |
   | Owner / issuer | Which service or team issued the secret |
   | Last rotation | Date if known; "unknown" if not |

3. **Classify blast radius** — score each secret 1–5:

   | Score | Meaning |
   |-------|---------|
   | 5 (CRITICAL) | Production database credential, root API key, signing key for JWTs/payments |
   | 4 (HIGH) | Third-party API key with write access (Stripe live, SendGrid, Twilio) |
   | 3 (MEDIUM) | Read-only API key, staging database credential |
   | 2 (LOW) | Internal service-to-service token (short TTL) |
   | 1 (MINIMAL) | Public key, non-sensitive config value |

4. **Order the rotation plan** — rotate CRITICAL secrets first, then HIGH, descending. Within the same blast-radius tier, rotate the ones with the longest time since last rotation first.

5. **Write the rotation procedure per secret** — each procedure follows this zero-downtime pattern:

   **Step 1 — Issue new secret**: generate or request a new credential from the issuer (AWS IAM, Stripe dashboard, GitHub, etc.) without revoking the old one yet.

   **Step 2 — Deploy with dual-accept** (duration: 1 deployment cycle, typically 15 min–24 h):
   - Update the secret in the secret manager (Vault, AWS Secrets Manager, GitHub Actions secret).
   - Application must accept BOTH the old and new secret during this window (e.g. try new, fallback to old for auth).
   - Monitor error rates during the dual-accept window.

   **Step 3 — Verify new secret is active** — confirm at least one successful authentication with the new credential in production logs.

   **Step 4 — Revoke old secret** — remove the old credential from the issuer system. Update any last references.

   **Step 5 — Verify revocation** — confirm the old secret is no longer accepted by the downstream service.

6. **Generate the rotation schedule** — produce a markdown table with owner, ETA, and verification checklist per secret.

## Output Format

```markdown
## Secret Rotation Plan

Generated: 2026-05-26
Secrets inventoried: 11
Secrets requiring rotation: 6 (2 CRITICAL, 3 HIGH, 1 MEDIUM)

### Rotation Order

| Priority | Secret | Type | Last Rotated | Blast Radius |
|----------|--------|------|--------------|--------------|
| 1 | `DATABASE_URL` (prod) | DB credential | unknown | CRITICAL (5) |
| 2 | `JWT_SIGNING_SECRET` | Signing key | 2025-01-01 | CRITICAL (5) |
| 3 | `STRIPE_SECRET_KEY` | Payment API key | 2024-11-01 | HIGH (4) |
| 4 | `SENDGRID_API_KEY` | Email API key | 2025-03-01 | HIGH (4) |
| 5 | `GITHUB_PAT` | PAT (CI) | 2024-09-01 | HIGH (4) |
| 6 | `STAGING_DB_URL` | DB credential | 2025-01-01 | MEDIUM (3) |

### Procedure: DATABASE_URL (prod)

Owner: platform-team
ETA: 48 h (requires DB maintenance window)

Step 1 — Issue new credential via AWS RDS console.
  Assign it the same IAM role and permissions as the current user.

Step 2 — Store in AWS Secrets Manager under `prod/app/DATABASE_URL_NEW`.
  Update application to try `DATABASE_URL_NEW` first, fall back to `DATABASE_URL`.
  Deploy and monitor for 24 h.

Step 3 — Verify: check logs for "Connected to database" using new credential.

Step 4 — Revoke old credential in RDS console.
  Remove `DATABASE_URL` from Secrets Manager.
  Rename `DATABASE_URL_NEW` → `DATABASE_URL`.

Step 5 — Deploy clean config (no fallback). Monitor 1 h.

Verification checklist:
  - [ ] Old credential rejected by RDS: test with psql -U <old_user>
  - [ ] Application error rate unchanged
  - [ ] No "authentication failed" events in CloudWatch
```

## Constraints

- Inventory is based on static file scanning; secrets stored only in runtime environment variables (injected by orchestration, not in files) may not be detected — supplement with a manual review of the deployment configuration.
- Dual-accept window requires application-level support; some credential types (e.g. symmetric signing keys) cannot be dual-accepted — those must rotate with a brief read-only window instead.
- This skill produces the rotation plan; the actual revocation must be performed by an authorised human operator — this skill does not call any secret management API.
- For hardcoded secrets flagged in git history, rotation alone is insufficient — the history must also be purged using `git filter-repo` or equivalent (use `skills/secrets-history-scan.md` for the purge procedure).
- TLS certificate rotation has different tooling (Let's Encrypt / AWS ACM / cert-manager); this plan covers API keys and credentials, not TLS lifecycle.
