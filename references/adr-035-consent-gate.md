# ADR-035: Scope-Based Consent Gate (0.2.0)

**Status:** Implemented  
**Decision date:** 2026-06-04  
**Authors:** elkhouly007

---

## Context

Lilara's identity is "trustworthy bounded autonomy": runs without asking EXCEPT
hard exceptions require consent. Before 0.2.0, the "EXCEPT … require consent"
half had no mechanism: Lilara had exactly two terminal outcomes — ALLOW (exit 0)
or DENY (exit 2). There was no "pause → ask a human → proceed on yes."

Verified state of the codebase before this ADR:
- `escalate` / `require-review` decisions mapped to `enforcementAction:"block"` at
  [decision-engine.js:1484](../runtime/decision-engine.js) (not advisory-only as
  sometimes described); they hard-blocked under `LILARA_ENFORCE=1` identically
  to `block`. There was no behavioral distinction between the verbs at the exit
  boundary.
- The real enforcement axis was `LILARA_ENFORCE` — without it, all decisions
  including `block` were advisory (exit 0). The existing `escalate`/`require-review`
  verbs were not intrinsically softer than `block`.
- **Latent bug found:** `buildEarlyReview` in `early-receipt-builder.js` hardcoded
  `enforcementAction:"require-review"` (not `"block"`), causing F25/F26 early-review
  receipts to silently bypass the enforce guard even under `LILARA_ENFORCE=1`.
- Notify transports (`notify/slack.js`, `notify/discord.js`) were send-only; no
  inbound approval channel existed or was added.

---

## Decision

### 1. Third enforcement state: `consent-required`

Introduce a new `enforcementAction` value: `"consent-required"`. This is the
only correct exit for consent-eligible floors when a human hasn't yet approved
the action and the scope doesn't already cover it.

**Mapping rule (pure, lattice-derived):**  
`enforcementFor(action, floorFired)` → `"consent-required" | "block" | "warn"`.  
`consent-required` is chosen ONLY when the fired floor's `demotableBy` contains
`"consent:interactive"`. Never by action verb alone. This prevents routing
kill-chain `escalate` (F23, `demotableBy:[]`) to an interactive ask.

### 2. Consent-eligible floors (0.2.0)

| Floor | Approve-past shape | Rationale |
|-------|-------------------|-----------|
| F18 network-egress | Scope-shaped: widen session grant to allow this host | Network scope is bounded; one-time approval per session is safe |
| F19 output-exfil suspicious | One-shot: mint+consume operator token | Re-asks every time (exfil risk is per-action) |
| F4 secret-class-C | One-shot: mint+consume operator token | Per-action; class-C should never be silently in-scope |
| F20 change-intent-drift medium | Scope-shaped: widen session intent scope | Medium drift is the canonical "off-plan, ask the human" case |

Inviolable tier (F1/F2/F3/F5/F23, and the complete hard-ethical-core list) keep
`demotableBy:[]` permanently. They are never consent-askable.

Deletion floors (F3/F14) remain hard-STOP + one-way notify in 0.2.0; they become
askable in the later deletion-coordination task once the ADR-013 snapshot makes
approve-past safe.

### 3. Pure/impure split (the load-bearing design decision)

`decide()` must remain pure and byte-identical-replayable (the decomposition
arbiter is byte-identical replay over `tests/fixtures/replay-corpus/*.jsonl`).

**`decide()` (pure side):**
- Emits `enforcementAction:"consent-required"` via `enforcementFor()` (lattice lookup).
- Checks an injected `input.consentGrant` against the fired floor via
  `evalConsentFloor()` → if in-scope, demotes to `action:"allow"` with
  `source:_CONSENT.source` ("consent-allow").
- Never reads the grant store from disk. Grant + `input.now` (epoch ms) are
  **injected by pretool-gate.js** — never computed inside `decide()`.

**`pretool-gate.js` (impure boundary):**
- Loads the active grant from the store and injects `consentGrant` + `now`.
- When `enforcementAction:"consent-required"` and `LILARA_CONSENT` is enabled,
  calls `requestConsent()` on the transport.
- On approve: mints a session scope grant (scope-shaped floors) or mints+consumes
  the floor's existing scoped operator token (one-shot floors).

### 4. Consent transport (`LILARA_CONSENT` public enum)

`LILARA_CONSENT = interactive | block | off` (three values only — **no `auto`**).
An `auto` value in a security product's public env is a footgun.

- `interactive` — opens the **controlling TTY** (`/dev/tty` POSIX,
  `\\.\CONIN$` Windows). **Reads from the TTY, never `process.stdin`** (stdin
  holds the agent's hook payload; reading it would allow self-approval via
  prompt injection).
- `block` — always deny + notify. For unattended runs that want notifications.
- `off` / unset — today's behavior, byte-identical. With `LILARA_ENFORCE=1`,
  `consent-required` is treated as `block` (preserves pre-0.2.0 semantics exactly).

**Test sentinel (internal only):** `__LILARA_CONSENT_TEST_AUTO=1` + `NODE_ENV=test`
enables auto-approve for automated tests. Not a `LILARA_CONSENT` value.
Not honored outside `NODE_ENV=test`.

### 5. Grant store

`~/.lilara/consent-grants.jsonl` — JSONL store modeled on the operator-token store
(ADR-002, contract.js:200-300). Record shape:

```json
{
  "id": "<64-char hex>",
  "projectScope": "<from runtime/project-scope.js>",
  "sessionId": "<session id or null>",
  "scopes": { "/* same shape as contract.scopes */" },
  "grantedAt": "<ISO>",
  "expiresAt": "<ISO>",
  "grantedVia": "consent:interactive",
  "floorCodes": ["F18_NETWORK_EGRESS"]
}
```

Bound to `projectScope` (from `project-scope.js`) — **not** the decision-key —
to avoid the known over-scoping bug documented in strategy-2026-05-31.

ADR-024/028/032 guards: `ensureBaseDirSafe` on write, `ensureStateDirSafe` on
read. File mode 0600, directory mode 0700.

### 6. Scope check for grants

`evalConsentFloor(input, grant, contract)` (pure, `runtime/floor-consent.js`)
delegates to `scopesMatch(grant.scopes, input)` — the same core extracted from
`scopeMatch` in `runtime/contract.js`. The class-C hard refusal and destructive-delete
symlink escape checks apply identically to grants. A grant **cannot** in-scope a
class-C payload.

### 7. Grant model: lazy real-args accretion

No task-start declaration protocol in 0.2.0. The first action that exceeds scope
STOPS and shows the **real** command/file/host; the human approves a scope derived
from that real action; in-scope actions are silent thereafter.

The human-facing prompt is built from REAL decision fields (`ir.fileTargets`,
`networkEgress.hostname`, `decision.command`, floor code) — **never** from agent
self-description (`notes`, `tool_input` text, etc.).

Up-front declaration (where an agent declares scope at task start and the human
approves once before actions flow) is deferred to a UX fast-follow on the same
seam.

### 8. Latent bug fix (side effect)

`buildEarlyReview` in `early-receipt-builder.js` previously hardcoded
`enforcementAction:"require-review"` which silently bypassed the enforce guard
at `pretool-gate.js:286` (`if (ENFORCE && decision.enforcementAction === "block")`)
even under `LILARA_ENFORCE=1`. Fixed by using `enforcementFor("require-review",
extra.floorFired || null)` which returns `"block"` for non-consent-eligible early
reviews (F25/F26 mcp-arg/mcp-registration) and `"consent-required"` for any future
consent-eligible floors using `buildEarlyReview`.

---

## Inviolable invariants

These apply permanently and cannot be changed without a new ADR:

1. `decide()` adds **no** new FS reads, writes, timestamps, or randomness beyond
   the already-blessed `scopesMatch` realpath and projectScope git probe.
2. Grant + `now` are **injected** into `decide()`, never computed inside it.
3. `LILARA_CONSENT` public enum has exactly three values: `interactive | block | off`.
   No `auto`. No new values without an ADR.
4. The consent prompt is built from REAL decision fields, never agent self-description.
5. No agent-controlled input (command, notes, tool_input, stdin) can self-approve.
6. Inviolable-tier floors (`demotableBy:[]`) are never consent-askable.
7. The transport reads the controlling TTY, never `process.stdin` (fd 0).
8. F3/F14 deletion floors remain hard-STOP until ADR-013 snapshot is wired.

---

## Files changed

### New files
- `runtime/floor-consent.js` — pure `evalConsentFloor(input, grant, contract)`
- `runtime/consent/grant-store.js` — `mintConsentGrant` + `loadActiveGrant`
- `runtime/consent/transport.js` — `requestConsent` + `buildConsentPrompt`
- `scripts/check-consent-gate.sh` — CI gate (6 tests + 3 structural invariants)
- `tests/runtime/consent-floor.test.js`
- `tests/runtime/consent-grant-store.test.js`
- `tests/runtime/consent-early-review-fix.test.js`
- `tests/runtime/consent-enforce-compat.test.js`
- `tests/runtime/consent-transport.test.js`
- `tests/runtime/consent-adversarial.test.js`

### Modified files
- `runtime/decision-lattice.js` — D-CONSENT at rung 18.25; `consent:interactive` in
  F4/F18/F19/F20 `demotableBy`; `enforcementFor(action, floorFired)` exported.
- `runtime/decision-engine.js` — import `enforcementFor`/`getEntryByName`/`evalConsentFloor`;
  `_CONSENT = getEntry("D-CONSENT")`; grant-suppression block (~line 1395);
  `enforcementFor` at line 1484 (replacing the inline array check).
- `runtime/early-receipt-builder.js` — `buildEarlyBlock` + `buildEarlyReview`
  now use `enforcementFor` (latent bug fix).
- `runtime/contract.js` — extract `scopesMatch(scopes, input)` core from
  `scopeMatch`; export both.
- `runtime/pretool-gate.js` — lazy import of consent modules; inject
  `consentGrant` + `now` into `decide()`; new consent-required branch.
- `scripts/check-counts.sh`, `README.md` — script count: 96 → 97.

---

## Alternatives considered

1. **LILARA_CONSENT=auto as a public value** — rejected as a footgun in a security
   product's public env (could be left in production accidentally).
2. **Per-boundary ask without session grants** — rejected; would prompt on every
   repeated in-scope action, which users would disable.
3. **Inbound Telegram/WhatsApp approval** — deferred by design; cannot authenticate
   the approver vs an injected message without additional plumbing (not in 0.2.0).
4. **Up-front task-start declaration** — deferred; the security-load-bearing path
   is the per-boundary ask from real args anyway; the declaration is a UX nicety.
