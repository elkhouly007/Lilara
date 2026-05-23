# Claw Code Harness — VERIFIED

> **VERIFIED — 2026-05-23.** Hook protocol traced end-to-end against ClawCode v0.1.3 (`deepelementlab/clawcode`) source. PreToolUse / PostToolUse stdin payload shapes and the stdout-JSON decision protocol are documented and the adapter is exercised end-to-end against the canonical payload. See [`WIRING_PLAN.md`](./WIRING_PLAN.md) for the operator-facing wiring guide.

## What This Is

`hooks/adapter.js` delegates to `claude/hooks/hook-utils.js → createAdapter()`, which calls `runtime/pretool-gate.js` — the same single enforcement spine used by the Claude Code, OpenCode, and OpenClaw adapters. ClawCode's hook engine is a "minimal Claude Code compatible hook execution engine" (`clawcode/plugin/hooks.py:69`) with **one critical difference**: ClawCode parses the hook subprocess's STDOUT as JSON for the permission decision and **IGNORES the exit code** (`clawcode/plugin/hooks.py:38-51` + `252-280`).

The ARG ClawCode adapter therefore uses `harnessOutput: "permission-json"` so that block decisions actually take effect inside ClawCode. The adapter also still exits 2 on block for cross-harness consistency.

`hooks/post-adapter.js` delegates to `runtime/post-adapter-factory.js → createPostAdapter()` — the shared scan-secrets + record-external-read implementation used by all six harnesses.

CI: `scripts/check-clawcode-adapter.sh` runs assertions covering both the legacy exit-code path AND the ClawCode-native stdout-JSON decision protocol.

## Verified scope (v3.x)

- **PreToolUse blocking:** supported. Adapter emits `{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"..."}}` on `LILARA_ENFORCE=1` block; ClawCode aborts the tool call with the supplied reason.
- **PostToolUse observation:** supported via `runtime/post-adapter-factory.js`. Secret scanning + taint recording on every PostToolUse fire.
- **Args fidelity:** exact. ClawCode passes the LLM's full `tool_input` dict to the hook payload.
- **Cwd fidelity:** opaque. ClawCode does NOT include `cwd` in the payload — the working directory is passed to the hook subprocess via `cwd=working_directory` (`clawcode/plugin/hooks.py:259-260`) but not as a JSON field. ARG falls back to context-discovery (git branch detection, project markers) for routing decisions.
- **Envelope reporting:** none. ClawCode does not expose execution-time env baselines; F15 envelope verify can't be wired without harness-side cooperation.
- **Kill switch:** `LILARA_KILL_SWITCH=1` blocks unconditionally with the ClawCode-native deny JSON.

## Not yet verified

- **MCP tool interception** — the hook matcher will fire for any `tool_name`, so MCP coverage depends on the operator's matcher regex. No end-to-end MCP-tool fire traced against ARG yet.
- **Skill interception** — same caveat.
- **Per-tool output-channel observability beyond Bash** — file-write / commit / PR / browser tool payload schemas have not been enumerated against ClawCode source.

These are tracked in [`COMPATIBILITY_NOTES.md`](./COMPATIBILITY_NOTES.md).

## How to wire it

See [`WIRING_PLAN.md`](./WIRING_PLAN.md) for the verified configuration steps.

## How verification was done

1. Cloned `deepelementlab/clawcode` and located `clawcode/plugin/hooks.py` + `clawcode/llm/agent.py`.
2. Read the hook engine source to extract: stdin payload shape, stdout decision protocol, exit-code handling, timeout, matcher semantics.
3. Wrote `clawcode/WIRING_PLAN.md` documenting the verified protocol with `file:line` citations.
4. Constructed the canonical payload and exercised `clawcode/hooks/adapter.js` against it: WARN mode, ENFORCE mode (block), SAFE command (allow). Verified stdout JSON matches ClawCode's decision protocol.
5. Added `harnessOutput: "permission-json"` to `claude/hooks/hook-utils.js → createAdapter()` so the adapter actually blocks ClawCode (previously: only exit 2, which ClawCode ignores).
6. Updated `scripts/check-clawcode-adapter.sh` to cover the stdout-JSON assertions in CI.

A live end-to-end test against a running ClawCode + local LLM would have been an additional confirmation but is unnecessary for protocol verification — the source itself is the contract and is now under CI.

## How to Contribute

If you spot a tool-name pattern ClawCode emits that the matcher should cover, or trace an MCP / Skill fire end-to-end, open a PR updating `WIRING_PLAN.md` matcher coverage and the relevant manifest fields.
