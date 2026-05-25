---
last_reviewed: 2026-05-25
version_target: 1.0.x
---

# Commit Conventions

Conventional Commits rules enforced by `claude/hooks/commit-validator.js` and expected by `skills/changelog-generator.md`.

## Subject Line Format

- Every commit subject must follow Conventional Commits: `type(scope)?: description`.
- Valid types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `build`, `ci`, `perf`, `revert`.
- Scope is optional. When used, it must be a noun describing the affected module or subsystem: `feat(auth):`, `fix(runtime):`.
- Breaking changes: append `!` before the colon (`feat(api)!:`) or add `BREAKING CHANGE:` in the commit body.
- The description after the colon starts lowercase, is imperative mood, and does not end with a period.

## Subject Line Length

- Maximum 72 characters for the subject line (first line of commit message).
- If you need more space, use a body: leave a blank line after the subject and write as many paragraphs as needed.
- The body is not length-limited. The 72-char limit applies to the subject only.

## WIP and Temporary Commits

- Never push WIP commits to protected branches (main, master, production, prod, release).
- WIP commits on feature branches must be squashed or amended before opening a pull request.
- Fixup commits (`fixup!`, `squash!`) must be interactive-rebased away before the branch merges.

## Body and Footer

- Use the body to explain WHY the change was made, not what (the diff shows what).
- Reference issues and PRs in the footer: `Closes #123`, `Fixes #456`, `Refs #789`.
- Co-author attribution goes in the footer: `Co-Authored-By: Name <email>`.
