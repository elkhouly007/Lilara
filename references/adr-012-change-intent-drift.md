# ADR-012 — Change-intent drift (F20, HAP v0.5 Stage D wave 2)

Status: accepted (v0.5 Stage D, parallel with auto-snapshot)
Scope: §5.1 "Change-intent diffing: compare declared user goal / plan envelope against actual file, command, network, and policy deltas; out-of-intent changes escalate."
Locked plan: §4.1 Stage D — "Output-channel exfiltration guard and change-intent diffing after Action IR has real adapter-side fields."

## Context

The Action IR (ADR-007) now exposes the adapter-side fields F20 needs:
`fileTargets[]`, `networkTargets[]`, `commandClass`, `commandTokens[]`,
`payloadClass`, `mcpServer`, `destructive`, `writeIntent`, and (post-ADR-010
PR-α / #47) `outputs[]` / `declaredOutput[]`. F19 (output-channel
exfiltration) shipped at rung 17.875. F20 is the second half of Stage D
wave 2: comparing what the operator **declared** the agent could do against
what the IR shows it is **actually** doing.

F20 composes with — and does not replace — F7 (`intent-unknown-strict`,
ADR-001 D). F7 is "the intent classifier returned `unknown` for the
command, and we are in strict posture, so route to require-review." F20 is
"the operator declared a scope of allowed file writes / commands / network
hosts / policy edits, and the IR exceeds that scope." They fire
independently; both stay in the lattice.

## Decision

Add a new engine-baked floor **F20 = change-intent-drift** at lattice rung
**18.5**, with these load-bearing pieces:

### Declared-envelope shape

`runtime/envelope.js` is extended additively. The existing envelope shape
(`build()` / `verify()` / pending-envelope persistence) is untouched. A new
optional sub-document `envelope.declaredIntent` is recognized:

```
envelope.declaredIntent = {
  goal:         string | null,
  planSummary:  string | null,
  allowedOps: {
    fileWrites:     string[] | null,   // path globs the agent may write
    fileDeletes:    string[] | null,   // path globs the agent may delete
    commands:       string[] | null,   // command-name allowlist (argv0 basename)
    commandClasses: string[] | null,   // intent-classifier vocabulary
    networkHosts:   string[] | null,   // FQDN / wildcard / `.suffix` matching
    policyEdits:    boolean | null     // null=undeclared, false=disallowed
  } | null,
  declaredBy:   "operator" | "adapter" | "fallback" | null,
  source:       string | null
};
```

`null` arrays mean "undeclared" — that field cannot drift. When
`declaredIntent` itself is absent or `allowedOps` is null, F20 no-ops
cleanly (fail-open: no drift signal, no F20 fire). The `intent-classifier.js`
vocabulary (explore / build / deploy / modify / configure / cleanup /
debug) is the canonical source for `commandClasses` values.

### Drift class taxonomy

`runtime/change-intent.js` exports `diffEnvelopeVsIr(envelope, ir)` which
returns `{ drift, classes[], details[], severity, error? }`. The six drift
classes are:

| class                          | fires when                                                                  |
|--------------------------------|-----------------------------------------------------------------------------|
| `file-write-out-of-scope`      | IR `fileTargets[]` write-intent entry no `fileWrites` glob matches          |
| `file-delete-out-of-scope`     | IR `fileTargets[]` delete-intent entry no `fileDeletes` glob matches        |
| `command-out-of-scope`         | `argv0` basename not in `commands` allowlist                                |
| `command-class-out-of-scope`   | `classifyIntent(ir.command).intent` not in `commandClasses` allowlist       |
| `network-host-out-of-scope`    | IR `networkTargets[]` host not in `networkHosts` allowlist                  |
| `policy-edit-not-declared`     | write/delete touches a policy/contract path AND `policyEdits === false`     |

### Severity ladder

| severity   | trigger                                                                | engine action      |
|------------|------------------------------------------------------------------------|--------------------|
| `none`     | no classes fired                                                       | no change          |
| `low`      | single drift class, no write/delete and no policy/destructive          | receipt-only marker |
| `medium`   | single write/delete drift class (and not high)                          | `require-review`, demotable only by operator-token-medium-only (scope `change-intent-drift-medium`) |
| `high`     | ≥2 classes OR any policy-edit drift OR `ir.destructive=true` + drift   | `block`, non-demotable by learned-allow or contract-allow |

### Fail-open contract

Any internal exception inside `diffEnvelopeVsIr` returns
`{ drift: false, classes: [], details: [], severity: "none", error: "<msg>" }`
and the engine journals a degraded-mode marker — F20 never throws to the
engine. Envelope file reads (`loadDeclaredEnvelope`) are likewise fail-open:
ENOENT returns null silently; malformed JSON / parse failure / expiry log a
journal marker (`change-intent-envelope-error` / `…-parse-error` /
`…-expired`) and return null.

### Engine wiring

`runtime/decision-engine.js` calls `diffEnvelopeVsIr` exactly once per
`decide()`, between F19's evaluation block and the contract-allow demotion
block. The F20 preview-action is applied AFTER F14b and F19's overrides so
contract-allow / auto-allow-once / trajectory-nudge cannot silently undo a
high-severity block or a medium-severity require-review. The demoted-to-allow
medium path preserves any stronger action a higher-priority floor produced.

### Lattice rung 18.5

`runtime/decision-lattice.js` records F20 at rung 18.5 — strictly increasing
versus the prior rung (D-CONTRACT-ALLOW @ 18). The chosen rung documents
that contract-allow cannot demote F20 fires (the demotion is severity-gated
by the operator-token-medium-only sentinel listed in `demotableBy`).
`source[0] = "change-intent-drift"`; `source[1] = "f20-demoted"` for the
medium-demoted-to-allow variant.

### Receipts + journal

Every F20 evaluation (drift or not) emits this additive key on the receipt
and matching journal entry:

```
changeIntent: {
  declared: boolean,
  drift:    boolean,
  classes:  string[],
  severity: "none" | "low" | "medium" | "high",
  redactedDetails: object | null   // up to 5 entries, value truncated to 64 chars
}
```

The journal entry chains per ADR-004 when F20 fires (block / require-review).

### CLI

`scripts/horus-cli.sh envelope set | show | clear` (added under the existing
unified CLI). `envelope set` writes `<HORUS_STATE_DIR>/envelope.json`
(0600), with a 24h freshness window. `envelope show` redacts goal /
planSummary to 120 chars. `envelope clear` removes the file.

## Relationship to F7

F7 fires on `intent === "unknown"` in strict posture and routes to
`require-review`. F20 fires on declared-vs-actual mismatch and routes by
severity. Both stay in the lattice; F7 is NOT modified by this PR.

## Non-goals (v0.5)

- Adapter-side envelope auto-extraction (model-side plan capture). Operator
  supplies via CLI for v0.5.
- Adversarial replay corpus (will follow up similar to F16 PR-D / #41).
- F7 deprecation / merger with F20.
- Wiring HAP enforcement into Claude Code / OpenClaw runtime.
- Operator-token signing-mechanism upgrade (reuses the F4/F19 scoped-token
  path: `mintOperatorToken(label, "change-intent-drift-medium")`).

## Acceptance

- `node tests/runtime/change-intent.test.js` — green.
- `bash scripts/check-lattice-receipts.sh` — green with F20 fixture pin.
- `bash scripts/check-runtime-core.sh` / `check-zero-deps.sh` /
  `check-counts.sh` — green.
- `HORUS_HERMETIC_TEST=1 bash scripts/run-fixtures.sh` — green.

## Files

- `runtime/change-intent.js` (new helper)
- `runtime/envelope.js` (additive `loadDeclaredEnvelope` + path helper)
- `runtime/decision-engine.js` (wiring + override + receipt/journal)
- `runtime/decision-lattice.js` (F20 entry at rung 18.5)
- `runtime/decision-journal.js` (changeIntent pass-through)
- `tests/runtime/change-intent.test.js`
- `tests/fixtures/lattice-receipts/F20-change-intent-drift.input`
- `scripts/horus-cli.sh` (`envelope set | show | clear`)
- `references/adr-012-change-intent-drift.md` (this file)
