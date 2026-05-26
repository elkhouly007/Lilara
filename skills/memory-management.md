# Skill: memory-management

---
name: memory-management
description: Cross-session semantic memory management. Store, search, and consolidate facts that persist across agent sessions. Uses keyword-based retrieval with recency weighting — no external dependencies or vector databases.
---

# Memory Management

Zero-dependency cross-session memory using append-only JSONL under `~/.lilara/memory/`. Facts are automatically surfaced at session start via the Lilara session-start hook.

## When to Use

- Storing a project decision that should be recalled next session ("we chose PostgreSQL for this project")
- Searching for past context before starting a task ("what did we decide about the auth approach?")
- Cleaning up the memory store (consolidating duplicates, pruning stale facts)
- Reviewing what Lilara knows about the current project before a long autonomous run

## Process

1. **Search before adding** — Run `lilara-cli.sh memory search <query>` first to check if the fact is already recorded. Avoid duplicates.
2. **Add facts concisely** — One fact per `lilara-cli.sh memory add "<fact>"`. Facts are 512-char max. Use `--source` to tag the origin (e.g. `--source operator`, `--source commit`).
3. **Review the store periodically** — Run `lilara-cli.sh memory list` to review stored facts. Run `lilara-cli.sh memory consolidate` to merge near-duplicates.
4. **Facts surface automatically** — The session-start hook injects the top-3 relevant facts into `additionalContext` for every new session. No manual recall needed.

## Output Format

```
# memory search typescript
[Lilara memory] Top 3 results for "typescript":
  1. [2026-05-26] TypeScript strict mode enabled in tsconfig.json (score 3.0)
     source: operator
  2. [2026-05-24] Project uses TypeScript 5.4 with React 19 (score 2.0)
     source: commit

# memory list
[Lilara memory] 5 facts (most recent first):
  1. [2026-05-26] TypeScript strict mode enabled ...
  2. ...

# memory consolidate --dry-run
[Lilara memory] Consolidation dry-run: 2 duplicates would be merged, 7 survivors remain.
```

## Constraints

- Zero runtime dependencies — uses Node.js built-ins and append-only JSONL.
- Facts do not leave the machine. Memory lives at `~/.lilara/memory/` (or `$LILARA_STATE_DIR/memory/`).
- Facts with `decayScore ≤ 0` are excluded from search and pruned by `memory consolidate`.
- The session-start hook injects facts as additional context only; it does not modify or delete facts.
- Keyword search is exact-match token overlap — not semantic/embedding-based. For best recall, use nouns and identifiers as search terms.
