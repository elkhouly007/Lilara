# ADR-029 — Pin-Store Corruption = Silent Full Reset

**Status:** Implemented — header reconciled 2026-06-12, Phase-0 ledger reconciliation (proposed 2026-06-02). Shipped in
commit acb524f: `_readPins()` now splits ENOENT (legitimate first-sight, returns `{}`) from parse/IO error (returns the
`{ _corrupt: true }` sentinel, emits a one-shot warning, and takes a best-effort forensic `.bak` copy);
`checkArgShapeDrift()` guards the sentinel and returns `{ drift: false, reason: "pin-store-corrupt" }` instead of
silently re-pinning to a possibly rug-pulled shape.  
**Severity:** MED  
**Area:** `runtime/mcp-pin.js:_readPins()` — ENOENT vs JSON parse-error ambiguity.

---

## Problem

`_readPins()` in `mcp-pin.js` (master state, before ADR-024) reads the pin store with
a blanket catch:

```js
function _readPins() {
  const p = _pinStorePath();
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};  // treats ENOENT and JSON parse-error identically
  }
}
```

### Two very different error scenarios treated identically

**Scenario A — ENOENT:** The pin file does not exist yet. This is **legitimate first-sight**
behaviour. Returning `{}` is correct: no pins recorded → first call records the hash.

**Scenario B — JSON parse error:** The file exists but contains invalid JSON. This can
result from:
- Attacker corruption (write invalid JSON to `LILARA_STATE_DIR/mcp-pins/pins.json`)
- Partial write (pre-ADR-024: `_writePins` was non-atomic; partial write → invalid JSON)
- Filesystem corruption or truncation

Returning `{}` on parse error **silently resets all drift history** for every
`{server, tool}` pair. Every subsequent call is treated as "first sight" — no drift is
detectable until the pin re-establishes on the next call.

### ADR-024 interaction

ADR-024 (June 2026) introduced:
1. State-dir permission validation (world-writable → skip I/O entirely)
2. Atomic pin writes via temp+rename

Atomic writes substantially reduce the probability of partial-write corruption. However:
- The rename is not transactional (power loss mid-rename can still leave a `.tmp.PID` file
  and no `pins.json`).
- The state-dir validation guards the DIR, but not the file within it. If `pins.json` is
  replaced by an attacker AFTER the dir check (race window between
  `ensureStateDirSafe()` → `_readPins()` → `_writePins()`), a corrupted file can still
  reach `_readPins()`.
- On Windows (where dir-level permission check is skipped), file corruption is less
  mitigated.

### Impact on ADR-018 rug-pull enforcement

After ADR-018, the pin IS the enforcement trigger. A full pin reset means:
- Next call is treated as first-sight → `drift: false` (no escalation)
- Attacker can then serve a rug-pulled dangerous arg shape as if it were the original
- The trusted-server + dangerous-arg escalation is suppressed for one call per server/tool

---

## Options

### Option 1 — Distinguish ENOENT from parse-error (RECOMMENDED)

```js
function _readPins() {
  const p = _pinStorePath();
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};    // legitimate: no pin file yet
    // Parse error or other I/O error — possible corruption. Treat as insecure.
    process.stderr.write(
      `[lilara] WARNING: mcp-pins/pins.json is unreadable (${err.message}); ` +
      "drift detection suspended for this invocation.\n"
    );
    return { _corrupt: true };              // sentinel — causes caller to skip I/O
  }
}
```

Then in `checkArgShapeDrift`:
```js
const pins = _readPins();
if (pins._corrupt) return { drift: false, reason: "pin-store-corrupt" };
```

**Effect:** Corruption is detected, logged, and the result is an explicit
`{ drift: false, reason: "pin-store-corrupt" }` rather than a silent first-sight
reset. Operator can inspect and remove the corrupt file. Next invocation with a clean
file resumes normal drift detection.

**Why not `drift: true` on corruption?**  Returning `drift: true` on corruption would
trigger the rug-pull escalation pathway for EVERY call until the file is repaired —
this is operationally too aggressive and could block legitimate MCP operations if the
file is transiently unreadable (e.g., filesystem glitch).

### Option 2 — Backup + restore strategy

On parse error, rename `pins.json` to `pins.json.corrupt.TIMESTAMP`, return `{}` (first-
sight), and let the pin re-establish. Preserves evidence for forensics; auto-recovers.
Adds write complexity (another rename); the corrupt file is preserved but not acted on.

### Option 3 — Status quo (now partially mitigated)

ADR-024's atomic writes and dir-level permission validation reduce corruption probability
substantially. Document the residual ENOENT/parse-error ambiguity in the code comment.

---

## Recommendation

**Option 1** — the ENOENT/parse-error split is a four-line change that meaningfully
improves the signal quality of `_readPins`. The `{ drift: false, reason: "pin-store-corrupt" }`
result is the correct explicit fail-safe posture (visible to operators, not silently
swallowed). Optionally combine with Option 2's backup-rename for forensics.

---

## FP analysis

- **No eval FP/FN:** State-dir and pin-file validation never changes `decide()`'s
  `action` output; only the advisory drift field is affected.
- **Operator experience:** A corrupt pin file produces a one-shot stderr warning. The
  operator removes `LILARA_STATE_DIR/mcp-pins/pins.json`; next invocation auto-recreates
  it. Pin detection resumes on the following call.
- **False alarms:** A transient filesystem error (e.g., stale NFS handle) produces the
  same warning as an attack. Operators should inspect the file. The warning is conservative
  and correct — the file is unreadable; suspending drift detection is the right response.

---

## Engine/script hook point

- `runtime/mcp-pin.js:_readPins()` — the `catch` block at ~line 47.
- `runtime/mcp-pin.js:checkArgShapeDrift()` — add `_corrupt` sentinel check after
  `_readPins()` call (~line 70 in post-ADR-024 mcp-pin.js).
- `tests/runtime/mcp-pin.test.js` — add test: write invalid JSON to pin file, call
  `checkArgShapeDrift`, assert `{ drift: false, reason: "pin-store-corrupt" }` + warning.

---

## Consequences

- **If approved:** 4-line change to `_readPins` + 2-line guard in `checkArgShapeDrift` +
  1 new test. Zero eval/replay impact. Improves forensic visibility for corruption.
- **If declined (Option 3):** Add a `// ADR-029: ENOENT and parse-error treated identically`
  comment to `_readPins` so future reviewers understand the ambiguity is known.
