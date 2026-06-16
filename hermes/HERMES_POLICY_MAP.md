# Hermes → Lilara Policy Map

> **How Hermes events map to Lilara decision sources and floor sources.** This file is the
> cross-reference for the Hermes adapter (Phase 2 of `references/PLAN.md`). It is the analog
> of `claude/CLAUDE_POLICY_MAP.md`, `opencode/OPENCODE_POLICY_MAP.md`, `openclaw/OPENCLAW_POLICY_MAP.md` —
> every Lilara adapter carries one.

## Integration model recap

Hermes tools are self-registering functions with a handler (per
`https://hermes-agent.nousresearch.com/docs/developer-guide/tools-runtime`). The Lilara wrapper
sits in front of the handler — it is the **handler-wrap** integration model (not a PreToolUse hook).

The wrapper does the following on every tool invocation:

1. **Normalize the Hermes tool-call payload** into the canonical Adapter IR (per `runtime/action-ir.js`, ADR-007).
   Field mapping:
   - Hermes `tool` → `input.tool`
   - Hermes `cmd` (terminal tool) → `input.command` (with `commandFrom` extraction as a fallback)
   - Hermes `cwd` → `input.cwd`
   - Hermes `args` → `input.args`
   - Hermes `mcp_server` → `input.mcpServer`
   - Hermes `skill_name` → `input.skillName`
   - Hermes `session_id` → `input.sessionId`
   - Hermes `tool_call_id` → `input.toolCallId` (added to the provenance window for taint tracking)

2. **Call `runtime.decide(input)`** to get the decision (`allow` / `require-review` / `block` / `modify` /
   `escalate`).

3. **Apply the decision:**
   - `allow` → invoke the wrapped handler; return its result.
   - `require-review` → in block mode, return a refusal to Hermes; in warn mode, run the handler and add a
     `require-review` annotation.
   - `block` → return a refusal to Hermes; never invoke the handler.
   - `modify` / `escalate` → in block mode, apply the modify/escalate action; in warn mode, run the handler.

## Hermes event surface → Lilara decision-source / floor-source map

Hermes does not emit "PreToolUse" or "PostToolUse" events; it invokes a handler. The Lilara wrapper
synthesizes the equivalent IR shape so the rest of Lilara (which is event-shape-agnostic) works identically.

| Hermes surface | Lilara decision source | Notes |
|---|---|---|
| `terminal` tool (shell exec) | `pretool-shell` | Same as Claude / OpenCode / OpenClaw shell path. |
| `web_search` tool | `pretool-web-search` | External-source output is recorded in the provenance window (F10). |
| `browser_screenshot` tool | `pretool-browser` | Output recorded; the assistant's final message goes through F19. |
| `mcp__<server>__<tool>` | `pretool-mcp` | F12 (mcp-deny) fires when the MCP server is blocked per `lilara.contract.json` v3 `scopes.mcp`. |
| `skill` tool (custom) | `pretool-skill` | F13 (skill-deny) fires when the skill is blocked per `scopes.skills`. |
| `honcho_*` tools (memory) | `pretool-honcho` | Memory writes are journaled; provenance window is updated. |
| `cron` delivery | `pretool-cron` | Cron-scheduled tool calls are wrapped identically; provenance window carries the cron schedule context. |
| Hermes return value | `posttool-output` | `runtime/post-adapter-factory.js` scans for secrets (F4 → payloadClass C on next turn) and records external-source reads for F10. |
| `gateway_inbound_message` (Telegram/Discord/etc.) | (not gated) | Inbound user messages are not gated by Lilara — the user is sovereign. Outbound assistant messages are observed via F19 (post-hoc). |

## Negative capabilities (honest-scoped per SCOPE §18 spirit)

These are the gaps the wrapper explicitly does **not** cover today. Each is a `[LOCKED]`-style honest statement of
what is NOT yet wired; lifting any of these is a separate PR.

| Capability | Status | Reason |
|---|---|---|
| `envelopeReporting` (F15) | **false** | The handler-wrap integration does not yet carry the F15 envelope fields (cwd inode, git HEAD, normalized command AST, env diff, resolved executable path, tracked target metadata). F15 wiring for Hermes requires a Hermes-side build/verify integration. |
| `exactEnv` | **false** | Without envelope reporting, env diff is not collected at hook time. |
| `finalMessageInterception` | **observe** | Hermes (like the other harnesses) does not expose a pre-emit hook for the assistant's final message. Post-hoc observation only. |
| `terminalInterception` | **observe** | Terminal output is observed post-hoc via the F19 output-exfil floor. |
| `screenshotInterception` | **none** | Hermes's browser supervisor owns screenshot capture separately; not exposed to plugin hooks. |

## Engineering invariants — held by this adapter

- `decide()` stays pure — the wrapper injects the taint window via `input.provenanceWindow` (ADR-046 pattern); never
  reads from disk inside `decide()`.
- Byte-identical replay — the wrapper emits no decision that differs from what the existing six harnesses emit for
  the same logical input (the same `runtime.decide()` is called).
- Inviolable tier never weakened — the wrapper cannot demote an inviolable floor's `block` to `allow` regardless of
  user input.
- Neutral universal-harm language — no religious/ideological labels in any wrapper output.
- Zero external dependencies — the wrapper uses Node built-ins only (`fs`, `path`, `crypto`, no third-party
  require).
- Hooks/adapters never auto-applied — the Hermes plugin path is opt-in (the user copies the plugin directory into
  `~/.hermes/plugins/lilara/`); there is no auto-install path.
