# ADR-026 — Receipt `commandClass` Under-Classification + irHash Re-baseline

**Status:** Accepted (Option 1) — 2026-06-02. Khouly authorized re-baseline 2026-06-02.  
**Severity:** HIGH / MED  
**Area:** `runtime/action-ir.js:490` and `tests/fixtures/replay-corpus/adversarial.jsonl`.

---

## Problem

ADR-023 (unified classification gateway, June 2026) migrated three raw-only
`classifyCommand` call sites to `classifyCommandDual` so Unicode-obfuscated destructive
commands are caught engine-wide. However, one call site was **deliberately deferred**
because migrating it would break the "byte-identical replay" hard constraint:

**`action-ir.js:490`:**
```js
const commandClass = command ? classifyCommand(command) : "unknown";
```

`commandClass` feeds:
- `ir.commandClass` (the IR field — stamped on receipts and decision-journal entries)
- `ir.destructive` (`:519` — affects auto-snapshot trigger)
- `ir.writeIntent` (`:523` — affects write-routing)
- `irHash` (`:573` — the canonical hash used by the replay gate)

### The under-classification artifact

The replay corpus `tests/fixtures/replay-corpus/adversarial.jsonl` contains two entries:

```jsonl
{"tag":"adv:critical-rm-cyrillic-er", "input":{"tool":"Bash","command":"рm -rf /","branch":"feature/test"},
 "expected":{"action":"block","decisionSource":"risk-engine","floorFired":"critical-risk",
             "irHash":"sha256:13254b74a7a4c6f3efd5617af6f03c0266dfe506c6f695d9c6a8b5148b04fe53"}}
{"tag":"adv:critical-rm-fullwidth",   "input":{"tool":"Bash","command":"ｒｍ -rf /","branch":"feature/test"},
 "expected":{"action":"block","decisionSource":"risk-engine","floorFired":"critical-risk",
             "irHash":"sha256:9a6fd86f322a66ce7700bb45a3ab86c994675a934bf5ed334f7159647bd01cb0"}}
```

Both commands are **blocked correctly** by the risk-engine (`critical-risk`, F3).
However, the recorded `irHash` was computed with `classifyCommand` returning `"generic"`
for the Cyrillic/full-width `rm`. The receipt field `commandClass: "generic"` is a
**false-clean audit artifact** — a forensics team auditing the receipt would not
recognize the command as destructive from its class alone.

### Why migrating breaks the replay gate

If `action-ir.js:490` uses `classifyCommandDual`:
- `classifyCommandDual("рm -rf /")` → `"destructive-delete"` (previously `"generic"`)
- `ir.commandClass` changes → `ir.destructive` changes (from `false` to `true`)
- `irHash` changes (it covers the full IR including `commandClass` and `destructive`)
- The replay gate asserts `irHash` byte-identical → **FAIL**

The gate is functioning correctly — it detected a real behavior change. The question is
whether to **authorize a one-time justified re-baseline** of these two entries.

### Why the command is blocked despite the under-classification

The risk-engine (`risk-score.js`) uses its own dual-path matching (ADR-008) to detect
`рm -rf /` as `critical-risk` → F3 blocks it. The `commandClass` field in the IR is
a convenience label computed at IR-build time; F3 does not depend on it. The block is
correct. The under-classification is purely an audit/receipt artifact problem, not a
safety problem.

---

## Options

### Option 1 — Authorized one-time irHash re-baseline (RECOMMENDED)

With Khouly's explicit approval:
1. Migrate `action-ir.js:490` to `classifyCommandDual`.
2. Re-generate the two affected replay entries via the canonical builder:
   ```bash
   node tests/fixtures/replay-corpus/build-adversarial.js
   ```
   Note: the `--update-baseline` flag mentioned in the original draft does NOT exist in
   `scripts/replay-decisions.js` — the builder is the correct regen path.
3. Commit the new `irHash` values alongside the code change.
4. Document the re-baseline in the ADR chain and the commit message.

**Why this is safe:** The commands are still blocked (by F3, not by `commandClass`).
The re-baseline corrects a receipt artifact, not a safety behavior. The replay gate
then accurately reflects what the engine does.

### Option 2 — Add a parallel `commandClassDual` field to the IR

Add a second field alongside `commandClass` that carries the dual-path classification
without touching `commandClass` or `irHash`:
```js
ir.commandClass     = command ? classifyCommand(command)     : "unknown"; // backward-compat
ir.commandClassDual = command ? classifyCommandDual(command) : "unknown"; // audit truth
```

No irHash change; no replay drift. Allows receipt consumers to see the correct class.
Downside: technical debt (two fields for the same semantic); `destructive` and
`writeIntent` remain based on the under-classified `commandClass`.

### Option 3 — Status quo + comment

Add a `// ADR-026: raw-only; see ADR-026 for re-baseline decision` comment at `:490`.
Accept that receipts under-report the command class for Unicode-obfuscated commands.

---

## Recommendation

**Option 1** — the re-baseline is justified and the scope is narrow (2 entries, both
already blocked by F3). The audit-assurance value of a correct receipt `commandClass`
outweighs the small one-time cost of the re-baseline. **Khouly must explicitly authorize
this** because it changes the replay-corpus baseline (an ADR-019 / eval-assurance shape
invariant).

---

## FP analysis

- **No eval FP/FN:** The `commandClass` field does not affect `action`, `decisionSource`,
  or `floorFired`. Both commands are blocked by F3 regardless. FP/FN rates unchanged.
- **Operator experience:** Receipts become more accurate, not less. After the fix,
  `commandClass: "destructive-delete"` truthfully describes the blocked command.

---

## Engine/script hook point

- `runtime/action-ir.js:490` — the `classifyCommand` call.
- `tests/fixtures/replay-corpus/adversarial.jsonl` — two entries: `adv:critical-rm-cyrillic-er`
  and `adv:critical-rm-fullwidth`.
- `tests/fixtures/replay-corpus/build-adversarial.js` — regeneration script.

---

## Consequences

- **If approved (Option 1):** 1 line change in `action-ir.js:490`; 2 corpus entry updates
  in `adversarial.jsonl`; commit must document the authorized exception to the
  byte-identical invariant.
- **If declined (Option 3):** Add the `// ADR-026` comment so future reviewers understand
  why this site is intentionally raw-only.
