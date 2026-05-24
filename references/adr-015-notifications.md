# ADR-015 — Notification routing (Discord / Slack / email)

**Status:** ACCEPTED — 2026-05-15 (v0.5 Stage D, wave-4).
**Scope refs:** `workstreams/agent-runtime-guard-scope.md` §5.1 ("Multi-channel
approvals (Discord, Slack, Telegram, Mobile, Email; voice later)") and §7.2
(notifications are **opt-in only** with **PII scrubbing**).
**Plan ref:** `workstreams/agent-runtime-guard-plan.md` §4.1 Stage D.

## 1. Why this exists

§5.1 calls for operator-facing notification routing on the four high-signal
decision events that v0.5 actually emits today — approval requests,
kill-switch fires, degraded-mode entries, and adversarial-bypass detections.
§7.2 requires that any such surface be opt-in, scrub PII, and never have the
ability to mask a security-critical decision by failing.

Before this PR there was no path from a `decide()` result to an operator's
inbox / chat. Operators learned about kill-switch fires only by reading the
journal after the fact, which defeats the point of having a kill switch.

ADR-015 closes the gap with a **side-effect rail** — not a floor — that
attaches to the existing receipt-assembly path and emits the event over zero
or more transports (Discord / Slack / email) when the contract opts in.

## 2. Decision

**Opt-in, default disabled.** Contract carries an optional `notifications`
block. Absent block ⇒ `loadNotifyConfig()` returns `{ enabled: false }` and
the hook is a complete no-op. Receipts on installs without notifications
stay byte-identical with the prior wave, preserving fixture stability.

**Fire-and-forget contract.** `runtime/decision-engine.js` invokes the hook
AFTER receipt assembly + journal append, BEFORE the engine return. The
engine does NOT await the resulting Promise — it attaches a `.catch(() => {})`
and returns immediately. Transport latency / failure can NEVER delay or
change a decision. The hook is wrapped in try/catch end-to-end so even a
synchronous throw inside `notify.js` can't escape into the hot path.

**Severity model.**

| kind                          | severity   | trigger                                           |
| ----------------------------- | ---------- | ------------------------------------------------- |
| `approval-request`            | `info`     | `action === "require-review"`                     |
| `kill-switch-fire`            | `critical` | `floorFired === "kill-switch"`                    |
| `degraded-mode-entered`       | `warning`  | first decide() in this process with `degradedMode`|
| `adversarial-bypass-detected` | `critical` | `floorFired` starts with `G` AND `action === "block"` |

`severityFloor` filters events at the router. `info` (default) lets all four
through; `warning` drops approval-request; `critical` keeps only the two
high-stakes kinds. Per-channel `events: ["*"]` matches every kind; per-channel
`events: ["kill-switch-fire", "..."]` opts a transport into a specific subset.

**Scrub contract (allowlist).** `scrubForNotify(receipt)` returns ONLY the
following keys, every one a known-safe receipt field that never contains a
secret on any code path: `action`, `riskLevel`, `reasonCodes`, `floorFired`,
`decisionKey`, `contractRevision`, `timestamp`, `ambientClass`, plus
`snapshotId` promoted from `receipt.snapshot.snapshotId` when present.
**Anything else is dropped.** That includes tool args, IR `outputs[]`,
environment values, `cwd`, file contents, `targetPath`, `notes`, and any
field tagged secret by the contract. The allowlist is the contract — a new
field appearing on a receipt cannot leak by default; an explicit code change
in `notify.js` is required.

Scrubber is byte-stable across re-scrub: passing an already-scrubbed payload
back through `scrubForNotify()` yields an identical byte string
(`canonicalJson(re_scrub) === canonicalJson(scrub)`). This is what
`notify-scrub.test.js` actually verifies.

**Retry + timeout.** Per-channel timeout 5s; up to 3 attempts with
exponential backoff `[200ms, 1s, 5s]`. 5xx and network failure retry; 4xx
terminates immediately (operator misconfiguration is not transient). After
3 attempts, the channel result carries
`error: "degraded-mode:exhausted-retries:<last>"` and the notification is
DROPPED — the journal `notify` entry records what happened, but the engine
proceeds unchanged.

**Credentials live in env, never in the contract.** SMTP host / port / user /
pass / from come from `LILARA_SMTP_*`. The contract document is hashed and
committed; baking credentials into it would publish them. Webhook URLs go
in the contract because URL alone is not a credential per Discord / Slack
threat models (the URL IS the bearer, but the contract is hashed and stored
in `~/.lilara/`, not pushed to remote).

**Receipt enrichment.** A decision whose hook actually fires (contract
enabled + matching event) gains an additive `notifyAttempted: true` key.
The key is absent on every other path so receipts on disabled installs
stay byte-identical.

## 3. Threat model

**Compromised webhook URL.** Worst case: an attacker who reads / steals the
webhook URL can spam the destination channel with anything they want, AND
they can read whatever Lilara sends to that channel. The scrub contract bounds
the latter: the leaked-payload surface is only the 9 allowlisted receipt
fields, none of which contain secrets. There is no path for `args`,
`outputs[]`, `cwd`, file contents, or env values to reach the webhook even
in the worst-case scrubber bug, because the scrubber is allowlist-only —
omitting a single line in `KEEP_KEYS` shrinks the surface, not grows it.

**Compromised SMTP creds.** Credentials are env-only; they never appear on
the receipt, never appear in the journal, and never appear in any payload
the transport sends. A leaked `LILARA_SMTP_PASS` lets the attacker send mail
through the operator's SMTP, but does NOT widen the Lilara receipt surface.

**Adversarial event injection.** Notification events are derived ONLY from
the finalized engine `result`. There is no path from raw user input to a
`kind` value. An attacker cannot inject a synthetic `kill-switch-fire`
because they cannot synthesize a `floorFired === "kill-switch"` without
actually tripping F1.

**Webhook URL prefix validation.** `discord.js` requires
`https://discord.com/api/webhooks/`; `slack.js` requires
`https://hooks.slack.com/services/`. A contract that attempts to route to
an arbitrary attacker domain fails at transport time with
`invalid-<type>-webhook-url`. The transport tests assert this.

**Fail-open vs fail-closed.** Notification failure is FAIL-OPEN — the
engine returns the decision regardless. This is a deliberate trade-off:
a transient webhook outage on a `kill-switch-fire` MUST NOT silently
re-permit the action that the floor already blocked. Operators see the
failure on the next `horus notify history` invocation and in the journal.

## 4. What's NOT in v0.5

- **Telegram, mobile push, voice.** Deferred to v1.5 / M9 per scope §5.2.
- **Multi-channel approval handshake** (operator approves via Slack and the
  engine respects it). That's M9 commercial — the v0.5 router is one-way.
- **Notification rate-limiting beyond per-channel retry.** Operators can
  disable noisy event kinds per channel via `events:[]`; no global digest.
- **Notification deduplication / digest mode.** Per-event firing only.
- **Encrypted webhook bodies.** Transport-layer TLS is sufficient given the
  scrub contract.
- **Wiring Lilara enforcement into Claude Code / OpenClaw runtime.** Notifications
  here are about the Lilara runtime's own decisions, not about adapter wiring.

## 5. CLI surface

`horus notify show` — print the active `notifications` config from the
loaded contract.
`horus notify test --channel <discord|slack|email> [--url <webhook>] [--dry-run]`
— send a test notification (or dry-run print the payload) to verify a
transport is configured correctly.
`horus notify history [--limit N]` — list recent journal entries with
`notifyAttempted` or `kind === "notify"`. Prints metadata only (timestamp,
kind, severity, per-channel result); never prints the scrubbed payload, in
keeping with the §7.2 PII baseline.

## 6. Files

- `runtime/notify.js` — router, scrubber, config loader, shared HTTP helper.
- `runtime/notify/discord.js` — Discord webhook transport.
- `runtime/notify/slack.js`   — Slack incoming-webhook transport.
- `runtime/notify/email.js`   — SMTP-over-TLS transport (hand-rolled, zero-dep).
- `runtime/decision-engine.js` — hook at two return sites (early-block + main).
- `schemas/lilara.contract.schema.json` — additive `notifications` block.
- `scripts/lilara-cli.sh` — `notify {test,show,history}` subcommands.
- `tests/runtime/notify-scrub.test.js` — adversarial PII scrub corpus.
- `tests/runtime/notify-transport.test.js` — HTTP + SMTP mock-server stubs.
