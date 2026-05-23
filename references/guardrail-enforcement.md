# Guardrail Enforcement Scaffold

## Goal

Move from policy-only to lightweight enforceable checks where that adds real safety value.

## First Enforcement Targets

- outbound payload review before external sends;
- config linting for obviously banned patterns;
- capability manifest consistency checks;
- hook contract validation;
- import report completeness.

## Early Enforcement Style

Prefer lightweight checks that are easy to review and do not create hidden behavior.

Examples:

- grep or schema checks for banned patterns;
- required-field checks for module registries;
- payload review checklists before external actions.

## Do Not Do

- create opaque enforcement that silently mutates user intent;
- bypass the standing approval policy;
- auto-approve because a check passed.

## F17 — Cross-Agent Lock (Lilara v0.5 PR-A)

F17 is the first engine-baked cross-agent lock floor. Lock records live under
`<LILARA_STATE_DIR>/cross-agent-locks/*.json` (one record per file). For a
write-like tool call (`Write`/`Edit`/`MultiEdit`/`NotebookEdit` or any IR
fileTargets with intent `write`/`delete`), `decide()` reads the lock
directory and blocks when a lock owned by a different agent/session is
unexpired and overlaps the call's target path or projectRoot. The lock
record carries `owner`, optional `projectRoot`, optional `paths[]`, and an
optional epoch-ms `expiresAt`. F17 is non-demotable and rung 17.75 (after
F16 ambient-authority, before D-CONTRACT-ALLOW). Read-only calls never fire
F17. A malformed lock file fails closed for write-like calls only. This PR
is the read-only consumer slice; the writer API (acquire/release) is
explicit and lands in a follow-up.
