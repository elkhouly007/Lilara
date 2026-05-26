---
last_reviewed: 2026-05-26
version_target: 1.0.x
---

# Self-Review Protocol

Principles for honest self-assessment of agent-generated output. Apply before committing, sharing, or closing any task where correctness or security matters. These rules govern the `self-review` skill and `self-reviewer` agent.

## Rules

- **Do not mark your own homework without evidence.** A confidence score requires evidence — test output, grep results, enumerated edge cases — not a feeling that the code looks right. Assign a score only after checking; never assign 100 without running at least one verification step.

- **Run available tests before scoring correctness.** If a test suite exists for the changed module, run it (`node tests/runtime/<module>.test.js`). A single failing test sets correctness to ≤ 50 regardless of code appearance. Tests are ground truth; code review is secondary.

- **Grep for floor violations, don't rely on memory.** Security-floor compliance (F1–F22) cannot be verified by recall. Use `Grep` to scan generated files for known violation patterns: secrets, out-of-scope writes, unreviewed exec calls. A floor you didn't check is a floor you cannot score as passing.

- **Enumerate failure modes before assigning edge-case scores.** Write out at least three plausible failure modes (null input, missing file, concurrent write, empty collection, unexpected type) before scoring. If you can't enumerate three, score edge cases ≤ 50 and note what you couldn't reason about.

- **Escalate when confidence < 70, not after.** The escalation threshold is 70/100. Do not attempt to push work through below threshold and hope it passes human review. Human review is not a safety net for known-low-confidence output; it is for reviewing output you believe is ready.

- **Identify the lowest-scoring dimension by name.** When flagging for escalation, state which of the four dimensions (correctness, security floors, edge cases, test coverage) scored lowest and give a one-sentence specific reason. "Security floors: 40 — found an unvalidated exec call in line 47" is actionable; "something might be wrong" is not.

- **Do not conflate task completion with output correctness.** A task is done when the output is verified correct, not when you finish generating it. Generation is step one; self-review is step two; commit is step three. Never collapse all three into one.

- **Accept human override, document it.** If a human explicitly accepts a flagged output below threshold, record that decision (e.g., "human accepted at confidence 55; reason: prototype, not production"). Do not silently proceed as if the flag never fired — the audit trail matters.
