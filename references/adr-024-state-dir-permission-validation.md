# ADR-024 — State-Dir Permission Validation

**Status:** Implemented — header reconciled 2026-06-12, Phase-0 ledger reconciliation (proposed 2026-06-01). Option 1
shipped: `ensureStateDirSafe()`/`ensureBaseDirSafe()` live in `runtime/state-dir.js`; the `mcp-pin.js` call site returns
`{ drift: false, reason: "state-dir-insecure" }` as specified; rolled out across all consumers via ADR-028 (commit
095c2ba) and the ADR-032 sweep (PRs #119/#120). Option 2 (atomic write-temp+rename) was consciously deferred to ADR-033
(shipped, PR #121).  
**Severity:** HIGH  
**Area:** `runtime/mcp-pin.js`, `runtime/decision-journal.js`, and all other LILARA_STATE_DIR consumers.

---

## Problem

`runtime/mcp-pin.js` reads and writes `LILARA_STATE_DIR/mcp-pins/pins.json` without validating
the permissions or ownership of `LILARA_STATE_DIR`. The fail-open catch at line 87:

```js
} catch { return { drift: false }; }
```

means any I/O error silently suppresses drift detection.

### Threat model: state-dir compromise

If `LILARA_STATE_DIR` points to a world-writable directory (e.g. `/tmp` without a process-specific
suffix, or a shared network mount), an attacker can:

1. **Pre-pin a hash**: Before Lilara first sees a server, write
   `LILARA_STATE_DIR/mcp-pins/pins.json` with a pre-seeded hash for the target `{server/tool}`.
   On the first real call, the pin matches → `drift: false` → no escalation, even if the actual
   arg shape is already dangerous.
2. **Corrupt the pin store**: Write invalid JSON to `pins.json`. `_readPins()` at line 47 catches
   parse errors and returns `{}` — all pins reset. The next call is "first sight" with no drift
   detection until the pin re-establishes.
3. **Race after pin write**: The pin write at line 53 (`_writePins`) is a single
   `fs.writeFileSync`. An attacker who observes the write can overwrite immediately after with the
   old hash, suppressing the drift signal for the next check.

**Impact (after ADR-018 Option 1):** The rug-pull pin is no longer advisory-only — it is the
enforcement trigger for `trusted-server-dualuse-after-drift`. Suppressing drift suppresses the
`require-review` escalation, allowing a rug-pulled trusted server to emit DROP DATABASE without a
human gate.

### Scope of the problem

The same dir-trust issue applies to:
- `runtime/decision-journal.js` — journal integrity (tamper evidence)
- `runtime/policy-store.js` — learned-allow grants
- `runtime/cross-agent-lock.js` — exclusive locks
- `runtime/session-context.js` — session trajectory state

All of these write security-critical state to `LILARA_STATE_DIR`.

---

## Current mitigations (partial)

- `_writePins()` uses `mode: 0o600` (user-only) for new files on creation.
- But `LILARA_STATE_DIR` itself is not mode-checked; a world-writable parent dir makes `0o600`
  on the file meaningless (attacker can rename/replace it).
- The decision-journal uses hash-chaining (ADR-004) for tamper detection of journal entries, but
  not for the pin store.

---

## Options

### Option 1 — Validate state-dir permissions on startup (RECOMMENDED)

In `runtime/mcp-pin.js` `_pinStorePath()` (or a shared `runtime/state-dir.js` helper), add:

```js
function ensureStateDirSafe(dir) {
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) throw new Error("not-a-directory");
    // Fail on world-writable (sticky bit doesn't protect against pre-creation attacks)
    if (st.mode & 0o002) {
      process.stderr.write(
        `[lilara] WARNING: LILARA_STATE_DIR is world-writable (${dir}); ` +
        `pin and journal integrity cannot be guaranteed.\n`
      );
      // Conservative: do NOT abort (would break all deploys that use /tmp);
      // log a warning and disable the stateful pin for this invocation.
      return false;
    }
    // Check ownership: must be the current user
    if (st.uid !== process.getuid?.()) {
      process.stderr.write(
        `[lilara] WARNING: LILARA_STATE_DIR is not owned by the current user.\n`
      );
      return false;
    }
    return true;
  } catch { return false; }
}
```

If `ensureStateDirSafe` returns false, `checkArgShapeDrift` should return
`{ drift: false, reason: "state-dir-insecure" }` and set an advisory field — same as today's
fail-open, but now explicit and logged.

**Why not abort?** Aborting `decide()` when state-dir is insecure would break every deployment
that uses a shared `/tmp` (e.g., CI). The conservative path is warn + disable the stateful pin
for this session; the stateless floors (F25, F26) still apply.

### Option 2 — Atomic pin update (write-rename)

Replace `fs.writeFileSync(pinPath, ...)` with a write-to-temp + atomic rename:
```js
const tmp = pinPath + ".tmp." + process.pid;
fs.writeFileSync(tmp, ..., { mode: 0o600 });
fs.renameSync(tmp, pinPath);
```

**Benefit:** Prevents partial-write corruption. Does NOT prevent a pre-positioned attacker from
replacing the file before the rename (race condition → still vulnerable on world-writable dirs).

**Recommended as a supplemental hardening, not a standalone fix.**

### Option 3 — Status quo + documentation

Document the threat model explicitly in the code. Add a `SECURITY.md` note about state-dir
requirements. Accept the risk for environments that cannot guarantee a secure `LILARA_STATE_DIR`.

---

## Recommendation

**Option 1 + Option 2** as a layered defense:
- Permission check on startup (warn, not abort, on insecure state-dir).
- Atomic pin update to prevent partial-write corruption.
- Centralize the check in a new `runtime/state-dir.js` helper so all state consumers (`mcp-pin`,
  `decision-journal`, `policy-store`, `cross-agent-lock`) share the same validation.

### Where it hooks

- `runtime/mcp-pin.js:35–40` — `_pinStorePath()` or `_readPins()` calls the new helper.
- Optionally: `runtime/pretool-gate.js` (the adapter entry point) — validate once at startup,
  cache the result, pass it down to all state consumers.

### What tests would prove no regression

- Existing `tests/runtime/mcp-pin.test.js` unchanged — they use a temp dir that is safe.
- New test: call `checkArgShapeDrift` with a world-writable mock stateDir → confirm
  `{ drift: false, reason: "state-dir-insecure" }` returned and warning logged.

---

## FP analysis

- **No eval impact:** state-dir validation never changes `decide()`'s `action` output — only the
  advisory drift field. FP/FN rates unchanged.
- **Operator experience:** a misconfigured state-dir produces a warning on stderr, not a block.
  Operator must either secure the dir or accept degraded rug-pull detection.
- **Platform note:** On Windows, `process.getuid()` is undefined — skip the uid check, rely on
  the mode check only (Windows permissions work differently).

---

## Consequences

- **If approved:** new `runtime/state-dir.js` helper + updates to `mcp-pin.js` + optional atomic
  write for `_writePins`. No eval/fixture/corpus changes.
- **If declined:** document the threat model in `SECURITY.md` and add a `// SECURITY: not
  validated — see ADR-024` comment in `mcp-pin.js` for future reviewers.
