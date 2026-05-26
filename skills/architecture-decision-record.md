# Skill: architecture-decision-record

---
name: architecture-decision-record
description: Generates an Architecture Decision Record (ADR) in Nygard format (Title / Date / Status / Context / Decision / Consequences) from a conversation transcript, a free-text description, or an interview with the engineer. Infers the next monotonic ADR number from the docs/adr/ directory, writes the file at docs/adr/NNNN-<slug>.md, and maintains the ADR status state machine (Proposed → Accepted → Deprecated → Superseded-by-X). Cross-links related ADRs when referenced.
---

# Architecture Decision Record

Capture architectural decisions as first-class artifacts so future engineers understand why the codebase is shaped the way it is — not just what it does, but why it was built that way.

## When to Use

- A significant technical decision has been made or is being debated (framework choice, database technology, API style, authentication approach, data model)
- A previous architectural choice needs to be revisited, deprecated, or superseded
- The team needs a record of a decision made under constraint (timeline, cost, team expertise) to inform future changes
- Preparing for a technical audit or onboarding engineers who need architectural context

## Process

1. **Extract the decision** — gather the following inputs from the conversation or a structured interview:

   - **What decision was made?** (the chosen option)
   - **What were the alternatives considered?** (at least two)
   - **What was the driving context?** (requirements, constraints, team capabilities, timeline)
   - **What are the consequences?** (positive: what becomes easier; negative: what becomes harder; neutral: what is now a constraint)
   - **What is the current status?** (Proposed / Accepted / Deprecated / Superseded-by-NNNN)
   - **Are there related ADRs?** (references to existing ADR files by number)

2. **Assign the ADR number** — read the `docs/adr/` directory to find the highest existing NNNN. Assign the next sequential number. If the directory does not exist, create it and start at 0001.

   ```bash
   ls docs/adr/*.md 2>/dev/null | sort -t'-' -k1 -n | tail -1
   # → docs/adr/0007-use-postgres-over-mysql.md  (next = 0008)
   ```

3. **Generate the filename slug** — kebab-case, maximum 6 words, from the decision title:
   - "Use PostgreSQL instead of MySQL" → `0008-use-postgresql-over-mysql.md`
   - "Adopt trunk-based development" → `0009-adopt-trunk-based-development.md`

4. **Write the ADR file** in Nygard format:

   ```markdown
   # ADR-0008: Use PostgreSQL over MySQL for the primary datastore

   Date: 2026-05-26
   Status: Accepted

   ## Context

   The platform requires full-text search, JSON document storage for flexible user-defined metadata,
   and row-level security for multi-tenant data isolation. The team evaluated MySQL 8.0, PostgreSQL 16,
   and MongoDB 7.0.

   MySQL 8.0 was ruled out because its full-text search is limited to MyISAM tables (no transactions),
   its JSON support lacks the jsonpath operators needed for the metadata query patterns identified in
   the product spec, and row-level security requires application-layer enforcement rather than
   database-native policy.

   MongoDB was ruled out because the team has stronger relational modeling expertise and the relational
   schema fits the domain model without requiring document nesting.

   ## Decision

   We will use PostgreSQL 16 as the primary datastore.

   - Full-text search via `tsvector` / `tsquery` with `pg_trgm` for fuzzy matching.
   - JSON/JSONB columns for user-defined metadata with jsonpath query support.
   - Row-level security (RLS) policies for tenant isolation at the database layer.

   ## Consequences

   **Positive:**
   - RLS policies enforce tenant isolation without application-layer guards, reducing the attack surface
     for cross-tenant data leakage.
   - `pg_trgm` enables fuzzy search without an external search service, reducing infrastructure cost.
   - The team can leverage existing PostgreSQL expertise.

   **Negative:**
   - PostgreSQL horizontal write scaling requires Citus or a similar extension; if write throughput
     exceeds single-node limits, sharding becomes a significant migration project.
   - Managed PostgreSQL (RDS, Cloud SQL, Supabase) costs more per vCPU than equivalent MySQL instances
     at the same tier.

   **Neutral:**
   - All ORMs in use (Prisma, SQLAlchemy, GORM) support PostgreSQL; no application-layer changes needed.

   ## Related

   - [ADR-0003: Use Prisma as the ORM](0003-use-prisma-as-orm.md) — this decision constrains the ORM
     to those with PostgreSQL support; Prisma already satisfies this.
   ```

5. **Apply the status state machine** — validate that the status transition is legal:

   ```
   Proposed → Accepted (decision approved by team/lead)
   Proposed → Superseded-by-NNNN (never implemented; a different decision won)
   Accepted → Deprecated (still in use but no longer recommended)
   Accepted → Superseded-by-NNNN (replaced by a later ADR)
   Deprecated → Superseded-by-NNNN (transition complete)
   ```

   When superseding an existing ADR, also update the old ADR's Status line to `Superseded by [ADR-NNNN](NNNN-<slug>.md)`.

6. **Cross-link related ADRs** — scan the ADR body for references to other decision numbers (e.g., "see ADR-0003") and verify those files exist. Add a `## Related` section listing each related ADR with a relative markdown link.

## Output Format

```
## ADR Generated

File: docs/adr/0008-use-postgresql-over-mysql.md
Status: Accepted
Number: ADR-0008

### ADR-0008: Use PostgreSQL over MySQL for the primary datastore

[full ADR content as shown in step 4 above]

### Status Machine Validation

  Transition: (new) → Accepted  ✓  Valid initial status.

### Related ADR Updates Required

  ADR-0003 (docs/adr/0003-use-prisma-as-orm.md) — no status change required; cited for context only.

### Next Steps

1. Commit docs/adr/0008-use-postgresql-over-mysql.md alongside the code change it describes.
2. Link this ADR from the relevant README section or ARCHITECTURE.md.
3. If a PR introduces this change, reference the ADR number in the PR description.
```

## Constraints

- The skill writes only to `docs/adr/` — it does not create the directory structure or update `ARCHITECTURE.md` automatically; these are listed as next steps for the engineer.
- ADR numbers are monotonically increasing and never reused — a deleted ADR leaves a gap in the sequence; document the gap with a placeholder file titled `NNNN-deleted.md` with status `Withdrawn`.
- The skill does not make technology recommendations — it records the decision the team has made or is considering. Evaluation of the decision's merit is out of scope.
- Consequences sections distinguish Positive / Negative / Neutral to avoid the common anti-pattern of listing only positives and hiding trade-offs.
- For decisions still under debate (Status: Proposed), the Decision section should describe the options under consideration, not a final choice — this creates a decision log that can be updated to Accepted or Superseded when the debate concludes.
