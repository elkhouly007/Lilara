# Hermes — Third-Party Notices

> Per `../references/hermes-license-check.md` and the standing license-attribution rule
> (HANDOVER-HERMES.md §4, RED-LINES.md §3). Lilara's Hermes adapter is built **clean-room
> from public docs only**. **No Hermes source code has been vendored, copied, or
> translated into Lilara's source tree.** The adapter implementation is original Lilara
> code under the same license as the rest of the Lilara repo (see `LICENSE` at the repo
> root — currently the project is private and unlicensed externally).

## Hermes target

| Field | Value |
|---|---|
| Project | Hermes Agent |
| Owner | Nous Research |
| Upstream URL | https://hermes-agent.nousresearch.com |
| Upstream source | https://github.com/NousResearch/hermes-agent |
| License | **MIT** (permissive, clean-room-compatible) |
| License-check artifact | `../references/hermes-license-check.md` (dated 2026-06-17) |
| Source contact | **None.** No Hermes source has been read, vendored, or translated. |
| Public protocol surface used | `https://hermes-agent.nousresearch.com/docs/developer-guide/adding-platform-adapters` and `https://hermes-agent.nousresearch.com/docs/developer-guide/tools-runtime` — paraphrased, not copied. |

## Attribution requirement

Per the Lilara standing rule (clean-room rewrite always; never copy AGPL/GPL/SSPL/BSL or
source-available code), and per the Hermes upstream's MIT terms:

- **MIT permits** verbatim copying with copyright + permission notice in the copy. We have
  not copied. No attribution clause is triggered.
- **Lilara's standing rule goes further**: we study, redesign, and rewrite — even from MIT
  sources. The Hermes adapter is original Lilara code, written from the public protocol
  description only.
- **Future contact:** if anyone on the Lilara team later reads Hermes source code, the
  license-check artifact (`references/hermes-license-check.md`) must be amended with the
  date of contact and the scope of files touched BEFORE any derived code lands. This
  amendment requires owner escalation.

## Why this file exists

The `references/hermes-license-check.md` artifact (Section "Attribution requirement")
promised: "The Lilara repo will carry an MIT attribution notice in the adapter's
`LICENSE-3rdparty/hermes.md` once code lands." This file is that notice. The actual
file path is `hermes/THIRD_PARTY_NOTICES.md` (we use the more conventional "third-party
notices" filename; the contents and intent are identical).

## Cross-references

- `../references/hermes-license-check.md` — the dated license-check artifact (MIT, clean-room boundary).
- `WIRING_PLAN.md` — full wiring plan + integration-model rationale.
- `HERMES_POLICY_MAP.md` — Hermes event surface → Lilara decision source / floor source map.
- `README.md` — apply guidance.
- `../HANDOVER-HERMES.md` §4 — the Lilara license red line.
- `../RED-LINES.md` §3 — the founder-facing red-line text.
