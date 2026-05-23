# Contract Reference — lilara.contract.json

The contract pre-agrees all security permissions before agent work begins. It is the machine-readable answer to: "what is this agent allowed to do in this project?"

## Quick Start

```bash
# 1. Generate a draft (inspects project, languages, branches)
lilara-cli.sh contract init

# 2. Review and edit lilara.contract.json.draft

# 3. Accept — computes hash, writes final file
lilara-cli.sh contract accept

# 4. Verify at any time
lilara-cli.sh contract verify

# 5. See what's in the contract
lilara-cli.sh contract show

# 6. Amend (bumps revision, requires re-accept)
lilara-cli.sh contract amend
lilara-cli.sh contract accept
```

## Full Schema

```jsonc
{
  "$schema": "schemas/lilara.contract.schema.json",
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
  // In strict mode (LILARA_CONTRACT_REQUIRED=1), unlisted harnesses are blocked for gated classes.
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

When `LILARA_CONTRACT_REQUIRED=1`, these command classes are blocked unless the contract explicitly allows them:

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
1. Load `lilara.contract.json`
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
| `LILARA_KILL_SWITCH=1` | block (unconditional) |
| Critical risk (score 10) | block |
| Secret payload class C | block |
| Contract hash mismatch (strict) | block |
| Harness out of scope (strict) + gated class | block |
| Novel command class | escalate |
| Scope violation | escalate |
| Protected branch write | require-review |
| Session risk ≥ 3 | escalate |

Attempting to set a floor to a weaker action in `lilara.contract.json` fails schema validation.

## Amend Flow

1. `lilara-cli.sh contract amend` — copies accepted contract to a new draft, bumps `revision`
2. Edit the draft
3. `lilara-cli.sh contract accept` — re-hashes, verifies revision is higher than current, writes and records
4. Previous contract stays in force during the draft window

Downgrade (lower `revision`) is rejected. Every amend bumps monotonically.

## Operator Token Flow (B3)

`lilara-cli.sh contract accept` requires a **positive operator signal** to run. Without one the command errors immediately. Two paths:

### (a) Interactive terminal (default)

Run `lilara-cli.sh contract accept` from an interactive shell. `stdin.isTTY` is true → gate passes.

### (b) Non-interactive / CI context

Mint a one-shot token from an interactive session first, then pass it to the non-interactive call:

```bash
# In your interactive terminal:
lilara-cli.sh operator-token mint ci-deploy
# → Token: <64-hex-chars>
# → Usage: LILARA_OPERATOR_TOKEN=<token> lilara-cli.sh contract accept

# In CI / automation:
LILARA_OPERATOR_TOKEN=<token> lilara-cli.sh contract accept
```

Tokens are stored in `~/.lilara/operator-tokens.jsonl` (mode 0600). Each token is consumed on first use; a second use returns "invalid or already consumed" and the accept call fails.

### Token management

| Command | Description |
|---|---|
| `lilara-cli.sh operator-token mint [label]` | Mint a fresh one-shot token (with optional label) |
| `lilara-cli.sh operator-token verify <token>` | Check validity without consuming |

### Security rationale

The old `accept()` checked that none of the known harness session env vars were present ("defense by absence"). Novel harnesses whose env var was not in the allowlist bypassed this check silently (Q2 problem). The positive-signal model inverts this: **all non-TTY accept calls are denied unless a valid one-shot token is presented**. There is no env-var allowlist to bypass.

---

## v2 — Validity Windows

`validity.activeHoursUtc` and `validity.activeDays` constrain when contract-allow demotions
take effect. When the current UTC time is outside the window OR the current UTC weekday is
not in `activeDays`:

- Payload classes set to `"warn"` or `"block"` in `scopes.payloadClasses` are blocked
  (F11 floor; `decisionSource: "validity-outside-window"`, `floorFired: "validity-window"`).
- Payload classes set to `"allow"` (default for A; configurable for B/C) get a
  `validityWarning: { code: "outside-window", reason }` annotation on the decision return
  + journal entry; action unchanged.
- A window with `start > end` is interpreted as crossing midnight UTC.

```json
"validity": {
  "activeHoursUtc": { "start": "09:00", "end": "18:00" },
  "activeDays": ["mon", "tue", "wed", "thu", "fri"]
}
```

## v2 — ContextTrust Per-Branch Override

`contextTrust` is an array of `{branchPattern, trustPosture}` entries. Order semantics
quoted verbatim from `schemas/lilara.contract.schema.json`:

> *"v2: Per-branch trust posture overrides. Entries are evaluated in order; first match wins.
> Falls back to top-level trustPosture if no entry matches."*

The first entry whose glob matches the current branch overrides the project-default
trust posture (`lilara.config.json` `runtime.trust_posture`). Affects risk-score posture
adjustment only — does not modify scopes or floors.

**Authors must order entries from most-specific to least-specific.** The runtime evaluates
in list order and does not compute glob specificity. `branchPattern` uses the same glob
syntax as `forcePushAllow` and `protected`.

```json
"contextTrust": [
  { "branchPattern": "feature/security/*", "trustPosture": "strict"  },
  { "branchPattern": "feature/*",          "trustPosture": "relaxed" },
  { "branchPattern": "main",               "trustPosture": "strict"  }
]
```

## v2 — scopes.tools.perToolAllow

Per-tool allowlists provide explicit pre-approval for specific tool + command + path
combinations. Each entry matches when `input.tool === entry.tool`; optional
`commandGlobs` and `pathGlobs` further constrain the match (omitted = unconstrained).
On match, the decision source is `contract-allow-tool-scope` (distinct from the W11
`contract-allow` source), and the W11 escalate→allow carve-out applies.

`perToolAllow` is **additive**: an entry can grant an explicit allow path but cannot make
the general scope deny. To restrict per-tool, combine with restrictive general scope.

```json
"scopes": {
  "tools": {
    "perToolAllow": [
      { "tool": "Bash", "commandGlobs": ["npm *", "node *"] },
      { "tool": "Edit", "pathGlobs":    ["docs/**", "tests/**"] }
    ]
  }
}
```

---

## v3 — scopes.mcp

Per-MCP-server access policy. Key is the server name; value is `{ policy: "allow" | "warn" | "block" }`.

Server name is extracted from the tool name using the `mcp__<server>__<tool>` convention (regex `^mcp__([^_]+(?:_[^_]+)*?)__`). If `input.mcpServer` is explicitly set, that takes precedence.

- `block` → F12 hard floor: `buildEarlyBlock("mcp-deny", ...)`. Fires before risk scoring.
- `warn` → `mcpWarning` annotation attached to the decision result and journal entry; action unchanged.
- `allow` or absent entry → no effect.

```json
"mcp": {
  "context7":       { "policy": "allow" },
  "computer-use":   { "policy": "warn"  },
  "unknown-server": { "policy": "block" }
}
```

**Edge cases:**
- Server name is case-sensitive and must match the `mcp__<name>__` prefix exactly.
- If the tool name does not match `mcp__…__` and `input.mcpServer` is absent, F12 silently no-ops.
- `warn` policy does not change the decision action. It is informational only.

---

## v3 — scopes.skills

Per-skill access policy. Key is the skill name (as passed in `input.skillName`); value is `{ policy: "allow" | "warn" | "block" }`.

- `block` → F13 hard floor: `buildEarlyBlock("skill-deny", ...)`. Fires after F12.
- `warn` → `skillWarning` annotation; action unchanged.
- `allow` or absent entry → no effect.

```json
"skills": {
  "superpowers:writing-plans": { "policy": "allow" },
  "dangerous-skill":           { "policy": "block" }
}
```

**Edge cases:**
- Skill name is taken directly from `input.skillName`. If that field is absent, F13 silently no-ops.
- The colon separator in skill names (e.g. `superpowers:writing-plans`) is treated as a regular character — no namespace matching.

---

## v3 — scopes.session

Session duration limit. When the session age exceeds `maxDurationMin`, the decision is escalated to `require-review` (D47 — operator declared "after N minutes, stop and ask me").

```json
"session": {
  "maxDurationMin": 480
}
```

- Session age is computed from `startTime` in `~/.lilara/session-budget/<session-id>.json`. The first `getCounters` call for a session persists `startTime = Date.now()`.
- When age > limit: `action = "require-review"`, `source = "session-over-duration"`. `sessionDurationWarning` annotation is also attached (`{ code, ageMin, limitMin }`).
- The escalation is asserted **after** all demotion blocks (contract-allow, auto-allow-once, trajectory-nudge), so it cannot be silently undone. Same pattern as F10 taint-floor.
- This is not a hard block — the operator reviews and decides. Use `scopes.budget.maxDestructiveOps` if you need a hard stop.

---

## v3 — scopes.budget

Hard caps on session-scoped quantities. When either counter equals or exceeds its limit at decide-time, the decision is hard-blocked (F14 `buildEarlyBlock("budget-exceeded", ...)`).

```json
"budget": {
  "maxDestructiveOps": 50,
  "maxExternalBytes":  10485760
}
```

- `maxDestructiveOps` — incremented after each `allow` on a `destructive-delete`-class command. Checked at the start of the next `decide()` call.
- `maxExternalBytes` — incremented via `recordExternalBytes(bytes, { sessionId })`. Not yet wired to an automatic source; operators or future work can call this API directly.
- Counters live at `~/.lilara/session-budget/<session-id>.json` (mode 0600, atomic writes).

**Edge cases:**
- Counters are per-session-id. If `sessionId` is absent from the input, F14 silently no-ops (no counter read or write).
- The budget check fires **before** risk scoring. A budget-exceeded block cannot be demoted by contract-allow or any other rung.
- `maxDestructiveOps: 0` blocks the first destructive-delete (0 >= 0). Set to 1 to allow exactly one.

---

## v3 — Migrating from v2

```bash
node scripts/migrateV2ToV3.js [input] [output.draft]
```

- `input` defaults to `lilara.contract.json` in the current directory.
- `output` defaults to `lilara.contract.json.draft` in the current directory.
- The tool validates the input as v1 or v2, sets `version: 3`, recomputes `contractHash`, and writes the draft.
- **Never overwrites the live `lilara.contract.json`**. Refuses to overwrite an existing `.draft` file.
- **Idempotent**: running on a v3 file exits 0 with "already version 3, no migration needed" on stderr and writes no output.
- The draft leaves `scopes.mcp`, `scopes.skills`, `scopes.session`, and `scopes.budget` absent — opt in by editing the draft before accepting.

After migration:

```bash
# 1. Review the draft
cat lilara.contract.json.draft

# 2. Edit to add v3 fields as desired (optional)
# ...

# 3. Accept to finalize
lilara-cli.sh contract accept
```
