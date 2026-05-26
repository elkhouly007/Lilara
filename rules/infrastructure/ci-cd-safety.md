---
last_reviewed: 2026-05-26
version_target: ">=0.2.0"
---

# CI/CD Safety Rules

Security and reliability practices for CI/CD pipelines (GitHub Actions, GitLab CI, Bitbucket Pipelines).

- **Pin third-party actions and orbs to full commit SHAs, not tags.** Tags are mutable — `actions/checkout@v4` can be repointed by an attacker who compromises the action repo. Use `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` and track updates with Dependabot or Renovate.
- **Use OIDC short-lived tokens instead of long-lived secrets.** Configure cloud providers (AWS, GCP, Azure) with OIDC identity federation so CI jobs receive temporary credentials via token exchange. Long-lived static secrets in CI become permanent breach vectors when leaked.
- **Restrict `permissions:` to the minimum required at the workflow and job level.** GitHub Actions workflows default to `contents: read` — but many workflows use the broader default. Explicitly set `permissions: {}` at workflow level and grant only what each job needs (e.g., `contents: write` only for release jobs).
- **Never use `pull_request_target` with checkout of the PR head.** `pull_request_target` runs with write permissions in the context of the base repo. Checking out `github.event.pull_request.head.sha` in that context allows untrusted PR authors to execute arbitrary code with write access.
- **Use ephemeral, isolated runners for production deployments.** Self-hosted runners that persist between jobs accumulate state (env vars, cached credentials, workspace residue) from prior runs. Use ephemeral runners or container-based isolation; never share a runner between untrusted and trusted jobs.
- **Enforce artifact retention policies and sign critical artifacts.** Artifacts stored indefinitely create a persistent surface for exfiltration of build outputs. Set a maximum retention period (e.g., 30 days for test artifacts, 1 year for release binaries) and sign release artifacts with Sigstore/Cosign.
- **Protect main/production branches with required status checks and signed commits.** Branch protection rules should require: passing CI status checks, at least one approved review, no direct pushes (even for admins in high-risk repos), and commit signature verification.
- **Require at minimum one human reviewer for changes to CI/CD config files.** Pipeline files (`.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`) define the execution environment. A malicious edit to these files can exfiltrate secrets, bypass tests, or deploy backdoored artifacts — treat them as security-critical.
- **Gate production deployments behind explicit environment approvals.** Use GitHub Environments / GitLab protected environments / Bitbucket deployment environments to require a named human approver before any job runs in a production context. Automated promotion without gates is the top cause of accidental production incidents.
- **Emit provenance attestations for release artifacts.** Use SLSA provenance generation (e.g., `slsa-framework/slsa-github-generator`) to attach a verifiable build attestation to every release artifact. This enables downstream consumers to verify the artifact was built from the expected source at the expected commit.
