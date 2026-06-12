# THROWAWAY DESIGN SPIKE — control-plane mocks

> **This directory is a disposable design spike. It is NOT the real build.**
> The §23.A control plane is sequenced LAST (after the safety core L1 → L5 → L2 → L4 → L3; see
> `references/SCOPE.md` §23.A and `references/PLAN.md` Phase 8) and its real build starts only on explicit owner go.
> Nothing here is wired into the runtime, the CLI, CI, or the installer. Delete this directory at any time; nothing
> breaks.

| File | What it is |
|---|---|
| `web-mock.html` | Static, self-contained HTML mock of the web control plane (fake hardcoded data, no server, no fetch). Open directly in a browser. |
| `tui-mock.md` | ASCII frame mockups of the terminal UI, including the TTY-hosted consent prompt. |

Both mocks exist to make `references/UI-DESIGN.md` visually reviewable. The design rules they express (and the real
build must enforce):

1. **Narrow-only web:** the web surface may revoke/stop/kill (narrowing) but every approve/grant control renders
   **disabled** — widening authority requires the approver-authentication design that SCOPE §8/§14 defer.
2. **The controlling TTY is the consent surface:** only the terminal UI hosts the consent stop-and-ask.
3. **Redaction everywhere:** all payload-ish values appear as redacted placeholders; the mocks contain no realistic
   secrets, tokens, or destructive command literals — by design, matching the dashboard's fail-closed redaction layer.
