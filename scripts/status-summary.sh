#!/usr/bin/env bash
set -eu
# pipefail so a sub-script's own internal `set -e` + `| pipe` failure
# propagates to the run_check below rather than being masked by the pipe's
# last command. Scoped to THIS wrapper only (do NOT add to the sub-scripts).
set -o pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

# Auto-detect Node.js on Windows when not already on PATH
if ! command -v node >/dev/null 2>&1; then
  for _candidate in \
    "/c/Users/Khouly/.lmstudio/.internal/utils" \
    "/c/Program Files/nodejs" \
    "/c/Program Files (x86)/nodejs"; do
    if [ -x "$_candidate/node.exe" ] || [ -x "$_candidate/node" ]; then
      export PATH="$_candidate:$PATH"
      break
    fi
  done
fi

pass() { printf '%s\n' "  $1: ok"; }
fail() { printf '%s\n' "  $1: MISSING" >&2; }

check_file() {
  if [ -f "$1" ]; then pass "$2"; else fail "$2"; fi
}

# Fail-flag accumulator for the [Verification] sub-script checks. De-masks the
# old `... && printf ok || printf FAILED` pattern that always exited 0 (Pitfall
# 53, surfaced by PR #195). `fail` the integer variable and `fail()` the
# function above live in separate bash namespaces, so they coexist safely:
# check_file still calls the function; run_check + `exit "$fail"` use the var.
declare -i fail=0

# run_check NAME CMD [ARGS...] — runs CMD silently; prints "NAME: ok" on success
# or "NAME: FAILED" to stderr and trips the fail flag on failure. stdout/stderr
# of the sub-script are suppressed so the summary stays terse; the fail flag is
# the propagation mechanism (the user sees only the summary, exit code reflects
# reality).
run_check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '%s\n' "  $name: ok"
  else
    printf '%s\n' "  $name: FAILED" >&2
    fail=1
  fi
}

version="$(cat "$(dirname -- "$0")/../VERSION" 2>/dev/null | tr -d '[:space:]' || echo "unknown")"
printf '%s\n' "Agent Runtime Guard Status Summary  (v${version})"
printf '%s\n' "==========================================="

printf '%s\n' ""
printf '%s\n' "[Verification]"
run_check "audit" ./scripts/audit-local.sh
run_check "registries" ./scripts/check-registries.sh
run_check "smoke" ./scripts/smoke-test.sh
run_check "scenarios" ./scripts/check-scenarios.sh
run_check "integration smoke" ./scripts/check-integration-smoke.sh
run_check "payload protection" ./scripts/test-payload-protection.sh
run_check "fixtures" ./scripts/run-fixtures.sh
# audit-examples keeps its intentional non-standard message (a failing run is a
# manual-review signal). We still propagate the failure to the fail flag so the
# de-masked exit code reflects it — matching the workflow's own "Audit examples"
# step, which exits 1 on this condition.
if ./scripts/audit-examples.sh >/dev/null 2>&1; then
  printf '%s\n' "  audit-examples: ok"
else
  printf '%s\n' "  audit-examples: prose matches found (review manually)" >&2
  fail=1
fi
run_check "installation" ./scripts/check-installation.sh
run_check "config-integration" ./scripts/check-config-integration.sh
run_check "runtime-core" ./scripts/check-runtime-core.sh
run_check "runtime-cli" ./scripts/check-runtime-cli.sh
run_check "hook-edge-cases" ./scripts/check-hook-edge-cases.sh
run_check "apply-status" ./scripts/check-apply-status.sh
run_check "executables" ./scripts/check-executables.sh
run_check "setup-wizard" ./scripts/check-setup-wizard.sh
run_check "wiring-docs" ./scripts/check-wiring-docs.sh
run_check "superiority-evidence" ./scripts/check-superiority-evidence.sh
run_check "status-docs" ./scripts/check-status-docs.sh
run_check "fixture-count" ./scripts/check-fixture-count.sh
run_check "harness-support" ./scripts/check-harness-support.sh
# The workflow sets ARG_SKIP_STATUS_ARTIFACT_CHECK=1 to intentionally skip this
# sub-check (the check-status-artifact step runs it separately). A skip is NOT a
# failure — do not call run_check / do not trip the fail flag here.
if [ "${ARG_SKIP_STATUS_ARTIFACT_CHECK:-0}" = "1" ]; then
  printf '%s\n' "  status-artifact: skipped"
else
  run_check "status-artifact" ./scripts/check-status-artifact.sh
fi
run_check "policy-lint" ./scripts/policy-lint.sh
run_check "data-detector" ./scripts/detect-sensitive-data.sh scripts/status-summary.sh

printf '%s\n' ""
printf '%s\n' "[Parity Snapshot]"
if [ ! -f "$root/references/parity-matrix.json" ]; then
  printf '%s\n' "  parity-matrix: MISSING"
else
  awk '
    BEGIN { in_sum=0; comp=""; ut=""; ad=""; de=""; eo="" }
    /"summary":/ { in_sum=1; next }
    !in_sum { next }
    /"agents":/ { comp="agents"; next }
    /"rules":/ { comp="rules"; next }
    /"skills":/ { comp="skills"; next }
    comp != "" && /"upstream_total":/ { v=$0; gsub(/[^0-9]/,"",v); ut=v }
    comp != "" && /"adopted":/ { v=$0; gsub(/[^0-9]/,"",v); ad=v }
    comp != "" && /"deferred":/ { v=$0; gsub(/[^0-9]/,"",v); de=v }
    comp != "" && /"current_only_total":/ {
      v=$0; gsub(/[^0-9]/,"",v)
      printf "  %s: upstream=%s adopted=%s deferred=%s ecc-only=%s\n", comp, ut, ad, de, v
      comp=""; ut=""; ad=""; de=""
    }
  ' "$root/references/parity-matrix.json"
fi

printf '%s\n' ""
printf '%s\n' "[Capability Packs]"
check_file "modules/mcp-pack/registry.json" "mcp-pack"
check_file "modules/wrapper-pack/registry.json" "wrapper-pack"
check_file "modules/plugin-pack/registry.json" "plugin-pack"
check_file "modules/browser-pack/registry.json" "browser-pack"
check_file "modules/notification-pack/registry.json" "notification-pack"
check_file "modules/daemon-pack/registry.json" "daemon-pack"

printf '%s\n' ""
printf '%s\n' "[Tool Wiring]"
check_file "openclaw/WIRING_PLAN.md" "openclaw"
check_file "opencode/WIRING_PLAN.md" "opencode"
check_file "claude/WIRING_PLAN.md" "claude-code"

printf '%s\n' ""
printf '%s\n' "[Payload Protection]"
check_file "scripts/classify-payload.sh" "classify"
check_file "scripts/redact-payload.sh" "redact"
check_file "scripts/review-payload.sh" "review"
check_file "references/payload-classification.md" "classification-policy"
check_file "references/payload-redaction.md" "redaction-policy"

printf '%s\n' ""
printf '%s\n' "[Upstream Workflow]"
check_file "references/vendor-policy.md" "vendor-policy"

printf '%s\n' ""
printf '%s\n' "[Scenario Coverage]"
check_file "tests/approval-boundary-scenarios.md" "approval-boundary"
check_file "tests/prompt-injection-scenarios.md" "prompt-injection"
check_file "tests/integration-smoke-cases.md" "integration-smoke-cases"

printf '%s\n' ""
printf '%s\n' "[Policy Layers]"
check_file "references/phase1-policy.md" "phase1"
check_file "references/phase2-policy.md" "phase2"
check_file "references/phase3-policy.md" "phase3"
check_file "references/guardrail-enforcement.md" "guardrail-enforcement"
check_file "references/verification-plan.md" "verification-plan"

printf '%s\n' ""
printf '%s\n' "[Agents]"
for f in agents/code-reviewer.md agents/security-reviewer.md agents/architect.md agents/planner.md agents/tdd-guide.md agents/performance-optimizer.md agents/typescript-reviewer.md agents/python-reviewer.md agents/go-reviewer.md agents/rust-reviewer.md agents/java-reviewer.md agents/kotlin-reviewer.md agents/database-reviewer.md agents/refactor-cleaner.md agents/build-error-resolver.md agents/silent-failure-hunter.md agents/doc-updater.md agents/code-simplifier.md agents/a11y-architect.md agents/chief-of-staff.md agents/code-explorer.md agents/pr-test-analyzer.md agents/e2e-runner.md agents/harness-optimizer.md agents/loop-operator.md agents/type-design-analyzer.md agents/seo-specialist.md agents/docs-lookup.md agents/go-build-resolver.md agents/java-build-resolver.md agents/kotlin-build-resolver.md agents/rust-build-resolver.md agents/cpp-reviewer.md agents/cpp-build-resolver.md agents/csharp-reviewer.md agents/flutter-reviewer.md agents/opensource-sanitizer.md agents/opensource-forker.md agents/healthcare-reviewer.md agents/pytorch-build-resolver.md agents/dart-build-resolver.md agents/gan-planner.md agents/gan-generator.md agents/gan-evaluator.md agents/opensource-packager.md agents/comment-analyzer.md agents/conversation-analyzer.md; do
  check_file "$f" "$(basename $f .md)"
done
check_file "agents/devops-reviewer.md" "devops-reviewer"
printf '%s\n' "  disk-count: $(find "$root/agents" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ') agent files"

printf '%s\n' ""
printf '%s\n' "[Rules]"
check_file "rules/common/coding-style.md" "common/coding-style"
check_file "rules/common/security.md" "common/security"
check_file "rules/common/testing.md" "common/testing"
check_file "rules/common/git-workflow.md" "common/git-workflow"
check_file "rules/common/development-workflow.md" "common/development-workflow"
check_file "rules/common/performance.md" "common/performance"
check_file "rules/common/code-review.md" "common/code-review"
check_file "rules/common/hooks.md" "common/hooks"
check_file "rules/common/agents.md" "common/agents"
check_file "rules/common/patterns.md" "common/patterns"

check_file "rules/typescript/coding-style.md" "typescript/coding-style"
check_file "rules/typescript/security.md" "typescript/security"
check_file "rules/typescript/testing.md" "typescript/testing"
check_file "rules/typescript/patterns.md" "typescript/patterns"
check_file "rules/typescript/hooks.md" "typescript/hooks"

check_file "rules/python/coding-style.md" "python/coding-style"
check_file "rules/python/security.md" "python/security"
check_file "rules/python/testing.md" "python/testing"
check_file "rules/python/patterns.md" "python/patterns"
check_file "rules/python/hooks.md" "python/hooks"

check_file "rules/golang/coding-style.md" "golang/coding-style"
check_file "rules/golang/security.md" "golang/security"
check_file "rules/golang/testing.md" "golang/testing"
check_file "rules/golang/patterns.md" "golang/patterns"
check_file "rules/golang/hooks.md" "golang/hooks"

check_file "rules/java/coding-style.md" "java/coding-style"
check_file "rules/java/security.md" "java/security"
check_file "rules/java/testing.md" "java/testing"
check_file "rules/java/patterns.md" "java/patterns"
check_file "rules/java/hooks.md" "java/hooks"

check_file "rules/kotlin/coding-style.md" "kotlin/coding-style"
check_file "rules/kotlin/security.md" "kotlin/security"
check_file "rules/kotlin/testing.md" "kotlin/testing"
check_file "rules/kotlin/patterns.md" "kotlin/patterns"
check_file "rules/kotlin/hooks.md" "kotlin/hooks"

check_file "rules/rust/coding-style.md" "rust/coding-style"
check_file "rules/rust/security.md" "rust/security"
check_file "rules/rust/testing.md" "rust/testing"
check_file "rules/rust/patterns.md" "rust/patterns"
check_file "rules/rust/hooks.md" "rust/hooks"

check_file "rules/cpp/coding-style.md" "cpp/coding-style"
check_file "rules/cpp/security.md" "cpp/security"
check_file "rules/cpp/testing.md" "cpp/testing"
check_file "rules/cpp/patterns.md" "cpp/patterns"
check_file "rules/cpp/hooks.md" "cpp/hooks"

check_file "rules/csharp/coding-style.md" "csharp/coding-style"
check_file "rules/csharp/security.md" "csharp/security"
check_file "rules/csharp/testing.md" "csharp/testing"
check_file "rules/csharp/patterns.md" "csharp/patterns"
check_file "rules/csharp/hooks.md" "csharp/hooks"

check_file "rules/swift/coding-style.md" "swift/coding-style"
check_file "rules/swift/security.md" "swift/security"
check_file "rules/swift/testing.md" "swift/testing"
check_file "rules/swift/patterns.md" "swift/patterns"
check_file "rules/swift/hooks.md" "swift/hooks"

check_file "rules/php/coding-style.md" "php/coding-style"
check_file "rules/php/security.md" "php/security"
check_file "rules/php/testing.md" "php/testing"
check_file "rules/php/patterns.md" "php/patterns"
check_file "rules/php/hooks.md" "php/hooks"

check_file "rules/perl/coding-style.md" "perl/coding-style"
check_file "rules/perl/patterns.md" "perl/patterns"
check_file "rules/perl/security.md" "perl/security"
check_file "rules/perl/testing.md" "perl/testing"
check_file "rules/perl/hooks.md" "perl/hooks"

check_file "rules/dart/coding-style.md" "dart/coding-style"
check_file "rules/dart/security.md" "dart/security"
check_file "rules/dart/testing.md" "dart/testing"
check_file "rules/dart/patterns.md" "dart/patterns"
check_file "rules/dart/hooks.md" "dart/hooks"

check_file "rules/web/coding-style.md" "web/coding-style"
check_file "rules/web/security.md" "web/security"
check_file "rules/web/testing.md" "web/testing"
check_file "rules/web/patterns.md" "web/patterns"
check_file "rules/web/performance.md" "web/performance"
check_file "rules/web/design-quality.md" "web/design-quality"
check_file "rules/web/hooks.md" "web/hooks"

check_file "rules/database/patterns.md" "database/patterns"
check_file "rules/infrastructure/patterns.md" "infrastructure/patterns"

printf '%s\n' "  disk-count: $(find "$root/rules" -name '*.md' | wc -l | tr -d ' ') rule files"

printf '%s\n' ""
printf '%s\n' "[Skills]"
check_file "skills/arg-learning-review.md" "arg-learning-review"
check_file "skills/arg-policy-tune.md" "arg-policy-tune"
check_file "skills/arg-runtime-debug.md" "arg-runtime-debug"
check_file "skills/autonomous-improvement.md" "autonomous-improvement"
check_file "skills/capability-audit.md" "capability-audit"
check_file "skills/code-review.md" "code-review"
check_file "skills/configure-lilara.md" "configure-lilara"
check_file "skills/content-engine.md" "content-engine"
check_file "skills/context-maximizer.md" "context-maximizer"
check_file "skills/deep-code-analysis.md" "deep-code-analysis"
check_file "skills/deployment-safety.md" "deployment-safety"
check_file "skills/git-worktree-patterns.md" "git-worktree-patterns"
check_file "skills/intelligence-amplification.md" "intelligence-amplification"
check_file "skills/investor-outreach.md" "investor-outreach"
check_file "skills/multi-agent-debug.md" "multi-agent-debug"
check_file "skills/multi-agent-orchestration.md" "multi-agent-orchestration"
check_file "skills/orchestration-design.md" "orchestration-design"
check_file "skills/pattern-extraction.md" "pattern-extraction"
check_file "skills/pm2-patterns.md" "pm2-patterns"
check_file "skills/semantic-refactor.md" "semantic-refactor"
check_file "skills/test-intelligence.md" "test-intelligence"
check_file "skills/workflow-acceleration.md" "workflow-acceleration"
printf '%s\n' "  disk-count: $(find "$root/skills" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ') skill files"

printf '%s\n' ""
printf '%s\n' "[References]"
check_file "references/per-tool-apply-status.md" "per-tool-apply-status"

printf '%s\n' ""
printf '%s\n' "[Hook Wiring]"
hook_placeholder_found=0
for candidate in \
  "$HOME/.claude/settings.json" \
  "$HOME/.claude/settings.local.json" \
  ".claude/settings.json" \
  ".claude/settings.local.json"
do
  if [ -f "$candidate" ] && grep -q '/ABS_PATH/' "$candidate" 2>/dev/null; then
    printf '%s\n' "  WARNING: /ABS_PATH/ placeholder in $candidate — run scripts/wire-hooks.sh" >&2
    hook_placeholder_found=1
  fi
done
if [ "$hook_placeholder_found" -eq 0 ]; then
  printf '%s\n' "  hook paths: ok (no /ABS_PATH/ placeholders found)"
fi

# De-masked exit: surface any [Verification] sub-check failure as a non-zero
# exit instead of the old always-exit-0 behavior. The [Hook Wiring] block above
# stays a soft WARNING (it does not trip the fail flag) — behavior preserved.
exit "$fail"
