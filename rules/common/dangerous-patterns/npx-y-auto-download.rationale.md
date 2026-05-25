---
last_reviewed: 2026-05-24
version_target: 0.1.0
pattern_id: npx -y (auto-download execution)
pattern_source: claude/hooks/dangerous-patterns.json
severity: high
---

# npx -y (auto-download execution) — Rationalization Defense

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "It's a well-known package like `create-react-app`." | npm package names can be squatted. The package you intend and the package installed may differ by one character. `npx -y` installs and runs immediately — there is no inspection window. |
| "The `--yes` flag just skips the confirmation prompt." | The confirmation prompt exists for this exact reason: to give the operator a moment to verify before execution. Skipping it removes the last human checkpoint before untrusted code runs. |
| "I've run this package before — I know it's safe." | npm packages are mutable. A version you ran previously may have been updated to include malicious code. `npx` without a pinned version always fetches the latest. |
| "The package is in the devDependencies — it's already trusted." | `npx` can run packages not in devDependencies. The `-y` flag does not check whether the package is in the project's lockfile. |

## Red Flags (STOP thoughts)

- "It's a popular package — it's definitely safe."
- "I just need to skip the confirmation."
- "I've used this package in many projects."
- "It's a scaffolding tool — it's fine to auto-install."

## Why this pattern is here

`npx -y` (or `npx --yes`) downloads and executes an npm package without any
confirmation. Combined with npm's mutable registry and the prevalence of
typosquatting attacks, this pattern is a common supply-chain attack vector.

Unlike `curl | bash`, there is a narrow mitigation path: use `npx` without `-y`
(requires explicit terminal confirmation), or install the package first with
`npm install` (which respects the lockfile and allows inspection) and then run
the local binary.

## Safer alternative

```bash
# Install with lockfile verification first
npm install --save-dev create-react-app
# Then run the local binary (no download at runtime)
npx create-react-app my-app   # uses the installed version, no re-download

# Or: pin the version and verify the integrity
npm install --save-dev create-react-app@5.0.1
# Check package-lock.json integrity hash before committing

# If you must use npx with a remote package: omit -y and review the prompt
npx some-package@1.2.3   # prompts before download — review the version
```
