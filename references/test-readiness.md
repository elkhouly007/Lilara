# Test-Readiness Guide — Lilara 0.1.9

**For:** Khouly's own hands-on testing session.
**Companion doc:** [`references/lilara-contract.md`](lilara-contract.md) — what to test against.
**Time to first fire:** ~10 minutes on a fresh clone.

---

## ⚠️ Read this first — the single biggest landmine

> **Lilara hooks are warn-only by default. Set `LILARA_ENFORCE=1` in your shell
> to make them block. Without it, nothing is blocked — you'll see warnings only.**

```sh
export LILARA_ENFORCE=1
```

Repeat: set this before testing. If a command you expect to be blocked is allowed,
check `LILARA_ENFORCE` first — 9 times out of 10, that's the cause.

---

## Step 1 — Clone (if not already done)

```sh
git clone https://github.com/elkhouly007/Lilara.git
cd Lilara
```

No npm install. No build step. No dependencies. The zero-dep constraint is enforced
by `scripts/check-zero-deps.sh` in CI. Node.js is the only runtime requirement.

---

## Step 2 — Verify the engine is healthy

```sh
bash scripts/lilara-cli.sh check
```

This runs ~50 gates in under 30 seconds. All should pass on master. If any fail,
do not proceed — diagnose first.

**Known MINGW64/Git Bash note (Windows):** If `check` hangs at the Dashboard
section, you may be on a pre-PR#137 version. Update to `dfe6fc4+` or run
individual gates (`bash scripts/check-dashboard.sh`, etc.) directly.

---

## Step 3 — Verify the engine fires (no harness required)

The `sandbox` subcommand dry-runs any command through `decide()` without writing
to the journal or touching hooks. It's the fastest way to confirm the engine works.

**⚠️ Set `LILARA_ENFORCE=1` BEFORE running smoke tests:**

```sh
export LILARA_ENFORCE=1
export LILARA_STATE_DIR=$(mktemp -d)   # fresh session, no accumulated risk
```

Run these smoke tests:

```sh
# F3 — critical-risk block
bash scripts/lilara-cli.sh sandbox "rm -rf /"
# Expected: action=block  floorFired=critical-risk  riskScore=10 (critical)

# F4 — secret-class-C block
bash scripts/lilara-cli.sh sandbox "echo ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
# Expected: action=block  floorFired=secret-class-C  code=F4_SECRET_CLASS_C

# F1 — kill-switch
LILARA_KILL_SWITCH=1 bash scripts/lilara-cli.sh sandbox "git status"
# Expected: action=block  floorFired=kill-switch  (even for a safe command)

# An allowed command
bash scripts/lilara-cli.sh sandbox "ls -la"
# Expected: action=allow  (no floor fired)
```

If these return the expected values, the engine is working. Done — the engine
fires correctly without any harness wiring.

---

## Step 4 — Wire into Claude Code (for live harness testing)

> This step wires Lilara's hooks into Claude Code so real tool calls go through
> `decide()` during a live coding session. Steps 1-3 already proved the engine
> works — this step proves the install path is unbroken.

### 4a — Install into your project

```sh
# From inside the Lilara repo:
bash scripts/lilara-cli.sh install /path/to/your/project --profile rules --auto
```

This copies `claude/hooks/`, `runtime/` (decision engine), `schemas/` (JSON schemas
read at runtime), `scripts/`, and other Lilara files into the target project. State
(`~/.lilara/`) is never touched. The script prints a hook snippet at the end — keep
that terminal output; you'll need it in step 4b.

**Profiles:**
- `minimal` — secret-warning + dangerous-command-gate only (fewest hooks)
- `rules` — minimal + quality-gate + git reminders (recommended for testing)
- `agents` — adds multi-agent coordination
- `full` — everything

### 4b — Generate the wire snippet

```sh
cd /path/to/your/project
bash scripts/wire-hooks.sh
```

This prints a JSON snippet with absolute paths pre-filled. The script deliberately
does **not** auto-write `settings.json` — you paste it manually.

**Verify paths before pasting:**
```sh
bash scripts/wire-hooks.sh --check    # detect stale /ABS_PATH/ placeholders
bash scripts/wire-hooks.sh --verify   # dry-run each hook against empty stdin
```

### 4c — Paste into `~/.claude/settings.json`

Open `~/.claude/settings.json` and merge the snippet under the `"hooks"` key.
The structure looks like:

```json
{
  "hooks": {
    "PreToolUse": [ ... ],
    "PostToolUse": [ ... ],
    "SessionStart": [ ... ],
    "Stop": [ ... ]
  }
}
```

The full snippet from `wire-hooks.sh` contains all hook types. Copy the relevant
blocks into your existing `settings.json` (or create a new one if it doesn't exist).

### 4d — Set enforcement

**⚠️ BEFORE starting Claude Code:**

```sh
export LILARA_ENFORCE=1
```

Or add it permanently to your shell profile. Without it, hooks warn but do not
block. This is the second time this doc says this because it's the most common
reason testing looks like Lilara isn't doing anything.

---

## Step 5 — Live end-to-end smoke test

**⚠️ Confirm `LILARA_ENFORCE=1` is set in the shell that will launch Claude Code.**

Open Claude Code in your wired project. From the Claude Code terminal, attempt
a known-dangerous command:

```
run: rm -rf /tmp/test-lilara-smoke
```

With `LILARA_ENFORCE=1` active and the `dangerous-command-gate.js` hook wired,
Claude Code should receive an exit-2 block and refuse to execute the command.

To see the decision that was made:

```sh
# ⚠️ Also repeat LILARA_ENFORCE=1 here before checking:
export LILARA_ENFORCE=1
bash scripts/lilara-cli.sh journal tail --tail 5
```

You should see a line like:
```
HH:MM:SS  block   critical-risk   tool=Bash  risk=critical/10.0  [destructive-delete-pattern,...]  -> /tmp/test-lilara-smoke
```

If you see `allow` for a command you expected to be blocked, check:
1. Is `LILARA_ENFORCE=1` set? (`echo $LILARA_ENFORCE`)
2. Did the hook execute? (`bash scripts/wire-hooks.sh --verify`)
3. Is the hooks snippet in `~/.claude/settings.json` with real absolute paths
   (no `/ABS_PATH/` placeholders)?

---

## Step 6 — Observe decisions in real-time

### Terminal tail (human-readable)

```sh
bash scripts/lilara-cli.sh journal tail --tail 20
bash scripts/lilara-cli.sh journal tail --tail 5   # last 5 only
```

Output format:
```
HH:MM:SS  ACTION          FLOOR                   tool=Name  risk=LEVEL/SCORE  [reasonCodes]  -> targetPath
```

Color coding (when terminal supports it): block=red, require-review=yellow, observe=cyan, allow=green.

### HTTP dashboard (visual)

```sh
bash scripts/lilara-cli.sh dashboard
# → opens at http://127.0.0.1:7917
```

Endpoints: `/api/summary`, `/api/decisions`, `/api/coverage`, `/api/kill-chains`.
Manual refresh (click Refresh button). Not streaming — refresh to see new decisions.

### Journal integrity

```sh
bash scripts/lilara-cli.sh journal verify
```

Verifies the tamper-evident hash chain. Should return `OK (N entries)`.

---

## Step 7 — What to test against

See [`references/lilara-contract.md`](lilara-contract.md) — 10 per-floor probe
commands with expected `action`, `floorFired`, and journal-tail lines. Run each
probe with:

```sh
export LILARA_ENFORCE=1
export LILARA_STATE_DIR=$(mktemp -d)   # fresh state for each floor probe

bash scripts/lilara-cli.sh sandbox "..."   # dry-run probe
bash scripts/lilara-cli.sh journal tail --tail 1   # see the live-fire result
```

---

## Quick-reference commands

```sh
# Verify engine health
bash scripts/lilara-cli.sh check

# Full gate suite (before pushing code changes)
bash scripts/lilara-cli.sh pre-push

# Sandbox dry-run (does NOT write to journal)
export LILARA_ENFORCE=1
export LILARA_STATE_DIR=$(mktemp -d)
bash scripts/lilara-cli.sh sandbox "rm -rf /"

# See decisions in real-time
bash scripts/lilara-cli.sh journal tail --tail 10

# HTTP dashboard
bash scripts/lilara-cli.sh dashboard

# Journal integrity check
bash scripts/lilara-cli.sh journal verify

# Session summary (see accumulated risk)
bash scripts/lilara-cli.sh session summary

# Wire-up snippet
bash scripts/wire-hooks.sh
bash scripts/wire-hooks.sh --check    # detect stale paths
bash scripts/wire-hooks.sh --verify   # verify hooks run

# Emergency halt ALL tool calls
export LILARA_KILL_SWITCH=1
unset LILARA_KILL_SWITCH   # re-enable
```

---

## State location

Lilara state lives in `~/.lilara/` by default. For isolated testing:

```sh
export LILARA_STATE_DIR=$(mktemp -d)   # fresh, ephemeral state
```

Key files:
- `~/.lilara/decision-journal.jsonl` — every `decide()` call (rotates at 5 MB)
- `~/.lilara/journal-chain.jsonl` — tamper-evident hash chain
- `~/.lilara/session-context.json` — session risk, MCP injection signals, counters
- `~/.lilara/policy-store.json` — learned-allow policies

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Commands not blocked | `echo $LILARA_ENFORCE` — must be `1` |
| Hook doesn't fire | `bash scripts/wire-hooks.sh --verify`; check `~/.claude/settings.json` |
| `/ABS_PATH/` in settings | `bash scripts/wire-hooks.sh --check`; regenerate snippet |
| `journal tail` shows nothing | Check `LILARA_STATE_DIR`; check that `LILARA_DECISION_JOURNAL` is not `0` |
| `check` hangs on Dashboard | See MINGW64 note in `references/lilara-contract.md §Part 5` |
| F9 fires for everything | Session risk is ≥ 3. Use `LILARA_STATE_DIR=$(mktemp -d)` to probe with fresh state, or `lilara-cli session summary` to inspect |
