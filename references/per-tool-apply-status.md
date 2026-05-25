# Per-Tool Apply Status

Tracks which Agent Runtime Guard components are applied (wired and active) vs. template-only (file exists but not yet configured) for each supported tool.

Last updated: 2026-05-25

---

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | Applied — wired in tool config and verified |
| 🔧 | Template only — file exists but not wired to this tool |
| ❌ | Not applicable — component not relevant for this tool |
| — | Not started |

---

## Claude Code (`claude/`)

| Component | Status | Notes |
|---|---|---|
| Agents (54) | ✅ | Registry present in-tree; project-local Claude wiring docs and hook assets verified |
| Rules (98) | ✅ | Full rules tree present; project-local apply path documented |
| Skills (30) | ✅ | Full skills tree present; structure verification passing |
| MCP pack | ✅ | Configured in mcp.json |
| Wrapper pack | ✅ | |
| Plugin pack | ✅ | |
| Browser pack | 🔧 | Template present; enable manually if browser tools needed |
| Notification pack | 🔧 | Desktop notifications — enable if desired |
| Daemon pack | 🔧 | Background daemons — enable if needed |
| Payload protection | ✅ | classify/redact/review pipeline active |
| Policy layers (1–3) | ✅ | Enforced via guardrail-enforcement.md |

## OpenCode (`opencode/`)

| Component | Status | Notes |
|---|---|---|
| Agents (54) | ✅ | Registry present in-tree; OpenCode wiring plan and config template present |
| Rules (98) | ✅ | Full rules tree present; project-local apply path documented |
| Skills (30) | ✅ | Full skills tree present; structure verification passing |
| MCP pack | ✅ | Configured in opencode.json |
| Wrapper pack | ✅ | |
| Plugin pack | ✅ | |
| Browser pack | 🔧 | Enable if Playwright/browser tools needed |
| Notification pack | 🔧 | |
| Daemon pack | 🔧 | |
| Payload protection | ✅ | |
| Policy layers (1–3) | ✅ | |

## OpenClaw (`openclaw/`)

| Component | Status | Notes |
|---|---|---|
| Agents (54) | ✅ | Full agent registry present in-tree with OpenClaw wiring plan |
| Rules (98) | ✅ | Full rules set present in-tree |
| Skills (30) | ✅ | Full skill set present in-tree |
| MCP pack | ✅ | Active |
| Wrapper pack | ✅ | Active |
| Plugin pack | ✅ | Active |
| Browser pack | ✅ | Active (OpenClaw has native browser support) |
| Notification pack | ✅ | Active |
| Daemon pack | ✅ | Active |
| Payload protection | ✅ | Full pipeline — classify → redact → review |
| Policy layers (1–3) | ✅ | Guardrails enforced at session level |

---

## Planned Harnesses

The following harnesses are planned but not yet supported. Stub directories document the planned integration contract. Support status is tracked in the Harness Support Matrix in README.md.

| Harness | Status | Directory | Notes |
|---|---|---|---|
| Codex | verified 2026-05-24 | codex/ | Source-traced against openai/codex (codex-rs); adapter exercised end-to-end; see codex/WIRING_PLAN.md |
| Claw Code | verified 2026-05-23 | clawcode/ | Source-traced against deepelementlab/clawcode v0.1.3; adapter exercised end-to-end; see clawcode/WIRING_PLAN.md |
| antegravity | verified 2026-05-24 | antegravity/ | Source-traced against google-gemini/gemini-cli (Apache-2.0); BeforeTool/AfterTool protocol verified; see antegravity/WIRING_PLAN.md |

---

## How to Update This File

This file is semi-generated.

Preferred workflow:
1. Regenerate or review `references/parity-matrix.json`.
2. Run `bash scripts/generate-apply-status.sh > references/per-tool-apply-status.md`.
3. Run `bash scripts/check-apply-status.sh`.
4. Run `bash scripts/status-summary.sh` to confirm the summary reflects the same state.
