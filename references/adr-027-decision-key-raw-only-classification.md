# ADR-027 — Raw-Only Classification in `fineKey` / `legacyKey`

**Status:** Proposed — 2026-06-02. Audit-by-side-effect finding from the June 2026 hardening sprint.  
**Severity:** MED-HIGH  
**Area:** `runtime/decision-key.js:105` (`fineKey`) and `:124` (`legacyKey`).

---

## Problem

ADR-023 (June 2026) migrated four raw-only `classifyCommand` call sites to
`classifyCommandDual`. During that audit, two additional raw-only sites were found in
`decision-key.js` itself — the same module where `classifyCommandDual` was added:

```js
// fineKey (line 105):
const cmdClass = classifyCommand(input.command);   // raw-only

// legacyKey (line 124):
const cmdClass = classifyCommand(cmd);             // raw-only, with explicit note:
// "Matches the key format produced by policy-store.js:decisionKey"
```

These sites were **deliberately not migrated** in ADR-023 because:
1. `legacyKey` is explicitly designed for backward-compat key matching; changing its
   classification risks orphaning existing learned-allow entries.
2. Both sites feed policy keys used for **learned-allow lookups and journal entries** —
   a classification change could produce key churn, not just a one-time re-baseline.

### The bypass vector

`Cyrillic рm -rf /` → `classifyCommand` → `"generic"`.

If a user has a learned-allow entry under `bash|generic|default-target|feature-branch|A`
(e.g., for `ls -la`), a Cyrillic `рm -rf /` would match that key and be **auto-allowed**
via the learned-allow shortcut — bypassing F3 and the floor cascade.

**However:** F3 (`critical-risk`, risk-engine) fires for `рm -rf /` BEFORE the
learned-allow check. The engine's decision precedence ensures: F1 kill-switch → F3
critical-risk → … → learned-allow. So the immediate safety impact is bounded: floors
still fire first. The bypass applies only if the command is below the F3 threshold but
obfuscated to look lower than its actual class.

### What "key churn" means

`fineKey` format: `tool|commandClass|pathBucket|branchBucket|payloadClass`

If `fineKey` switches to `classifyCommandDual`, a stored learned-allow entry for key
`bash|generic|default-target|feature-branch|A` will no longer match an input whose
normalized class is `destructive-delete`. The entry is orphaned; the user must re-approve.

For `legacyKey`, the risk is wider: `policy-store.js:decisionKey()` and
`policy-store.js:scopedKey()` both use the same `classifyCommand` raw call. If
`fineKey`/`legacyKey` switch but `decisionKey`/`scopedKey` don't, the key formats
diverge → `fineKey` lookups never match stored `decisionKey` entries.

---

## Options

### Option 1 — Migrate `fineKey` to `classifyCommandDual`, keep `legacyKey` raw

- `fineKey` is the forward path for new decisions. Its under-classification is the active
  bypass risk for future learned-allows.
- `legacyKey` stays raw — preserves backward compat for existing entries.
- Requires: also migrating `policy-store.js:decisionKey()` and `policy-store.js:scopedKey()`
  to `classifyCommandDual` so the stored key format stays consistent with `fineKey`.

**Risk:** Orphans existing `fineKey`-format learned-allow entries stored under raw-class
keys. A migration script or a key-upgrade path in `loadPolicy` would be needed.

### Option 2 — Dual-key lookup

Keep existing raw-class keys AND look up under the dual-class key. Accept both as a
match. Avoids orphaning; prevents the bypass for new commands; backward-compatible.

```js
function fineKey(input) {
  const rawKey  = /* ... classifyCommand ... */;
  const dualKey = /* ... classifyCommandDual ... */;
  return { rawKey, dualKey }; // callers check both
}
```

Adds complexity to every learned-allow lookup.

### Option 3 — Versioned key schema

Add a `v:` prefix to `fineKey` format: `v2|tool|cmdClass|...` where `v2` uses dual-path
and `v1` was raw. Migrate existing entries to `v2` on first load. Clean but adds
migration complexity.

### Option 4 — Status quo + comment (INTERIM RECOMMENDATION)

Add explicit `// ADR-027: raw-only for key stability — see ADR-027` comments at both
sites while Khouly decides the migration strategy. The floor + risk-engine defense-in-depth
holds; the bypass risk is real but bounded.

---

## Recommendation

**Option 4 (interim)** — surface the problem clearly; defer the migration strategy to
Khouly because it requires a decision on policy-store key-format versioning. **Option 1
or 3** is the right long-term fix. The key decision: is an explicit migration script
(orphaning old entries with user notification) acceptable?

---

## FP analysis

- **No eval FP/FN:** Learned-allow changes do not affect the FP/FN metric (the eval
  corpus does not exercise learned-allow paths; all entries are fresh-invocation).
- **Operator experience (if migrated):** Users see previously auto-allowed commands
  routed to require-review or route until they re-approve. Operators with Cyrillic or
  full-width commands already in their approved list may notice re-prompting.
- **Security direction:** More restrictive (never less). Under-classification → allow
  is the risk; over-classification → re-approval is the mitigation.

---

## Engine/script hook point

- `runtime/decision-key.js:105` (`fineKey`) — `const cmdClass = classifyCommand(input.command)`
- `runtime/decision-key.js:124` (`legacyKey`) — `const cmdClass = classifyCommand(cmd)`
- `runtime/policy-store.js` — `decisionKey()` and `scopedKey()` use the same raw classification
- `runtime/policy-store.js:loadPolicy` — potential home for a migration/upgrade path

---

## Consequences

- **If approved (Option 1):** Migrate `fineKey`, `decisionKey`, `scopedKey` to
  `classifyCommandDual`. Write a policy migration script. Add CHANGELOG note for operators.
- **If approved (Option 3):** Design and implement versioned key schema. Larger scope.
- **If deferred (Option 4):** Add `// ADR-027` comments. Revisit when Khouly decides
  the policy-store key-format versioning strategy.
