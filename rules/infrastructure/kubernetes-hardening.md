---
last_reviewed: 2026-05-26
version_target: ">=0.2.0"
---

# Kubernetes Hardening Rules

Security hardening practices for Kubernetes manifests and cluster configuration.

- **Enforce Pod Security Standards at namespace level.** Apply `pod-security.kubernetes.io/enforce: restricted` (or at minimum `baseline`) to namespaces via namespace labels. Restricted disallows privilege escalation, host namespaces, and most volume types — this is the correct baseline for production workloads.
- **Set `runAsNonRoot: true` and `readOnlyRootFilesystem: true` in securityContext.** These two fields alone block a large class of container escape paths. Pair with `allowPrivilegeEscalation: false` and `capabilities: drop: [ALL]` to reach a minimal privilege footprint.
- **Define CPU and memory requests and limits on every container.** Containers without limits can consume all node resources and trigger OOM kills on neighbors. Set realistic requests (for scheduling) and limits (for isolation); treat missing limits as a deployment blocker.
- **Deploy a NetworkPolicy default-deny and explicitly allow required flows.** The default Kubernetes network model is allow-all. Create a deny-all ingress and egress NetworkPolicy in each namespace, then add minimal allow rules for each service's actual traffic pattern.
- **Avoid `hostPath`, `hostNetwork`, and `hostPID`.** These volume and namespace fields share host resources directly with the container, bypassing pod isolation. They are almost never required in application workloads and are prohibited under the restricted Pod Security Standard.
- **Apply RBAC least-privilege.** Every ServiceAccount should have only the permissions it provably needs. Audit with `kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa>`. Avoid ClusterRoles and `*` verbs; prefer namespace-scoped Roles with explicit resource lists.
- **Mount secrets as files, not environment variables.** Secrets mounted as env vars appear in process listings, crash dumps, and debug logs. Mount them as volumes at a restricted path (`/run/secrets/`) with `defaultMode: 0400`.
- **Define resource quotas and LimitRanges per namespace.** ResourceQuotas prevent a single namespace from consuming the entire cluster. LimitRanges set default requests/limits for pods that omit them, ensuring the requests/limits rule above is always satisfied.
- **Enable audit logging at the API server level.** Configure the kube-apiserver `--audit-policy-file` to log at least `Metadata` for all resources and `Request` for secrets, configmaps, and roles. Audit logs are the primary forensic source for compromise detection.
- **Use an ImagePolicyWebhook or OPA/Gatekeeper to enforce image policies.** Block unsigned, unscanned, or non-registry images at admission time. Policies should enforce registry allowlist, cosign signature presence, and maximum image age for production namespaces.
