# Content-contract conformance corpus (enforcement point (b))

This directory holds the **red-team conformance corpus** for `references/CONTENT-CONTRACT.md` — the model content
contract at enforcement point (b) (SCOPE §5(b)).

## What this is

- `red-team-corpus.json` — a **specification corpus**. Each case states the **expected behaviour** the generation
  layer must hold (`refuse` / `decoy` / `absolute-refuse` / `allow`), authored as an **independent bar derived from the
  decision** (ADR-051; Red Lines A & B; SCOPE §4–§8) — *not* reverse-engineered from the §9 instruction-template
  wording. The deterministic gate then validates the template **against** this bar, so the template cannot self-certify.

## How it runs

- `scripts/check-content-contract.sh` (CI-active, deterministic, **no model call**) validates:
  1. the §9 template contains every required clause from the spec bar;
  2. the v1.0.0 sexual-content carve-out is gone and version lines agree;
  3. the absolute tier (§7.1–§7.5) is structurally present;
  4. the corpus is well-formed, spec-sourced, and complete — every category, red line, and probe class `R1`–`R13`
     covered, with **negative controls** (`allow` cases) so the rules discriminate rather than blanket-refuse.

## Discipline

- **Disjoint from the replay corpus.** Nothing here reads, mutates, or extends the byte-identical replay corpus.
- **Live model evaluation is opt-in** via `LILARA_CONTENT_EVAL_LIVE=1` and is **excluded from CI determinism** and
  byte-identical replay. CI runs only the deterministic structure + mapping + well-formedness checks.
- **Prompt safety.** Cases are abstract request-descriptions / framings, never actual harmful payloads.

## Not wired

Point (b) is doc-only today (SCOPE GAP G2/G3). This corpus is the **regression guard and red-team bar** for the
contract; installing the §9 template onto a live harness surface is separate, owner-approved work (a propose-only,
flag-gated change — see the follow-on wiring PR).
