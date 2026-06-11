# ADR-048 — F4 demotion path design (OPEN — pending decision)

**Status:** Proposed (open design question — no implementation in this sprint)
**Date:** 2026-06-11
**Scope:** `runtime/decision-engine.js` — F4 consent demotion path

---

## Context

ADR-047 closed the F4 consent-grant payloadClass bypass: a broad `consentGrant` can no longer
demote an internally-detected F4 block to `allow`. After ADR-047, `scopesMatch`'s class-C hard
refusal makes the `consent:interactive` path listed in `F4.demotableBy` inoperative for
internally-scanned secrets.

The decision lattice still lists `"consent:interactive"` in `F4.demotableBy`. In practice this
entry is dead for the scan-detected case (and was never intended to produce `allow`). The
operator-token path (`"operator-token:class-c-review-demote"`) correctly demotes to
`require-review` and is unaffected.

---

## Open design question

**Should F4 have a narrow, one-shot interactive demotion path that produces `require-review`
rather than `allow`?**

The motivating use case: a developer who intentionally pipes a secret into a non-exfiltrating
command (e.g. `echo $TOKEN | wc -c` — character count, not network egress) gets a hard block
with no recovery path short of the operator token. A one-shot interactive grant could route to
`require-review` (human-in-the-loop confirmation) rather than silently allowing.

### Option A — Remove `consent:interactive` from `F4.demotableBy` entirely
Reflects reality after ADR-047. The entry is dead for scan-detected secrets. Clean lattice, no
ambiguity. The operator-token path remains the only authorized demotion. Users who need
per-session relief use the operator token.

**Trade-off:** no interactive recovery path. Operator token is a relatively coarse instrument.

### Option B — Keep `consent:interactive` in `F4.demotableBy`; route to `require-review`
Change `evalConsentFloor` so that for `payloadClass="C"`, a matching grant produces
`{ allowed: false, demoteTo: "require-review" }` (instead of the current hard refusal). The
consent block in `decide()` would set `action = "require-review"` rather than `allow`.

**Trade-off:** requires changes to `contract.js:scopesMatch`, `evalConsentFloor`, and the
consent block. Increases lattice complexity. The `require-review` outcome on an F4 secret is
already achievable via operator token — the incremental value of adding a broad-grant path is
limited. Needs threat-model review (can a prompt injection self-issue a `consentGrant` via the
MCP machinery?).

### Option C — Narrow one-shot scope: command-hash-bound grant
A `consentGrant` for F4 must be scoped to a specific `commandHash` (SHA-256 of the command).
Broad `{tool:"Bash"}` grants remain blocked; only pre-approved specific commands can route to
`require-review`.

**Trade-off:** highest precision, lowest attack surface. Requires `commandHash` in the grant
schema and a new `scopesMatch` branch.

---

## Decision deferred

No change to F4 demotion behavior in this sprint. The current state (consent cannot demote
F4-internal block; operator-token can demote to `require-review`) is secure and correct.
The open question is whether to add a human-accessible interactive recovery path, and if so,
how to scope it to prevent prompt-injection self-approval.

Assign to a future sprint after threat-model review of Option B/C.

---

## Current behavior (post ADR-047, v0.2.1)

| Path | Result |
|------|--------|
| `_scanSecrets` detects secret + broad `consentGrant` | `block` — class-C hard refusal fires |
| Explicit `input.payloadClass="C"` + broad `consentGrant` | `block` — class-C hard refusal fires |
| Operator token (`LILARA_F4_DEMOTE_TOKEN`) | `require-review` |
| No grant, no token | `block` |
