# Hermes Adapter — License Check + Clean-Room Boundary

> **Phase 2 step 1 (per `references/PLAN.md` §"Phase 2"):** the dated license-check artifact must **predate** the first
> code commit for the Hermes adapter. This file is that artifact. **No `hermes/` adapter code has been written yet**;
> this document is the prerequisite.

---

## 1. Target identification

| Field | Value |
|---|---|
| Project name | Hermes Agent |
| Canonical repo | `https://github.com/NousResearch/hermes-agent` |
| Maintainer / org | Nous Research (`https://nousresearch.com`) |
| Homepage | `https://hermes-agent.nousresearch.com` |
| Public docs | `https://hermes-agent.nousresearch.com/docs/` |
| Default branch | `main` |
| First commit (repo) | 2025-07-22 |
| Last push (observed 2026-06-16) | 2026-06-16 |
| Topics | ai, ai-agent, ai-agents, anthropic, chatgpt, claude, claude-code, clawdbot, codex, hermes, hermes-agent, llm, moltbot, nous-research, openai, openclaw |
| Description | "The agent that grows with you" — built-in learning loop, creates skills from experience, improves them during use, persistent memory, cross-session recall, multi-platform (Telegram/Discord/Slack/WhatsApp/Signal/CLI). |

**Why this target.** The handover package's `HANDOVER-HERMES.md` (founder-text, Level 1) and `VISION.md` (point 6, "two
run modes — fast-reply AND long-running for hours/days, like Hermes / Claude Code") and `VISION.md` point 7 ("Lilara as a
control plane — the user registers his other tools ... Claude Code, Codex, Antigravity, ... Hermes, OpenClaw, etc.")
name Hermes as a target integration. `references/SCOPE.md` §17 (Reference integrations) lists it as the **second
reference integration** (Phase 2 deliverable, target version 0.2.3, closing 0.2.0 DoD #5). `NousResearch/hermes-agent`
matches the founder's intent ("self-improving AI agent", "grows with you") and is the dominant open-source project by
that name (195k+ stars, MIT, actively maintained).

---

## 2. License

| Field | Value |
|---|---|
| License file (canonical) | `https://raw.githubusercontent.com/NousResearch/hermes-agent/main/LICENSE` |
| SPDX identifier | **MIT** |
| License name | "MIT License" |
| Copyright | (c) 2025 Nous Research |
| License type | **Permissive** (no copyleft, no SSPL, no BSL, no source-available) |
| Compatible with Lilara's clean-room rule | **YES** |

**Verdict:** The license is **permissive and acceptable for clean-room study** (read interface/docs surface, never read
implementation). MIT permits use, modification, and redistribution with attribution. Per the Lilara license red line
(`RED-LINES.md` §3, `HANDOVER-HERMES.md` §4): clean-room rewrite always; **NEVER copy AGPL/GPL/SSPL/BSL or
source-available code**. MIT is in the green zone.

### Attribution requirement

The Lilara repo will carry an MIT attribution notice in the adapter's `LICENSE-3rdparty/hermes.md` once code lands. No
copyleft attribution is required.

---

## 3. Observed public protocol surface (read from docs only — no source code)

Per the Lilara license red line ("reading interface/docs surface to integrate against is permitted, reading
implementation is not"), the following is what the public docs at `https://hermes-agent.nousresearch.com/docs/` expose
about how to integrate a **platform adapter** (the natural surface for a Lilara adapter that runs behind Hermes's
messaging gateway). All content below is paraphrased from public docs — **not from source code**.

### 3.1 Adapter lifecycle (per `/docs/developer-guide/adding-platform-adapters/`)

A platform adapter connects Hermes to an external messaging service. Two integration paths exist:

- **Plugin path (recommended).** Drop a plugin directory into `~/.hermes/plugins/` with two files:
  `plugin.yaml` (metadata, env-var declarations) and `adapter.py` (the adapter class + a `register()` entry point).
  No core Hermes code changes needed.
- **Built-in path.** Modify 20+ files across code, config, and docs. Not recommended for third-party work.

### 3.2 Required interface (per the public docs)

A Hermes platform adapter extends `BasePlatformAdapter` and implements:

- `connect()` — Establish connection (WebSocket, long-poll, HTTP server, etc.). Abstract.
- `disconnect()` — Clean shutdown. Abstract.
- `send()` — Send a text message to a chat. Abstract.
- `send_typing()` — Show typing indicator. Optional override.
- `get_chat_info()` — Return chat metadata. Optional override.

Inbound messages are received by the adapter and forwarded via `self.handle_message(event)`, which the base class
routes to the gateway runner.

### 3.3 Plugin registration (per the public docs)

A plugin entry point receives a `ctx` (registry context) and calls `ctx.register_platform(...)` with:

- `name` — platform identifier (e.g., `my_platform`)
- `label` — display label
- `adapter_factory` — `lambda cfg: MyPlatformAdapter(cfg)`
- `check_fn` — runtime requirement check (e.g., "is the API token set?")
- `validate_config` — config-shape validation
- `required_env` — list of env vars required for the platform to be active
- `install_hint` — text shown to the user when requirements aren't met
- `env_enablement_fn` — auto-seed `PlatformConfig.extra` from env vars
- `cron_deliver_env_var` — env var name for the cron delivery channel
- `allowed_users_env` / `allow_all_env` — per-platform user authorization
- `max_message_length` — chunking cap (0 = no limit)
- `platform_hint` — LLM guidance injected into the system prompt
- `emoji` — display emoji
- (Optional) `ctx.register_tool(...)` for platform-specific tools

### 3.4 Integration points the plugin system handles automatically (per the public docs)

`ctx.register_platform()` automatically wires the following integration points — no core code changes needed:
gateway adapter creation, config parsing (`Platform._missing_()` accepts any name), connected-platform validation,
user authorization, env-only auto-enable, YAML config bridge, cron delivery, `hermes config` UI entries, send_message
tool routing, webhook cross-platform delivery, `/update` command access, channel directory inclusion, system-prompt
hints, message chunking, PII redaction (`pii_safe` flag), `hermes status` display, `hermes gateway setup` inclusion,
`hermes tools`/`hermes skills` per-platform config, token lock (multi-profile, `acquire_scoped_lock()` in `connect()`),
orphaned-config warning.

### 3.5 Relevant adjacent surfaces (public docs, not source)

- **Agent loop internals:** `/docs/developer-guide/agent-loop` — describes how the Hermes runtime drives a single
  tool-call turn. Relevant if the Lilara adapter needs to invoke or gate individual turns.
- **Trajectory format:** `/docs/developer-guide/trajectory-format` — describes the canonical record of a turn
  (tool calls, results, model output). Relevant for taint-window integration.
- **Tools runtime:** `/docs/developer-guide/tools-runtime` — describes how tools are registered and dispatched.
  Relevant for the F15 execution-envelope reporting path (parity with Claude/OpenCode).
- **Context engine plugin:** `/docs/developer-guide/context-engine-plugin` — describes the context-assembly
  extension point. Relevant for Phase 4 (L2 Smart Memory) where Lilara memory would feed into Hermes's prompt
  assembly.
- **Memory provider plugin:** `/docs/developer-guide/memory-provider-plugin` — relevant for Phase 4.
- **Session storage:** `/docs/developer-guide/session-storage` — relevant for journal cross-link.
- **Programmatic integration:** `/docs/developer-guide/programmatic-integration` — describes how to embed Hermes
  as a library rather than via CLI. Relevant for guest→host inversion (Phase 6).
- **Gateway internals:** `/docs/developer-guide/gateway-internals` — relevant for inbound-channel Phase 6 work.

---

## 4. Clean-room boundary (the load-bearing statement)

Per `HANDOVER-HERMES.md` §4 and `RED-LINES.md` §3:

- **PERMITTED** for Phase 2: reading public docs (this file is the record of what was read), reading the public
  `LICENSE`, reading the public README, reading the docs site. Studying the **observed behavior** (event names,
  payload shapes, integration points) from the docs surface.
- **NOT PERMITTED** for Phase 2: cloning the repo, reading source code, copy-pasting, paraphrasing implementation
  details, lifting structural code patterns. The Lilara adapter will be written **from the public docs' interface
  description** plus the founder's vision, **never by reading Hermes source.**
- **NOT PERMITTED at any layer**: copying any Hermes source file, even with attribution, even with modification.

If a future routed task seems to require reading Hermes source, **STOP and escalate to the owner** — that is a license
red line crossing, not a routine decision. A dated follow-up amendment to this artifact (with a justification for
why public docs are insufficient) is required BEFORE any source contact.

---

## 5. Phase 2 deliverables gated on this artifact

Per `references/PLAN.md` §"Phase 2" and `HANDOVER-HERMES.md` §9:

1. **License-check artifact first** — THIS FILE. (done — committed before any `hermes/` code.)
2. `hermes/` adapter (hooks/adapter.js + hooks/post-adapter.js + manifest) — built clean-room from public docs.
3. Extend `scripts/check-post-adapter-parity.sh`, `scripts/install-local.sh`, `scripts/check-install-smoke.sh` to
   the 7th harness (otherwise 0.2.0 DoD #3 silently regresses).
4. Real-run measurement on both OpenClaw and Hermes under the declared posture; multi-day Hermes runs get
   lattice-hash bookend verification (`check-inviolable-tier.sh`'s hash comparison at session start and end).
5. Flip `references/SCOPE.md` §10 DoD #5 to BUILT with the measured numbers; release 0.2.3.

---

## 6. Cross-references

- `RED-LINES.md` §3 — license red line.
- `HANDOVER-HERMES.md` §4 — license-check artifact gate; §9 — Hermes operating instructions.
- `references/PLAN.md` §"Phase 2" — full work items.
- `references/SCOPE.md` §17 — reference integrations; §18 — engineering invariants; §10 #5 — DoD target.
- `HANDOVER-OPENCLAW.md` §9 — planner-side mirror of the same gate.
- `references/adr-035-consent-gate.md` — the four invariants the adapter must preserve.
- `references/adr-046-taint-window-injection.md` — `decide()` purity; the adapter must inject taint window, not
  read from disk.

---

## 7. Sign-off

| Field | Value |
|---|---|
| Date | 2026-06-16 |
| Author | Thoth (Lilara CPO + CTO, Hermes orchestrator) |
| License checked | **MIT** (NousResearch/hermes-agent) |
| Clean-room boundary | Public docs only; no source contact without owner escalation |
| Companion file | Will land as `hermes/LICENSE-3rdparty.md` in the adapter PR |
| Owner approval required for source contact | YES |
