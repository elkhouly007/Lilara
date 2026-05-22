# Archived bootstrap planning docs (2026-05-09)

This directory holds the pre-implementation planning artifacts produced on
repo bootstrap day, 2026-05-09. They were authored before Stage A–D shipped
and are now superseded by the live operating docs.

## Why they were moved

They were originally tracked at the repo root and lived there unchanged
through Stages A–D. Keeping them at the root made them compete with the
current sources of truth for new readers: a contributor opening the repo
would see `MASTER_PLAN.md` (999 lines, never updated post-bootstrap) next
to a refreshed `ROADMAP.md` and have no fast way to know which was
authoritative. Moving them into a dated archive subdir preserves them as
historical context without putting them in the reader's primary path.

## What replaces them

| Archived | Replacement |
|---|---|
| `MASTER_PLAN.md`, `MASTER_PLAN_PROMPT.md` | `ARCHITECTURE.md`, `CONTRACT.md`, `MODULES.md`, `DECISIONS.md` |
| `AMPLIFICATION_PLAN.md`, `ENHANCEMENT_PLAN.md` | `ROADMAP.md`, `CHANGELOG.md`, `references/adr-*.md` |
| `OVERNIGHT_PROGRESS.md`, `OVERNIGHT_REPORT_2/3/4.md` | `CHANGELOG.md`, the `workstreams/` task-brief history |
| `CLAUDE_CODE_HANDOFF.md` | already a stub pointer; see `references/archive/CLAUDE_CODE_HANDOFF-v1.0.md` for v1.0 contents |

## Editorial status

Frozen. These files are historical context only. Do not update them.
Update the replacements above instead.
