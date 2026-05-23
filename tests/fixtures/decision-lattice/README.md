# decision-lattice fixtures

Baseline fixtures for `runtime/decision-lattice.js` (Lilara ADR-007 PR-A).

`scripts/check-lattice-ordering.sh` validates the table at runtime — these
fixtures are reference snapshots only. PR-C will add per-floor receipt
fixtures that pin the IR-derived `floorFired` + `decisionSource` strings
back to entries in `LATTICE`.

Files:
- `lattice-self-check.input` — JSON snapshot of (id, rung, name, action,
  source, demotableBy) for every entry in `LATTICE`. Used by humans + by
  future CI tooling to detect intentional vs accidental drift.
