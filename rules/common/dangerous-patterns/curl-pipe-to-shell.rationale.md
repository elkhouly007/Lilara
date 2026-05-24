---
pattern_id: curl pipe to shell
pattern_source: claude/hooks/dangerous-patterns.json
severity: critical
---

# curl pipe to shell — Rationalization Defense

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "It's the official installation method from the project's README." | Official READMEs recommend curl-pipe-bash for convenience, not security. Many major supply-chain attacks (SolarWinds, XZ Utils, PyPI compromises) operated through packages distributed through "official" channels. The installer cannot be reviewed in the pipe. |
| "The URL is HTTPS — it's authenticated." | HTTPS authenticates the connection to the server, not the content of what the server returns. If the server is compromised, or the CDN is poisoned, or the DNS is hijacked, you receive malicious code over a valid TLS connection. |
| "I've used this script before and it was fine." | Supply-chain compromise can happen at any time between runs. The content at the URL is not version-pinned unless you pin it explicitly (by hash). |
| "The script just installs a package — I can read the URL." | Reading the URL tells you where the script lives, not what it contains at the moment you run it. The content can change between your `curl` and your pipe to `bash`. |
| "This is a trusted open-source project." | Open-source projects have had their distribution infrastructure compromised. Maintainer accounts have been hijacked. "Trusted" is a property of the version you audited, not of all future versions. |

## Red Flags (STOP thoughts)

- "It's the official way to install it."
- "The HTTPS URL means it's secure."
- "I've run this script many times before."
- "It's open-source, so it's safe."
- "The README recommends this method."

## Why this pattern is here

Curl-pipe-to-bash is the single most cited supply-chain attack vector in
agentic security research. It combines three compounding risks:

1. **No pre-execution review** — the shell receives code immediately as bytes
   stream in from the network; there is no opportunity to inspect it.
2. **Ambient privilege** — in many environments the agent runs as the repo
   owner or with elevated CI privileges; the piped code inherits all of those.
3. **No audit trail** — the agent's decision journal records the command, but
   the content of what ran is not logged unless the operator adds extra machinery.

Cited in OWASP Agentic Security ASI01 (Prompt Injection via External Content)
and the NIST SP 800-218 Secure Software Development Framework.

## Safer alternative

```bash
# Step 1: download to a file (no execution)
curl -fsSL https://install.example.com/setup.sh -o /tmp/setup.sh

# Step 2: review the content before running
cat /tmp/setup.sh | head -50
# Or: open in an editor, grep for suspicious patterns, check shasum

# Step 3: verify the checksum if the project provides one
sha256sum /tmp/setup.sh
# Compare against the published hash on the project's release page

# Step 4: execute explicitly (requires separate operator approval)
bash /tmp/setup.sh

# Alternative: use a package manager with lockfile verification
npm ci       # respects package-lock.json with integrity hashes
pip install --require-hashes -r requirements.txt
```
