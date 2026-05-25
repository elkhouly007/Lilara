# Skill: self-review

---
name: self-review
description: Agent self-assessment loop that pauses after code generation to evaluate correctness, security floor compliance, edge-case coverage, and test adequacy before committing. Emits a structured confidence report and escalates to human review when confidence < 70.
---

# Self-Review

Structured self-assessment loop for agents to evaluate their own output before committing or declaring done. Applies four scored dimensions and flags output for human review when confidence is insufficient.

## When to Use

- After generating or modifying code, before committing
- After writing a plan, architecture doc, or spec — before sharing
- Before closing a task where correctness or security matters
- Any time the agent has made multiple interdependent decisions and wants to check for drift

Do NOT use as a substitute for external code review on security-critical changes; use as a complement.

## Process

1. **Pause before declaring done** — Stop after generating output. Do not commit, send, or close the task yet.

2. **Evaluate four dimensions** — Score each 0–100:

   - **Correctness** (0–100): Does the output meet the stated requirement exactly? Are there logic errors, off-by-ones, missing branches, wrong return types? Score 0 if the output is wrong; 100 if it demonstrably satisfies every stated requirement.

   - **Security floors** (0–100): Does the output comply with all active F1–F22 floors? Check: no secrets in output, no ambient-authority writes outside declared scope, no cross-agent lock violations, no unreviewed remote code execution. Score 0 if any floor is violated; reduce 20 points per unverified floor.

   - **Edge cases** (0–100): Have you considered null/empty input, maximum-length input, concurrent writes, missing files, network failure, and unexpected types? Score based on how many plausible edge cases are handled vs. identified-but-unhandled.

   - **Test coverage** (0–100): Would the existing test suite catch a regression in this output? Are there tests for the happy path? For at least one failure mode? Score 0 if no tests exist; 50 if only happy-path tests exist; 100 if failure modes are also covered.

3. **Compute overall confidence** — `confidence = round((correctness + security + edge_cases + test_coverage) / 4)`.

4. **Emit the confidence report**:

   ```json
   {
     "confidence": <0-100>,
     "dimensions": {
       "correctness": <0-100>,
       "security_floors": <0-100>,
       "edge_cases": <0-100>,
       "test_coverage": <0-100>
     },
     "flagged": <true|false>,
     "notes": "<free-text — what was found, what was skipped, why>"
   }
   ```

5. **Escalate if flagged** — `flagged = confidence < 70`. When flagged:
   - State the lowest-scoring dimension and the specific reason.
   - Ask the human to review before proceeding, or invoke `self-reviewer` agent.
   - Do not commit or close the task until either the score improves or the human explicitly accepts the risk.

6. **Proceed when confident** — `confidence >= 70` and no floor violated → commit or close the task.

## Output Format

```
## Self-Review — <task description>

Confidence: <N>/100  [PASS | ESCALATE]

| Dimension       | Score |
|-----------------|-------|
| Correctness     |  N/100|
| Security floors |  N/100|
| Edge cases      |  N/100|
| Test coverage   |  N/100|

Notes: <explanation of any scores below 70, what was checked, what was deferred>
```

When `flagged: true`, append:

```
ACTION REQUIRED: confidence below threshold. Lowest dimension: <name> (<score>/100).
Reason: <specific issue>.
```

## Constraints

- Self-review supplements but does not replace external human review on security-critical code.
- A confidence score of 100 does not guarantee correctness — it means the agent has checked all four dimensions thoroughly. Human review is still the final gate.
- Do not inflate scores to avoid escalation. Honest low scores are more useful than dishonest high scores.
- References: `rules/common/self-review-protocol.md` for the underlying principles.
