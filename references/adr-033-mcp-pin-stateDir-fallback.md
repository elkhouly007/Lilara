# ADR-033 — mcp-pin `os.tmpdir()` → `stateDir()` Fallback Unification

**Status:** Proposed — 2026-06-02. Descoped from ADR-028 pending Khouly's call on FP nuance.  
**Severity:** LOW-MED  
**Area:** `runtime/mcp-pin.js` — inconsistent state-dir resolution when `LILARA_STATE_DIR` is unset.

---

## Problem

`mcp-pin.js` is the **only** state consumer that bypasses `state-paths.stateDir()` for its
base directory resolution. When `LILARA_STATE_DIR` is unset, the other consumers resolve
to `~/.lilara` (via `stateDir()`); `mcp-pin.js` falls back to `os.tmpdir()`:

```js
// mcp-pin.js
const stateDir = process.env.LILARA_STATE_DIR || os.tmpdir();
```

vs.

```js
// policy-store.js, session-context.js, decision-journal.js
const { stateDir } = require("./state-paths");
const dir = stateDir(); // → LILARA_STATE_DIR || path.join(os.homedir(), ".lilara")
```

This inconsistency has two consequences:

1. **Pin storage diverges from all other state** — when `LILARA_STATE_DIR` is unset,
   pins land in `/tmp/mcp-pins/pins.json` while policy, journal, and session state land
   in `~/.lilara/`. The pin store is invisible to backup and state-bundle exports.

2. **Validation semantics differ** — `/tmp` is frequently world-writable (mode 1777 with
   sticky bit). `ensureStateDirSafe` rejects world-writable dirs on POSIX, so drift
   detection would be disabled on systems where `/tmp` is world-writable **and**
   `LILARA_STATE_DIR` is unset. Under the current `os.tmpdir()` fallback, this is often
   the case for default Linux/macOS setups.

### ADR-028's explicit note

ADR-028's reference document (lines 116-119) explicitly called out this inconsistency as
part of the ADR-028 recommendation. The actual ADR-028 PR (PR #115) deferred it:

> FP nuance: switching to `~/.lilara` could return `state-dir-insecure` for users who
> never created it, where `/tmp` always exists. Warrants separate review.

---

## FP nuance (the reason for deferral)

If mcp-pin switches to `stateDir()` (resolving to `~/.lilara` when `LILARA_STATE_DIR` is
unset):
- `ensureStateDirSafe(~/.lilara)` fails with "stat failed" (ENOENT) if `~/.lilara` was
  never created by any prior Lilara run.
- This returns `false` → drift detection disabled → every call returns
  `{ drift: false, reason: "state-dir-insecure" }`.
- Under `os.tmpdir()`, `/tmp` always exists → drift detection works immediately.

The fix requires `_pinStorePath()` to `mkdirSync` before validating, or `ensureBaseDirSafe`
(which mkdirs then validates). This is the `ensureBaseDirSafe` pattern already shipped in
ADR-028 — but it would change `mcp-pin.js`'s behavior for users who run Lilara for the
first time without an existing `~/.lilara`.

---

## Options

### Option 1 — Unify via `stateDir()` + `ensureBaseDirSafe` (RECOMMENDED)

Replace `os.tmpdir()` with `stateDir()` in `_pinStorePath()` and in the `checkArgShapeDrift`
dir resolution. Use `ensureBaseDirSafe` to mkdir-then-validate, so the first run auto-creates
`~/.lilara/mcp-pins/` safely:

```js
// Before:
const stateDir = process.env.LILARA_STATE_DIR || os.tmpdir();
// After:
const { stateDir: _stateDir } = require("./state-paths");
const resolvedStateDir = _stateDir();  // LILARA_STATE_DIR || ~/.lilara
```

The validation call in `checkArgShapeDrift` already uses `ensureBaseDirSafe` semantics
(mkdir-then-validate); no caller change needed.

**Migration:** existing pins under `os.tmpdir()` are silently abandoned (they were ephemeral
anyway — in `/tmp`). First call after the change records pins fresh in `~/.lilara/mcp-pins/`.

### Option 2 — Status quo + code comment

Leave `os.tmpdir()` as the fallback. Add a comment explaining the inconsistency and the
FP trade-off. Document in `SECURITY.md`.

---

## Recommendation

**Khouly's call needed.** The trade-off is:
- Option 1: consistent state dir, ADR-018 more reliable, first-run auto-creates `~/.lilara`.
  Pins previously in `/tmp` are abandoned (one-time first-sight reset on first run after upgrade).
- Option 2: no behavior change, no migration, but state dir remains inconsistent and
  drift detection is silently disabled on any system where `/tmp` is world-writable and
  `LILARA_STATE_DIR` is unset.

If you approve Option 1, the change is ~5 lines in `mcp-pin.js`.

---

## FP analysis

- **No eval/replay drift:** pin-store path is advisory; its result never changes `decide()`'s `action` output.
- **First-run behavior:** on first invocation after the change, pins start fresh in `~/.lilara/mcp-pins/`. Every server/tool is "first-sight" for that run; no false drift detection.

---

## Engine/script hook points

- `runtime/mcp-pin.js:_pinStorePath()` — replace `os.tmpdir()` with `_stateDir()`.
- `runtime/mcp-pin.js:checkArgShapeDrift()` — replace `process.env.LILARA_STATE_DIR || os.tmpdir()` with `_stateDir()`.
- Remove `const os = require("os")` if no longer needed.

---

## Cross-references

- ADR-024: introduced the `os.tmpdir()` fallback with explicit validation.
- ADR-028: first consumer sweep; surfaced this inconsistency as out-of-scope.
- `runtime/state-paths.js:stateDir()` — the canonical resolver.
