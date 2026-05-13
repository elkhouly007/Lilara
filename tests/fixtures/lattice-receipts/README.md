# lattice-receipts fixtures (HAP ADR-007 PR-C)

One fixture per floor (and two demoted-variant fixtures) that pins the
LATTICE-anchored receipt shape produced by `decide()`. The runner is
`scripts/check-lattice-receipts.sh`; it is invoked from `run-fixtures.sh`.

Each `<floor>.input` is a JSON document describing the setup (env,
contract, session counters, taint, …) and the expected receipt fields
(`action`, `decisionSource`, `floorFired`, `rung`, `latticeVersion`,
`irHashPresent`, `reasonCodesIncludes`, …). See the header comment in
`scripts/check-lattice-receipts.sh` for the full fixture shape.

If a fixture flips, the engine's floor labelling has drifted from
`LATTICE`. Stop and reconcile before adjusting expectations.
