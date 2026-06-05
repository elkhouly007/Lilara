# ADR-039 — Notify-transport TLS loopback floor

**Status:** Implemented
**Decision date:** 2026-06-05
**Severity:** MED-HIGH

---

## 1. Problem statement

`runtime/notify/email.js` carries security-relevant event payloads (command string,
floor code, decision source, target path). Two environment variables allow weakening
SMTP security:

- `LILARA_NOTIFY_INSECURE=1` → switches from TLS to plaintext (`net.connect`)
- `LILARA_NOTIFY_TLS_NOVERIFY=1` → disables certificate validation (`rejectUnauthorized: false`)

Both variables were honored for **any SMTP host**, including external production relays.
One env-var set (e.g. in a CI profile, `.env`, or shell session) would silently route
security telemetry in the clear or to an attacker's MITM relay, with no operator warning.

By contrast, `runtime/notify/slack.js` and `runtime/notify/discord.js` already gate
`LILARA_NOTIFY_INSECURE` to `127.0.0.1|localhost` only:

```js
// slack.js / discord.js line 34 (existing):
if (process.env.LILARA_NOTIFY_INSECURE === "1" && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) return true;
```

`email.js` had no such guard — the inconsistency created the gap.

---

## 2. Decision

Gate both `LILARA_NOTIFY_INSECURE` and `LILARA_NOTIFY_TLS_NOVERIFY` to **loopback
hosts only** (`127.0.0.1`, `::1`, `localhost`), mirroring the pattern already present
in the Slack and Discord transports.

Implementation: a single `_isLoopbackHost(host)` helper (regex `/^(127\.0\.0\.1|::1|localhost)$/i`)
applied at two call sites in `notify/email.js`:

```js
// Loopback guard — matches slack.js / discord.js convention.
const insecure = process.env.LILARA_NOTIFY_INSECURE === "1" && _isLoopbackHost(host);

const _tlsNoverify = process.env.LILARA_NOTIFY_TLS_NOVERIFY === "1" && _isLoopbackHost(opts.host);
const sock = opts.insecure
  ? net.connect(opts.port, opts.host)
  : tls.connect(opts.port, opts.host, { rejectUnauthorized: !_tlsNoverify });
```

For non-loopback hosts the flags are silently ignored (not an error; the operator's
config is preserved without downgrading production security).

---

## 3. Rationale

- **Fail-closed direction**: external SMTP relays must always use full TLS. When the
  env var is set in a shared CI profile and the operator switches from a local test
  relay to a production relay, security must not silently degrade.
- **Uniform convention**: all three notification transports (Slack, Discord, SMTP) now
  follow the same loopback-only weakening rule. A single mental model for operators.
- **No behavior change for current legitimate use**: the two env vars exist for local
  test/dev SMTP servers (Mailhog, smtp4dev), which always run on loopback. Production
  operators connecting to SendGrid/SES/Postfix will see no difference — the flags were
  already irrelevant for them.

---

## 4. Trust-boundary-map update

Row in `trust-boundary-map-2026-06-02.md`:

> **email.js** — `LILARA_NOTIFY_INSECURE` / `LILARA_NOTIFY_TLS_NOVERIFY` env vars
> allow weakening TLS. **RESOLVED (ADR-039):** both vars now loopback-gated;
> non-loopback hosts always use TLS + cert validation.

The `instinct-store.js` and `context-discovery.js` rows remain open (not in scope
for this PR).

---

## 5. Alternatives rejected

1. **Remove LILARA_NOTIFY_TLS_NOVERIFY entirely** — breaks legitimate local dev
   setups with self-signed SMTP certs. Rejected; the loopback guard is the right scope.
2. **Warn and proceed** — ambiguous: operators may miss the warning; silent guard is
   cleaner and matches the Slack/Discord precedent.
3. **Require explicit per-host allowlist** — over-engineered for the existing threat
   model (outbound-only, operator controls the env var).

---

## 6. Files changed

- `runtime/notify/email.js` — `_isLoopbackHost()` helper + two loopback-gated checks
- `tests/runtime/notify-tls-guard.test.js` — 6 tests covering loopback/non-loopback
  behavior for both insecure and tls-noverify modes
- `references/adr-039-notify-tls-floor.md` — this document
- `references/trust-boundary-map-2026-06-02.md` — email.js row updated to RESOLVED
