---
pattern_id: DROP DATABASE / DROP TABLE
pattern_source: claude/hooks/dangerous-patterns.json
severity: critical
---

# DROP DATABASE / DROP TABLE — Rationalization Defense

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "It's just the test database." | Test databases often contain sanitized copies of production data, realistic schemas, and migration history. Dropping them forces a full re-seed and breaks other developers' running environments. |
| "The migration script says to drop the table first." | A migration script in a file is advisory until it runs. Running it — especially in the wrong environment — is irreversible. Verify the environment variable, connection string, and database name explicitly before executing any DROP. |
| "The data can be regenerated from the seed files." | Seed files may be outdated. Custom test data added by QA, staging fixtures, or integration test state will not be in the seed. Verify what exactly will be lost before dropping. |
| "It's a local Docker database — it doesn't matter." | Docker database volumes persist across container restarts. Dropping the schema destroys weeks of accumulated test data and may invalidate other containers that share the volume. |
| "TRUNCATE is safer than DROP." | `TRUNCATE TABLE` still destroys all rows irreversibly and typically fires fewer triggers than `DELETE`. It is faster than `DELETE` precisely because it bypasses row-level logging. "Safer" means less structural destruction, not recoverable. |

## Red Flags (STOP thoughts)

- "The migration requires it — I'm just following the script."
- "It's only test / staging / dev data."
- "I'll run the seeds again after."
- "TRUNCATE is not the same as DROP."
- "The database name has 'test' in it, so it's safe."

## Why this pattern is here

Database schema destruction is irreversible without a verified backup. In the
OWASP Top 10 for agents, unguarded DDL on live or semi-live databases ranks
alongside credential exfiltration as the highest-impact category of agent error.

Real incidents: staging databases with months of QA data dropped by a migration
runner that connected to the wrong environment; production tables truncated by
a scheduled job whose connection-string template resolved incorrectly.

The pattern matches both `DROP TABLE`, `DROP DATABASE`, `DROP SCHEMA`, and
`TRUNCATE TABLE` because all four are DDL-level destructive operations with
no automatic undo.

## Safer alternative

```sql
-- Instead of DROP TABLE: rename to a "deleted_" prefix for a cooling-off period
ALTER TABLE users RENAME TO deleted_users_20260524;

-- Verify what you're about to destroy
SELECT COUNT(*) FROM users;
SELECT table_name, table_rows FROM information_schema.tables WHERE table_name = 'users';

-- Create a point-in-time backup before any schema change
pg_dump -Fc mydb -f mydb-$(date +%Y%m%d).dump

-- Use a migration tool with explicit rollback support
flyway migrate   # has --dry-run and rollback capability
liquibase rollback
```
