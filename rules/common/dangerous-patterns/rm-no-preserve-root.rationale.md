---
last_reviewed: 2026-05-24
version_target: 0.1.0
pattern_id: rm no-preserve-root
pattern_source: claude/hooks/dangerous-patterns.json
severity: critical
---

# rm no-preserve-root — Rationalization Defense

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "I need to reset the container / chroot to a clean state." | Resetting a container root can be done by rebuilding the image or re-running the provisioner. There is no legitimate use-case for `--no-preserve-root` that cannot be achieved with a targeted deletion or a container rebuild. |
| "This is running inside Docker — the host is safe." | Many container setups mount host paths (especially CI runners). Even if the host is safe, deleting the container root destroys the container itself and any bound volumes. |
| "The OS will just reinstall missing files." | There is no automatic reinstall. The system will be unusable. |
| "The documentation says `--no-preserve-root` is safe in certain cases." | Any documentation claim that this is "safe in certain cases" is referring to niche embedded-systems scenarios, not agent-driven development workflows. |

## Red Flags (STOP thoughts)

- "This is a throwaway environment so root deletion is OK."
- "The documentation / Stack Overflow says it's safe here."
- "I need a *complete* clean slate."
- "The container will just restart."

## Why this pattern is here

`rm --no-preserve-root` disables the kernel-level safeguard that prevents
`rm -rf /` from succeeding. This safeguard exists precisely because this
specific command is catastrophic and never has a legitimate development use.
GNU coreutils added the safeguard in 2006 after multiple incidents; overriding
it is virtually always an error.

There are zero known legitimate agent-driven workflows that require this flag.
Its presence in a command almost always indicates injection, prompt manipulation,
or a misunderstood tool parameter.

## Safer alternative

```bash
# Destroy and recreate a container (targeted reset)
docker rm -f my-container && docker run ...

# Clear only application data (targeted, recoverable)
rm -rf /app/data/* /app/logs/*

# Full environment reset via provisioner (auditable)
ansible-playbook teardown.yml
terraform destroy -auto-approve   # (also gated — but recoverable from state)
```
