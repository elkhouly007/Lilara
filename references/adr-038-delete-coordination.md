# ADR-038 · F29 `destructive-delete-coord` · Deletion-Coordination Gate

**Status:** Implemented
**Decision date:** 2026-06-05
**Floor:** F29 · rung 9.5 · `require-review` → `consent-required`
**Tier:** demotable (`consent:interactive`)
**Env flag:** `LILARA_DELETE_COORD=1` (default off)

---

## 1. Problem statement

Before this ADR, an out-of-scope `rm -rf` (high-risk, `destructive-delete-pattern`)
was governed by **no floor**: the risk cascade produced `action:"require-tests"`,
`floorFired:null`, `decisionSource:"risk-engine"` with:

- No approve-past mechanism — the operator is re-asked on every repeat within the
  same scope, even when the action is identical and already approved.
- No recoverability affordance — no snapshot is taken; the action is unrecoverable.
- No visible semantics — `require-tests` looks like a code-quality gate, not a
  destructive-action gate, making the UI confusing.

ADR-035 §8 reserved F3/F14 as hard-stop until "the ADR-013 snapshot makes approve-past
safe." That framing assumed F3/F14 would become consent-askable — but F3 (`critical-risk`,
catastrophic rm -rf /) and F14 (`budget-exceeded`, session budget cap) are both
inviolable by ADR-036 on sound grounds: you cannot snapshot all of `/`, and approve-past
defeats the budget cap. The right design is a **new demotable path** at a different rung,
not amending the inviolable hard-stops.

## 2. Decision

**Floor F29 — `destructive-delete-coord`.**

- **Rung 9.5** — strictly between F8 (`protected-branch`, 9) and F4 (`secret-class-C`,
  10), matching code order. Governs the mid-range "high-risk destructive-delete, not
  catastrophic" case. F3 (`critical-risk`) still fires first for rm -rf of system paths.
- **Action:** `require-review` (maps to `enforcementAction:"consent-required"` via the
  lattice `demotableBy:["consent:interactive"]` mapping).
- **Tier:** `demotable` — excluded from `INVIOLABLE_FLOOR_IDS` automatically.
- **Flag-gated:** `LILARA_DELETE_COORD=1` required. When off, the legacy
  `require-tests` arm runs unchanged. Zero replay-corpus divergence.

**Approve-past flow:**
1. F29 fires → `enforcementAction:"consent-required"` → pretool-gate.js stops and asks
   (when `LILARA_CONSENT=interactive`).
2. Operator approves → pretool-gate.js:
   a. Takes a recoverability snapshot of the target tree (visible-but-fail-open; see §3).
   b. Mints a scoped `destructiveAllow` grant covering the specific file targets via
      `_deriveGrantScopes` (the `scopes.filesystem.destructiveAllow[].pathGlob` shape).
   c. Returns `exitCode:0` ("Consent granted — proceeding").
3. Subsequent in-scope deletes (matching grant scope):
   a. `input.consentGrant` is injected by pretool-gate.js → the grant-suppression block
      in `decide()` demotes F29's `require-review` → `action:"allow"`.
   b. The ADR-013 rail at `decision-engine.js:~1579` snapshots (since `action="allow"` +
      `ir.destructive=true`).
   c. pretool-gate.js checks `decision.snapshot.status`; if not `created`/`truncated`,
      emits a loud visible warning (see §3).

The two snapshot sites are mutually exclusive on `action`: first call uses the
approval hook (action was `require-review`), repeats use the ADR-013 rail (action is
`allow`). No double-snapshot, no missed snapshot.

## 3. Recoverability invariant — visible-but-fail-open

The safety justification for proceeding on in-scope deletes is "they're recoverable."
A silently-failed snapshot = an unrecoverable delete the system treated as safe.

**Rule:** snapshot failure is **ALWAYS visible, NEVER silent** on the F29 path.

Failure conditions: any thrown error, `scope-too-large`, `state-dir-insecure`,
`failed-fail-open`, or any status other than `created`/`truncated`.

On failure (both approval hook and rail path):
- `emit()` a loud, unmistakable stderr warning naming the failure and the targets.
  Not wrapped in any outer try/catch — the warning is guaranteed to reach the operator.
- Write a `snapshot-failed-on-approved-delete` decision-journal marker (kind field)
  so the audit trail reflects the compromised recoverability.
- Proceed with the action (fail-open) — the operator explicitly approved.

ADR-013 §2 fail-open principle is preserved: snapshot failure never converts an
approved action into a block. But it is visible, not silent.

## 4. `fileTargets` fix (load-bearing)

`buildConsentPrompt(decision, extra)` previously read `decision.ir?.fileTargets` — but
the engine result has no `ir` key. This caused `_deriveGrantScopes` to emit no
`destructiveAllow` entries, so the minted grant covered nothing and approve-past
silently re-asked on every delete.

Fix: pretool-gate.js now injects `fileTargets` from `gateIr` via `extra.fileTargets`.
`buildConsentPrompt` prefers `extra.fileTargets` over `decision.ir?.fileTargets`.
This is the ONLY way approve-past functions as designed. Tests cover the second-call
silent-pass behavior to prove the grant is non-empty.

## 5. Inertness proof (replay-safety)

- `LILARA_DELETE_COORD` is never set by `replay-decisions.js`.
- With flag off, the `else { action = "require-tests"; }` arm runs unchanged.
- Replay compares only `{action, decisionSource, floorFired, irHash}` — `enforcementAction`
  and `decision.snapshot` are not compared.
- `input.consentGrant` is never injected in replay → grant-suppression block inert.
- Net: zero divergence for all existing `destructive-delete-pattern` corpus entries.

## 6. Scope limits

- Only governs `commandClass === "destructive-delete"` with `ir.destructive === true`.
- `scope-too-large` (>256 MiB file tree) is a snapshot warning, not a block; the
  approved delete proceeds with a visible warning.
- Network/DB/container deletes are out of scope (ADR-013 §4 known limitations).
- Grant TTL: 1 hour (existing `mintConsentGrant` default).
- F3 (`critical-risk`) and F14 (`budget-exceeded`) remain inviolable and unchanged.

## 7. Alternatives rejected

1. **Make F3/F14 consent-askable.** Unsafe: F3 fires on catastrophic rm -rf / (can't
   snapshot all of `/`); F14 is a budget cap (approve-past defeats the rate limit).
   Also governance-breaking: ADR-036 locked both as inviolable. Rejected.
2. **Snapshot every destructive-delete regardless of consent.** Changes flag-OFF
   behavior; replay divergence. Rejected.
3. **Amend an existing demotable floor.** No existing floor governs out-of-scope
   destructive-delete at rung 9.5. Rejected (the slot was empty).

## 8. Invariants preserved

1. `decide()` is pure — no new FS reads, writes, or randomness.
2. Cross-call state (`consentGrant`, `now`) injected by pretool-gate.js, never read
   inside `decide()`.
3. `INVIOLABLE_FLOOR_IDS` unchanged — F3/F14 still inviolable.
4. Replay corpus: zero divergence when `LILARA_DELETE_COORD` unset.
5. Snapshot failure never blocks; always visible (emit + journal marker).
6. Neutral universal-harm language throughout (no culture-specific terms).
7. Zero external dependencies.

## 9. Files changed

- `runtime/decision-lattice.js` — add F29 at rung 9.5
- `runtime/decision-engine.js` — `_F29` handle; flag-gated cascade arm
- `runtime/consent/transport.js` — `fileTargets` fix (prefer `extra.fileTargets`);
  recoverability hint in `buildPromptText` for F29
- `runtime/pretool-gate.js` — lazy `_requireSnapshot`/`_requireJournal`/`_isDeleteCoordActive`;
  `fileTargets` injection; snapshot-on-approval hook; rail-path visibility check
- `artifacts/lattice-baseline.sha256` — re-baselined (F29 hash delta; INVIOLABLE unchanged)
- `references/adr-038-delete-coordination.md` — this document
- `scripts/check-delete-coord.sh` — CI gate
- `tests/runtime/delete-coord.test.js` — unit tests
- `scripts/lilara-cli.sh` — gate wiring
- `.github/workflows/check.yml` — CI wiring
- `scripts/check-counts.sh` — bump EXPECTED_SCRIPTS
- `README.md` — bump scripts count heading
