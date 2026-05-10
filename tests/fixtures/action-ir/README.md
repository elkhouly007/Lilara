# action-ir fixtures

Baseline fixtures for `runtime/action-ir.js` (HAP ADR-007 PR-A).

PR-A scope: shape + helpers exist; no adapter wiring yet. The current
fixtures here document EMPTY_IR for human review; PR-B will add a
cross-adapter parity matrix (6 adapters × 6 logical scenarios) and
`scripts/check-action-ir-parity.sh`.

Files:
- `empty-ir.input` — pretty-printed snapshot of `EMPTY_IR` (the canonical
  empty record). Useful as a parity baseline + human reference.
