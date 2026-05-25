---
last_reviewed: 2026-05-26
version_target: 1.0.x
---

# Workflow Discipline

Rules for respecting and enforcing declared workflow steps. Applies when a project configures `workflow.required_steps` in `lilara.config.json`. The enforcer is implemented in `runtime/workflow-enforcer.js`; session state lives at `<stateDir>/workflow-state.json`.

## Rules

- **Respect the declared step order.** When `step_order: "strict"` is configured, steps must complete in the order listed in `required_steps`. Committing before tests run, or deploying before review, is not a shortcut — it is a policy violation.

- **Mark steps explicitly, not retroactively.** A step counts as complete only when `markStep(name)` is called at the actual completion boundary. Marking test-passed after a failed run, or calling review-complete before review feedback is addressed, defeats the enforcer.

- **Treat coaching messages as blockers in strict mode.** When `LILARA_ENFORCE=1` and mode is strict, a `blocked: true` result from `checkSteps()` means the workflow gate must not be bypassed. Bypassing it (with `--no-verify` or by skipping the check) removes the value of the contract.

- **Missing steps are coaching, not punishment.** When `LILARA_ENFORCE` is not set, missing steps produce coaching output only — they do not block. Use enforce mode deliberately in pipelines, not by default in developer environments.

- **Config absence means no constraint.** If `lilara.config.json` is absent or lacks a `workflow` key, `checkSteps()` returns `{ satisfied: true, mode: "disabled" }`. No workflow gates fire. This is the safe default.

- **Step state is session-scoped.** `workflow-state.json` accumulates completed steps for the current work session. Use `resetSteps()` to start fresh for a new task. Stale completed-step records from a previous session do not carry over unless you deliberately preserve the file.

- **Required steps should reflect real quality gates.** Configure only steps that represent real quality checks: `test`, `review`, `lint`, `typecheck`, `security-scan`. Do not add trivial or ceremony-only steps — every entry in `required_steps` should be something that, if skipped, would genuinely risk a quality regression.

- **Workflow config is additive, not a straitjacket.** `required_steps` defines a minimum; it does not prohibit doing more. A workflow that requires `["test", "review", "commit"]` does not prevent you from also running a security scan or updating docs. The step tracker ignores unregistered steps.
