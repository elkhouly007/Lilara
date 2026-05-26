# Skill: migration-planner

---
name: migration-planner
description: Produce a structured, phased migration plan for database schema changes, API version transitions, or framework upgrades. Each plan includes a pre-migration readiness checklist, numbered execution phases (shadow/dual-write → cutover → backfill → validation), explicit rollback steps per phase, success criteria, and a monitoring checklist. Output is a markdown document ready to paste into a PR description or runbook.
---

# Migration Planner

Transform a migration intent ("we need to change X to Y") into an ordered, reversible execution plan with a rollback path at every phase — so the team can stop and recover at any point without data loss or service disruption.

## When to Use

- A database schema change affects a table that is written to in production (rename column, change type, add NOT NULL)
- An API endpoint contract must change in a way that breaks existing clients
- A framework upgrade changes a fundamental interface used across many files (e.g. ORM version, auth library, runtime version)
- A data model change requires both a code change and a data backfill that can't be done atomically

## Process

1. **Capture the migration intent** — write a one-paragraph summary of:
   - What is changing (source state → target state)
   - Why (performance, correctness, compliance, deprecation)
   - Blast radius (which tables/endpoints/services/clients are affected)
   - Hard deadline or SLA constraint, if any

2. **Classify the migration type** — pick the appropriate template:

   | Type | Key risk | Strategy |
   |------|----------|----------|
   | Schema — column rename | Reads/writes fail during transition | Dual-write with both names |
   | Schema — type change | Existing data may not convert | Shadow column + backfill + swap |
   | Schema — add NOT NULL | INSERT fails until all rows have a value | Add nullable → backfill → add constraint |
   | API — breaking change | Existing clients receive 4xx/5xx | Versioned endpoint + sunset window |
   | Framework upgrade | Runtime behaviour change | Canary deployment + feature flag |

3. **Write the pre-migration checklist** — must all be true before Phase 1 starts:
   - [ ] Migration PR reviewed and approved by at least two engineers
   - [ ] Rollback procedure documented and tested in staging
   - [ ] Monitoring dashboard open and baseline captured
   - [ ] On-call engineer briefed and available
   - [ ] Maintenance window communicated to affected clients (for breaking changes)

4. **Draft the phased plan** — typical four-phase structure:

   **Phase 1 — Prepare (no production impact)**
   - Add new column / new endpoint / new code path
   - Deploy and verify in staging
   - Rollback: undeploy; no state change needed

   **Phase 2 — Shadow (dual-write, reads stay on old)**
   - Production code writes to both old and new; reads still use old
   - Monitor error rates on new write path; validate data parity
   - Rollback: deploy previous code; both columns/paths still present

   **Phase 3 — Cutover (reads switch to new)**
   - Flip read path to new column/endpoint; old write path remains active for one release cycle
   - Monitor client error rates; run parity check on a sample
   - Rollback: flip reads back to old; deploy previous code

   **Phase 4 — Cleanup (remove old)**
   - Remove old column/endpoint after sunset window expires
   - Run final data integrity check
   - Rollback: not possible at this phase — treat cleanup as permanent

5. **Define success criteria** — per phase:
   - Zero increase in error rate on affected paths
   - Data parity check: `SELECT COUNT(*) WHERE new_col != old_col` = 0 (for schema changes)
   - Latency p99 within 10% of pre-migration baseline

6. **Write the monitoring checklist** — metrics to watch during each phase:
   - Error rate on affected endpoints (Dashboard / Sentry / Datadog)
   - Database replication lag (if using CDC)
   - Query execution time for affected tables
   - Consumer error logs for API breaking changes

## Output Format

```markdown
## Migration Plan: rename `users.username` → `users.handle`

### Intent
Rename the `username` column to `handle` to align with new brand terminology.
Affected: `users` table (2.3M rows), 14 query sites across 5 services.

### Pre-Migration Checklist
- [ ] PR reviewed (2 engineers)
- [ ] Staging migration tested
- [ ] Rollback verified in staging
- [ ] On-call briefed
- [ ] No other schema migrations in flight on this table

### Phase 1 — Add `handle` column (deploy: 2026-06-01)
Steps:
  1. `ALTER TABLE users ADD COLUMN handle VARCHAR(50);`
  2. Deploy code that writes to both `username` AND `handle`.
  3. Verify: SELECT COUNT(*) FROM users WHERE handle IS NULL = 2.3M (expected).
Rollback: `ALTER TABLE users DROP COLUMN handle;`

### Phase 2 — Backfill (deploy: 2026-06-02)
Steps:
  1. Batch-update: `UPDATE users SET handle = username WHERE handle IS NULL LIMIT 10000;`
     (repeat until 0 rows affected, rate-limited to 500 req/s)
  2. Verify: SELECT COUNT(*) FROM users WHERE handle IS NULL = 0.
  3. Add NOT NULL: `ALTER TABLE users ALTER COLUMN handle SET NOT NULL;`
Rollback: `ALTER TABLE users ALTER COLUMN handle DROP NOT NULL;`

### Phase 3 — Cutover reads (deploy: 2026-06-05)
Steps:
  1. Update all query sites to read `handle`; keep dual-write active.
  2. Monitor 24 h; check error rate delta < 0.1%.
Rollback: revert query sites to read `username`; dual-write still active.

### Phase 4 — Drop `username` (deploy: 2026-06-12, sunset +7 days)
Steps:
  1. Remove dual-write; code writes only to `handle`.
  2. `ALTER TABLE users DROP COLUMN username;`
  3. Final integrity check: SELECT COUNT(*) FROM users WHERE handle IS NULL = 0.
Rollback: NOT AVAILABLE — treat as permanent.

### Success Criteria
- Error rate on /users endpoints: no increase > 0.1%
- Zero rows with handle IS NULL after Phase 2
- Query p99 within 10% of pre-migration baseline
```

## Constraints

- This skill produces a plan document, not executable migration scripts; SQL and code changes must be written separately and reviewed.
- Phase 4 (cleanup) is deliberately irreversible — the skill flags this clearly and recommends a sunset window before executing.
- Backfill rate limits are recommendations; the actual safe rate depends on production load, database capacity, and replication topology.
- API breaking changes may require longer sunset windows depending on SLA commitments to consumers; the plan template uses 7 days as a default.
- Cross-service dependencies (e.g. services that bypass the API and query the database directly) must be identified manually — this skill does not scan external service repositories.
