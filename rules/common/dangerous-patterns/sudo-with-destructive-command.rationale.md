---
pattern_id: sudo with destructive command
pattern_source: claude/hooks/dangerous-patterns.json
severity: critical
---

# sudo with destructive command — Rationalization Defense

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "The operation requires root — it won't work otherwise." | If an operation requires root, it is outside normal user-space scope. This is a signal to request operator approval, not to proceed with `sudo`. The requirement for root is the risk indicator, not an excuse to bypass the gate. |
| "I've used `sudo rm` in this environment before and it was fine." | Prior approvals for sudo do not transfer to new commands or new contexts. Each `sudo` + destructive-command combination is a distinct action that requires independent approval. |
| "The script already uses `sudo` throughout — this is consistent." | Consistency with other uses of `sudo` in a script is not a safety argument. It means the entire script deserves elevated scrutiny, not that additional `sudo` uses should be normalized. |
| "I'm running in a container with passwordless sudo — it's safe." | Passwordless sudo in a container is a deployment shortcut, not a security indicator. The absence of a password prompt does not change the blast radius of the command. |

## Red Flags (STOP thoughts)

- "The operation needs root to work."
- "I've done `sudo rm` before in this project."
- "The whole script uses sudo — this is consistent."
- "The container has passwordless sudo, so it doesn't matter."
- "I need elevated privileges to clean up properly."

## Why this pattern is here

This pattern matches specifically `sudo` combined with destructive commands
(`rm`, `dd`, `mkfs`, `fdisk`, `parted`, `wipefs`, `shred`). It is a second
layer of defense — the individual destructive command patterns may not catch
all invocations, but the `sudo` + command combination is a reliable signal
that an elevated destructive operation is about to occur.

Elevated privileges expand the blast radius of any destructive operation from
user-space scope to system-wide scope. `sudo rm -rf /tmp/foo` failing due to
permissions is a recoverable error; `sudo rm -rf /` is not.

## Safer alternative

```bash
# For cleanup tasks: avoid sudo entirely by using user-writable paths
rm -rf /tmp/my-app-artifacts-$(id -u)/   # user's own temp files

# For system-level operations: use a provisioner or init system
# (run by a human or a dedicated infra tool, not the AI agent)
ansible -m file -a "path=/etc/app state=absent" servers

# If sudo is truly required: request explicit operator approval and
# document the specific command and its purpose in the Lilara envelope
lilara-cli.sh envelope set "Remove legacy config: sudo rm -f /etc/app/legacy.conf"
# Then the force-push / envelope-divergence floor (F20) will catch deviations
```
