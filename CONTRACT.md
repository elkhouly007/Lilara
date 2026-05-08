# Contract Reference — horus.contract.json

The contract pre-agrees all security permissions before agent work begins. It is the machine-readable answer to: "what is this agent allowed to do in this project?"

## Quick Start

```bash
# 1. Generate a draft (inspects project, languages, branches)
horus-cli.sh contract init

# 2. Review and edit horus.contract.json.draft

# 3. Accept — computes hash, writes final file
horus-cli.sh contract accept

# 4. Verify at any time
horus-cli.sh contract verify

# 5. See what's in the contract
horus-cli.sh contract show

# 6. Amend (bumps revision, requires re-accept)
horus-cli.sh contract amend
horus-cli.sh contract accept
```

## Full Schema

```jsonc
{
  "$schema": "schemas/horus.contract.schema.json",
  "version": 1,

  // Unique ID: "arg-" + YYYYMMDD + "-" + 12 random hex chars
  "contractId": "arg-20260425-a7b2f1c3d4e5",

  // Monotonic. Downgrade (lower revision) is rejected on accept.
  "revision": 1,

  "acceptedAt": "2026-04-25T12:00:00Z",
  "acceptedBy": "user@host",     // informational only

  // null = never expires
  "expiresAt": null,

  // Which harnesses this contract covers.
  // In strict mode (HORUS_CONTRACT_REQUIRED=1), unlisted harnesses are blocked for gated classes.
  "harnessScope": ["claude", "opencode", "openclaw"],

  // relaxed | balanced | strict
  "trustPosture": "balanced",

  "scopes": {
    "filesystem": {
      // Glob patterns. ${projectRoot} is substituted at runtime.
      "readAllow": ["${projectRoot}/**"],
      "writeAllow": ["${projectRoot}/src/**", "${projectRoot}/tests/**"],
      "writeDeny":  ["**/.env*", "**/*.pem", "**/secrets/**"],

      // Per-class destructive allows. All-or-nothing: if any target escapes all globs, block.
      "destructiveAllow": [
        { "commandClass": "destructive-delete", "pathGlob": "${projectRoot}/build/**" },
        { "commandClass": "destructive-delete", "pathGlob": "${projectRoot}/dist/**" }
      ]
    },

    "network": {
      // Hostname allowlist. "*" blocks all outbound.
      "outboundAllow": ["registry.npmjs.org", "pypi.org", "github.com"],
      "outboundDeny":  ["*"],

      // Commands allowed to execute on remote hosts (ssh, docker exec, etc.)
      "remoteExecAllow": []
    },

    "secrets": {
      // "block" = hard-block on class-C secret patterns (floor; cannot be set to "off")
      // "warn"  = warn only
      "scanMode": "block",

      // Redact matched values before writing to decision journal
      "redactInJournal": true,

      // Exempt paths from secret scanning (e.g. test fixtures with fake keys)
      "allowSecretLikeInFiles": ["tests/fixtures/**/*.fake-key"]
    },

    "elevation": {
      "sudoAllow": false,
      // Explicit command allowlist when sudoAllow=true
      "sudoAllowCommands": []
    },

    "branches": {
      // Exact names and glob patterns for protected branches
      "protected": ["main", "master", "release/*"],

      // Push is allowed to these branches without require-review
      "pushAllow": ["feature/*", "fix/*"],

      // Force-push is allowed to these branches
      "forcePushAllow": []
    },

    "shell": {
      // Tools that may be invoked (Bash commands)
      "toolAllow": ["git", "npm", "node", "pytest", "rg", "jq"],
      "toolDeny":  ["curl", "wget", "nc", "ssh"],

      // false = global package installs (npm -g, pip install --user) are blocked
      "globalInstallAllow": false
    },

    "payloadClasses": {
      // A = allow, B = warn, C = block (cannot be set to "off" — floor)
      "A": "allow",
      "B": "warn",
      "C": "block"
    }
  },

  // SHA-256 hash of all fields above, excluding contractHash itself.
  // Computed over canonical JSON (keys sorted recursively).
  // Verified on every decide() call.
  "contractHash": "sha256:..."
}
```

## Gated Capability Classes

When `HORUS_CONTRACT_REQUIRED=1`, these command classes are blocked unless the contract explicitly allows them:

| Class | Examples |
|---|---|
| `destructive-delete` | `rm -rf`, `shred`, `dd of=`, `mkfs` |
| `force-push` | `git push --force`, `--force-with-lease` |
| `remote-exec` | `curl ... \| sh`, `wget ... \| bash` |
| `auto-download` | `npx -y`, `npm i -g`, `pip install` |
| `hard-reset` | `git reset --hard` |
| `destructive-db` | `DROP TABLE`, `DROP DATABASE` |
| `disk-write` | `dd of=<device>` |
| `sudo` | Any `sudo`-prefixed command |
| `global-pkg-install` | `npm -g`, `pip install --user` (when globalInstallAllow=false) |
| `unknown` | Command the classifier cannot place — fail closed |

Low-risk read and safe-write operations proceed without a contract even in strict mode.

## Hash Verification

On every `decide()` call:
1. Load `horus.contract.json`
2. Look up `accepted-contracts.json` for the current `projectRoot`
3. Recompute `sha256(canonicalJson(contractWithoutHash))`
4. If hash mismatches the accepted record → block gated classes (strict) or log warning (default)

If the contract file is missing but strict mode is active → block all gated classes.

## Scope Matching Algorithm

1. Classify `input.command` → `commandClass`
2. Extract argument targets via `runtime/arg-extractor.js`
3. Resolve each target with `path.resolve(projectRoot, arg)` + `fs.realpathSync`; on error → deny
4. Reject `..` escape after resolve; reject absolute paths outside `projectRoot`
5. For each matching scope entry, test every target against the path glob
6. **All-or-nothing**: if even one target escapes every allowed glob → scope violation

## Floors That Contracts Cannot Override

These actions are engine-baked and cannot be demoted by any contract-allow:

| Floor | Action |
|---|---|
| `HORUS_KILL_SWITCH=1` | block (unconditional) |
| Critical risk (score 10) | block |
| Secret payload class C | block |
| Contract hash mismatch (strict) | block |
| Harness out of scope (strict) + gated class | block |
| Novel command class | escalate |
| Scope violation | escalate |
| Protected branch write | require-review |
| Session risk ≥ 3 | escalate |

Attempting to set a floor to a weaker action in `horus.contract.json` fails schema validation.

## Amend Flow

1. `horus-cli.sh contract amend` — copies accepted contract to a new draft, bumps `revision`
2. Edit the draft
3. `horus-cli.sh contract accept` — re-hashes, verifies revision is higher than current, writes and records
4. Previous contract stays in force during the draft window

Downgrade (lower `revision`) is rejected. Every amend bumps monotonically.

## Operator Token Flow (B3)

`horus-cli.sh contract accept` requires a **positive operator signal** to run. Without one the command errors immediately. Two paths:

### (a) Interactive terminal (default)

Run `horus-cli.sh contract accept` from an interactive shell. `stdin.isTTY` is true → gate passes.

### (b) Non-interactive / CI context

Mint a one-shot token from an interactive session first, then pass it to the non-interactive call:

```bash
# In your interactive terminal:
horus-cli.sh operator-token mint ci-deploy
# → Token: <64-hex-chars>
# → Usage: HORUS_OPERATOR_TOKEN=<token> horus-cli.sh contract accept

# In CI / automation:
HORUS_OPERATOR_TOKEN=<token> horus-cli.sh contract accept
```

Tokens are stored in `~/.horus/operator-tokens.jsonl` (mode 0600). Each token is consumed on first use; a second use returns "invalid or already consumed" and the accept call fails.

### Token management

| Command | Description |
|---|---|
| `horus-cli.sh operator-token mint [label]` | Mint a fresh one-shot token (with optional label) |
| `horus-cli.sh operator-token verify <token>` | Check validity without consuming |

### Security rationale

The old `accept()` checked that none of the known harness session env vars were present ("defense by absence"). Novel harnesses whose env var was not in the allowlist bypassed this check silently (Q2 problem). The positive-signal model inverts this: **all non-TTY accept calls are denied unless a valid one-shot token is presented**. There is no env-var allowlist to bypass.
