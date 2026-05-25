# Parity Report

Last updated: 2026-05-26
Upstream reference: `affaan-m/everything-claude-code` `v1.10.0`
Source of truth: `references/parity-matrix.json`

## Summary

| Component | Upstream | Current | Adopted | Deferred | Current-only |
|---|---:|---:|---:|---:|---:|
| Agents | 0 | 55 | 0 | 0 | 55 |
| Rules | 0 | 99 | 0 | 0 | 99 |
| Skills | 0 | 32 | 0 | 0 | 32 |

## Interpretation

- **Agents**: full upstream coverage, plus ECC-specific additions.
- **Rules**: full upstream parity, plus ECC-specific additions.
- **Skills**: full upstream coverage is now present in the tree, plus ECC-specific additions.
- Structural normalization is complete.
- Runtime activation and superiority work are complete.

## Sprint 3 Result

Sprint 3 imported the remaining upstream skills and closed the explicit skills parity gap in the tracker.

## Current Outcome

Agent Runtime Guard now has full upstream parity plus verified runtime/usability/superiority layers backed by executable checks and anti-drift documentation guards.
