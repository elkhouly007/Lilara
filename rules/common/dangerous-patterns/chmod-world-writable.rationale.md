---
pattern_id: chmod world-writable
pattern_source: claude/hooks/dangerous-patterns.json
severity: high
---

# chmod world-writable (777) — Rationalization Defense

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "I need the web server to be able to write to the directory." | The correct fix is to set ownership (`chown www-data:www-data /var/www/uploads`) and group-write permissions (`chmod 775`). World-writable permissions allow *any* process on the system to write there — including other web applications, cron jobs, and attackers who have gained any foothold. |
| "It's just a temporary fix to unblock the deployment." | Temporary fixes become permanent when the deployment succeeds and no one revisits them. The "temporary" `chmod 777` on `/var/log/app` is the one that gets exploited six months later. |
| "This is a development machine — security doesn't matter." | Development machines contain real credentials, git remotes, SSH keys, and production configs in `.env` files. A world-writable path on a dev machine that is git-pushed to a shared environment propagates the permission. |
| "I already set 777 on the parent directory." | Compound permissions errors do not cancel each other out. Adding more world-writable paths expands the attack surface. |

## Red Flags (STOP thoughts)

- "It's just dev / staging / a temporary environment."
- "The web server needs write access — this is the quick fix."
- "I'll fix the permissions properly later."
- "The directory already has loose permissions."

## Why this pattern is here

`chmod 777` (or `chmod a+w`, `chmod 0777`) makes a file or directory writable
by every process on the system. This is the textbook privilege-escalation
setup: an attacker with any foothold on the system can write to world-writable
paths, inject code into writable scripts, or plant files for a setuid binary
to pick up.

OWASP A01:2021 (Broken Access Control) specifically cites world-writable
filesystem paths as a contributing factor in privilege escalation chains.

## Safer alternative

```bash
# Correct: set ownership to the service user, group-write for the deployment group
chown -R www-data:deploy /var/www/uploads
chmod -R 775 /var/www/uploads   # owner+group write, no world-write

# For a script that needs to be executable: use +x without world-write
chmod 755 deploy.sh   # owner writes, everyone executes (no world-write)

# Verify what permissions are actually needed before changing them
ls -la /var/www/uploads   # see current permissions
stat /var/www/uploads     # see owner, group, and mode

# For temporary shared directories in CI: use a group-scoped directory
mkdir -m 770 /tmp/ci-shared && chown ci:ci /tmp/ci-shared
```
