# Codex Compatibility Notes

**Status: VERIFIED — 2026-05-24.** Hook protocol source-traced against openai/codex (codex-rs). All claims below carry file:line evidence from the upstream Rust source.

## What Is Now Known

| Claim | Evidence | Adapter implication |
|---|---|---|
| Stdin is JSON with snake_case field names | `codex-rs/hooks/src/types.rs:38` — `#[serde(rename_all = "snake_case")]` on HookPayload | Adapter's snake_case key reads are correct |
| PreToolUse payload carries `tool_input.command` for Bash | `codex-rs/hooks/src/events/pre_tool_use.rs` — PreToolUseRequest struct; Codex docs confirm `tool_input.command` for Bash/apply_patch | `extractCommand` leads with `i.tool_input?.command` |
| `cwd` is an absolute path typed as AbsolutePathBuf | `codex-rs/hooks/src/types.rs:41` — `cwd: AbsolutePathBuf` on HookPayload | `extractCwd` leads with `i.cwd`; `cwdFidelity: "exact"` |
| Exit code 2 = block (stderr shown to model) | `developers.openai.com/codex/hooks` — "Exit Code Protocol" | Adapter exits 2 on block; no stdout JSON needed |
| PostToolUse output field is `tool_response` | `codex-rs/hooks/src/events/post_tool_use.rs` — PostToolUseRequest struct | `runtime/post-adapter-factory.js` leads with `tool_response` |
| Hook config locations | `developers.openai.com/codex/hooks` — "Hook Configuration" | Wiring example uses `<repo>/.codex/hooks.json` |
| Default hook timeout is 600s | `developers.openai.com/codex/hooks` — "Subprocess Timeout" | Adapter completes <20ms; well under limit |

## Decisions Taken

- `harnessOutput` stays at the default `"echo"` — Codex honours exit code 2, so no stdout JSON is needed. This is explicitly different from ClawCode, which uses `"permission-json"` because ClawCode ignores exit codes.
- `cwdFidelity: "exact"` — `cwd` is a typed AbsolutePathBuf field, not a best-effort string.
- `argsFidelity: "exact"` — `tool_input` is a Rust Value field containing `command` for shell tools; the field name and nesting are enforced by the upstream struct.
- `mcpInterception: "partial"` and `skillInterception: "partial"` — not `"supported"` — because upstream tool-handler coverage is demonstrably incomplete (openai/codex#20204, #16732).
- `envelopeReporting: false` stays — Codex does not expose execution-time env baselines.

## What Is Still Unverified

- **MCP tool-handler coverage** — openai/codex#20204 documents inconsistent PreToolUse hook coverage across handlers. openai/codex#16732 (ApplyPatch missing hook dispatch, fixed in PR #18391) shows the pattern recurs. MCP-delegated tool calls may silently bypass the hook surface.
- **Skill interception** — same handler-coverage gap; no end-to-end trace against a Skill invocation.
- **Per-tool PostToolUse schema** beyond Bash — the `tool_response` field name for file-write, commit, PR, and browser tools has not been enumerated against codex-rs source.

## Source-Trace Appendix

Files consulted in openai/codex (codex-rs) for this verification:

| File | Purpose |
|---|---|
| `codex-rs/hooks/src/types.rs` | HookPayload base struct; snake_case attribute; AbsolutePathBuf typing |
| `codex-rs/hooks/src/events/pre_tool_use.rs` | PreToolUseRequest struct with all PreToolUse fields |
| `codex-rs/hooks/src/events/post_tool_use.rs` | PostToolUseRequest struct; `tool_response` output field |
| `developers.openai.com/codex/hooks` | Authoritative external docs: exit codes, config locations, timeout |

GitHub issues consulted:

| Issue | Content |
|---|---|
| openai/codex#20204 | Inconsistent PreToolUse hook coverage across tool handlers |
| openai/codex#16732 | ApplyPatchHandler missing PreToolUse/PostToolUse dispatch (fixed in PR #18391) |
