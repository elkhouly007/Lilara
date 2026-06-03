# ADR-034 — MCP Inbound Response Inspection

**Status:** Implemented — 2026-06-03 (quad-track bundle sprint). Option 2 variant chosen.
**Severity:** MED-HIGH (design question; current surface boundary is intentional)
**Area:** `runtime/post-adapter-factory.js` (block 2d), `runtime/session-context.js`

---

## Problem

Lilara is a **PreToolUse outbound gate** — it inspects the *outbound* tool-call request (args the agent is about to send) and decides allow/block/review before execution. It does **not** parse live MCP server responses. There is zero `jsonrpc`/`tools/list`/`tools/call`/result parsing in `runtime/`.

This means the following inbound threats are **currently outside Lilara's inspection surface:**

| Threat | Vector | Current coverage |
|--------|--------|-----------------|
| Tool-list poisoning | MCP server advertises a tool with a dangerous name or description designed to manipulate the agent | None (Lilara sees the tool name in `input.tool` at the outbound call, not during tool-list fetch) |
| Malicious tool description | Server returns a tool description containing injection payload or prompt injection | None |
| Malicious result payload | Server returns a result containing injection, exfil payload, or encoded command that the agent then executes | Partial — `runtime/post-adapter-factory.js` F23 scans MCP *result strings* for kill-chain indicators in the PostToolUse hook; `output-sanitizer.js` scans for class-C secrets. But this is PostToolUse (after execution), not a gate. |
| Tool-description schema drift | Server changes tool descriptions between tool-list fetches (analogous to arg-shape drift, but on the description) | None |

The trust-boundary audit confirmed: searching `runtime/` for `jsonrpc`, `tools/list`, `tools/call`, `result`, `toolDescription` returns zero hits for live response parsing.

---

## Background (why inbound is currently out of scope)

Lilara's architecture is adapted from Claude Code's PreToolUse hook: it receives the already-parsed tool-call request from the harness, not the raw JSON-RPC session. This is pragmatic — every harness (claude, opencode, openclaw) handles MCP session negotiation differently; Lilara normalizes at the outbound-gate layer. Adding inbound inspection would require Lilara to sit in the MCP connection path (proxy mode) rather than the decision-gate path.

The existing F23 (kill-chain detection), F4 (secret scan), and output-sanitizer run PostToolUse on MCP results as an advisory rail — they are not blocking gates. They cover exfiltration and kill-chain signals but not preemptive tool-description poisoning.

---

## Options

### Option 1 — Tool-list inspection on first-call (incremental, no proxy)

When Lilara observes a tool call to `mcp__<server>__<tool>` for the first time (or after a pin drift event from `mcp-pin.js`), trigger an out-of-band tool-list fetch from the server and inspect:
- Tool name collisions with dangerous built-ins
- Tool description containing dangerous-command-shaped strings (reuse F25 scanning logic)

Pro: No proxy; works with existing hook architecture. Con: Async out-of-band fetch adds latency on first-call; requires network access from the gate; race condition between fetch and execution.

### Option 2 — Result inspection gate (PostToolUse → require-review)

Promote the existing PostToolUse advisory scans (F23, output-sanitizer) to a **blocking gate** that the harness respects. If the result contains a kill-chain indicator or class-C secret, return `require-review` for the next tool call (trajectory escalation), not just a journal advisory.

Pro: Works within existing architecture; no proxy. Con: Reactionary (inspection after execution, not before); does not cover tool-list poisoning.

### Option 3 — MCP proxy mode (full inbound inspection)

Lilara runs as a transparent JSON-RPC proxy between the harness and MCP servers. Inspects tool-list responses (tool names, descriptions, schema) and tool-call results before they reach the agent. Full coverage of all inbound threat vectors.

Pro: Comprehensive; covers all threats including tool-list poisoning. Con: Significant architectural change; breaks all existing harness integrations; requires Lilara to be deployed as a network-layer proxy rather than a hook-level gate.

### Option 4 — Status quo + document (current)

Accept the current inbound surface as a design boundary. Document in the trust-boundary map. Continue to invest in outbound gate hardening (F25/F26/F23/F4) and PostToolUse advisory scans.

---

## Decision (2026-06-03)

**Option 2 — Result inspection gate / PostToolUse → trajectory escalation.**

Clarifying questions resolved:
1. **MCP credentials at gate time?** No — hard blocker for Option 1. The gate receives
   already-parsed input from the harness; no MCP connection credentials are available.
2. **PostToolUse blocking-capable?** Partially (unverified for all 6 harnesses). Resolved
   by choosing a TRAJECTORY variant of Option 2: PostToolUse stays advisory (never a
   blocking gate itself); it increments a session-level counter that the NEXT decide() call
   reads via F9 (sessionRisk ≥ 3 → escalate). PreToolUse remains the sole blocking gate.
3. **Proxy on roadmap?** No — confirmed stop condition (would change product positioning).

**Implementation:**
- `runtime/session-context.js`: `mcpInjectionSignals` field in session state;
  `recordMcpInjectionSignal()` increments it; `getMcpInjectionSignals()` reads it;
  `getSessionRisk()` adds tiered contribution (≥1 → +2, ≥2 → +3).
- `runtime/post-adapter-factory.js`: block 2d calls `recordMcpInjectionSignal()` when
  MCP injection is confirmed — after the existing journal append + provenance recording.

**Buildup semantics:**
- 1 injection alone → sessionRisk 2 → does NOT trip F9 (single signal is informative, not conclusive)
- 2+ injections alone → sessionRisk 3 → F9 escalates on next PreToolUse
- 1 injection + 2 prior escalations → 2+2 = 4 → cap 3 → F9 fires

**Coverage gap (documented, not resolved):** tool-list poisoning and malicious tool
descriptions remain out of scope (Option 1 blocked by missing credentials; Option 3 is
a stop condition). This is now the known-and-accepted surface boundary for C5 in the
trust-boundary map.

---

## FP analysis

Any inbound inspection would operate on MCP data that the agent's own MCP client already fetched and trusts. False-positive risk for F25-style scanning of tool descriptions is similar to F25's existing FP rate (low for genuine dangerous-command shapes in tool descriptions; tool names are typically benign identifiers).

---

## Cross-references

- `references/trust-boundary-map-2026-06-02.md` — Cluster C, C5 (known-and-accepted).
- ADR-020: F25/F26 MCP arg danger floors (outbound inspection — currently covers the call side, not the response side).
- `runtime/post-adapter-factory.js` — existing PostToolUse advisory scans (F23, output-sanitizer).
- `runtime/mcp-pin.js` — arg-shape drift detection (outbound, ADR-018/ADR-033).
