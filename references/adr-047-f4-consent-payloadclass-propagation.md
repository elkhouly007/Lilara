# ADR-047 — F4 consent-grant payloadClass propagation

**Status:** Implemented  
**Date:** 2026-06-09  
**Scope:** `runtime/decision-engine.js` — consent gate (0.2.0)

---

## Problem

When `_scanSecrets()` detects a class-C secret in a command string, it sets a
block-scoped local variable (`secretInCommand = true`) and sets `action = "block"`,
`floorFired = "secret-class-C"`. Critically, it does **not** mutate
`input.payloadClass`.

The consent gate (lines 1529+) subsequently calls:

```js
const _cr = _evalConsentFloor(input, input.consentGrant, contract);
```

`evalConsentFloor` → `scopesMatch(grant.scopes, input)` reads `input.payloadClass`,
which is still `"A"` (never updated by the internal scan). The class-C hard refusal
in `contract.js:572` therefore never fires, `_cr.inScope` is `true`, and the gate
demotes the F4 block to `allow`.

**Confirmed repro (master `f9cce79`):**

```js
decide({
  tool: "Bash",
  command: "echo ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  branch: "test",
  consentGrant: { scopes: { tools: { perToolAllow: [{ tool: "Bash" }] } }, ... },
}) → action: "allow"   // WRONG — must be block
```

---

## Fix

In the consent block of `decision-engine.js`, pass a shallow-copy with
`payloadClass: "C"` to `evalConsentFloor` whenever `floorFired === _F4.name`:

```js
const _consentInput = floorFired === _F4.name
  ? { ...input, payloadClass: "C" }
  : input;
const _cr = _evalConsentFloor(_consentInput, input.consentGrant, contract);
```

The spread is idempotent when `input.payloadClass` is already `"C"` (the explicit
caller-set case). The proxy `floorFired === _F4.name` is reliable because:

- Once F4 sets `action = "block"`, all subsequent guards use `action !== "block"`
  or `floorFired || newFloor`, so `floorFired` stays `"secret-class-C"` through
  to the consent block.
- The proxy covers both the command-text arm (`_scanSecrets(input.command)`) and
  the MCP-arg arm (`_scanSecrets(mcpPayload)`) of the F4 detection block.

---

## allow vs require-review

After this fix, `scopesMatch` returns `{ allowed: false, reason: "payload-class-C" }`
for any consent grant against an F4-fired block. `_cr.inScope` is `false`.

**Consent cannot demote an internally-detected F4 block to either `allow` or
`require-review` via the consent gate.**

The only authorized demotion path remains the **operator-token → `require-review`**
(via `LILARA_F4_DEMOTE_TOKEN`, scope `class-c-review-demote`).

The lattice entry lists `"consent:interactive"` in `F4.demotableBy`. After this fix,
`canDemote(F4.id, "consent:interactive")` still returns `true`, but `evalConsentFloor`
returns `inScope: false` for all class-C payloads — `scopesMatch`'s hard refusal is
the final backstop. Whether to remove `"consent:interactive"` from `F4.demotableBy`
is a separate design decision for a future ADR.

---

## Replay corpus safety

The consent block is guarded by `input.consentGrant`. Corpus entries never carry
`consentGrant` (per the code comment at lines 1520–1523: "corpus runs omit
consentGrant → this block is completely inert → zero corpus divergence"). The fix
path is unreachable during corpus replay.

---

## Invariant

**Any future floor-precedence change that could let another consent-demotable floor
steal `floorFired` while a secret is present MUST re-evaluate this guard or add
an explicit payloadClass propagation path.**

---

## Regression tests

`tests/runtime/f4-consent-grant-bypass.test.js` — 6 tests:

| # | Description | Master result | After fix |
|---|-------------|---------------|-----------|
| 1 | Baseline: F4 blocks without grant | block ✓ | block ✓ |
| 2 | Broad Bash grant + GitHub PAT in command | **allow ✗** | block ✓ |
| 3 | Broad grant + secret-to-file command | **allow ✗** | block ✓ |
| 4 | Explicit `payloadClass:"C"` + grant | block ✓ | block ✓ |
| 5 | Non-secret command + grant not over-blocked | allow ✓ | allow ✓ |
| 6 | Protected branch (`"main"`) + secret + grant | **allow ✗** | block ✓ |
