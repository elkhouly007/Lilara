# ADR-023 — Unified Command Classification Gateway

**Status:** Proposed — 2026-06-01. Audit-by-side-effect finding from the June 2026 hardening sprint.  
**Severity:** HIGH  
**Area:** `runtime/action-ir.js`, `runtime/contract.js`, `runtime/decision-engine.js`,
`runtime/degraded-mode.js` — all call `classifyCommand` directly on raw strings.

---

## Problem

ADR-008 (PR #71) introduced `_classifyCommandDual` in `decision-engine.js` to apply Unicode
NFKD normalization and confusable folding before command classification. The dual-path is the
**correct** classifier: it catches Cyrillic/full-width/ZWJ-spliced destructive verbs that the
raw regex would miss.

**`_classifyCommandDual` is not exported.** Four code paths call the raw-only `classifyCommand`
directly:

| File | Line | Context | Security Impact |
|------|------|---------|-----------------|
| `runtime/action-ir.js` | 490 | IR `commandClass` field | IR field underestimates class; receipt misrepresents danger |
| `runtime/contract.js` | 545 | `scopeMatch()` scope resolution | Contract allow-list may grant permission for a command that is `generic` raw but `destructive-delete` normalized |
| `runtime/decision-engine.js` | 1039 | Non-MCP Bash command classification | This one uses the dual-path for risk scoring (via `risk-score.js` `matches()`) but reverts to single-path for contract scope match |
| `runtime/degraded-mode.js` | 108 | Fallback classification when main engine is degraded | Degraded decisions misclassify Unicode-obfuscated commands |

### The bypass vector

An attacker uses Cyrillic `рm -rf /` (U+0440 'р' looks like Latin 'r') as a shell command:

- `classifyCommand("рm -rf /")` → `"generic"` (ASCII regex misses Cyrillic 'р').
- `_classifyCommandDual("рm -rf /")` → `"destructive-delete"` (NFKD folds 'р'→'r').

If this command is passed through any of the four raw-only paths above:
- **action-ir.js**: the IR receipt says `commandClass: "generic"` — the operator sees a false-clean receipt.
- **contract.js `scopeMatch()`**: if the contract has `scopes.commands.allow: ["generic"]`, the command is **granted**.
- **degraded-mode.js**: the entire decision degrades to incorrect classification.

The **MCP floors (F25, F26)** already correctly use `_classifyCommandDual` — so the primary
safety path is intact. The bypass applies to the **receipt classification** and the **contract
scope resolution** that pre-empt floor evaluation.

---

## Options

### Option 1 — Export `_classifyCommandDual` from `decision-key.js` (RECOMMENDED)

Move the dual-path logic into `runtime/decision-key.js` (where `classifyCommand` lives) as an
exported `classifyCommandSafe()` or `classifyCommandDual()`. Decision-engine.js imports it;
all four raw-only call sites are updated to use the safe version.

**Changes:**
- `runtime/decision-key.js`: add `classifyCommandDual(cmd)` — import `normalizeCommand` from
  `./command-normalize`, mirror the `_classifyCommandDual` logic already in decision-engine.js.
- `runtime/action-ir.js:490`: replace `classifyCommand(cmd)` → `classifyCommandDual(cmd)`.
- `runtime/contract.js:545`: replace `classifyCommand(cmd)` → `classifyCommandDual(cmd)`.
- `runtime/decision-engine.js:1039`: replace `classifyCommand(...)` → `classifyCommandDual(...)`.
- `runtime/degraded-mode.js:108`: replace `classifyCommand(...)` → `classifyCommandDual(...)`.
- `runtime/decision-engine.js`: `_classifyCommandDual` becomes a local wrapper around the exported
  function (backward compat; or remove and use the import directly).

**FP risk:** The dual-path only escalates class when `norm !== raw` (Unicode present). For
pure-ASCII input (the overwhelming majority of real commands), `norm === raw` and behavior is
byte-identical to today.

### Option 2 — Deprecate `classifyCommand` export, make it call `classifyCommandDual` internally

Simplest migration: `classifyCommand` becomes an alias for the dual-path. All 4 call sites are
automatically fixed without code changes to callers.

**Risk:** May regress tests that assert `classifyCommand("рm")` returns `"generic"` (testing the
raw-only behavior). Those tests would need to be updated — which is the correct behavior change.

### Option 3 — Status quo + documentation

Document the raw-only call sites as known limitations. Accept that receipt classification and
contract scope resolution are single-path.

---

## Recommendation

**Option 2** (simplest) if eval/test coverage confirms no regressions. **Option 1** (explicit) if
a named `classifyCommandSafe` is preferred over a silent semantic change to the exported function.
Either closes the bypass.

### What tests would prove the fix

1. `tests/runtime/command-normalize.test.js` — add `classifyCommandDual("рm -rf /")` →
   `"destructive-delete"` test.
2. `tests/runtime/mcp-floor-adversarial.test.js` — add a Cyrillic command via non-MCP Bash path,
   confirm the receipt's `commandClass` field is `"destructive-delete"` (not `"generic"`).
3. Eval corpus: no new entries needed (existing `safe-01` through `safe-22` are pure ASCII; the
   Cyrillic corpus entries in Track B exercise the MCP path).

---

## FP risk

- **Option 2 FP risk: low.** `classifyCommandDual` returns the more restrictive class, never
  the less restrictive class. A `generic` raw command that is also `generic` normalized stays
  `generic`. Only misclassified commands (raw → `generic`, normalized → `destructive`) are affected
  — and that change is correct behavior.
- **Corpus impact:** Eval corpus entries use ASCII commands; `norm === raw` for all 120 entries →
  zero behavior change.

---

## Consequences

- **If approved:** one import addition in `decision-key.js` + 4 call-site edits. No fixture or
  corpus changes needed for ASCII corpus. ADR line-number comments may need refresh.
- **If declined:** document the four raw-only sites explicitly in the code with a `// TODO ADR-023`
  comment so they are visible to future reviewers.
