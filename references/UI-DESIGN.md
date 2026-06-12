# Lilara Control Plane — UI Design (web + terminal)

> **Status: DESIGN ONLY — §23.A `[OPEN]` direction, sequenced LAST.** This document designs the §23.A control surface
> (register external tools, run/launch them, watch the live task/queue). Per SCOPE §23.A and the locked build order,
> the **real build is the final phase** (PLAN.md Phase 8) and **starts only on explicit owner go**. The only code that
> accompanies this document is a throwaway spike (`spikes/control-plane/`, static mocks, fake data) — clearly labeled,
> never wired, delete-anytime.
>
> **Prototype vs real-build marker (owner-required):**
> | Artifact | Class |
> |---|---|
> | This document | Design (reviewable now) |
> | `spikes/control-plane/web-mock.html`, `tui-mock.md` | **Throwaway spike** (visual review only) |
> | Web control plane, TUI, registry/launch backend | **Real build — Phase 8, owner-gated, not started** |

---

## 1. What already exists (the substrate — verified 2026-06-12)

The control plane does not start from zero. Shipped today:

- **Read-only dashboard** — `scripts/dashboard-server.js` (`lilara-cli.sh dashboard`): zero-dep Node http server,
  **binds 127.0.0.1 only**, default port 7917; routes `/`, `/healthz`, `/api/summary`, `/api/decisions`,
  `/api/coverage`, `/api/kill-chains`, `/api/sessions`; every journal-derived byte passes the `receipt-export.js`
  redaction layer and the server **fails closed** (refuses to serve journal data) if the redactor is unavailable.
  CI-gated by `scripts/check-dashboard.sh`.
- **Terminal tail** — `scripts/journal-tail.js`: the proto-TUI lineage (live decision feed in a terminal).
- **Unified CLI** — `scripts/lilara-cli.sh`, 35 subcommands (`status`, `journal`, `receipts`, `session`, `memory`,
  `snapshot`, `notify`, `operator-token`, `dashboard`, …) — the operator surface a TUI composes.
- **Consent transport** — `runtime/consent/transport.js`: `requestConsent()` on the **controlling TTY**
  (`/dev/tty` / `\\.\CONIN$`), never fd 0; deterministic prompt from real decision fields only.
- **Adapters** — six harness adapters (claude, codex, openclaw, opencode, clawcode, antegravity; Hermes planned,
  PLAN.md Phase 2) — the registration/launch substrate: "launch a tool" = spawn it wrapped by its adapter so the guard
  fronts every action.
- **On-disk state a UI can read** (all under `~/.lilara/`): `decision-journal.jsonl` (rotated), `session-context.json`,
  `consent-grants.jsonl`, `operator-tokens.jsonl`, `telemetry.jsonl`, `provenance-window.json`, `envelope.json`,
  `snapshots/`, `mcp-pins/`, `session-budget/`, `memory/`. *(Exact set re-verify at build time; the UI never reads
  these directly in the web case — only through the redaction layer.)*

## 2. Security model (the design's spine — derived from SCOPE, not invented here)

**Rule 1 — narrow-only web.** Until approver-authentication is designed (SCOPE §8/§14: channel-based approval
**deferred `[LOCKED]`**), the web surface may only **NARROW** authority:

| Action class | Web | Terminal (controlling TTY) |
|---|---|---|
| Observe (queue, decisions, receipts, posture) | ✅ read-only, redacted | ✅ |
| Narrow (revoke grant, stop task, kill switch) | ✅ allowed | ✅ |
| **Widen (approve consent, mint grant, demote floor)** | ❌ **never — rendered disabled with "requires approver-authentication — deferred"** | ✅ consent prompt only, via the existing TTY transport |
| Launch a registered tool | ✅ allowed (launch only *adds* a guarded process; every action still fronts the guard) | ✅ |

Rationale: revoke/stop/kill are fail-safe-direction actions (worst case: something stops). Approve/grant are exactly
the actions invariant 3 of §8 protects; a web click is not an authenticated approver until Phase 6's ADR says how.
*Edge case decided conservatively:* tool **registration** (writing the registry) is widening-adjacent — v1 web shows
the form but submission is disabled; registration happens via CLI/TUI on the host.

**Rule 2 — the TTY is the consent surface.** The TUI runs on the controlling terminal, so it may host the consent
stop-and-ask by construction — it inherits `openTTY()`'s invariant (reads the TTY, never the agent's stdin pipe).
The web UI *displays* a pending consent and points at the terminal.

**Rule 3 — localhost + redaction only.** Web binds 127.0.0.1; all data passes the allowlist redaction layer
(`receipt-export.js` lineage; the §19 #5 typed serializer once L2 lands); fail-closed when the redactor is missing.
No payloads, no secrets, no raw commands — redacted placeholders render as `‹redacted: …›`.

**Rule 4 — zero-dep.** Web UI = vanilla HTML/JS served by the Node http server (SSE for live tail); TUI = Node
readline + ANSI. No frameworks, no npm. Matches §18 and keeps the supply-chain surface at zero.

**Rule 5 — the guard fronts everything launched.** "Run tool from Lilara" = adapter-wrapped spawn. There is no launch
path that bypasses an adapter. (Guest→host inversion prerequisite: PLAN.md Phase 6, per §23.A's host-trust design
flag.)

**Rule 6 — standing constraint until Phase 8 (owner-decided Q6, 2026-06-12):** the existing dashboard **is the seed of
§23.A** — the control plane builds on `dashboard-server.js`'s audited zero-dep, redaction-fail-closed substrate — and
it stays read-only until the Phase-8 real build; mutating endpoints (launch/approve) are added only then, behind
Phase-6 approver-auth (SCOPE §14 `[LOCKED]` standing constraint).

## 3. Users and jobs

One persona today (the owner is customer #1; SCOPE §0): an engineer running several coding agents, some unattended for
hours/days. Jobs, in priority order:

1. *"What are my agents doing right now?"* — live queue across tools, current decision states.
2. *"Something needs me"* — a consent-required task is parked; see it instantly, answer **at the terminal**.
3. *"Stop that"* — stop a task / revoke a grant / global kill switch, from anywhere on the machine.
4. *"What happened while I was away?"* — receipts/journal browser with floor-fire history.
5. *"Start work"* — register a tool once; launch it guarded; watch it join the queue.
6. *"What protects me right now?"* — live posture view (the SCOPE §18 default-posture table, live values).

## 4. Web UI — information architecture

Five views (tabs), one persistent header.

**Header (always visible):** posture strip (ENFORCE on/off · consent mode · F28/F29/F23 state — green/amber per
actual env), global **KILL SWITCH** (double-confirm; narrowing, so allowed), live SSE connection dot.

1. **Fleet / Registry** — registered tools as cards: adapter, state (running / unattended / stopped), uptime, last
   decision, posture chips. Actions: **Launch** (adapter-wrapped), **Stop**. "Register tool…" opens the form
   (name, adapter, working dir) — **submit disabled in v1 web** (Rule 1 edge case), caption points at
   `lilara-cli.sh`/TUI.
2. **Live Queue** — one table across all tools: task, tool, state (`running` / `waiting-on-consent` / `queued` /
   `done`), elapsed, last decision. `waiting-on-consent` rows pulse and show: *"answer on the controlling terminal —
   the web cannot approve"* + disabled Approve + enabled **Deny/stop** (narrowing).
3. **Decisions & Floors** — live decision feed (timestamp, tool, action class, floor chip, decision) + 24h floor-fire
   counts sidebar. Backed by `/api/decisions` + SSE tail; all fields post-redaction.
4. **Receipts / Audit** — filterable receipts browser (session, floor, decision, `irHash` prefix), detail pane with
   the structured receipt; banner: *"served read-only via the redaction layer; fail-closed if redactor unavailable."*
5. **Grants & Posture** — active consent grants (scope, age, session) with **Revoke** (narrowing, allowed); the
   default-posture table with **live** values; operator-token list (count + ages only, never values).

**Live updates:** one SSE channel (`/api/events`) multiplexing journal appends + session-state changes; views render
from a single client-side store. Polling fallback every 5s.

**Failure modes:** redactor missing → server refuses journal data (existing behavior) → UI shows fail-closed banner,
not empty tables. SSE drop → stale-data watermark with last-update time, no silent staleness.

## 5. Terminal UI

**Layout (single screen, three panes + status bar):**

```
┌─ FLEET ──────────────┬─ LIVE QUEUE ────────────────────────────┐
│ ● claude-code  run   │ task            tool     state   last   │
│ ● openclaw     14h   │ refactor api    claude   run     allow  │
│ ○ hermes       reg   │ nightly sweep   openclaw CONSENT F18    │
│ ○ antigravity  stop  │ docs pass       claude   queued  —      │
├──────────────────────┴─ DECISIONS ─────────────────────────────┤
│ 03:12:09 openclaw network-egress F18 consent-required          │
│ 03:11:58 claude   file-write     —   allow                     │
└────────────────────────────────────────────────────────────────┘
 ENFORCE:off CONSENT:off F28:off F29:off │ q quit k kill / filter
```

- **Consent integration:** when a consent-required decision parks a task, the TUI (running on the controlling TTY)
  surfaces the deterministic prompt — same fields as `buildConsentPrompt()` (hostname, command class, floor, file
  targets), `[y/N]`, default deny. This is the *legitimate* consent surface (Rule 2).
- **Keybindings:** `tab` cycle panes · `enter` detail · `/` filter · `r` revoke grant (confirm) · `s` stop task ·
  `k` kill switch (double-confirm) · `q` quit.
- **Implementation lineage (Phase 8):** `journal-tail.js` (feed) + `lilara-cli.sh` subcommands (actions) +
  `consent/transport.js` (prompt). Zero-dep ANSI; no curses library.

## 6. Registration & launch model (design for Phase 8)

- **Registry:** `~/.lilara/tools.json` — `{ name, adapter, cwd, launchCmd, env?, notes? }` per tool. Written only by
  CLI/TUI (host-side), version-stamped, validated against a schema in `schemas/`.
- **Launch:** spawn `launchCmd` with the adapter's hook wiring injected (per-harness mechanism as each adapter defines
  it today); the child's PreToolUse/PostToolUse traffic flows through the guard exactly as a manually-started tool.
- **Queue model:** task identity from session-context + journal correlation (sessionId → tool → current decision
  state). `waiting-on-consent` derives from a parked `consent-required` decision with no recorded answer.
- **Out of scope for v1 even in Phase 8:** remote (non-localhost) access; multi-user; web approve (gated on the
  Phase 6 approver-auth ADR: nonce + expiry per prompt, approver identity binding, §8 invariants re-proven remotely).

## 7. Phasing & acceptance

| Stage | Gate | Content |
|---|---|---|
| Spike (now, this PR) | none — throwaway | static `web-mock.html` + `tui-mock.md`, fake data, visual review of this design |
| Phase 8 real build | owner go + Phase 6 approver-auth (Q6 decided 2026-06-12: dashboard IS the seed) | backend endpoints on dashboard-server lineage; TUI; registry/launch; SSE |

**Phase 8 acceptance checklist (falsifiable):** every mutating endpoint sits behind approver-auth · narrow-only rule
enforced by tests (no widen action reachable unauthenticated) · 100% of launched-tool actions traverse an adapter ·
redaction fail-closed test green · zero external dependencies · TUI consent path proven equivalent to the existing TTY
transport (same invariants test suite).

## 8. Open questions (owner)

- **Q6 — RESOLVED (owner, 2026-06-12):** the dashboard IS the seed; this design's assumption is now the decision
  (SCOPE §24, §14 standing constraint).
- Web *registration* submit: keep disabled in v1 (this design's conservative call) or allow it as
  registration-is-not-widening? Default: disabled until decided.
- TUI scope: read+consent only, or also grant minting (it IS the controlling TTY, so §8 permits it)? Default: defer
  minting to the consent flow itself.

*End of design. Nothing here is sequenced before the safety core; nothing here relaxes Rule 1–6.*
