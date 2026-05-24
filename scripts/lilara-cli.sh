#!/usr/bin/env bash
# lilara-cli.sh — Unified command-line interface for Agent Runtime Guard.
#
# Consolidates 14 individual scripts into one entry point.
#
# Usage:
#   ./scripts/lilara-cli.sh <subcommand> [args...]
#   ecc <subcommand> [args...]          (if symlinked to PATH)
#
# Subcommands:
#   install     Install Agent Runtime Guard into a target project directory (one command).
#   upgrade     Upgrade an existing installation in-place, preserving lilara.config.json.
#   setup       Run the interactive onboarding wizard.
#   audit       Audit scripts and hook files for unsafe patterns.
#   check       Fast runtime + unit checks (< 30 s). No fixtures, no audit scans, no bench.
#   ci          Full CI superset: check + audit + fixtures + bench. Matches GitHub Actions.
#   contract    Manage the upfront security contract (init/accept/show/verify/diff/amend).
#   operator-token  Manage one-shot operator tokens for non-TTY contract acceptance (mint/verify).
#   fixtures    Run all fixture-based tests.
#   eval        Measure decision quality: run labeled corpus through runtime.decide(), report FP/FN rates.
#   integrity   Verify hook file SHA-256 integrity baseline.
#   status      Show counts of agents, rules, skills, hooks, scripts.
#   review      Review a payload file for security classification.
#   classify    Classify a payload file (A/B/C tier).
#   redact      Redact a payload file (print sanitised version).
#   wire        Generate a settings.json snippet for hook wiring.
#   log         Show or clear the hook event log (LILARA_HOOK_LOG=1).
#   version     Print Agent Runtime Guard version.
#   runtime     Show runtime roadmap, state, approvals, promotions, and decision explanations.
#   journal     Tamper-evident chain ops (verify) for ADR-004 hash-chained journal.
#   state       ADR-011 portable export/import of Lilara state (export/import/doctor).
#   envelope    ADR-012 declared-intent envelope (set/show/clear) for F20 drift checks.
#   snapshot    ADR-013 auto-snapshot store ops (list/show/restore/prune/doctor).
#   receipts    ADR-014 audit-grade receipts (validate/export/schema/doctor).
#   notify      ADR-015 notification routing (test/show/history).
#   sandbox     ADR-016 dry-run a command through the decision lattice; print which floors fire.
#   help        Show this help, or help for a specific subcommand.
#
# Examples:
#   lilara-cli.sh install ./my-project --profile rules --auto
#   lilara-cli.sh setup --non-interactive --target ./my-project --profile full
#   lilara-cli.sh audit
#   lilara-cli.sh check
#   lilara-cli.sh eval
#   lilara-cli.sh eval --verbose
#   lilara-cli.sh eval --max-fp-pct 5 --max-fn-pct 10
#   lilara-cli.sh redact payload.json --diff
#   lilara-cli.sh log --tail 20
#   lilara-cli.sh log --clear
#   lilara-cli.sh runtime state
#   lilara-cli.sh runtime accept 'bash|sudo|default-target|A'
#   lilara-cli.sh runtime record-approval --tool Bash --command 'sudo systemctl restart app' --target ops/service
#   lilara-cli.sh runtime promote 'bash|sudo|default-target|A'
#   lilara-cli.sh runtime explain --tool Bash --command 'sudo systemctl restart app' --target ops/service

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
scripts="${root}/scripts"

# ── colour helpers ────────────────────────────────────────────────────────────

if [ -t 1 ]; then
  BOLD="$(tput bold 2>/dev/null || printf '')"
  CYAN="$(tput setaf 6 2>/dev/null || printf '')"
  GREEN="$(tput setaf 2 2>/dev/null || printf '')"
  YELLOW="$(tput setaf 3 2>/dev/null || printf '')"
  RED="$(tput setaf 1 2>/dev/null || printf '')"
  RESET="$(tput sgr0 2>/dev/null || printf '')"
else
  BOLD="" CYAN="" GREEN="" YELLOW="" RED="" RESET=""
fi

usage() {
  sed -n '3,37p' "$0" | sed 's/^# //' | grep -v '^#'
}

die() { printf '%sError: %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# ── subcommand dispatch ───────────────────────────────────────────────────────

cmd="${1:-help}"
shift || true

case "$cmd" in

  # ── install ──────────────────────────────────────────────────────────────
  install)
    exec bash "${scripts}/install.sh" "$@"
    ;;

  # ── upgrade ──────────────────────────────────────────────────────────────
  upgrade)
    bash "${scripts}/upgrade.sh" "$@"
    # Auto-migrate legacy 4-part learned-allow keys after upgrading
    bash "${scripts}/migrate-policy-store.sh" --apply
    ;;


  # ── setup ────────────────────────────────────────────────────────────────
  setup)
    exec bash "${scripts}/setup-wizard.sh" "$@"
    ;;

  # ── audit ─────────────────────────────────────────────────────────────────
  audit)
    section() { printf '\n%s━━━ %s ━━━%s\n' "$CYAN" "$1" "$RESET"; }
    failed=0

    section "Audit local (scripts + hooks)"
    bash "${scripts}/audit-local.sh" || failed=1

    section "Audit examples (prose + GOOD blocks)"
    bash "${scripts}/audit-examples.sh" || failed=1

    section "Hook integrity"
    bash "${scripts}/verify-hooks-integrity.sh" || failed=1

    [ "$failed" -eq 0 ] && printf '\n%sAll audits passed.%s\n' "$GREEN" "$RESET" && exit 0
    printf '\n%sOne or more audits failed.%s\n' "$RED" "$RESET" >&2
    exit 1
    ;;

  # ── check ─────────────────────────────────────────────────────────────────
  check)
    section() { printf '\n%s━━━ %s ━━━%s\n' "$CYAN" "$1" "$RESET"; }
    failed=0

    # Node.js is required by several checks. Fail fast with a helpful message.
    if ! command -v node >/dev/null 2>&1; then
      printf '\n%sError: node not found on PATH.%s\n' "$RED" "$RESET" >&2
      printf 'Several checks (runtime-core, runtime-cli, hook-edge-cases, config-integration, installation) require Node.js.\n' >&2
      printf 'On this machine, Node.js is available at:\n' >&2
      printf '  /c/Users/Khouly/.lmstudio/.internal/utils/node.exe\n' >&2
      printf 'Run:  export PATH="/c/Users/Khouly/.lmstudio/.internal/utils:$PATH"\n' >&2
      printf 'then re-run:  %s check\n' "$0" >&2
      exit 2
    fi

    section "Registries"
    bash "${scripts}/check-registries.sh" || failed=1

    section "Integration smoke"
    bash "${scripts}/check-integration-smoke.sh" || failed=1

    section "Skills"
    bash "${scripts}/check-skills.sh" --errors-only || failed=1

    section "Installation"
    bash "${scripts}/check-installation.sh" || failed=1

    section "Config integration"
    bash "${scripts}/check-config-integration.sh" || failed=1

    section "Runtime core"
    bash "${scripts}/check-runtime-core.sh" || failed=1

    section "Runtime CLI"
    bash "${scripts}/check-runtime-cli.sh" || failed=1

    section "Hook edge cases"
    bash "${scripts}/check-hook-edge-cases.sh" || failed=1

    section "Apply status"
    bash "${scripts}/check-apply-status.sh" || failed=1

    section "Executables"
    bash "${scripts}/check-executables.sh" || failed=1

    section "Setup wizard"
    bash "${scripts}/check-setup-wizard.sh" || failed=1

    section "Wiring docs"
    bash "${scripts}/check-wiring-docs.sh" || failed=1

    section "Superiority evidence"
    bash "${scripts}/check-superiority-evidence.sh" || failed=1

    section "Status docs"
    bash "${scripts}/check-status-docs.sh" || failed=1

    section "Fixture count"
    bash "${scripts}/check-fixture-count.sh" || failed=1

    section "Harness support"
    bash "${scripts}/check-harness-support.sh" || failed=1

    section "OWASP coverage"
    bash "${scripts}/check-owasp-coverage.sh" || failed=1

    section "Status artifact"
    bash "${scripts}/check-status-artifact.sh" || failed=1

    section "Scenarios"
    bash "${scripts}/check-scenarios.sh" || failed=1

    section "Zero deps"
    bash "${scripts}/check-zero-deps.sh" || failed=1

    section "Count drift"
    bash "${scripts}/check-counts.sh" || failed=1

    section "Cross-harness equivalence"
    bash "${scripts}/check-cross-harness-equivalence.sh" || failed=1

    section "Contract module"
    bash "${scripts}/check-contract.sh" || failed=1

    section "Kill-switch (all 13 hooks)"
    bash "${scripts}/check-kill-switch.sh" || failed=1

    section "Pressure tests"
    bash "${scripts}/check-pressure-tests.sh" || failed=1

    if [ "$failed" -eq 0 ]; then
      printf '\n%sAll checks passed.%s\n' "$GREEN" "$RESET"
      printf 'This is the fast loop. For the full CI set (fixtures, audit, bench), run: %s ci\n' "$0"
      exit 0
    fi
    printf '\n%sOne or more checks failed.%s\n' "$RED" "$RESET" >&2
    exit 1
    ;;

  # ── fixtures ──────────────────────────────────────────────────────────────
  fixtures)
    exec bash "${scripts}/run-fixtures.sh" "$@"
    ;;

  # ── ci ────────────────────────────────────────────────────────────────────
  # Full superset: check + audit + fixture tests + bench + CI-only checks.
  # Matches the GitHub Actions workflow step-for-step.
  ci)
    section() { printf '\n%s━━━ %s ━━━%s\n' "$CYAN" "$1" "$RESET"; }
    failed=0

    section "Fast checks"
    bash "$0" check || failed=1

    section "Audit local (scripts + hooks)"
    bash "${scripts}/audit-local.sh" || failed=1

    section "Audit examples (prose + GOOD blocks)"
    bash "${scripts}/audit-examples.sh" || failed=1

    section "Hook integrity"
    bash "${scripts}/verify-hooks-integrity.sh" || failed=1

    section "Fixtures"
    bash "${scripts}/run-fixtures.sh" || failed=1

    section "OpenCode adapter (CI parity)"
    bash "${scripts}/check-opencode-adapter.sh" || failed=1

    section "OpenClaw adapter (CI parity)"
    bash "${scripts}/check-openclaw-adapter.sh" || failed=1

    section "Claw Code adapter (CI parity)"
    bash "${scripts}/check-clawcode-adapter.sh" || failed=1

    section "Decision replay (CI parity)"
    LILARA_CONTRACT_ENABLED=0 LILARA_TRAJECTORY_WINDOW_MIN=0 \
      bash "${scripts}/check-decision-replay.sh" || failed=1

    section "Contract schema v2 migration (CI parity)"
    bash "${scripts}/check-migrate-v1-v2.sh" || failed=1

    section "Runtime bench"
    bash "${scripts}/bench-runtime-decision.sh" || failed=1

    [ "$failed" -eq 0 ] && printf '\n%sAll CI checks passed.%s\n' "$GREEN" "$RESET" && exit 0
    printf '\n%sOne or more CI checks failed.%s\n' "$RED" "$RESET" >&2
    exit 1
    ;;

  # ── eval ──────────────────────────────────────────────────────────────────
  eval)
    exec bash "${scripts}/eval-decision-quality.sh" "$@"
    ;;

  # ── integrity ─────────────────────────────────────────────────────────────
  integrity)
    exec bash "${scripts}/verify-hooks-integrity.sh" "$@"
    ;;

  # ── status ────────────────────────────────────────────────────────────────
  status)
    exec bash "${scripts}/status-summary.sh" "$@"
    ;;

  # ── review ────────────────────────────────────────────────────────────────
  review)
    exec bash "${scripts}/review-payload.sh" "$@"
    ;;

  # ── classify ──────────────────────────────────────────────────────────────
  classify)
    exec bash "${scripts}/classify-payload.sh" "$@"
    ;;

  # ── redact ────────────────────────────────────────────────────────────────
  redact)
    exec bash "${scripts}/redact-payload.sh" "$@"
    ;;

  # ── wire ──────────────────────────────────────────────────────────────────
  wire)
    exec bash "${scripts}/wire-hooks.sh" "$@"
    ;;

  # ── log ───────────────────────────────────────────────────────────────────
  log)
    log_file="${HOME}/.lilara/hook-events.log"

    # Parse sub-flags
    tail_n=""
    clear_log=0
    since_ts=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --tail)   shift; tail_n="${1:-50}" ;;
        --tail=*) tail_n="${1#--tail=}" ;;
        --clear)  clear_log=1 ;;
        --since)  shift; since_ts="${1:-}" ;;
        --since=*) since_ts="${1#--since=}" ;;
        *) die "Unknown flag: $1" ;;
      esac
      shift
    done

    if [ "$clear_log" -eq 1 ]; then
      if [ -f "$log_file" ]; then
        : > "$log_file"
        printf 'Log cleared: %s\n' "$log_file"
      else
        printf 'No log file found at %s\n' "$log_file"
      fi
      exit 0
    fi

    if [ ! -f "$log_file" ]; then
      printf 'No log file found at %s\n' "$log_file"
      printf 'Set LILARA_HOOK_LOG=1 to enable event logging.\n'
      exit 0
    fi

    if [ -n "$since_ts" ]; then
      printf '%sHook event log since %s (%s):%s\n\n' "$CYAN" "$since_ts" "$log_file" "$RESET"
      node -e "
const fs = require('fs');
const lines = fs.readFileSync(process.argv[1], 'utf8').trim().split('\n').filter(Boolean);
const since = new Date(process.argv[2]).getTime();
for (const line of lines) {
  try {
    const r = JSON.parse(line);
    if (new Date(r.ts).getTime() >= since) console.log(line);
  } catch { /* skip non-JSON legacy lines */ }
}
" "$log_file" "$since_ts"
    elif [ -n "$tail_n" ]; then
      printf '%sLast %s entries from %s:%s\n\n' "$CYAN" "$tail_n" "$log_file" "$RESET"
      tail -n "$tail_n" "$log_file"
    else
      printf '%sHook event log: %s%s\n\n' "$CYAN" "$log_file" "$RESET"
      cat "$log_file"
    fi
    ;;

  # ── contract ──────────────────────────────────────────────────────────────
  # Manage the upfront security contract (lilara.contract.json) for the current
  # project. The contract pre-agrees all permissions before work begins.
  contract)
    sub="${1:-status}"
    shift || true
    target_dir="${1:-.}"
    case "$sub" in
      init)
        node - "$root" "$target_dir" <<'EOF'
"use strict";
const path = require("path");
const { generate } = require(path.join(process.argv[2], "runtime/contract"));
const projectRoot = path.resolve(process.argv[3] || ".");
const draftPath = generate(projectRoot);
console.log("Contract draft written to:", draftPath);
console.log("Review and edit the draft, then run: lilara-cli.sh contract accept");
EOF
        ;;
      accept)
        node - "$root" "$target_dir" <<'EOF'
"use strict";
const path = require("path");
const { accept } = require(path.join(process.argv[2], "runtime/contract"));
const projectRoot = path.resolve(process.argv[3] || ".");
try {
  const { contractId, contractHash } = accept(projectRoot);
  console.log("Contract accepted:", contractId);
  console.log("Hash:", contractHash);
} catch (err) {
  process.stderr.write("Error: " + err.message + "\n");
  process.exit(1);
}
EOF
        ;;
      show)
        node - "$root" "$target_dir" <<'EOF'
"use strict";
const path = require("path");
const { load } = require(path.join(process.argv[2], "runtime/contract"));
const projectRoot = path.resolve(process.argv[3] || ".");
const doc = load(projectRoot);
if (!doc) { console.log("No contract found at", projectRoot); process.exit(0); }
console.log(JSON.stringify(doc, null, 2));
EOF
        ;;
      verify|status)
        node - "$root" "$target_dir" <<'EOF'
"use strict";
const path = require("path");
const { verify } = require(path.join(process.argv[2], "runtime/contract"));
const projectRoot = path.resolve(process.argv[3] || ".");
const result = verify(projectRoot);
if (result.ok) {
  console.log("Contract OK:", result.contractId);
} else {
  console.log("Contract status:", result.reason, result.contractId || "");
  process.exit(1);
}
EOF
        ;;
      diff)
        node - "$root" "$target_dir" <<'EOF'
"use strict";
const path = require("path");
const fs   = require("fs");
const { contractFilePath, draftFilePath } = require(path.join(process.argv[2], "runtime/contract"));
const projectRoot = path.resolve(process.argv[3] || ".");
const cf = contractFilePath(projectRoot);
const df = draftFilePath(projectRoot);
const left  = fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf,"utf8")) : null;
const right = fs.existsSync(df) ? JSON.parse(fs.readFileSync(df,"utf8")) : null;
if (!left && !right) { console.log("No contract or draft found."); process.exit(0); }
console.log("--- lilara.contract.json (accepted)");
console.log("+++ lilara.contract.json.draft");
const l = JSON.stringify(left || {}, null, 2).split("\n");
const r = JSON.stringify(right || {}, null, 2).split("\n");
l.forEach((line, i) => { if (line !== r[i]) console.log("-", line, "\n+", r[i] || ""); });
EOF
        ;;
      amend)
        node - "$root" "$target_dir" <<'EOF'
"use strict";
const path = require("path");
const fs   = require("fs");
const { load, generate, contractFilePath, draftFilePath } = require(path.join(process.argv[2], "runtime/contract"));
const projectRoot = path.resolve(process.argv[3] || ".");
const cf = contractFilePath(projectRoot);
if (!fs.existsSync(cf)) {
  process.stderr.write("No accepted contract found. Run: lilara-cli contract init && lilara-cli contract accept first.\n");
  process.exit(1);
}
const existing = JSON.parse(fs.readFileSync(cf, "utf8"));
generate(projectRoot, {
  existingRevision: existing.revision || 1,
  harnesses:        existing.harnessScope,
  trustPosture:     existing.trustPosture,
});
const df = draftFilePath(projectRoot);
const next = (existing.revision || 1) + 1;
process.stdout.write(`Draft written to ${path.relative(process.cwd(), df)} (revision ${next}).\nEdit it, then run: lilara-cli contract accept\n`);
EOF
        ;;
      *)
        printf '%sUnknown contract subcommand: %s%s\n' "$RED" "$sub" "$RESET" >&2
        printf 'Available: init, accept, show, verify, status, diff, amend\n' >&2
        exit 2
        ;;
    esac
    ;;

  # ── operator-token ────────────────────────────────────────────────────────
  # Manage one-shot operator tokens for non-TTY contract acceptance and floor demotion.
  # Usage:
  #   lilara-cli.sh operator-token mint [label] [--scope <scope>]
  #     Mint a fresh one-shot token. Optional scope binds the token to a specific
  #     consumption purpose (e.g. class-c-review-demote for ADR-002 B F4 demotion).
  #   lilara-cli.sh operator-token verify <token>  Check validity without consuming it.
  operator-token)
    sub="${1:-mint}"
    shift || true
    case "$sub" in
      mint)
        label=""
        scope=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --scope)
              scope="${2:-}"
              shift 2
              ;;
            *)
              if [ -z "$label" ]; then label="$1"; fi
              shift
              ;;
          esac
        done
        node - "$root" "$label" "$scope" <<'EOF'
const path = require("path");
const { mintOperatorToken } = require(path.join(process.argv[2], "runtime/contract"));
const label = process.argv[3] || null;
const scope = process.argv[4] || null;
const token = mintOperatorToken(label, scope);
process.stderr.write("WARNING: Treat this like a credential — don't echo it in shared logs.\n");
process.stdout.write("Token: " + token + "\n");
if (scope) {
  process.stdout.write("Scope: " + scope + "\n");
  if (scope === "class-c-review-demote") {
    process.stdout.write("Usage: LILARA_F4_DEMOTE_TOKEN=" + token + " <agent invocation>\n");
  } else {
    process.stdout.write("Usage: scope-bound token; pass via the appropriate env var for " + scope + "\n");
  }
} else {
  process.stdout.write("Usage: LILARA_OPERATOR_TOKEN=" + token + " lilara-cli.sh contract accept\n");
}
EOF
        ;;
      verify)
        token="${1:-}"
        if [ -z "$token" ]; then
          printf '%sUsage: lilara-cli.sh operator-token verify <token>%s\n' "$RED" "$RESET" >&2
          exit 2
        fi
        node - "$root" "$token" <<'EOF'
const path = require("path");
const fs = require("fs");
const { operatorTokensPath } = require(path.join(process.argv[2], "runtime/contract"));
const want = process.argv[3];
const p = operatorTokensPath();
let lines;
try { lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean); }
catch { process.stdout.write("Token store not found.\n"); process.exit(1); }
const rec = lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean).find(r => r.token === want);
if (!rec) { process.stdout.write("NOT FOUND: token not in store.\n"); process.exit(1); }
if (rec.usedAt) { process.stdout.write("CONSUMED: token already used at " + rec.usedAt + ".\n"); process.exit(1); }
process.stdout.write("VALID: token available (label=" + (rec.label || "none") + ", created=" + rec.createdAt + ")\n");
EOF
        ;;
      list)
        node - "$root" <<'EOF'
const path = require("path");
const fs = require("fs");
const { operatorTokensPath } = require(path.join(process.argv[2], "runtime/contract"));
const p = operatorTokensPath();
let lines;
try { lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean); }
catch { process.stdout.write("No operator tokens found.\n"); process.exit(0); }
const records = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
if (records.length === 0) { process.stdout.write("No operator tokens found.\n"); process.exit(0); }
for (const r of records) {
  const status = r.usedAt ? "CONSUMED at " + r.usedAt : "AVAILABLE";
  process.stdout.write("id=" + r.token.slice(0, 8) + "...  label=" + (r.label || "(none)") + "  created=" + r.createdAt + "  " + status + "\n");
}
EOF
        ;;
      revoke)
        token_id="${1:-}"
        if [ -z "$token_id" ]; then
          printf '%sUsage: lilara-cli.sh operator-token revoke <token-or-id-prefix>%s\n' "$RED" "$RESET" >&2
          exit 2
        fi
        node - "$root" "$token_id" <<'EOF'
const path = require("path");
const fs = require("fs");
const { operatorTokensPath } = require(path.join(process.argv[2], "runtime/contract"));
const want = process.argv[3];
const p = operatorTokensPath();
let lines;
try { lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean); }
catch { process.stderr.write("No operator token store found.\n"); process.exit(1); }
const records = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const matches = records.filter(r => r.token === want || r.token.startsWith(want));
if (matches.length === 0) { process.stderr.write("No matching token found for: " + want + "\n"); process.exit(1); }
if (matches.length > 1) { process.stderr.write("Ambiguous prefix — " + matches.length + " matches. Use a longer prefix.\n"); process.exit(1); }
const revokedAt = new Date().toISOString();
const updated = records.map(r => {
  if (r.token === matches[0].token) return JSON.stringify({ ...r, usedAt: r.usedAt || revokedAt, revokedAt });
  return JSON.stringify(r);
});
const tmp = p + ".tmp";
fs.writeFileSync(tmp, updated.join("\n") + "\n", { mode: 0o600 });
try { fs.renameSync(tmp, p); }
catch { fs.writeFileSync(p, updated.join("\n") + "\n", { mode: 0o600 }); }
process.stdout.write("REVOKED: token id=" + matches[0].token.slice(0, 8) + "... at " + revokedAt + "\n");
EOF
        ;;
      *)
        printf '%sUnknown operator-token subcommand: %s%s\n' "$RED" "$sub" "$RESET" >&2
        printf 'Available: mint, verify, list, revoke\n' >&2
        exit 2
        ;;
    esac
    ;;

  # ── version ───────────────────────────────────────────────────────────────
  version)
    ver_file="${root}/VERSION"
    if [ -f "$ver_file" ]; then
      printf 'Agent Runtime Guard %s\n' "$(cat "$ver_file")"
    else
      printf 'Agent Runtime Guard (VERSION file not found)\n'
    fi
    ;;

  # ── runtime ───────────────────────────────────────────────────────────────
  runtime)
    sub="${1:-roadmap}"
    shift || true
    case "$sub" in
      roadmap)
        printf 'Runtime roadmap: %s\n' "${root}/references/runtime-autonomy-roadmap.md"
        ;;
      state)
        exec node "${scripts}/runtime-state.js" show "$@"
        ;;
      accept)
        exec node "${scripts}/runtime-state.js" accept "$@"
        ;;
      dismiss)
        exec node "${scripts}/runtime-state.js" dismiss "$@"
        ;;
      promote)
        exec node "${scripts}/runtime-state.js" promote "$@"
        ;;
      record-approval)
        exec node "${scripts}/runtime-state.js" record-approval "$@"
        ;;
      auto-allow-once)
        exec node "${scripts}/runtime-state.js" auto-allow-once "$@"
        ;;
      explain)
        exec node "${scripts}/runtime-state.js" explain "$@"
        ;;
      classify)
        # Classify the intent of a shell command: lilara-cli.sh runtime classify <command>
        cmd_arg="${1:-}"
        node - "$root" "$cmd_arg" <<'__CLASSIFY_EOF__'
"use strict";
const path = require("path");
const { classifyIntent } = require(path.join(process.argv[2], "runtime/intent-classifier"));
const result = classifyIntent(process.argv[3] || "");
console.log(JSON.stringify(result, null, 2));
__CLASSIFY_EOF__
        ;;
      route)
        # Resolve the workflow route for a shell command: lilara-cli.sh runtime route <command>
        cmd_arg="${1:-}"
        node - "$root" "$cmd_arg" <<'__ROUTE_EOF__'
"use strict";
const path = require("path");
const { classifyIntent } = require(path.join(process.argv[2], "runtime/intent-classifier"));
const { resolveRoute } = require(path.join(process.argv[2], "runtime/route-resolver"));
const classified = classifyIntent(process.argv[3] || "");
const route = resolveRoute(classified.intent);
console.log(JSON.stringify({ ...classified, ...route }, null, 2));
__ROUTE_EOF__
        ;;
      *)
        die "Unknown runtime subcommand: $sub"
        ;;
    esac
    ;;

  # ── journal ───────────────────────────────────────────────────────────────
  # ADR-004 PR 37A: tamper-evident hash-chained journal. Detection-only — no
  # enforcement gating; degraded-mode wiring lands in PR 37B.
  journal)
    sub="${1:-verify}"
    shift || true
    case "$sub" in
      verify)
        # Optional --file <path> override; defaults to <stateDir>/journal-chain.jsonl.
        chain_file=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --file)   shift; chain_file="${1:-}" ;;
            --file=*) chain_file="${1#--file=}" ;;
            *) die "Unknown flag: $1" ;;
          esac
          shift
        done
        node - "$root" "$chain_file" <<'__JOURNAL_VERIFY_EOF__'
"use strict";
const path = require("path");
const { verify, chainPath } = require(path.join(process.argv[2], "runtime/journal-chain"));
const file = process.argv[3] || chainPath();
const result = verify({ file });
if (result.ok) {
  process.stdout.write("journal verify: OK (" + result.entryCount + " entries) " + file + "\n");
  process.exit(0);
}
process.stdout.write("journal verify: FAIL (" + result.errors.length + " error(s), " + result.entryCount + " entries) " + file + "\n");
for (const e of result.errors) {
  process.stdout.write("  seq=" + (e.seq === null ? "?" : e.seq) + " line=" + (e.line === null ? "?" : e.line) + " reason=" + e.reason + "\n");
}
process.exit(1);
__JOURNAL_VERIFY_EOF__
        ;;
      *)
        printf '%sUnknown journal subcommand: %s%s\n' "$RED" "$sub" "$RESET" >&2
        printf 'Available: verify\n' >&2
        exit 2
        ;;
    esac
    ;;

  # ── state ─────────────────────────────────────────────────────────────────
  # ADR-011 state portability: export / import / doctor. Bundle format is a
  # zero-dep ustar tar of Lilara state under LILARA_STATE_DIR with secrets/host-
  # local files stripped. See references/adr-011-state-portability.md.
  state)
    sub="${1:-doctor}"
    shift || true
    case "$sub" in
      export)
        out_path=""
        force_arg=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --force) force_arg="1" ;;
            -h|--help)
              printf 'Usage: lilara-cli.sh state export <out-path> [--force]\n'
              exit 0
              ;;
            --*) die "Unknown flag: $1" ;;
            *) out_path="$1" ;;
          esac
          shift
        done
        [ -n "$out_path" ] || die "Usage: lilara-cli.sh state export <out-path> [--force]"
        node - "$root" "$out_path" "$force_arg" <<'__STATE_EXPORT_EOF__'
"use strict";
const path = require("path");
const sb = require(path.join(process.argv[2], "runtime/state-bundle"));
const dj = require(path.join(process.argv[2], "runtime/decision-journal"));
const outPath = process.argv[3];
const force   = process.argv[4] === "1";
try {
  const m = sb.exportBundle({ outPath, force });
  process.stdout.write("state export: ok\n");
  process.stdout.write("  bundle:           " + outPath + "\n");
  process.stdout.write("  bundleHash:       " + m.bundleHash + "\n");
  process.stdout.write("  files:            " + m.fileCount + "\n");
  process.stdout.write("  totalBytes:       " + m.totalBytes + "\n");
  process.stdout.write("  journalChainTip:  " + (m.journalChainTipAt || "(none)") + "\n");
  process.stdout.write("  hostFingerprint:  " + m.hostFingerprint + "\n");
  if (m.excluded && m.excluded.length) {
    process.stdout.write("  excluded:         " + m.excluded.length + " file(s) (secret-blacklist / symlink / non-regular)\n");
  }
  dj.append({
    kind: "state-export", action: "state-export",
    riskLevel: "low", riskScore: 0, reasonCodes: ["state-bundle"],
    tool: "lilara-cli", branch: "",
    notes: "bundle=" + m.bundleHash + " files=" + m.fileCount + " chainTip=" + (m.journalChainTipAt || "none"),
  });
} catch (err) {
  process.stderr.write("state export: FAIL — " + err.message + "\n");
  process.exit(1);
}
__STATE_EXPORT_EOF__
        ;;
      import)
        bundle_path=""
        apply_arg=""
        force_arg=""
        xhost_arg=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --apply) apply_arg="1" ;;
            --force) force_arg="1" ;;
            --accept-cross-host) xhost_arg="1" ;;
            -h|--help)
              printf 'Usage: lilara-cli.sh state import <bundle-path> [--apply] [--force] [--accept-cross-host]\n'
              exit 0
              ;;
            --*) die "Unknown flag: $1" ;;
            *) bundle_path="$1" ;;
          esac
          shift
        done
        [ -n "$bundle_path" ] || die "Usage: lilara-cli.sh state import <bundle-path> [--apply] [--force] [--accept-cross-host]"
        node - "$root" "$bundle_path" "$apply_arg" "$force_arg" "$xhost_arg" <<'__STATE_IMPORT_EOF__'
"use strict";
const path = require("path");
const sb = require(path.join(process.argv[2], "runtime/state-bundle"));
const dj = require(path.join(process.argv[2], "runtime/decision-journal"));
const { stateDir } = require(path.join(process.argv[2], "runtime/state-paths"));
const bundlePath      = process.argv[3];
const apply           = process.argv[4] === "1";
const force           = process.argv[5] === "1";
const acceptCrossHost = process.argv[6] === "1";
const target = stateDir();
const tipBefore = sb.readChainTip(target);
const r = sb.importBundle(bundlePath, { apply, force, acceptCrossHost });
if (!r.ok) {
  process.stderr.write("state import: FAIL\n");
  for (const p of r.problems || []) process.stderr.write("  - " + p + "\n");
  process.exit(1);
}
if (r.dryRun) {
  process.stdout.write("state import: dry-run OK (pass --apply to restore)\n");
  process.stdout.write("  bundleHash:     " + r.manifest.bundleHash + "\n");
  process.stdout.write("  files:          " + r.manifest.fileCount + "\n");
  process.stdout.write("  crossHost:      " + (r.crossHost ? "yes (pass --accept-cross-host)" : "no") + "\n");
  process.exit(0);
}
process.stdout.write("state import: APPLIED\n");
process.stdout.write("  bundleHash:     " + r.manifest.bundleHash + "\n");
process.stdout.write("  chainTipBefore: " + (tipBefore || "(none)") + "\n");
process.stdout.write("  chainTipAfter:  " + (r.manifest.journalChainTipAt || "(none)") + "\n");
if (r.backupPath) process.stdout.write("  backup:         " + r.backupPath + "\n");
if (r.crossHost)  process.stdout.write("  note: cross-host restore (--accept-cross-host)\n");
dj.append({
  kind: "state-import", action: "state-import",
  riskLevel: "low", riskScore: 0, reasonCodes: ["state-bundle"],
  tool: "lilara-cli", branch: "",
  notes: "bundle=" + r.manifest.bundleHash + " files=" + r.manifest.fileCount + " before=" + (tipBefore || "none") + " after=" + (r.manifest.journalChainTipAt || "none"),
});
__STATE_IMPORT_EOF__
        ;;
      doctor)
        node - "$root" <<'__STATE_DOCTOR_EOF__'
"use strict";
const path = require("path");
const sb = require(path.join(process.argv[2], "runtime/state-bundle"));
const { stateDir } = require(path.join(process.argv[2], "runtime/state-paths"));
const dir = stateDir();
const m = sb.buildExportManifest(dir);
process.stdout.write("state doctor: " + dir + "\n");
process.stdout.write("  includable files:    " + m.fileCount + "\n");
process.stdout.write("  totalBytes:          " + m.totalBytes + "\n");
process.stdout.write("  excluded:            " + m.excluded.length + "\n");
process.stdout.write("  journalChainTipAt:   " + (m.journalChainTipAt || "(none)") + "\n");
process.stdout.write("  hostFingerprint:     " + m.hostFingerprint + "\n");
for (const e of m.excluded.slice(0, 10)) process.stdout.write("    [excluded] " + e.path + "  (" + e.reason + ")\n");
if (m.excluded.length > 10) process.stdout.write("    ... and " + (m.excluded.length - 10) + " more\n");
process.stdout.write("portability: ready (`lilara-cli.sh state export <out>` to produce a bundle)\n");
__STATE_DOCTOR_EOF__
        ;;
      *)
        printf '%sUnknown state subcommand: %s%s\n' "$RED" "$sub" "$RESET" >&2
        printf 'Available: export, import, doctor\n' >&2
        exit 2
        ;;
    esac
    ;;

  # ── envelope ──────────────────────────────────────────────────────────────
  # ADR-012 (Lilara v0.5 Stage D): declared-intent envelope. Writes the operator-
  # supplied scope of what the agent is allowed to do — files / commands /
  # network hosts / policy edits — to <LILARA_STATE_DIR>/envelope.json. The
  # runtime engine reads this on each decide() and fires F20 (change-intent-
  # drift) when actuals deviate from the declared scope.
  envelope)
    sub="${1:-show}"
    shift || true
    case "$sub" in
      set)
        goal=""; plan=""
        allow_writes=""; allow_deletes=""; allow_commands=""
        allow_classes=""; allow_hosts=""; allow_policy=""
        source_label="cli"
        while [ $# -gt 0 ]; do
          case "$1" in
            --goal)            shift; goal="${1:-}" ;;
            --goal=*)          goal="${1#--goal=}" ;;
            --plan)            shift; plan="${1:-}" ;;
            --plan=*)          plan="${1#--plan=}" ;;
            --allow-writes)    shift; allow_writes="${1:-}" ;;
            --allow-writes=*)  allow_writes="${1#--allow-writes=}" ;;
            --allow-deletes)   shift; allow_deletes="${1:-}" ;;
            --allow-deletes=*) allow_deletes="${1#--allow-deletes=}" ;;
            --allow-commands)  shift; allow_commands="${1:-}" ;;
            --allow-commands=*) allow_commands="${1#--allow-commands=}" ;;
            --allow-classes)   shift; allow_classes="${1:-}" ;;
            --allow-classes=*) allow_classes="${1#--allow-classes=}" ;;
            --allow-hosts)     shift; allow_hosts="${1:-}" ;;
            --allow-hosts=*)   allow_hosts="${1#--allow-hosts=}" ;;
            --allow-policy)    allow_policy="1" ;;
            --source)          shift; source_label="${1:-cli}" ;;
            --source=*)        source_label="${1#--source=}" ;;
            -h|--help)
              printf 'Usage: lilara-cli.sh envelope set [--goal "..."] [--plan "..."] \\\n'
              printf '         [--allow-writes "pat,pat"] [--allow-deletes "pat,pat"] \\\n'
              printf '         [--allow-commands "ls,cat"] [--allow-classes "explore,build"] \\\n'
              printf '         [--allow-hosts "github.com,*.example.com"] [--allow-policy] \\\n'
              printf '         [--source "label"]\n'
              exit 0
              ;;
            *) die "Unknown flag: $1" ;;
          esac
          shift
        done
        node - "$root" "$goal" "$plan" "$allow_writes" "$allow_deletes" "$allow_commands" "$allow_classes" "$allow_hosts" "$allow_policy" "$source_label" <<'__ENV_SET_EOF__'
"use strict";
const path = require("path");
const fs = require("fs");
const { declaredEnvelopePath } = require(path.join(process.argv[2], "runtime/envelope"));
const { ensureDir, stateDir } = require(path.join(process.argv[2], "runtime/state-paths"));
function splitList(s) {
  return String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
}
const writes  = splitList(process.argv[5]);
const deletes = splitList(process.argv[6]);
const cmds    = splitList(process.argv[7]);
const classes = splitList(process.argv[8]);
const hosts   = splitList(process.argv[9]);
const policy  = process.argv[10] === "1";
const allowedOps = {
  fileWrites:    writes.length  ? writes  : null,
  fileDeletes:   deletes.length ? deletes : null,
  commands:      cmds.length    ? cmds    : null,
  commandClasses: classes.length ? classes : null,
  networkHosts:  hosts.length   ? hosts   : null,
  policyEdits:   policy ? true : false,
};
const doc = {
  version: 1,
  createdAt: Date.now(),
  declaredIntent: {
    goal:        process.argv[3] || null,
    planSummary: process.argv[4] || null,
    allowedOps,
    declaredBy:  "operator",
    source:      process.argv[11] || "cli",
  },
};
ensureDir(stateDir());
const p = declaredEnvelopePath();
fs.writeFileSync(p + ".tmp", JSON.stringify(doc, null, 2), { mode: 0o600 });
fs.renameSync(p + ".tmp", p);
process.stdout.write("envelope set: " + p + "\n");
process.stdout.write("  goal:    " + (doc.declaredIntent.goal || "(none)") + "\n");
process.stdout.write("  expires: 24h from now\n");
__ENV_SET_EOF__
        ;;
      show)
        node - "$root" <<'__ENV_SHOW_EOF__'
"use strict";
const path = require("path");
const fs = require("fs");
const { declaredEnvelopePath, loadDeclaredEnvelope } = require(path.join(process.argv[2], "runtime/envelope"));
const p = declaredEnvelopePath();
if (!fs.existsSync(p)) { process.stdout.write("No declared-intent envelope found at " + p + "\n"); process.exit(0); }
const loaded = loadDeclaredEnvelope();
if (!loaded) {
  process.stdout.write("envelope: present but invalid/expired/malformed (" + p + ")\n");
  process.exit(0);
}
const di = loaded.declaredIntent;
function clip(s) { const t = String(s || ""); return t.length > 120 ? t.slice(0, 120) + "..." : t; }
process.stdout.write("envelope: " + p + "\n");
process.stdout.write("  createdAt:   " + (loaded.createdAt ? new Date(loaded.createdAt).toISOString() : "(unknown)") + "\n");
process.stdout.write("  goal:        " + clip(di.goal) + "\n");
process.stdout.write("  planSummary: " + clip(di.planSummary) + "\n");
process.stdout.write("  declaredBy:  " + (di.declaredBy || "(unset)") + "\n");
process.stdout.write("  source:      " + (di.source || "(unset)") + "\n");
const a = di.allowedOps || {};
process.stdout.write("  allowedOps:\n");
process.stdout.write("    fileWrites:     " + JSON.stringify(a.fileWrites)     + "\n");
process.stdout.write("    fileDeletes:    " + JSON.stringify(a.fileDeletes)    + "\n");
process.stdout.write("    commands:       " + JSON.stringify(a.commands)       + "\n");
process.stdout.write("    commandClasses: " + JSON.stringify(a.commandClasses) + "\n");
process.stdout.write("    networkHosts:   " + JSON.stringify(a.networkHosts)   + "\n");
process.stdout.write("    policyEdits:    " + JSON.stringify(a.policyEdits)    + "\n");
__ENV_SHOW_EOF__
        ;;
      clear)
        node - "$root" <<'__ENV_CLEAR_EOF__'
"use strict";
const path = require("path");
const fs = require("fs");
const { declaredEnvelopePath } = require(path.join(process.argv[2], "runtime/envelope"));
const p = declaredEnvelopePath();
if (!fs.existsSync(p)) { process.stdout.write("No declared-intent envelope to clear.\n"); process.exit(0); }
fs.unlinkSync(p);
process.stdout.write("envelope cleared: " + p + "\n");
__ENV_CLEAR_EOF__
        ;;
      *)
        printf '%sUnknown envelope subcommand: %s%s\n' "$RED" "$sub" "$RESET" >&2
        printf 'Available: set, show, clear\n' >&2
        exit 2
        ;;
    esac
    ;;

  # ── snapshot ──────────────────────────────────────────────────────────────
  snapshot)
    sub="${1:-list}"
    shift || true
    case "$sub" in
      list)
        node - "$root" <<'__SNAP_LIST_EOF__'
"use strict";
const path = require("path");
const s = require(path.join(process.argv[2], "runtime/snapshot"));
const items = s.listSnapshots();
if (items.length === 0) { process.stdout.write("snapshot list: (none)\n"); process.exit(0); }
process.stdout.write("snapshot list: " + items.length + " snapshot(s)\n");
for (const it of items) {
  process.stdout.write("  " + it.snapshotId + "\n");
  process.stdout.write("    createdAt:   " + it.createdAt + "\n");
  process.stdout.write("    sizeBytes:   " + it.sizeBytes + "\n");
  process.stdout.write("    fileCount:   " + it.fileCount + (it.truncated ? "  (truncated)" : "") + "\n");
  process.stdout.write("    reason:      " + it.reason + "\n");
  process.stdout.write("    decisionKey: " + it.decisionKey + "\n");
}
__SNAP_LIST_EOF__
        ;;
      show)
        snap_id="${1:-}"
        [ -n "$snap_id" ] || die "Usage: lilara-cli.sh snapshot show <snapshotId>"
        node - "$root" "$snap_id" <<'__SNAP_SHOW_EOF__'
"use strict";
const path = require("path");
const fs   = require("fs");
const s = require(path.join(process.argv[2], "runtime/snapshot"));
const dir = path.join(s.snapshotsDir(), process.argv[3]);
const mp  = path.join(dir, "manifest.json");
if (!fs.existsSync(mp)) { process.stderr.write("snapshot show: not found — " + process.argv[3] + "\n"); process.exit(1); }
const m = JSON.parse(fs.readFileSync(mp, "utf8"));
process.stdout.write("snapshot " + m.snapshotId + "\n");
process.stdout.write("  createdAt:    " + m.createdAt + "\n");
process.stdout.write("  reason:       " + m.reason + "\n");
process.stdout.write("  decisionKey:  " + (m.decisionKey || "(none)") + "\n");
process.stdout.write("  irHash:       " + (m.irHash || "(none)") + "\n");
process.stdout.write("  truncated:    " + Boolean(m.truncated) + "\n");
process.stdout.write("  fileCount:    " + m.fileCount + "\n");
process.stdout.write("  totalBytes:   " + m.totalBytes + "\n");
process.stdout.write("  manifestHash: " + (m.manifestHash || "(none)") + "\n");
for (const e of (m.entries || [])) {
  process.stdout.write("    " + e.path + "\n");
  process.stdout.write("      size:   " + e.size + "\n");
  process.stdout.write("      sha256: " + e.sha256 + "\n");
}
__SNAP_SHOW_EOF__
        ;;
      restore)
        snap_id=""
        apply_arg=""
        force_arg=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --apply)   apply_arg="1" ;;
            --dry-run) apply_arg="" ;;
            --force)   force_arg="1" ;;
            -h|--help)
              printf 'Usage: lilara-cli.sh snapshot restore <snapshotId> [--apply] [--force]\n'
              printf '  Default: dry-run (print what would change). Pass --apply to actually restore.\n'
              exit 0
              ;;
            --*) die "Unknown flag: $1" ;;
            *) snap_id="$1" ;;
          esac
          shift
        done
        [ -n "$snap_id" ] || die "Usage: lilara-cli.sh snapshot restore <snapshotId> [--apply] [--force]"
        node - "$root" "$snap_id" "$apply_arg" "$force_arg" <<'__SNAP_RESTORE_EOF__'
"use strict";
const path = require("path");
const s = require(path.join(process.argv[2], "runtime/snapshot"));
const snapshotId = process.argv[3];
const apply = process.argv[4] === "1";
const force = process.argv[5] === "1";
const r = s.restoreSnapshot(snapshotId, { dryRun: !apply, force });
if (r.reason === "snapshot-not-found") { process.stderr.write("snapshot restore: not found — " + snapshotId + "\n"); process.exit(1); }
process.stdout.write("snapshot restore: " + (apply ? "APPLIED" : "dry-run") + (force ? "  (--force)" : "") + "\n");
process.stdout.write("  restored:  " + r.restored.length + "\n");
for (const p of r.restored) process.stdout.write("    + " + p + "\n");
if (r.conflicts.length > 0) {
  process.stdout.write("  conflicts: " + r.conflicts.length + " (hash mismatch; pass --force to overwrite)\n");
  for (const c of r.conflicts) process.stdout.write("    ! " + c.path + "\n      captured=" + c.captured + "\n      current= " + c.current + "\n");
}
if (r.skipped.length > 0) {
  process.stdout.write("  skipped:   " + r.skipped.length + "\n");
  for (const p of r.skipped) process.stdout.write("    - " + p + "\n");
}
if (!apply) process.stdout.write("  (no files written — pass --apply to restore)\n");
process.exit(r.ok ? 0 : 2);
__SNAP_RESTORE_EOF__
        ;;
      prune)
        node - "$root" <<'__SNAP_PRUNE_EOF__'
"use strict";
const path = require("path");
const s = require(path.join(process.argv[2], "runtime/snapshot"));
const r = s.pruneSnapshots();
process.stdout.write("snapshot prune: kept=" + r.kept.length + " deleted=" + r.deleted.length + "\n");
for (const id of r.deleted) process.stdout.write("  - " + id + "\n");
__SNAP_PRUNE_EOF__
        ;;
      doctor)
        node - "$root" <<'__SNAP_DOCTOR_EOF__'
"use strict";
const path = require("path");
const s = require(path.join(process.argv[2], "runtime/snapshot"));
const r = s.doctor();
process.stdout.write("snapshot doctor: " + (r.ok ? "OK" : "PROBLEMS") + "\n");
process.stdout.write("  snapshots: " + r.snapshots.length + "\n");
for (const it of r.snapshots) process.stdout.write("    " + (it.ok ? "ok" : "FAIL") + "  " + it.snapshotId + " (" + it.fileCount + " file(s))\n");
if (r.problems.length > 0) {
  process.stdout.write("  problems: " + r.problems.length + "\n");
  for (const p of r.problems) process.stdout.write("    - " + p.snapshotId + ": " + p.reason + (p.path ? " path=" + p.path : "") + (p.blob ? " blob=" + p.blob : "") + "\n");
  process.exit(1);
}
__SNAP_DOCTOR_EOF__
        ;;
      *)
        printf '%sUnknown snapshot subcommand: %s%s\n' "$RED" "$sub" "$RESET" >&2
        printf 'Available: list, show, restore, prune, doctor\n' >&2
        exit 2
        ;;
    esac
    ;;

  # ── receipts ──────────────────────────────────────────────────────────────
  # ADR-014 audit-grade receipts: validate / export / schema / doctor. The
  # receipt is the journal entry shape; the schema lives at
  # schemas/receipt.v1.json. Round-trip doctor proves exporter is its own
  # inverse on the on-disk journal.
  receipts)
    sub="${1:-validate}"
    shift || true
    case "$sub" in
      validate)
        jpath=""; chain_arg=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --journal)  shift; jpath="${1:-}" ;;
            --journal=*) jpath="${1#--journal=}" ;;
            --chain)    shift; chain_arg="${1:-}" ;;
            --chain=*)  chain_arg="${1#--chain=}" ;;
            -h|--help)
              printf 'Usage: lilara-cli.sh receipts validate [--journal <path>] [--chain <path>]\n'; exit 0 ;;
            *) die "Unknown flag: $1" ;;
          esac
          shift
        done
        node - "$root" "$jpath" "$chain_arg" <<'__RV_EOF__'
"use strict";
const fs = require("fs"); const path = require("path");
const root = process.argv[2]; const jArg = process.argv[3]; const cArg = process.argv[4];
const { stateDir } = require(path.join(root, "runtime/state-paths"));
const { validateJournalChain } = require(path.join(root, "runtime/receipt-validator"));
const jFile = jArg || path.join(stateDir(), "decision-journal.jsonl");
let entries = [];
if (fs.existsSync(jFile)) {
  for (const ln of fs.readFileSync(jFile, "utf8").split("\n").filter(Boolean)) {
    try { entries.push(JSON.parse(ln)); } catch { /* skip */ }
  }
}
const cFile = cArg || path.join(stateDir(), "journal-chain.jsonl");
const opts = { entries };
if (fs.existsSync(cFile)) opts.chainFile = cFile;
const r = validateJournalChain(opts);
process.stdout.write("receipts validate: " + (r.valid ? "OK" : "FAIL") + "\n");
process.stdout.write("  journal:        " + jFile + "\n");
process.stdout.write("  entries:        " + entries.length + "\n");
process.stdout.write("  schemaErrors:   " + r.schemaErrors.length + "\n");
if (opts.chainFile) {
  process.stdout.write("  chain:          " + cFile + " (" + r.chainEntryCount + " entries)\n");
  process.stdout.write("  chainErrors:    " + r.chainErrors.length + "\n");
}
for (const e of r.schemaErrors.slice(0, 10)) process.stdout.write("    schema  entry=" + e.entry + " path=" + e.path + " — " + e.message + "\n");
for (const e of r.chainErrors.slice(0, 10))  process.stdout.write("    chain   seq=" + (e.seq == null ? "?" : e.seq) + " line=" + (e.line == null ? "?" : e.line) + " — " + e.reason + "\n");
process.exit(r.valid ? 0 : 1);
__RV_EOF__
        ;;
      export)
        since=""; until_=""; fmt="jsonl"; out_path=""; sid=""; act=""; lvl=""; redact_arg=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --since)            shift; since="${1:-}" ;;
            --since=*)          since="${1#--since=}" ;;
            --until)            shift; until_="${1:-}" ;;
            --until=*)          until_="${1#--until=}" ;;
            --format)           shift; fmt="${1:-}" ;;
            --format=*)         fmt="${1#--format=}" ;;
            --out)              shift; out_path="${1:-}" ;;
            --out=*)            out_path="${1#--out=}" ;;
            --session-id)       shift; sid="${1:-}" ;;
            --session-id=*)     sid="${1#--session-id=}" ;;
            --decision-action)  shift; act="${1:-}" ;;
            --decision-action=*) act="${1#--decision-action=}" ;;
            --risk-level)       shift; lvl="${1:-}" ;;
            --risk-level=*)     lvl="${1#--risk-level=}" ;;
            --redact)           redact_arg="1" ;;
            -h|--help)
              printf 'Usage: lilara-cli.sh receipts export [--since <iso>] [--until <iso>] [--format jsonl|csv]\n'
              printf '         [--out <path>] [--session-id <id>] [--decision-action <act>] [--risk-level <lvl>] [--redact]\n'; exit 0 ;;
            *) die "Unknown flag: $1" ;;
          esac
          shift
        done
        LILARA_EXPORT_SINCE="$since" LILARA_EXPORT_UNTIL="$until_" LILARA_EXPORT_FMT="$fmt" \
        LILARA_EXPORT_OUT="$out_path" LILARA_EXPORT_SID="$sid" LILARA_EXPORT_ACT="$act" \
        LILARA_EXPORT_LVL="$lvl" LILARA_EXPORT_REDACT="$redact_arg" \
        node - "$root" <<'__RE_EOF__'
"use strict";
const fs = require("fs"); const path = require("path");
const root = process.argv[2];
const { exportReceipts, buildExportManifest } = require(path.join(root, "runtime/receipt-export"));
const filter = {};
if (process.env.LILARA_EXPORT_SINCE) filter.since = process.env.LILARA_EXPORT_SINCE;
if (process.env.LILARA_EXPORT_UNTIL) filter.until = process.env.LILARA_EXPORT_UNTIL;
if (process.env.LILARA_EXPORT_SID)   filter.sessionId      = process.env.LILARA_EXPORT_SID;
if (process.env.LILARA_EXPORT_ACT)   filter.decisionAction = process.env.LILARA_EXPORT_ACT;
if (process.env.LILARA_EXPORT_LVL)   filter.riskLevel      = process.env.LILARA_EXPORT_LVL;
if (process.env.LILARA_EXPORT_REDACT === "1") filter.redact = true;
const fmt = process.env.LILARA_EXPORT_FMT || "jsonl";
const buf = exportReceipts(filter, fmt);
const out = process.env.LILARA_EXPORT_OUT;
if (out) {
  fs.writeFileSync(out, buf, { mode: 0o600 });
  const m = buildExportManifest(buf, { format: fmt, filter, redact: Boolean(filter.redact),
    entryCount: fmt === "jsonl" ? buf.toString("utf8").split("\n").filter(Boolean).length : Math.max(0, buf.toString("utf8").split("\n").filter(Boolean).length - 1) });
  process.stdout.write("receipts export: ok\n");
  process.stdout.write("  out:           " + out + "\n");
  process.stdout.write("  format:        " + fmt + "\n");
  process.stdout.write("  bytes:         " + m.bytes + "\n");
  process.stdout.write("  entries:       " + m.entryCount + "\n");
  process.stdout.write("  contentSha256: " + m.contentSha256 + "\n");
  process.stdout.write("  bundleHash:    " + m.bundleHash + "\n");
} else {
  process.stdout.write(buf);
}
__RE_EOF__
        ;;
      schema)
        print_arg=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --print) print_arg="1" ;;
            -h|--help) printf 'Usage: lilara-cli.sh receipts schema [--print]\n'; exit 0 ;;
            *) die "Unknown flag: $1" ;;
          esac
          shift
        done
        node - "$root" "$print_arg" <<'__RS_EOF__'
"use strict";
const fs = require("fs"); const path = require("path"); const crypto = require("crypto");
const root = process.argv[2]; const printAll = process.argv[3] === "1";
const schemaPath = path.join(root, "schemas/receipt.v1.json");
const raw = fs.readFileSync(schemaPath, "utf8");
if (printAll) { process.stdout.write(raw); process.exit(0); }
const h = "sha256:" + crypto.createHash("sha256").update(raw).digest("hex");
process.stdout.write("receipts schema\n");
process.stdout.write("  path:    " + schemaPath + "\n");
process.stdout.write("  sha256:  " + h + "\n");
process.stdout.write("  bytes:   " + raw.length + "\n");
__RS_EOF__
        ;;
      doctor)
        node - "$root" <<'__RD_EOF__'
"use strict";
const fs = require("fs"); const path = require("path");
const root = process.argv[2];
const { stateDir } = require(path.join(root, "runtime/state-paths"));
const { validateJournalChain } = require(path.join(root, "runtime/receipt-validator"));
const { exportReceipts, roundTrip } = require(path.join(root, "runtime/receipt-export"));
const jFile = path.join(stateDir(), "decision-journal.jsonl");
if (!fs.existsSync(jFile)) { process.stdout.write("receipts doctor: no journal at " + jFile + "\n"); process.exit(0); }
const entries = [];
for (const ln of fs.readFileSync(jFile, "utf8").split("\n").filter(Boolean)) {
  try { entries.push(JSON.parse(ln)); } catch { /* skip */ }
}
const v = validateJournalChain({ entries });
const exported = exportReceipts({}, "jsonl");
const rt = roundTrip(exported, "jsonl");
process.stdout.write("receipts doctor: " + (v.valid && rt.ok ? "OK" : "PROBLEMS") + "\n");
process.stdout.write("  journal:        " + jFile + "\n");
process.stdout.write("  entries:        " + entries.length + "\n");
process.stdout.write("  schemaErrors:   " + v.schemaErrors.length + "\n");
process.stdout.write("  roundTrip:      " + (rt.ok ? "byte-identical (" + rt.parsedCount + " entries)" : rt.reason) + "\n");
process.exit(v.valid && rt.ok ? 0 : 1);
__RD_EOF__
        ;;
      *)
        printf '%sUnknown receipts subcommand: %s%s\n' "$RED" "$sub" "$RESET" >&2
        printf 'Available: validate, export, schema, doctor\n' >&2
        exit 2
        ;;
    esac
    ;;

  # ── telemetry ─────────────────────────────────────────────────────────────
  telemetry)
    sub="${1:-report}"
    shift || true
    case "$sub" in
      report|show|summary)
        node - "$root" <<'EOF'
"use strict";
const path = require("path");
const { summarizeTelemetry } = require(path.join(process.argv[2], "runtime/telemetry"));
const s = summarizeTelemetry();
if (s.totalEvents === 0) {
  console.log("No telemetry events recorded yet.");
  console.log("Telemetry is written to: ~/.lilara/telemetry.jsonl");
  process.exit(0);
}
console.log(`Telemetry summary — ${s.totalEvents} event(s) total`);
if (s.dateRange) {
  console.log(`  earliest: ${s.dateRange.earliest}`);
  console.log(`  latest:   ${s.dateRange.latest}`);
}
console.log("  By event type:");
const sorted = Object.entries(s.byEvent).sort((a, b) => b[1].count - a[1].count);
for (const [name, info] of sorted) {
  console.log(`    ${name.padEnd(40)} count=${info.count}  last=${info.lastSeen}`);
}
EOF
        ;;
      clear)
        node - "$root" <<'EOF'
"use strict";
const path = require("path");
const fs   = require("fs");
const { stateDir } = require(path.join(process.argv[2], "runtime/state-paths"));
const f = path.join(stateDir(), "telemetry.jsonl");
if (fs.existsSync(f)) { fs.unlinkSync(f); console.log("Telemetry log cleared."); }
else { console.log("No telemetry log found."); }
EOF
        ;;
      *)
        printf '%sUnknown telemetry subcommand: %s%s\n' "$RED" "$sub" "$RESET" >&2
        printf 'Available: report, clear\n' >&2
        exit 2
        ;;
    esac
    ;;

  # ── notify ────────────────────────────────────────────────────────────────
  # ADR-015 notification routing (Discord / Slack / email). Default disabled.
  notify)
    sub="${1:-show}"
    shift || true
    case "$sub" in
      test)
        channel=""
        url=""
        dry_run=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --channel)   shift; channel="${1:-}" ;;
            --channel=*) channel="${1#--channel=}" ;;
            --url)       shift; url="${1:-}" ;;
            --url=*)     url="${1#--url=}" ;;
            --dry-run)   dry_run="1" ;;
            -h|--help)
              printf 'Usage: lilara-cli.sh notify test --channel <discord|slack|email> [--url <webhook>] [--dry-run]\n'
              exit 0
              ;;
            --*) die "Unknown flag: $1" ;;
            *) die "Unexpected arg: $1" ;;
          esac
          shift
        done
        [ -n "$channel" ] || die "Usage: lilara-cli.sh notify test --channel <discord|slack|email> [--url <webhook>] [--dry-run]"
        node - "$root" "$channel" "$url" "$dry_run" <<'__NOTIFY_TEST_EOF__'
"use strict";
const path = require("path");
const root = process.argv[2];
const channel = process.argv[3];
const url = process.argv[4] || "";
const dry = process.argv[5] === "1";
const notify = require(path.join(root, "runtime/notify"));
const event = {
  kind: "approval-request", severity: "info", decisionKey: "cli-test:" + Date.now(),
  summary: "lilara-cli notify test", scrubbedReceipt: notify.scrubForNotify({ action: "require-review", riskLevel: "low", reasonCodes: ["cli-test"], floorFired: null, decisionKey: "cli-test", timestamp: new Date().toISOString() }),
  timestamp: new Date().toISOString(),
};
let transport;
try { transport = require(path.join(root, "runtime/notify", channel)); }
catch { process.stderr.write("notify test: unknown channel: " + channel + "\n"); process.exit(2); }
const payload = transport.buildPayload ? transport.buildPayload(event) : transport.buildMessage(event, "to@example.com", "from@example.com");
if (dry) {
  process.stdout.write("notify test (dry-run): channel=" + channel + "\n");
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); process.exit(0);
}
const ch = channel === "email" ? { type: "email", to: process.env.LILARA_SMTP_TO || "ops@example.com", events: ["*"] }
  : { type: channel, webhookUrl: url, events: ["*"] };
(async () => {
  const r = await transport.send(ch, event);
  process.stdout.write("notify test: " + JSON.stringify(r) + "\n");
  process.exit(r.ok ? 0 : 1);
})();
__NOTIFY_TEST_EOF__
        ;;
      show)
        node - "$root" <<'__NOTIFY_SHOW_EOF__'
"use strict";
const path = require("path");
const root = process.argv[2];
const { load } = require(path.join(root, "runtime/contract"));
const { loadNotifyConfig } = require(path.join(root, "runtime/notify"));
const doc = load(process.cwd());
const cfg = loadNotifyConfig(doc);
process.stdout.write("notify show:\n");
process.stdout.write("  enabled:       " + cfg.enabled + "\n");
process.stdout.write("  severityFloor: " + cfg.severityFloor + "\n");
process.stdout.write("  channels:      " + cfg.channels.length + "\n");
for (const c of cfg.channels) {
  const events = (c.events || ["*"]).join(",");
  const dest = c.webhookUrl ? "<webhook>" : (c.to || "");
  process.stdout.write("    - type=" + c.type + "  events=[" + events + "]  dest=" + dest + "\n");
}
__NOTIFY_SHOW_EOF__
        ;;
      history)
        limit="20"
        while [ $# -gt 0 ]; do
          case "$1" in
            --limit)   shift; limit="${1:-20}" ;;
            --limit=*) limit="${1#--limit=}" ;;
            -h|--help) printf 'Usage: lilara-cli.sh notify history [--limit N]\n'; exit 0 ;;
            *) die "Unexpected arg: $1" ;;
          esac
          shift
        done
        node - "$root" "$limit" <<'__NOTIFY_HISTORY_EOF__'
"use strict";
const path = require("path");
const fs = require("fs");
const root = process.argv[2];
const limit = Math.max(1, Math.min(1000, parseInt(process.argv[3] || "20", 10) || 20));
const { journalPaths } = require(path.join(root, "runtime/decision-journal"));
const { logFile } = journalPaths();
if (!fs.existsSync(logFile)) { process.stdout.write("notify history: (journal empty)\n"); process.exit(0); }
const lines = fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
const entries = [];
for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
  let r; try { r = JSON.parse(lines[i]); } catch { continue; }
  if (r.kind === "notify" || r.notifyAttempted === true) entries.push(r);
}
entries.reverse();
if (entries.length === 0) { process.stdout.write("notify history: (no notify entries)\n"); process.exit(0); }
process.stdout.write("notify history: " + entries.length + " entry/entries\n");
for (const r of entries) {
  process.stdout.write("  " + (r.ts || "") + "  kind=" + (r.action || "") + "  severity=" + (r.riskLevel || "") + "\n");
  if (Array.isArray(r.notifyResult)) for (const x of r.notifyResult) {
    process.stdout.write("    -> " + x.channel + " ok=" + x.ok + " status=" + x.status + (x.error ? " err=" + x.error : "") + "\n");
  }
}
__NOTIFY_HISTORY_EOF__
        ;;
      *)
        printf '%sUnknown notify subcommand: %s%s\n' "$RED" "$sub" "$RESET" >&2
        printf 'Available: test, show, history\n' >&2
        exit 2
        ;;
    esac
    ;;

  # ── sandbox ───────────────────────────────────────────────────────────────
  sandbox)
    json_mode=0; tool_override="Bash"; harness_override="cli-sandbox"; explain=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --json)    json_mode=1; shift ;;
        --tool)    tool_override="$2"; shift 2 ;;
        --harness) harness_override="$2"; shift 2 ;;
        --explain) explain=1; shift ;;
        --) shift; break ;;
        --*) printf '%sUnknown sandbox flag: %s%s\n' "$RED" "$1" "$RESET" >&2; exit 2 ;;
        *) break ;;
      esac
    done
    cmd="$*"
    if [ -z "$cmd" ]; then
      printf 'Usage: lilara sandbox [--json] [--tool TOOL] [--harness HARNESS] [--explain] <command...>\n' >&2
      printf 'Dry-run a command through the decision lattice without writing to the journal.\n' >&2
      exit 2
    fi
    node - "$root" "$tool_override" "$harness_override" "$cmd" "$json_mode" "$explain" <<'__SANDBOX_EOF__'
"use strict";
const path = require("path");
const [root, tool, harness, cmd, jsonMode, explain] = process.argv.slice(2);
process.env.LILARA_DRY_RUN = "1";
const { decide } = require(path.join(root, "runtime", "decision-engine"));
let result;
try {
  result = decide({
    tool,
    harness,
    command: cmd,
    cwd: process.cwd(),
    branch: "sandbox",
    dryRun: true,
  });
} catch (err) {
  process.stderr.write("[lilara sandbox] engine error: " + (err && err.message || err) + "\n");
  process.exit(1);
}
if (jsonMode === "1") {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} else {
  const { floorFired, decisionSource, code, reasonCodes, riskScore, riskLevel, action } = result;
  const rungVal = result.rung != null ? result.rung : "-";
  process.stdout.write("action:         " + action + "\n");
  process.stdout.write("floorFired:     " + (floorFired || "-") + "\n");
  process.stdout.write("code:           " + (code || "-") + "\n");
  process.stdout.write("rung:           " + rungVal + "\n");
  process.stdout.write("reasonCodes:    " + JSON.stringify(reasonCodes || []) + "\n");
  process.stdout.write("riskScore:      " + riskScore + " (" + riskLevel + ")\n");
  process.stdout.write("decisionSource: " + (decisionSource || "-") + "\n");
  if (explain === "1" && result.explanation) {
    process.stdout.write("\nexplanation:\n" + result.explanation + "\n");
  }
}
__SANDBOX_EOF__
    ;;

  # ── help ──────────────────────────────────────────────────────────────────
  help|-h|--help)
    if [ $# -gt 0 ]; then
      sub="$1"
      # Delegate to sub-script --help where possible
      case "$sub" in
        install)  bash "${scripts}/install.sh" --help ;;
        upgrade)  bash "${scripts}/upgrade.sh" --help 2>/dev/null || printf 'Usage: upgrade.sh [INSTALLED_DIR]\n' ;;
        setup)    bash "${scripts}/setup-wizard.sh" --help ;;
        redact)   bash "${scripts}/redact-payload.sh" --help ;;
        review)   bash "${scripts}/review-payload.sh" --help 2>/dev/null || printf 'No detailed help for: review\n' ;;
        classify) bash "${scripts}/classify-payload.sh" --help 2>/dev/null || printf 'No detailed help for: classify\n' ;;
        *)
          printf '%sNo detailed help for: %s%s\n' "$YELLOW" "$sub" "$RESET"
          usage
          ;;
      esac
    else
      printf '%s%sAgent Runtime Guard CLI%s\n\n' "$BOLD" "$CYAN" "$RESET"
      usage
    fi
    ;;

  # ── unknown ───────────────────────────────────────────────────────────────
  *)
    printf '%sUnknown subcommand: %s%s\n\n' "$RED" "$cmd" "$RESET" >&2
    usage >&2
    exit 2
    ;;

esac
