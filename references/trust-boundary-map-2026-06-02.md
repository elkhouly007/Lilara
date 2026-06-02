# Trust Boundary Map — Lilara 2026-06-02

**Status:** Living document — update this map each sprint instead of re-auditing from scratch.
**Version:** 0.1.6 (master @ 095c2ba, post ADR-028/029/030 bundle)
**Sprint that produced it:** June 2026 hardening sprint, trust-boundary-audit bundle.
**Owner:** Security-focused engineering. Every code PR that touches a boundary listed here
should update the relevant row.

---

## How to read this map

Each boundary is described by:
- **Source trust level** — where the data originates (caller, on-disk state, env var, MCP layer)
- **Validation present** — `✓` = validated/guarded; `~` = partial/advisory guard only; `✗` = none
- **Fail direction** — what happens on degraded/malicious input (`CLOSED` = blocks or degrades-closed, `OPEN` = allows/widens trust, `SAFE-ish` = evidence-only, cannot widen a live decision)
- **Load-bearing** — does a throw/bad value here propagate to `decide()`'s return, the receipt, or the gate?
- **Status** — `RESOLVED` (this sprint), `KNOWN-ACCEPTED` (documented and accepted), `PROPOSED` (future ADR)

---

## Cluster A — `input.*` reads into `decide()` (ADR-031 surface)

**Entry point:** `runtime/decision-engine.js:960` — `function decide(input = {})`

**Framing:** `decide()` has **no outer try/catch**. Any uncaught throw propagates to
`pretool-gate.js:268-283`, which only fails **closed** when `LILARA_ENFORCE=1` *and* an
independent surface signal (dangerous-pattern / secret / sensitive-path) is present.
In the common case it falls through to `:281-282` — **exit 0 = allow**. An uncaught
throw inside `decide()` is therefore a **fail-open bypass**, not a DoS.

**Fix (ADR-031):** `materializeInput(input)` called once at `:987`, immediately after
the kill-switch early-return, before `discover(input)`. Reassigns the local `input`
binding so every downstream read sees a safe, getter-free, null-safe copy. On any throw
during materialization, `decide()` returns a fail-safe `require-review` decision object.

| ID | Finding | Site | Load-bearing? | Fail direction | Severity | Status |
|----|---------|------|---------------|----------------|----------|--------|
| A1 | `discover(input)` + `Object.entries(input)` — first ops before any floor; null input or throwing enumerable getter crashes here | `:989-991` | Yes (feeds enriched) | OPEN → gate allow | HIGH | **RESOLVED** (ADR-031 PR 2) |
| A2 | `input.repeatedApprovals` / `sessionRisk` / `branch` read with only `!=null` guard, no try/catch | `:1004-1006` | Yes (sessionRisk→F9 escalate) | OPEN | HIGH | **RESOLVED** (ADR-031 PR 2) |
| A3 | `_classifyCommandDual(input.command)` — `\|\|""` guards value but not a throwing getter | `:1072` | Yes (cmdClass→isGated→F2/F5/contract) | OPEN | HIGH | **RESOLVED** (ADR-031 PR 2) |
| A4 | `String(input.harness)` (F5 harness-scope) read outside any try | `:1101` | Yes (F5 block) | OPEN | HIGH | **RESOLVED** (ADR-031 PR 2) |
| A5 | `input.payloadClass` (F11) read outside the F11 try | `:1141` | Yes (F11 block vs warn) | OPEN | HIGH | **RESOLVED** (ADR-031 PR 2) |
| A6 | `input.envelope && input.observedEnvelope` gate read **outside** the F15 try (verify body inside is fail-closed) | `:1348` | Yes (F15 envelope-diverged) | OPEN (gate read) | HIGH | **RESOLVED** (ADR-031 PR 2) |
| A7 | `input.tool` in the F4 MCP secret-scan branch, unguarded | `:1896` | Yes (F4 block/demote) | OPEN | MED-HIGH | **RESOLVED** (ADR-031 PR 2) |
| A8 | Receipt builders (`buildEarlyBlock:269`, `buildEarlyReview:359`, final receipt `:2277`) read `input.envelope \|\| null` **inside the result literal, before** the journal try/catch — a throwing getter converts an intended BLOCK/REVIEW into a gate crash | `:269`, `:359`, `:2277` | Yes (receipt IS the decision) | OPEN | HIGH | **RESOLVED** (ADR-031 PR 2) |
| A9 | Final journal-append block (`input.tool/branch/targetPath/notes`) not in try/catch — a throwing getter crashes **after** the decision is computed | `:2316-2327` | Advisory (telemetry) | OPEN (post-decision) | MED | **RESOLVED** (ADR-031 PR 2) |
| A10 | Late floors (F16/F24/F17/F25/F26/F19) per-call outer `try→buildEarlyReview`; advisory classifiers (ambientTouch `:1016`, isWriteLike `:1030`, classifyIntent `:1046`) guarded by ADR-025/030 | various | Mixed | CLOSED / SAFE-ish | (already covered) | KNOWN-ACCEPTED |

**Guard-shape note:** ADR-025 introduced three inconsistent guard shapes — per-call outer try, per-read try, and inline `||`/`?.`/`typeof`. The inline guards protect against null/undefined *values* but **not throwing getters**. The `input.command` property is guarded as advisory at `:1046` yet read load-bearing-unguarded at `:1072` (the engine's own comment at `:1042-1044` acknowledges this). Input materialization closes all A-series findings with one seam.

---

## Cluster B — State-dir consumers (ADR-032/033 surface)

**Resolver:** `runtime/state-paths.js:13-17` — `stateDir()` returns
`path.resolve(LILARA_STATE_DIR)` else `~/.lilara`. **No validation** — delegates to
`ensureStateDirSafe` / `ensureBaseDirSafe` in `runtime/state-dir.js:53,126`.

**Shared validation helpers** (ADR-024/028 primitives):
- `ensureStateDirSafe(dir) → boolean` `:53` — read guard; rejects world-writable
  (`0o002`), foreign-owned (`uid≠process.getuid()`), non-directory, or inaccessible.
  Windows: returns `true` for any directory (POSIX bits meaningless on NTFS).
  **Known limitation:** `statSync` follows symlinks; a symlink to a user-owned safe dir passes.
- `ensureBaseDirSafe(dir) → boolean` `:126` — write guard; creates dir at `0o700` if
  absent, then calls `ensureStateDirSafe`.

**ADR-028 baseline (already validated, all CLOSED/degrade-closed):**
- `decision-journal.js`: `append()` returns false on unsafe dir → journal disabled, action unaffected.
- `policy-store.js`: read unsafe → `emptyPolicy()` (no learned-allow grants from poisoned store); write unsafe → cache-only.
- `session-context.js`: read unsafe → `emptyState()`; write unsafe → skip.
- `cross-agent-lock.js`: insecure dir / malformed → `ok:false, malformed[]` → writes fail-closed.

**Audit findings (this sprint):**

| ID | Consumer | Read/Write paths | Validation | Fail direction | Severity | Status |
|----|----------|-----------------|------------|----------------|----------|--------|
| B1 | `envelope.js` `loadBaseline()` `:99-115` | R+W `envelope-baselines/*.json` | None | **FAIL-UNSAFE** — missing/corrupt baseline silently re-baselines to current (possibly poisoned) env → suppresses F15 env-divergence floor | HIGH | **RESOLVED** (ADR-032 PR 3) |
| B2 | `journal-chain.js` `:36-51` | R+W hash-chain + key file | None | Tamper-evident chain on attacker-writable dir | MED-HIGH | **RESOLVED** (ADR-032 PR 4) |
| B3 | `contract.js` `:42,196` | R+W `accepted-contracts.json`, `operator-tokens.jsonl` | None | Operator-token store unguarded | MED-HIGH | **RESOLVED** (ADR-032 PR 4) |
| B4 | `snapshot.js` `:25,87` | W snapshots tree | None | Fail-open evidence rail — cannot widen a live decision | MED | **RESOLVED** (ADR-032 PR 4) |
| B5 | `state-bundle.js` `:70,176,275` | R+W export/import | None (structural manifest check only) | Import restores attacker-supplied files; no perm check on destination | MED | **RESOLVED** (ADR-032 PR 4) |
| B6 | `receipt-export.js` `:20-31` | R journal | None | Offline audit tool — poisoned journal corrupts export, no live effect | LOW | **RESOLVED** (ADR-032 PR 4) |
| B7 | `sarif-export.js` `:6` | R stateDir | None | Offline export tool | LOW | **RESOLVED** (ADR-032 PR 4) |
| B8 | `telemetry.js`, `session-budget.js`, `session-memory.js`, `session-resume.js`, `spend-estimator.js`, `workflow-enforcer.js`, `memory-search.js` | R+W under stateDir | None | Fail-open writers; no live-decision widening | LOW-MED | **RESOLVED** (ADR-032 PR 4) |
| B9 | `mcp-pin.js` `:49,129` | R+W `mcp-pins/pins.json` | Validated but uses `os.tmpdir()` fallback (not `stateDir()`) | On world-writable `/tmp` with var unset: `ensureStateDirSafe` rejects → drift detection silently disabled | LOW-MED | **RESOLVED** (ADR-033 PR 5) |

**ADR-028 (already validated):** `decision-journal.js`, `policy-store.js`, `session-context.js`, `cross-agent-lock.js` — CLOSED/degrade-closed. See above.

---

## Cluster C — MCP boundary

**Framing (known-and-accepted):** Lilara is a **PreToolUse outbound gate** — it inspects
the *outbound* tool-call args before execution. It does **not** parse live MCP server
responses. There is zero `jsonrpc`/`tools/list`/`tools/call`/result parsing in `runtime/`.
Classic inbound threats (tool-list poisoning, malicious tool descriptions, malicious result
payloads) are **out of the current inspection surface by design.**

| ID | Surface | Validation | Fail direction | Status |
|----|---------|------------|----------------|--------|
| C1 | F12 mcp-deny (`decision-engine.js:1155`) — server-name routing via `input.mcpServer` or parsed from tool name | Per-server contract policy (`scopes.mcp[server]`) | CLOSED (deny→block, warn→advisory) | KNOWN-ACCEPTED |
| C2 | MCP arg-shape rug-pull pin (`decision-engine.js:1516-1547`) — `_checkArgShapeDrift` over `input.tool_input/args/params` | `ensureStateDirSafe` inside `mcp-pin.js:checkArgShapeDrift`; ADR-029 ENOENT-vs-parse split | FAIL-OPEN by design (`try{}catch{}` block — conscious choice, drift detection never blocks) | KNOWN-ACCEPTED |
| C3 | F25 mcp-arg-danger (`_evalMcpArgFloor:625`) — string values from all arg containers | `_ESV_NODE_CAP=1000` (oversize→unscannable→require-review); inner catch also→require-review | CLOSED (fail-safe on oversize/error — ADR-022) | KNOWN-ACCEPTED |
| C4 | F26 mcp-registration-write (`_evalMcpRegistrationFloor:745`) — file-write to MCP config path | `_RAW_SCAN_CAP=262_144` (oversize→unscannable→require-review); outer catch fail-closed | CLOSED (ADR-022) | KNOWN-ACCEPTED |
| C5 | MCP inbound: tool-list, tool-description, server response payloads | **No inspection** | Not applicable (not in surface) | PROPOSED (future ADR — inbound response inspection) |

---

## Cluster D — Replay / byte-identical guarantee

**Entry:** `scripts/replay-decisions.js` via `scripts/check-replay-corpus.sh`.
**Asserted byte-identical per corpus entry:** `action`, `decisionSource`, `floorFired`, `irHash`.
`irHash` = `"sha256:" + sha256(canonicalJson({...ir, irHash:""}))`.

`canonicalJson` (`runtime/canonical-json.js`) is the shared serializer — used by IR hashing,
journal-chain, envelope hash, receipt-export bundle hash, notify payloads, contract hashing,
snapshot manifest hash. It sorts keys recursively with **unbounded recursion** (pre-fix).

**Measured baseline (225 corpus entries, all 5 replay-corpus files + eval-corpus.json):**
- `canonicalJson` recursion call-depth (leaf = 1):
  - Max IR depth = **4** (`F3:rm-rf-tmp`)
  - Max decision-receipt depth = **5** (`f16:order:envelope-targets-ambient-after-nonambient-targetpath`)
  - → Baseline = **5** (deepest legitimate `canonicalJson` use)

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| D1 | `canonical-json.js` unbounded recursion — latent stack-overflow crash surface (DoS; pathological nested IR) feeding irHash and all other `canonicalJson` uses | MED | **RESOLVED** (ADR-021-depth-cap PR 6, cap=64 = 12.8×baseline) |
| D2 | Drift vectors (known): classifier changes re-base irHash; passing real `cwd` causes OS-specific path.resolve drift (replay deliberately omits it); branch leakage (replay pins `LILARA_BRANCH_OVERRIDE="replay/isolated-context"`) | — | KNOWN-ACCEPTED |

---

## Cluster E — Gate / env hygiene

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| E1 | `LILARA_DECISION_JOURNAL=0` disables journaling; the check-decide-on-every-call gate asserts journal-line growth → would false-fail. BUT `scripts/check-decide-on-every-call.sh:36-42` already overrides the env inline. No live bug. | LOW | KNOWN-ACCEPTED (mitigated inline; document only) |
| E2 | ADR-021 and ADR-022 number collisions (two distinct files each) | — | PROPOSED (housekeeping ADR, PR 7) |

---

## Known-and-accepted bucket

Future sprints: **do not re-audit these unless the underlying design changes.**

1. **MCP inbound inspection** (C5) — tool-list/description/result parsing is out of current
   surface by design. Lilara is a PreToolUse outbound gate. Future-ADR proposed.

2. **`LILARA_DECISION_JOURNAL=0` × check-decide gate** (E1) — already mitigated inline in
   `scripts/check-decide-on-every-call.sh:36-42`. No action needed.

3. **`state-dir.js` symlink-to-safe-target** — `statSync` follows symlinks; a symlink to a
   user-owned safe dir passes `ensureStateDirSafe`. Known limitation documented at
   `runtime/state-dir.js:20-23`. Acceptable; symlink from the state dir itself is an unusual
   attack vector.

4. **Offline export tools** (B6/B7: `receipt-export.js`, `sarif-export.js`) — poisoning
   these corrupts an audit artifact, never a live decision. Hardened this sprint for
   consistency, not severity.

5. **F25/F26 fail-open on any error** (C3/C4) — the `try{}catch{}` blocks in the MCP arg
   and registration floors use conscious fail-open (drift/arg danger never blocks). This is
   an intentional design decision (ADR-022 specifies fail-open on internal error for these
   advisory floors).

6. **MCP arg-shape rug-pull detection fail-open** (C2) — `checkArgShapeDrift` fails-open on
   any unexpected error because drift detection is advisory. Corrupt pin store (ADR-029)
   returns `{drift:false, reason:"pin-store-corrupt"}` explicitly rather than silently
   resetting — that part is fail-safe.

7. **ADR numbering collisions** (E2) — ADR-021 and ADR-022 each have two files. Housekeeping.

---

## Surface not yet mapped

These areas exist in the codebase but were not the focus of this audit sprint:

- `runtime/instinct-store.js` and friends — instinct/coaching system reads from
  `LILARA_INSTINCT_DIR`; not mapped for trust-boundary validation status.
- Notification transports (`runtime/notify/slack.js`, `discord.js`, `email.js`) —
  `LILARA_NOTIFY_INSECURE` / `LILARA_NOTIFY_TLS_NOVERIFY` env vars allow weakening TLS;
  not mapped. These are outbound-only so severity is limited.
- Context-discovery (`runtime/context-discovery.js`) VCS CI env var reads — not validated
  but feed only the branch/project-root detection, not decision logic directly.

---

## Maintenance protocol

When a PR touches a boundary in this map:
1. Update the **Status** cell of the affected row.
2. Add new rows for any new boundary surfaces touched.
3. Move resolved findings to a dated "Resolved in sprint X" appendix if the table grows
   unwieldy.
4. Do **not** delete known-and-accepted rows — they are the institutional memory that
   prevents re-auditing resolved surfaces.
