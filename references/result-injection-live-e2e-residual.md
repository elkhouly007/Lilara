# Result-injection coverage — static vs live-E2E residual

**Scope:** MCP result-injection (block 2d, `runtime/post-adapter-factory.js:181–246`) for the
three harnesses whose `mcpInterception` is not `verified`: **Codex** (`partial`), **ClawCode**
(`unverified`), **Antegravity** (`unverified`).

**Status:** static coverage extended (see below). Live E2E remains open — this document records
exactly what is needed to close it. Per-harness `mcpInterception` manifest values are **unchanged**
by the static work; static coverage proves our adapter handles the documented payload shape, **not**
that the harness emits it.

---

## Background

Block 2d is harness-agnostic — it has no per-harness branching and runs for every adapter that
delegates to `createPostAdapter()` (all 6, enforced by `check-post-adapter-parity.sh`). It fires
when `sourceLabel(toolName) === "mcp"` and the extracted output text matches an injection pattern,
journaling `mcp-result-injection`. Output text is extracted at `post-adapter-factory.js:89`:

```js
const outputText = String(input.tool_response || input.output || input.tool_output || input.content || "");
```

Effective coverage therefore depends on two things the factory cannot self-verify:
1. the harness **emits** a PostToolUse/AfterTool event for MCP tool calls, and
2. it carries the output in a field this extractor reads.

---

## (1) Now covered statically

`tests/runtime/post-adapter-harness-payloads.test.js` drives each shipped adapter **entry point**
end-to-end with a synthetic payload built from the harness's *documented* output field (an MCP
`tool_name` of shape `mcp__<server>__<op>`, which keeps blocks 2b/2c silent so only block 2d fires):

| Harness | Event (documented) | Field tested | Asserted |
|---------|--------------------|--------------|----------|
| Codex | `PostToolUse` | `tool_response` | injection → `mcp-result-injection`; benign → none; stdin passthrough intact |
| ClawCode | `PostToolUse` | `tool_output` (with `tool_response` absent — proves the fallback) | same |
| Antegravity | `AfterTool` | `tool_response` (+ `hook_event_name:"AfterTool"`) | same |
| Claude (control) | `PostToolUse` | `tool_response` | same |

This closes the gap the PR #71 test (`post-adapter-mcp-injection.test.js`) left open: PR #71 tests
the scanner + gate in isolation; it never exercises the `:89` field-extraction chain through a real
adapter. A regression that broke, say, the `tool_output` fallback would now be caught for ClawCode.

OpenCode/OpenClaw use the same factory and are covered by the same `:89` extractor + parity check;
they are out of this track's scope (`mcpInterception: partial`, same shared path).

---

## (2) Still requires a live harness run (cannot be faked)

For each harness, closing the residual means capturing a **real** MCP-tool payload from the installed
binary and asserting block 2d fires on it. Capture recipes already live in each `*/WIRING_PLAN.md`.

### Codex — `mcpInterception: partial`
- **Why partial, not just unverified:** upstream codex-rs has inconsistent hook dispatch across tool
  handlers (openai/codex#20204; ApplyPatch lacked dispatch entirely until #18391). So even a perfect
  adapter cannot guarantee *every* MCP tool fires PostToolUse.
- **Needed:** installed `codex` version; a real MCP tool invocation (e.g. a connector call); capture
  the PostToolUse stdin payload; confirm (a) the event fires for that MCP tool and (b) the output is
  in `tool_response`. Assertion: the captured payload, piped to `codex/hooks/post-adapter.js`, yields
  an `mcp-result-injection` journal entry when the output contains an injection marker.
- **Closes to:** `partial` → `verified` only after enumerating which MCP tool handlers dispatch.

### ClawCode — `mcpInterception: unverified`
- **Open question:** ClawCode's hook matcher is an operator-configured regex over `tool_name`; MCP
  tools route through PostToolUse **iff** the operator's matcher covers them. No live MCP-tool fire
  has been traced against the adapter.
- **Needed:** installed ClawCode version; `.claude`/settings matcher that covers `mcp__*`; a real MCP
  tool call; capture the PostToolUse payload; confirm the output field is `tool_output`. Assertion as
  above against `clawcode/hooks/post-adapter.js`.

### Antegravity — `mcpInterception: unverified`
- **Open question (event):** Antegravity uses `AfterTool` (not `PostToolUse`); a live `agy` fire with
  the corrected event names + `run_shell_command` matcher has not been confirmed end-to-end.
- **Open question (field shape) — discovered during this work:** the adapter's own source cites the
  upstream type as `AfterToolInput.tool_response: Record<string, unknown>` (an **object**), whereas
  the WIRING_PLAN example shows `tool_response` as a **string**. The `:89` extractor does
  `String(input.tool_response)`, which yields `"[object Object]"` for an object → block 2d would
  **miss** the injection. The static test covers the documented *string* shape; **if** live capture
  shows an object, the extractor needs a flatten step (and a follow-up hardening PR). This must be
  resolved by a real capture, not assumed.
- **Needed:** installed `agy` v1.0.1; `.gemini/settings.json` with `AfterTool` + `run_shell_command`;
  a real MCP tool call; capture the AfterTool payload; record whether `tool_response` is a string or
  an object. Assertion as above against `antegravity/hooks/post-adapter.js`.

---

## Definition of done (per harness)

Live residual is closed for a harness when a **captured real payload** from the installed binary,
fed to that harness's adapter, produces an `mcp-result-injection` journal entry — at which point its
manifest `mcpInterception` may move toward `verified`. Until then it stays `partial`/`unverified`.
Static coverage (section 1) is necessary but **not** sufficient for that promotion.
