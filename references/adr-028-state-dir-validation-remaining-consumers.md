# ADR-028 — State-Dir Validation Gap: Remaining Consumers

**Status:** Implemented — header reconciled 2026-06-12, Phase-0 ledger reconciliation (proposed 2026-06-02). Shipped in
commit 095c2ba: `decision-journal.js`, `policy-store.js`, `session-context.js`, and `cross-agent-lock.js` all validate
via `ensureBaseDirSafe`/`ensureStateDirSafe` with per-consumer fail-safe fallbacks (disable journaling / empty policy /
in-memory degrade / `{ ok: false }`). The three consumers descoped here (snapshot, receipt-export, state-bundle) were
closed by the ADR-032 full sweep (PR #120).  
**Severity:** MED-HIGH  
**Area:** All `LILARA_STATE_DIR` consumers except `mcp-pin.js` (already hardened by ADR-024).

---

## Problem

ADR-024 (June 2026) hardened `runtime/mcp-pin.js` to validate the state directory before
pin I/O using the new `runtime/state-dir.js:ensureStateDirSafe()`. The same dir-trust gap
exists in every other runtime module that writes security-critical state to
`LILARA_STATE_DIR`.

### Affected consumers (via `state-paths.stateDir()` / `ensureDir()`)

| Module | State written | Security sensitivity |
|--------|---------------|---------------------|
| `runtime/decision-journal.js` | Hash-chained audit log | HIGH — tamper evidence relies on journal integrity |
| `runtime/policy-store.js` | Learned-allow grants | HIGH — a poisoned policy-store can pre-grant dangerous commands |
| `runtime/cross-agent-lock.js` | Exclusive agent locks | MED-HIGH — poisoned locks can deny or grant cross-agent access |
| `runtime/session-context.js` | Session trajectory state | MED — trajectory under-inflation suppresses risk escalation |
| `runtime/snapshot.js` | Pre-write snapshots | MED — can suppress recovery artifacts |
| `runtime/receipt-export.js` | Decision receipts | MED — audit artifact |
| `runtime/state-bundle.js` | Bundled state export | MED — export artifact |

### The attack surface

`state-paths.stateDir()` returns `path.resolve(process.env.LILARA_STATE_DIR)` (or
`~/.lilara`). `ensureDir()` in `state-paths.js` does:
```js
function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
  } catch { /* caller handles missing dir */ }
}
```

This creates the directory if absent (correct) but **does not validate existing dir
permissions**. A world-writable `~/.lilara` (or an attacker who pre-created it
world-writable) lets them:
- Pre-write policy entries to grant dangerous commands without user approval.
- Corrupt the decision-journal to suppress tamper-evidence.
- Write a fake cross-agent lock to block or unlock agent coordination.

### Why this gap is slightly less urgent than ADR-024

`mcp-pin.js` had the most direct attack chain: compromised pin → suppressed rug-pull
escalation → dangerous command allowed despite trust erosion. The other consumers
support auditing, policy management, and coordination — critical for security posture
but not a direct allow-gate bypass in the same invocation.

---

## Options

### Option 1 — Centralise `ensureStateDirSafe` in `state-paths.js` (RECOMMENDED)

Extend `state-paths.js:ensureDir()` to call `ensureStateDirSafe` on existing dirs:

```js
const { ensureStateDirSafe } = require("./state-dir");

function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
    return ensureStateDirSafe(dirPath); // returns bool
  } catch { return false; }
}
```

All consumers of `ensureDir` get the validation automatically. Each consumer must be
updated to check the return value and gracefully degrade (log warning, disable stateful
features) rather than proceeding with I/O to a poisoned path.

**Challenge:** Callers currently ignore `ensureDir`'s return value (it returns void).
Changing the signature is a minor breaking change for callers; each must handle `false`.

### Option 2 — Validate once at startup in `pretool-gate.js`

`pretool-gate.js` is the adapter entry point called on every hook invocation. Add a
single `ensureStateDirSafe(stateDir())` check there; cache the result; pass it down to
all state consumers as a context flag:

```js
// pretool-gate.js
const stateDirSafe = ensureStateDirSafe(stateDir());
// Pass stateDirSafe to decide() in the context object
```

Consumers check the flag before I/O. More explicit; single validation point.

### Option 3 — Per-module opt-in (same as ADR-024)

Each module individually calls `ensureStateDirSafe` before I/O, same pattern as
`mcp-pin.js`. Verbose but mirrors the existing ADR-024 approach.

### Option 4 — Status quo + documentation

Document the gap in `SECURITY.md`. Accept the risk for environments that cannot
guarantee a secure `LILARA_STATE_DIR`.

---

## Recommendation

**Option 2** — single validation in `pretool-gate.js` is the cleanest entry-point
approach. It avoids per-module boilerplate and validates exactly once per agent invocation.
The cached boolean flows through the context object that `decide()` already receives.

**Also:** `runtime/mcp-pin.js` is the only state consumer that bypasses
`state-paths.stateDir()`, using `process.env.LILARA_STATE_DIR || os.tmpdir()` directly.
This inconsistency (different fallback: `/tmp` vs `~/.lilara`) should be resolved as
part of this ADR — unified via `stateDir()` from `state-paths.js`.

---

## FP analysis

- **No eval FP/FN:** State-dir validation never changes `decide()`'s `action` output.
- **Operator experience:** A misconfigured state dir produces a one-shot warning and
  disables stateful features (learned-allow lookup, journal append, policy writes).
  Stateless floors (F3, F25, F26) still apply. The agent can still operate in a
  degraded-but-safe posture.
- **CI/CD impact:** CI runners using shared `/tmp` may trigger warnings if `/tmp` is
  world-writable. Operators should point `LILARA_STATE_DIR` at a process-specific
  subdirectory (e.g., `mktemp -d`) in CI.

---

## Engine/script hook point

- `runtime/state-paths.js:ensureDir()` — add `ensureStateDirSafe` call here, OR
- `runtime/pretool-gate.js` — add a single startup validation.
- `runtime/decision-journal.js`, `policy-store.js`, `cross-agent-lock.js`,
  `session-context.js` — update callers to handle unsafe-dir result.
- `runtime/mcp-pin.js` — fix inconsistent fallback (`os.tmpdir()` → `stateDir()`).

---

## Consequences

- **If approved:** Extend `state-dir.js`; update `pretool-gate.js` or `state-paths.js`;
  each consumer handles unsafe-dir gracefully. Tests: mock world-writable state dir at
  `pretool-gate` level → confirm all consumers degrade safely.
- **If declined:** Add `// ADR-028: unvalidated state-dir — see SECURITY.md` to each
  `ensureDir` call site and document the threat in `SECURITY.md`.
