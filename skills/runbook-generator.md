# Skill: runbook-generator

---
name: runbook-generator
description: Generates operational runbooks for standard lifecycle events: deployment, rollback, incident response (per severity tier), backup and restore, and on-call handoff. Each runbook has a fixed structure — Trigger, Prerequisites, numbered Steps (copy-pasteable commands), Verification, Rollback, Escalation, and Post-mortem template — so on-call engineers can execute under pressure without improvisation. Consumes project configuration files to populate real commands and paths.
---

# Runbook Generator

Turn tribal knowledge into copy-pasteable operational playbooks that any on-call engineer can execute under pressure without needing to improvise.

## When to Use

- A service is approaching its first production deployment and has no operational documentation
- An incident revealed that the team improvised steps that should have been written down
- Preparing for on-call handoff to a team member unfamiliar with the system
- Standardizing runbooks across multiple services in an organization

## Process

1. **Identify the runbook type** — determine which runbook(s) to generate from the request:

   | Type | When |
   |---|---|
   | **Deployment** | Planned release of a new version |
   | **Rollback** | Reverting to a previous known-good version |
   | **Incident Response — Sev 1** | Full service outage, customer impact > 50% |
   | **Incident Response — Sev 2** | Significant degradation, customer impact 10–50% |
   | **Incident Response — Sev 3** | Minor degradation, customer impact < 10% |
   | **Backup & Restore** | Data recovery from backup, disaster recovery |
   | **On-Call Handoff** | Shift change or PTO coverage briefing |

2. **Collect service facts** — read the following to populate real commands:
   - Deployment command: from `Makefile`, `package.json` scripts, or `scripts/deploy.sh`
   - Container image name and registry: from `Dockerfile` or CI workflow
   - Kubernetes namespace and deployment name: from `k8s/*.yaml` or `helm/values.yaml`
   - Database connection: from environment variable names in `.env.example`
   - Backup location: from `scripts/backup.sh` or cloud storage config
   - Monitoring dashboard URL: from `README.md` or `docs/runbooks/`
   - Alert channels: from `ONCALL.md` or PagerDuty config

3. **Write the runbook** using this fixed structure for every type:

   ### Deployment Runbook template:

   ```markdown
   # Runbook: Deploy <Service> to Production

   **Last updated:** 2026-05-26
   **Owner:** Platform Team
   **Estimated duration:** 15–20 minutes

   ## Trigger

   A new release has been tagged (e.g., `v1.4.2`) and approved for production by the release
   manager. This runbook assumes staging deployment succeeded.

   ## Prerequisites

   - [ ] You have deploy access to the production Kubernetes cluster
         (`kubectl config current-context` should show `prod-us-east-1`)
   - [ ] The image `registry.example.com/myapp:<tag>` is built and pushed (verify: CI green)
   - [ ] Staging smoke tests pass for the release tag
   - [ ] PagerDuty maintenance window is open (if expected downtime)

   ## Steps

   1. Confirm the release tag and image:
      ```bash
      export TAG=v1.4.2
      docker pull registry.example.com/myapp:${TAG}
      ```

   2. Deploy to production:
      ```bash
      kubectl set image deployment/myapp \
        myapp=registry.example.com/myapp:${TAG} \
        -n production
      ```

   3. Monitor the rollout:
      ```bash
      kubectl rollout status deployment/myapp -n production --timeout=5m
      ```

   4. Verify the new version is serving traffic:
      ```bash
      curl -s https://api.example.com/health | jq '.version'
      # Expected: "v1.4.2"
      ```

   5. Check error rate in Grafana for 5 minutes post-deploy.
      Dashboard: https://grafana.example.com/d/api-overview

   ## Verification

   - [ ] `kubectl rollout status` exits 0
   - [ ] `/health` endpoint returns the new version string
   - [ ] Error rate < 0.1% for 5 minutes post-deploy
   - [ ] No new PagerDuty alerts in the 5-minute window

   ## Rollback

   If verification fails at any step, roll back immediately:
   ```bash
   kubectl rollout undo deployment/myapp -n production
   kubectl rollout status deployment/myapp -n production --timeout=5m
   ```
   Then follow the Rollback runbook.

   ## Escalation

   - On-call lead: @oncall-lead (PagerDuty escalation policy: `myapp-production`)
   - Platform Slack: #platform-oncall

   ## Post-mortem Template

   If this deployment caused an incident, open a post-mortem within 24 hours:
   - What changed (version, config, infrastructure)?
   - What broke and when was it detected?
   - How was it mitigated?
   - What would have prevented it?
   ```

4. **Write the Incident Response runbook** with severity-scaled scope:

   - **Sev 1**: immediate page-all, war room link, 5-minute updates to status page, executive comms template, RCA required within 24 hours
   - **Sev 2**: page on-call, 15-minute updates, customer segment notification template, RCA required within 48 hours
   - **Sev 3**: on-call aware, no customer comms unless > 30 minutes, RCA optional

5. **Write the On-Call Handoff runbook** with:
   - Current open incidents and their status
   - Pending deployments and their risk level
   - Known flaky alerts to ignore (and the Jira/GitHub issue tracking the fix)
   - Escalation contacts for the next shift
   - Handoff confirmation checklist (outgoing confirms each item before signing off)

## Output Format

```
## Runbook Generator — Output

Service: myapp
Runbooks generated: Deployment, Rollback, Incident Response (Sev 1 / Sev 2 / Sev 3)

Files written:
  docs/runbooks/deploy-production.md
  docs/runbooks/rollback-production.md
  docs/runbooks/incident-response-sev1.md
  docs/runbooks/incident-response-sev2.md
  docs/runbooks/incident-response-sev3.md

### Populated from project config

| Field | Source | Value |
|---|---|---|
| Deploy command | scripts/deploy.sh | kubectl set image ... |
| Image registry | .github/workflows/ci.yml | registry.example.com/myapp |
| K8s namespace | k8s/deployment.yaml | production |
| Health endpoint | src/routes/health.ts | /health |
| Grafana dashboard | README.md | https://grafana.example.com/d/api-overview |

### Fields Requiring Manual Population

- [ ] Escalation contact names and PagerDuty policies
- [ ] Backup S3 bucket path (not found in project files)
- [ ] Status page URL (not found in project files)

### Next Steps

1. Review each runbook and fill in the [ ] manual population items above.
2. Share with the team for a dry-run walkthrough before the next deployment.
3. Link runbooks from README.md under "Operations" section.
4. Schedule a quarterly review to keep commands and contacts current.
```

## Constraints

- Runbooks are populated with commands inferred from project files — if a required command is not found, the field is left as `<TODO: fill in>` with a note in the "Manual Population" list.
- The skill writes to `docs/runbooks/` by default — override the output path if the project uses a different documentation structure.
- Verification steps use concrete success criteria (exit codes, metric thresholds, response content) — never "verify it looks right"; vague verification is useless under incident stress.
- Incident response runbooks are severity-classified; the correct runbook for the severity must be executed — using the Sev-3 runbook for a Sev-1 incident will under-escalate and delay resolution.
- Runbooks have an `Last updated` date — schedule quarterly reviews; a runbook that has not been reviewed in 12 months should be treated as untrusted until re-verified.
