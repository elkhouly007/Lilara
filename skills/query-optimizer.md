# Skill: query-optimizer

---
name: query-optimizer
description: Review ORM and raw SQL query patterns for N+1 fetch loops, full-table scans, missing index candidates, and over-fetching. Covers Prisma, TypeORM, SQLAlchemy, GORM, ActiveRecord, and raw SQL. For each finding, explains the cost, shows the problematic code, and gives a corrected version. If EXPLAIN output is provided, incorporates it into the analysis.
---

# Query Optimizer

Find the database queries that will cause production incidents at scale — N+1 loops, full-table scans, and missing indexes — before a DBA does it in a post-mortem.

## When to Use

- Slow API endpoints that touch the database, identified by p95 latency > 200 ms in profiling
- A new feature that adds queries to a loop or loads a relation lazily in a list view
- Pre-launch database review before traffic scales beyond the test dataset
- EXPLAIN output from a slow-query log that you need help interpreting

## Process

1. **Locate query sites** — find all database interaction points:

   ```bash
   # Prisma
   grep -rn --include='*.{ts,js}' "prisma\." src/

   # TypeORM
   grep -rn --include='*.{ts,js}' -E "\.(find|findOne|createQueryBuilder|getRepository)" src/

   # SQLAlchemy
   grep -rn --include='*.py' -E "(session\.(query|execute)|db\.query)" .

   # GORM
   grep -rn --include='*.go' -E "db\.(Find|First|Where|Preload)" .

   # Raw SQL
   grep -rn --include='*.{ts,js,py,go,rb}' -E "(\"SELECT|'SELECT|`SELECT)" .
   ```

2. **Detect N+1 patterns** — look for queries inside loops:
   - **Loop over results, then query per item** — code pattern: `for item in results: db.query(item.id)`
   - **ORM lazy-loading inside a list renderer** — e.g. accessing `.author.name` on each post in a loop without `.include('author')` or `.joinedload(Post.author)`
   - **Multiple sequential queries that could be a single JOIN or `IN` clause**

   For each N+1 found, calculate the worst-case query count: `1 + N` where N is the expected list size.

3. **Detect full-table scans** — look for queries without a `WHERE` clause on an indexed column, or with non-selective filters:
   - `SELECT * FROM orders` with no WHERE
   - Filtering on a column that is unlikely to be indexed: `WHERE LOWER(email) = ?`
   - ORM calls like `.findAll()` with no `where` option on a large table

4. **Identify missing index candidates** — for each WHERE clause column in a high-frequency query, check whether an index exists:

   ```sql
   -- PostgreSQL: list indexes on a table
   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'orders';

   -- MySQL
   SHOW INDEX FROM orders;
   ```

   Flag columns used in WHERE, JOIN ON, or ORDER BY that have no index.

5. **Review over-fetching** — look for `SELECT *` or ORM calls that load full entities when only 1–2 columns are needed. Each extra column increases network bandwidth and memory allocation per row.

6. **Incorporate EXPLAIN output** (if provided) — read the query plan and flag:
   - `Seq Scan` on a large table (expected `Index Scan` or `Bitmap Index Scan`)
   - High `cost` estimates relative to the table's row count
   - `Hash Join` on columns without statistics (stale `ANALYZE`)

7. **Write the findings report** — one finding per issue, with the code location, the problematic query, the corrected version, and an estimated improvement.

## Output Format

```
## Query Optimisation Report

Files scanned: 23 (Prisma + raw SQL)
Issues found: 4 (1 HIGH, 2 MEDIUM, 1 LOW)

### ❌ HIGH — N+1 on post list (src/api/posts.ts:47)

Problem:
  const posts = await prisma.post.findMany()         // 1 query
  for (const post of posts) {
    const author = await prisma.user.findUnique({ where: { id: post.authorId } })
    // ↑ N queries — one per post
  }

Fix:
  const posts = await prisma.post.findMany({
    include: { author: true }                         // 1 + 1 query (joined)
  })

Impact: 100 posts → 101 queries reduced to 2.

### ⚠ MEDIUM — Missing index on orders.status (migration 20260301)

Problem: GET /orders?status=pending hits a Seq Scan on 1.2M rows.

Fix:
  CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status)
  WHERE status != 'completed';   -- partial index excludes 90% of rows

### ⚠ MEDIUM — Over-fetching in user list (src/api/users.ts:12)

Problem: SELECT * returns 22 columns; view only renders name + email.

Fix:
  await prisma.user.findMany({ select: { id: true, name: true, email: true } })

### ℹ LOW — Unparameterised LIKE in search (src/api/search.ts:8)
  WHERE title LIKE '%' || $1 || '%' cannot use a btree index.
  Consider pg_trgm GIN index for full-text search on large datasets.
```

## Constraints

- Static analysis only — does not execute queries or connect to a database.
- Index recommendations are advisory; the actual index type (btree, hash, GIN, partial) depends on the query pattern, data distribution, and write/read ratio for that table.
- N+1 detection is based on code pattern analysis; loop nesting depth > 2 may produce false positives if the outer loop is a small bounded set (e.g. iterating over 3 statuses).
- EXPLAIN output analysis requires the plan to be provided as text input; this skill does not run EXPLAIN itself.
- Covering index recommendations (index includes) require knowing which columns are in SELECT — accurate only if SELECT columns are explicit, not `*`.
