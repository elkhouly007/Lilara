#!/usr/bin/env bash
# horus-cli.sh — Unified command-line interface for Agent Runtime Guard.
#
# Consolidates 14 individual scripts into one entry point.
#
# Usage:
#   ./scripts/horus-cli.sh <subcommand> [args...]
#   ecc <subcommand> [args...]          (if symlinked to PATH)
#
# Subcommands:
#   install     Install Agent Runtime Guard into a target project directory (one command).
#   upgrade     Upgrade an existing installation in-place, preserving horus.config.json.
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
#   log         Show or clear the hook event log (HORUS_HOOK_LOG=1).
#   version     Print Agent Runtime Guard version.
#   runtime     Show runtime roadmap, state, approvals, promotions, and decision explanations.
#   help        Show this help, or help for a specific subcommand.
#
# Examples:
#   horus-cli.sh install ./my-project --profile rules --auto
#   horus-cli.sh setup --non-interactive --target ./my-project --profile full
#   horus-cli.sh audit
#   horus-cli.sh check
#   horus-cli.sh eval
#   horus-cli.sh eval --verbose
#   horus-cli.sh eval --max-fp-pct 5 --max-fn-pct 10
#   horus-cli.sh redact payload.json --diff
#   horus-cli.sh log --tail 20
#   horus-cli.sh log --clear
#   horus-cli.sh runtime state
#   horus-cli.sh runtime accept 'bash|sudo|default-target|A'
#   horus-cli.sh runtime record-approval --tool Bash --command 'sudo systemctl restart app' --target ops/service
#   horus-cli.sh runtime promote 'bash|sudo|default-target|A'
#   horus-cli.sh runtime explain --tool Bash --command 'sudo systemctl restart app' --target ops/service

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
  sed -n '3,22p' "$0" | sed 's/^# //' | grep -v '^#'
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
    HORUS_CONTRACT_ENABLED=0 HORUS_TRAJECTORY_WINDOW_MIN=0 \
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
    log_file="${HOME}/.horus/hook-events.log"

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
      printf 'Set HORUS_HOOK_LOG=1 to enable event logging.\n'
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
  # Manage the upfront security contract (horus.contract.json) for the current
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
console.log("Review and edit the draft, then run: horus-cli.sh contract accept");
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
console.log("--- horus.contract.json (accepted)");
console.log("+++ horus.contract.json.draft");
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
  process.stderr.write("No accepted contract found. Run: horus-cli contract init && horus-cli contract accept first.\n");
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
process.stdout.write(`Draft written to ${path.relative(process.cwd(), df)} (revision ${next}).\nEdit it, then run: horus-cli contract accept\n`);
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
  # Manage one-shot operator tokens for non-TTY contract acceptance.
  # Usage:
  #   horus-cli.sh operator-token mint [label]   Mint a fresh one-shot token.
  #   horus-cli.sh operator-token verify <token>  Check validity without consuming it.
  operator-token)
    sub="${1:-mint}"
    shift || true
    case "$sub" in
      mint)
        label="${1:-}"
        node - "$root" "$label" <<'EOF'
const path = require("path");
const { mintOperatorToken } = require(path.join(process.argv[2], "runtime/contract"));
const label = process.argv[3] || null;
const token = mintOperatorToken(label);
process.stderr.write("WARNING: Treat this like a credential — don't echo it in shared logs.\n");
process.stdout.write("Token: " + token + "\n");
process.stdout.write("Usage: HORUS_OPERATOR_TOKEN=" + token + " horus-cli.sh contract accept\n");
EOF
        ;;
      verify)
        token="${1:-}"
        if [ -z "$token" ]; then
          printf '%sUsage: horus-cli.sh operator-token verify <token>%s\n' "$RED" "$RESET" >&2
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
      *)
        printf '%sUnknown operator-token subcommand: %s%s\n' "$RED" "$sub" "$RESET" >&2
        printf 'Available: mint, verify\n' >&2
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
        # Classify the intent of a shell command: horus-cli.sh runtime classify <command>
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
        # Resolve the workflow route for a shell command: horus-cli.sh runtime route <command>
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
  console.log("Telemetry is written to: ~/.horus/telemetry.jsonl");
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
