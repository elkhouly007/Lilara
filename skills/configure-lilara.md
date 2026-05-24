# Skill: Configure Lilara

## Trigger

Use when setting up Lilara in a new environment, installing components selectively, or reconfiguring what is active for a specific tool (Claude Code, OpenCode, OpenClaw).

## Overview

Lilara has three layers:
1. **Agents** — specialist sub-agents invoked by orchestrators or directly
2. **Rules** — applied automatically to relevant file types during code operations
3. **Skills** — slash commands invoked explicitly by the user

Components live in the project root and are wired to tools via config files in `claude/`, `opencode/`, and `openclaw/`.

## Setup Process

### Step 1 — Verify the repo is present

```bash
ls agents/ rules/ skills/ scripts/ references/
```

If not present, clone from `github.com/elkhouly007/lilara` or copy from the source.

### Step 2 — Choose target tool

| Tool | Config location | What gets wired |
|---|---|---|
| Claude Code | `claude/settings.json` | Agents (as subagents), skills (as slash commands), rules (via CLAUDE.md imports) |
| OpenCode | `opencode/opencode.json` | Agents, rules, skills |
| OpenClaw | `openclaw/config.json` | All of the above + capability packs |

### Step 3 — Select capability packs (OpenClaw only)

Available packs under `modules/`:

| Pack | What it adds |
|---|---|
| `mcp-pack` | MCP server tool definitions |
| `wrapper-pack` | Thin CLI wrappers for common operations |
| `plugin-pack` | Extension hooks |
| `browser-pack` | Browser automation tools |
| `notification-pack` | Desktop/push notification integrations |
| `daemon-pack` | Background process management |

Enable a pack by listing it in the tool's config. Disable by removing it — no destructive action needed.

### Step 4 — Verify installation

```bash
# Run the status check
bash scripts/status-summary.sh

# Run the smoke test
bash scripts/smoke-test.sh

# Run the audit
bash scripts/audit-local.sh
```

All checks must report `ok`. If any report `missing` or `fail`, read the error and install the missing component.

### Step 5 — Apply payload protection (if using external agents)

Enable classify/redact/review pipeline under `modules/payload-protection/` if the setup sends prompts to external agents. This ensures no personal or confidential data leaves without review.

## Selective Installation

To install only specific agents or skills (minimal footprint):

1. Copy only the desired files from `agents/` and `skills/`.
2. Update the tool's config to reference only those files.
3. Run `status-summary.sh` — missing entries for uninstalled components are expected and can be filtered.

## Output

- Confirmation that all selected components are wired and verified.
- List of any components that could not be installed and why.
- Next step: run `status-summary.sh` to confirm state.

## Constraints

- Do not modify source files in `agents/`, `rules/`, or `skills/` during setup — configure via the tool's wiring layer only.
- Do not auto-install external dependencies without asking — some capability packs require npm/pip packages.
