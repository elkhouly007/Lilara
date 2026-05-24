#!/usr/bin/env bash
set -eu

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

version="$(cat "$(dirname -- "$0")/../VERSION" 2>/dev/null | tr -d '[:space:]' || echo "unknown")"
printf '%s\n' "Agent Runtime Guard Status Summary  (v${version})"
printf '%s\n' "==========================================="

printf '%s\n' ""
printf '%s\n' "[Verification]"
./scripts/audit-local.sh >/dev/null 2>&1 && printf '%s\n' "  audit: ok" || printf '%s\n' "  audit: FAILED"
./scripts/check-registries.sh >/dev/null 2>&1 && printf '%s\n' "  registries: ok" || printf '%s\n' "  registries: FAILED"
./scripts/smoke-test.sh >/dev/null 2>&1 && printf '%s\n' "  smoke: ok" || printf '%s\n' "  smoke: FAILED"
./scripts/check-scenarios.sh >/dev/null 2>&1 && printf '%s\n' "  scenarios: ok" || printf '%s\n' "  scenarios: FAILED"
./scripts/check-integration-smoke.sh >/dev/null 2>&1 && printf '%s\n' "  integration smoke: ok" || printf '%s\n' "  integration smoke: FAILED"
./scripts/test-payload-protection.sh >/dev/null 2>&1 && printf '%s\n' "  payload protection: ok" || printf '%s\n' "  payload protection: FAILED"
./scripts/run-fixtures.sh >/dev/null 2>&1 && printf '%s\n' "  fixtures: ok" || printf '%s\n' "  fixtures: FAILED"
./scripts/audit-examples.sh >/dev/null 2>&1 && printf '%s\n' "  audit-examples: ok" || printf '%s\n' "  audit-examples: prose matches found (review manually)"
./scripts/check-installation.sh >/dev/null 2>&1 && printf '%s\n' "  installation: ok" || printf '%s\n' "  installation: FAILED"
./scripts/check-config-integration.sh >/dev/null 2>&1 && printf '%s\n' "  config-integration: ok" || printf '%s\n' "  config-integration: FAILED"
./scripts/check-runtime-core.sh >/dev/null 2>&1 && printf '%s\n' "  runtime-core: ok" || printf '%s\n' "  runtime-core: FAILED"
./scripts/check-runtime-cli.sh >/dev/null 2>&1 && printf '%s\n' "  runtime-cli: ok" || printf '%s\n' "  runtime-cli: FAILED"
./scripts/check-hook-edge-cases.sh >/dev/null 2>&1 && printf '%s\n' "  hook-edge-cases: ok" || printf '%s\n' "  hook-edge-cases: FAILED"
./scripts/check-apply-status.sh >/dev/null 2>&1 && printf '%s\n' "  apply-status: ok" || printf '%s\n' "  apply-status: FAILED"
./scripts/check-executables.sh >/dev/null 2>&1 && printf '%s\n' "  executables: ok" || printf '%s\n' "  executables: FAILED"
./scripts/check-setup-wizard.sh >/dev/null 2>&1 && printf '%s\n' "  setup-wizard: ok" || printf '%s\n' "  setup-wizard: FAILED"
./scripts/check-wiring-docs.sh >/dev/null 2>&1 && printf '%s\n' "  wiring-docs: ok" || printf '%s\n' "  wiring-docs: FAILED"
./scripts/check-superiority-evidence.sh >/dev/null 2>&1 && printf '%s\n' "  superiority-evidence: ok" || printf '%s\n' "  superiority-evidence: FAILED"
./scripts/check-status-docs.sh >/dev/null 2>&1 && printf '%s\n' "  status-docs: ok" || printf '%s\n' "  status-docs: FAILED"
./scripts/check-fixture-count.sh >/dev/null 2>&1 && printf '%s\n' "  fixture-count: ok" || printf '%s\n' "  fixture-count: FAILED"
./scripts/check-harness-support.sh >/dev/null 2>&1 && printf '%s\n' "  harness-support: ok" || printf '%s\n' "  harness-support: FAILED"
if [ "${ARG_SKIP_STATUS_ARTIFACT_CHECK:-0}" = "1" ]; then
  printf '%s\n' "  status-artifact: skipped"
else
  ./scripts/check-status-artifact.sh >/dev/null 2>&1 && printf '%s\n' "  status-artifact: ok" || printf '%s\n' "  status-artifact: FAILED"
fi
./scripts/policy-lint.sh >/dev/null 2>&1 && printf '%s\n' "  policy-lint: ok" || printf '%s\n' "  policy-lint: FAILED"
./scripts/detect-sensitive-data.sh scripts/status-summary.sh >/dev/null 2>&1 && printf '%s\n' "  data-detector: ok" || printf '%s\n' "  data-detector: FAILED"

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
