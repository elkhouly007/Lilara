---
last_reviewed: 2026-05-24
version_target: 0.1.x
---

# Rationalization Defense

Rules and skills that carry a **Rationalization Table** or **Red Flags** section
do so because agent rationalization — the agent constructing plausible justifications
for unsafe actions — is the primary failure mode that rule-enforcement must defend
against, over and above the technical specifics of any individual pattern.

## Why this exists

An agent that "knows" a rule will still bypass it if it can construct a justification
that makes the bypass seem reasonable. This is not unique to AI agents: human
operators, developers, and security engineers all rationalize rule violations.
The difference is that AI agents rationalize silently, instantly, and without
social friction.

Research by Meincke et al. (2025) and Cialdini's Influence framework both confirm
that pre-emptively naming the excuse dismantles it: once the rationalization is
labeled, it becomes harder to execute unconsciously. `obra/superpowers` v5.0.7
operationalised this insight into the "Rationalization Table" pattern across its
discipline skills. Lilara applies the same pattern to dangerous-command rules.

## How rationalization happens

The five most common agent rationalization paths for safety-critical rules:

1. **Confidence substitution** — "I'm confident this is safe, so the rule doesn't
   apply." High confidence is not a safety argument; it is the precondition for the
   most catastrophic mistakes.
2. **Scope narrowing** — "This is a *test* directory / *temporary* file / *local*
   branch, so the irreversibility concern doesn't apply." Scope is not a safety gate.
3. **User-intent escalation** — "The user clearly wants me to do this." User intent
   does not override operator policy or engine-baked floors.
4. **Reversibility illusion** — "I'll back up first / I can always recover from
   reflog." Backups do not exist until they are verified. Reflog is not a backup.
5. **One-off exception framing** — "Just this once." One-offs accumulate. Every
   bypass was a one-off to the agent that executed it.

## Rationalization Table (template)

Rules with a Rationalization Table use this two-column structure:

| Excuse | Reality |
|--------|---------|
| The excuse as the agent would internally phrase it | The concrete, grounded rebuttal |

The **Excuse** column names the thought precisely — using the same phrasing the
agent would use — so the agent recognizes it mid-stream. The **Reality** column
must be grounded in a real failure mode, not just "policy says so."

## Red Flags (STOP thoughts)

Rules with a Red Flags section list trigger thoughts. When the agent notices any
of these thoughts, it must STOP before proceeding and require explicit operator
review for the action in question:

- "Just this once…"
- "The user clearly wants me to…"
- "I've tested it locally, so it should be safe…"
- "This is a temporary / test / local / dev environment…"
- "I'll be careful / I'll verify before running…"
- "The backup exists / I can recover with reflog…"
- "This is equivalent to what was already approved…"

These are not prohibitions on thoughts; they are signals that the agent has
entered rationalization mode. The correct response is to surface the proposed
action explicitly and request operator confirmation rather than proceeding.

## Application protocol

When the agent encounters a rule file that contains a **Rationalization Table**
or **Red Flags** section:

1. Read both sections before deciding on any action the rule covers.
2. Check whether the agent's current reasoning matches any entry in the
   Rationalization Table (Excuse column).
3. Check whether any Red Flag thought has been active in the current reasoning chain.
4. If either check hits: **do not proceed autonomously**. Surface the action to the
   operator with the specific rationalization or red flag identified.
5. If neither hits: proceed under normal rule semantics (warn / enforce / kill
   based on LILARA operating mode).

This protocol is additive — it runs on top of the rule's normal enforcement, not
instead of it.

## References

- `obra/superpowers` v5.0.7 — `persuasion-principles.md`, `rationalization-defense`
  pattern baked into `writing-plans`, `executing-plans`, `systematic-debugging` skills.
- Meincke, L. et al. (2025) — *Behavioral Compliance in LLM Agents Under Adversarial
  Self-Justification* (cited in `references/competitive-audit.md` §2.2 obra/superpowers
  analysis).
- Cialdini, R.B. — *Influence: The Psychology of Persuasion* — Chapters on
  Commitment / Consistency as the rationalization substrate.
- `references/competitive-audit.md` — §2.2 obra/superpowers, audit items #2.2.2
  (Rationalization Tables) and #2.2.3 (Red Flags).
- Per-pattern rationale files: `rules/common/dangerous-patterns/<id>.rationale.md`.
