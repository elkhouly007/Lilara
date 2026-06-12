# THROWAWAY DESIGN SPIKE — terminal UI mock (control plane)

> **Not the real build.** Visual mock for `references/UI-DESIGN.md` §5. The §23.A real build is sequenced last and
> owner-gated. All data below is fake; frames are pure ASCII.

## Frame 1 — main layout (3 panes + status bar)

```
+- FLEET ---------------------+- LIVE QUEUE -------------------------------------+
| > claude-code   * running   | task                 tool      state     last    |
|   openclaw      * unatt 14h | refactor api layer   claude    running   allow   |
|   hermes        . registered| nightly dep sweep    openclaw  CONSENT   F18     |
|   antigravity   . stopped   | docs pass            claude    queued    -       |
|                             | delete artifacts (c) openclaw  done      allow   |
+-----------------------------+- DECISIONS (tail) -------------------------------+
| 03:12:09 openclaw  network-egress   [F18]  consent-required                    |
| 03:11:58 claude    file-write       [---]  allow                               |
| 03:11:31 claude    outbound payload [F27]  block   <redacted: credential-C>    |
| 03:10:09 openclaw  file-read        [F10]  warn    taint window overlap        |
+---------------------------------------------------------------------------------+
 ENFORCE:off CONSENT:off F28:off F29:off F23:observe | tab panes  / filter  q quit
```

**Design notes.** Fleet keeps fixed width (tool states scan vertically); queue gets the widest column budget (task
names dominate); the decision tail is the `journal-tail.js` lineage and scrolls independently. The status bar always
shows the live posture — the same honesty rule as the web header: if nothing would halt, the operator can see it.

## Frame 2 — consent prompt (the TTY-hosted stop-and-ask)

```
+- CONSENT REQUIRED ------- task: nightly dep sweep (openclaw) --------------------+
|                                                                                  |
|  floor fired   : F18 network-egress                                              |
|  action class  : outbound request                                                |
|  target host   : <redacted until approved: external hostname>                    |
|  command class : package-index query                                             |
|  file targets  : (none)                                                          |
|  grant scope   : egress to this host, this session only                          |
|                                                                                  |
|  Approve this scope?  [y/N]  _                                                   |
|                                                                                  |
+----------------------------------------------------------------------------------+
  This prompt is legitimate ONLY here: the TUI runs on the controlling TTY and
  inherits the consent transport's invariant (reads the TTY, never the agent's
  stdin pipe). Prompt fields come from REAL decision fields, never agent narrative.
  Default on Enter / timeout: DENY.
```

**Design notes.** This is the one place in either UI where authority can WIDEN — permitted because it is the same
controlling-TTY transport the consent gate already ships (`runtime/consent/transport.js`), not a new approval channel.
The web UI shows this task as `waiting-on-consent` with its approve control disabled.

## Frame 3 — receipts / journal detail (read-only, redacted)

```
+- RECEIPT s-9f21 / 03:11:31 -------------------------------------------------------+
| decision        : block                                                           |
| floorFired      : secret-egress-external (F27)                                    |
| actionClass     : outbound payload                                                |
| target host     : <redacted: external hostname>                                   |
| payload         : <redacted: credential-class C>                                  |
| irHash          : a1b2c3...                                                       |
| contractRevision: 7                                                               |
+------------------------------------------------------------------------------------+
  served read-only via the redaction layer -- fail-closed if redactor unavailable
```

## Keybindings

```
 tab    cycle panes              enter  open detail on selected row
 /      filter current pane      s      stop selected task        (narrowing)
 r      revoke selected grant    k      KILL SWITCH (double-confirm, narrowing)
 y / n  answer consent prompt    q      quit (TUI only; tools keep running)
```

## What this spike deliberately does not do

- No real data, no server, no reads of `~/.lilara/` — frames are hand-drawn.
- No approve path anywhere except the TTY consent frame (Frame 2), mirroring the narrow-only rule.
- No destructive command literals, no realistic secrets — redacted placeholders only, same as the real redaction layer
  would produce.
