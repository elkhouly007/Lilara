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
journaling `mcp-result-injection`. Output text is extracted at `post-adapter-factory.js:94-95` (updated — see object-vs-string
hardening below):

```js
const rawOutput  = input.tool_response || input.output || input.tool_output || input.content || "";
const outputText = (rawOutput && typeof rawOutput === "object") ? collectText(rawOutput) : String(rawOutput);
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
| Codex | `PostToolUse` | `tool_response` (string) | injection → `mcp-result-injection`; benign → none; stdin passthrough intact |
| ClawCode | `PostToolUse` | `tool_output` (with `tool_response` absent — proves the fallback) | same |
| Antegravity | `AfterTool` | `tool_response` (+ `hook_event_name:"AfterTool"`) | same |
| Claude (control) | `PostToolUse` | `tool_response` (string) | same |
| Codex | `PostToolUse` | `tool_response` **object** `{stdout, stderr, exitCode}` | injection inside object → `mcp-result-injection`; benign object → none |
| Antegravity | `AfterTool` | `tool_response` **object** (primary risk — `AfterToolInput.tool_response: Record<string,unknown>`) | same |
| ClawCode | `PostToolUse` | `tool_output` **object** | same (parity) |
| Claude (control) | `PostToolUse` | `tool_response` **object** | same (parity) |

This closes two gaps: (1) the PR #71 isolation gap (PR #71 tests the scanner alone; string-field
extraction now covered per-harness); (2) the object-vs-string ambiguity — `collectText` flatten
at `:94-95` is exercised end-to-end through each adapter for both injection (must fire) and benign
(must not fire). A regression that broke the `tool_output` fallback or the object-flatten path
would now be caught.

OpenCode/OpenClaw use the same factory and are covered by the same `:94-95` extractor + parity check;
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
- **Field-shape ambiguity — DEFENDED in factory (live-emit residual still open):** the adapter's
  own source cites the upstream type as `AfterToolInput.tool_response: Record<string, unknown>` (an
  **object**), whereas the WIRING_PLAN example shows `tool_response` as a **string**. The prior
  `String(input.tool_response)` yielded `"[object Object]"` for an object → block 2d would miss
  the injection. Fixed in `post-adapter-factory.js:94-95`: non-string payloads are now routed
  through `collectText` (recursive flatten, `claude/hooks/hook-utils.js:62-70`) so injection text
  inside an object is extracted and scanned. Covered by `post-adapter-harness-payloads.test.js`
  (object-payload section — both string and object `tool_response` for antegravity, plus anti-FP).
  **Known bound:** `collectText` flattens to depth 4 (`claude/hooks/hook-utils.js:63`). Injection
  text nested deeper than 4 levels inside an object payload remains a theoretical residual — not
  observed in any documented harness shape, but worth recording.
  **Live residual remains open:** whether `agy` actually *emits* an object for MCP tool calls
  (rather than a string, null, or absent field) is still unverified — that requires a real capture.
- **Needed:** installed `agy` v1.0.1; `.gemini/settings.json` with `AfterTool` + `run_shell_command`;
  a real MCP tool call; capture the AfterTool payload; confirm `tool_response` is present and
  record its actual shape (string or object). Assertion: the captured payload, piped to
  `antegravity/hooks/post-adapter.js`, yields an `mcp-result-injection` journal entry when the
  output contains an injection marker — regardless of whether the field is a string or an object.

---

## Definition of done (per harness)

Live residual is closed for a harness when a **captured real payload** from the installed binary,
fed to that harness's adapter, produces an `mcp-result-injection` journal entry — at which point its
manifest `mcpInterception` may move toward `verified`. Until then it stays `partial`/`unverified`.
Static coverage (section 1) is necessary but **not** sufficient for that promotion.
