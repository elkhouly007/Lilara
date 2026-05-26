#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

pass() { printf '  ok      %s\n' "$1"; }
fail() { printf '  ERROR   %s\n' "$1" >&2; exit 1; }

printf '[check-runtime-cli]\n'

tmp_home="$(mktemp -d)"
cleanup() { rm -rf "$tmp_home" "${dismiss_home:-}"; }
trap cleanup EXIT

HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" node - <<'NODE' "$root" || exit 1
const path = require('path');
const runtime = require(path.join(process.argv[2], 'runtime'));
const input = { command: ['sudo', 'systemctl', 'restart', 'app'].join(' '), targetPath: 'ops/service', tool: 'Bash' };
runtime.recordApproval(input);
runtime.recordApproval(input);
runtime.recordApproval(input);
const suggestions = runtime.listSuggestions();
if (suggestions.length !== 1) throw new Error(`expected 1 suggestion, got ${suggestions.length}`);
console.log(suggestions[0].key);
NODE
policy_key="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" node - <<'NODE' "$root"
const path = require('path');
const runtime = require(path.join(process.argv[2], 'runtime'));
const suggestions = runtime.listSuggestions();
process.stdout.write(suggestions[0].key);
NODE
)"

state_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime state)"
printf '%s\n' "$state_output" | grep -q 'pending-suggestions: 1' || fail 'runtime state shows pending suggestion count'
printf '%s\n' "$state_output" | grep -q "promote: lilara-cli.sh runtime promote '$policy_key'" || fail 'runtime state shows explicit promote command'
pass 'runtime state shows suggestion summary'

HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime accept "$policy_key" >/dev/null
state_after_accept="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime state)"
printf '%s\n' "$state_after_accept" | grep -q 'learned-allows: 1' || fail 'runtime accept promotes learned allow'
printf '%s\n' "$state_after_accept" | grep -q 'promoted-defaults: 1' || fail 'runtime accept updates promoted defaults summary'
pass 'runtime accept works'

HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" node - <<'NODE' "$root" >/dev/null
const path = require('path');
const runtime = require(path.join(process.argv[2], 'runtime'));
const input = { command: ['npx', '-y', 'tsx', 'scripts/check.ts'].join(' '), targetPath: 'scripts/check.ts', tool: 'Bash' };
runtime.recordApproval(input);
runtime.recordApproval(input);
runtime.recordApproval(input);
NODE
promote_key="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" node - <<'NODE' "$root"
const path = require('path');
const runtime = require(path.join(process.argv[2], 'runtime'));
const suggestions = runtime.listSuggestions();
process.stdout.write(suggestions[suggestions.length - 1].key);
NODE
)"
HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime promote "$promote_key" >/dev/null
promoted_state="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime state)"
printf '%s\n' "$promoted_state" | grep -q 'learned-allows: 2' || fail 'runtime promote promotes reviewed local default'
printf '%s\n' "$promoted_state" | grep -q 'promoted-defaults: 2' || fail 'runtime promote updates promoted defaults summary'
printf '%s\n' "$promoted_state" | grep -q '\[promoted-defaults\]' || fail 'runtime state lists promoted defaults'
printf '%s\n' "$promoted_state" | grep -q 'created-at:' || fail 'runtime state shows promoted default creation time'
printf '%s\n' "$promoted_state" | grep -q 'eligible-at:' || fail 'runtime state shows promoted default eligibility time'
printf '%s\n' "$promoted_state" | grep -q 'accepted-at:' || fail 'runtime state shows promoted default acceptance time'
printf '%s\n' "$promoted_state" | grep -q 'last-approved-at:' || fail 'runtime state shows promoted default approval history'
pass 'runtime promote works'

record_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime record-approval --tool Bash --command 'sudo systemctl restart app' --target ops/service)"
printf '%s\n' "$record_output" | grep -q 'Recorded approval:' || fail 'runtime record-approval prints result'
pass 'runtime record-approval works'

repo="$tmp_home/repo"
mkdir -p "$repo/ops"
git -C "$tmp_home" init repo >/dev/null 2>&1
git -C "$repo" checkout -b release >/dev/null 2>&1
cat > "$repo/lilara.config.json" <<'EOF'
{
  "runtime": {
    "trust_posture": "balanced",
    "protected_branches": ["release"]
  }
}
EOF

protected_repo="$tmp_home/protected-repo"
mkdir -p "$protected_repo/ops"
git -C "$tmp_home" init protected-repo >/dev/null 2>&1
git -C "$protected_repo" checkout -b release >/dev/null 2>&1
cat > "$protected_repo/lilara.config.json" <<'EOF'
{
  "runtime": {
    "trust_posture": "balanced",
    "protected_branches": ["release"]
  }
}
EOF

shape_repo="$tmp_home/shape-repo"
mkdir -p "$shape_repo/src"
git -C "$tmp_home" init shape-repo >/dev/null 2>&1
git -C "$shape_repo" checkout -b feature/runtime >/dev/null 2>&1
cat > "$shape_repo/package.json" <<'EOF'
{"name":"shape-repo"}
EOF
cat > "$shape_repo/src/app.ts" <<'EOF'
export const app = true;
EOF

tests_shape_repo="$tmp_home/tests-shape-repo"
mkdir -p "$tests_shape_repo"
git -C "$tmp_home" init tests-shape-repo >/dev/null 2>&1
git -C "$tests_shape_repo" checkout -b feature/tests >/dev/null 2>&1
cat > "$tests_shape_repo/package.json" <<'EOF'
{"name":"tests-shape-repo"}
EOF

# Seed lifecycle state for the exact explain key so promotion-lifecycle fields appear.
# Use discover() to resolve the branch so the stored key matches what decide() uses.
HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" node - <<NODE "$root" "$repo" >/dev/null
const path = require('path');
const runtime = require(path.join(process.argv[2], 'runtime'));
const repoRoot = process.argv[3];
const raw = { command: 'sudo systemctl restart app', targetPath: path.join(repoRoot, 'ops'), tool: 'Bash', projectRoot: repoRoot };
const discovered = runtime.discover(raw);
const enriched = { ...raw, ...discovered };
runtime.recordApproval(enriched);
runtime.recordApproval(enriched);
runtime.recordApproval(enriched);
const sug = runtime.listSuggestions().find((s) => s.key.includes('sudo'));
if (sug) runtime.acceptSuggestion(sug.key);
NODE

explain_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'sudo systemctl restart app' --target "$repo/ops" )"
printf '%s\n' "$explain_output" | grep -q 'explanation:' || fail 'runtime explain prints explanation'
printf '%s\n' "$explain_output" | grep -q 'policy-key:' || fail 'runtime explain prints policy key'
printf '%s\n' "$explain_output" | grep -q 'branch: release' || fail 'runtime explain discovers branch'
printf '%s\n' "$explain_output" | grep -q 'action: require-review' || fail 'runtime explain exposes extended action'
printf '%s\n' "$explain_output" | grep -q 'action-plan-review: protected-branch-review' || fail 'runtime explain prints review plan'
printf '%s\n' "$explain_output" | grep -q 'workflow-lane: review' || fail 'runtime explain prints workflow lane'
printf '%s\n' "$explain_output" | grep -q 'workflow-target: lilara-cli.review' || fail 'runtime explain prints workflow target'
printf '%s\n' "$explain_output" | grep -q 'workflow-command: lilara-cli.sh review' || fail 'runtime explain prints workflow command'
printf '%s\n' "$explain_output" | grep -q 'promotion-stage:' || fail 'runtime explain prints promotion stage'
printf '%s\n' "$explain_output" | grep -q 'promotion-lifecycle:' || fail 'runtime explain prints compact promotion lifecycle summary'
printf '%s\n' "$explain_output" | grep -q 'promotion-created-at:' || fail 'runtime explain prints promotion creation timestamp'
printf '%s\n' "$explain_output" | grep -q 'promotion-eligible-at:' || fail 'runtime explain prints promotion eligibility timestamp'
printf '%s\n' "$explain_output" | grep -q 'promotion-accepted-at:' || fail 'runtime explain prints accepted promotion timestamp'
printf '%s\n' "$explain_output" | grep -q 'promotion-last-approved-at:' || fail 'runtime explain prints promotion approval history'
pass 'runtime explain works'

modify_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'cat prod/config' --target "$repo/prod/service" --branch feature/payments )"
printf '%s\n' "$modify_output" | grep -q 'action: modify' || fail 'runtime explain prints modify action'
printf '%s\n' "$modify_output" | grep -q 'workflow-lane: narrow' || fail 'runtime explain prints modify workflow lane'
printf '%s\n' "$modify_output" | grep -q 'action-plan-hints:' || fail 'runtime explain prints modification hints'
pass 'runtime modify action plan works'

destructive_cmd="$(printf '%s %s %s' 'rm' '-rf' '/tmp/build')"
HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime record-approval --tool Bash --command "$destructive_cmd" --target /tmp/build >/dev/null
HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime record-approval --tool Bash --command "$destructive_cmd" --target /tmp/build >/dev/null
adaptive_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command "$destructive_cmd" --target /tmp/build)"
printf '%s\n' "$adaptive_output" | grep -q 'promote this verification pattern into a reviewed project default' || fail 'runtime explain adapts action plan from history'
printf '%s\n' "$adaptive_output" | grep -q 'promotion-stage:' || fail 'runtime explain shows promotion stage'
printf '%s\n' "$adaptive_output" | grep -q 'promotion-guidance:' || fail 'runtime explain shows promotion guidance'

stack_tests_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command "$destructive_cmd" --target "$tests_shape_repo/build" --projectRoot "$tests_shape_repo")"
printf '%s\n' "$stack_tests_output" | grep -q 'action: require-tests' || fail 'runtime explain keeps destructive stack-aware work in require-tests action'
printf '%s\n' "$stack_tests_output" | grep -q 'action-plan-commands:' || fail 'runtime explain prints stack-aware verification commands'
printf '%s\n' "$stack_tests_output" | grep -q '    - npm test' || fail 'runtime explain prints stack-aware npm test command'
printf '%s\n' "$stack_tests_output" | grep -q '    - npm run lint' || fail 'runtime explain prints stack-aware npm lint command'
pass 'runtime adaptive action plan and promotion guidance works'

route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'npm test' --target web/app.ts)"
printf '%s\n' "$route_output" | grep -q 'workflow-lane: checks' || fail 'runtime explain routes low-risk verification into checks lane'
printf '%s\n' "$route_output" | grep -q 'workflow-target: lilara-cli.check' || fail 'runtime explain prints checks workflow target'
printf '%s\n' "$route_output" | grep -q 'workflow-command: lilara-cli.sh check' || fail 'runtime explain prints checks workflow command'

source_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'update module' --target src/runtime/app.ts --branch feature/ci-test)"
printf '%s\n' "$source_route_output" | grep -q 'workflow-lane: checks' || fail 'runtime explain routes source-file work into checks lane'
printf '%s\n' "$source_route_output" | grep -q 'workflow-target: lilara-cli.check' || fail 'runtime explain prints source-file checks target'

source_shape_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'update module' --target "$shape_repo/src/app.ts" --projectRoot "$shape_repo")"
printf '%s\n' "$source_shape_output" | grep -q 'workflow-lane: checks' || fail 'runtime explain routes source-file work into checks lane for detected project shape'
printf '%s\n' "$source_shape_output" | grep -q 'workflow-reason: This target looks like source code in a node project, so the safest default route is through stack-aware checks.' || fail 'runtime explain prints stack-aware source route reason'
printf '%s\n' "$source_shape_output" | grep -q 'workflow-command: lilara-cli.sh check && npm test' || fail 'runtime explain prints stack-aware source route command'

source_edit_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Edit --command 'edit module' --target src/runtime/app.ts --branch feature/ci-test)"
printf '%s\n' "$source_edit_output" | grep -q 'workflow-lane: checks' || fail 'runtime explain routes direct source edits into checks lane'
printf '%s\n' "$source_edit_output" | grep -q 'workflow-reason: This target looks like source code, so direct edits should route through local checks first.' || fail 'runtime explain prints tool-aware source edit reason'

strict_source_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'update module' --target src/runtime/app.ts --projectRoot "$repo")"
printf '%s\n' "$strict_source_route_output" | grep -q 'workflow-lane: review' || fail 'runtime explain routes source-file work into review lane under strict trust posture'
printf '%s\n' "$strict_source_route_output" | grep -q 'workflow-target: lilara-cli.review' || fail 'runtime explain prints strict source-file review target'

protected_source_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'update module' --target src/runtime/app.ts --projectRoot "$protected_repo")"
printf '%s\n' "$protected_source_route_output" | grep -q 'workflow-lane: review' || fail 'runtime explain routes protected-branch source work into review lane'
printf '%s\n' "$protected_source_route_output" | grep -q 'workflow-reason: This target looks like source code on protected branch release, so it should route through review first.' || fail 'runtime explain prints protected source review reason'

strict_source_edit_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Edit --command 'edit module' --target src/runtime/app.ts --projectRoot "$repo")"
printf '%s\n' "$strict_source_edit_output" | grep -q 'workflow-lane: review' || fail 'runtime explain routes strict direct source edits into review lane'
printf '%s\n' "$strict_source_edit_output" | grep -q 'workflow-target: lilara-cli.review' || fail 'runtime explain prints strict direct source edit review target'

protected_source_edit_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Edit --command 'edit module' --target src/runtime/app.ts --projectRoot "$protected_repo")"
printf '%s\n' "$protected_source_edit_output" | grep -q 'workflow-lane: review' || fail 'runtime explain routes protected-branch source edits into review lane'
printf '%s\n' "$protected_source_edit_output" | grep -q 'workflow-reason: This target looks like source code on protected branch release, so direct edits should route through review first.' || fail 'runtime explain prints protected source edit review reason'

 docs_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'update docs' --target docs/runtime-notes.md --branch feature/ci-test)"
printf '%s\n' "$docs_route_output" | grep -q 'workflow-lane: direct' || fail 'runtime explain keeps docs updates on direct lane by default'

setup_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'setup profile full' --target lilara.config.json --branch feature/ci-test)"
printf '%s\n' "$setup_route_output" | grep -q 'workflow-lane: setup' || fail 'runtime explain routes setup work into setup lane'
printf '%s\n' "$setup_route_output" | grep -q 'workflow-target: lilara-cli.setup' || fail 'runtime explain prints setup workflow target'
printf '%s\n' "$setup_route_output" | grep -q 'workflow-command: lilara-cli.sh setup' || fail 'runtime explain prints setup workflow command'

setup_shape_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'setup project' --target "$shape_repo" --projectRoot "$shape_repo")"
printf '%s\n' "$setup_shape_output" | grep -q 'project-config: missing' || fail 'runtime explain prints missing project-config state'
printf '%s\n' "$setup_shape_output" | grep -q 'project-stack: node' || fail 'runtime explain prints discovered project stack'
printf '%s\n' "$setup_shape_output" | grep -q 'project-markers: node' || fail 'runtime explain prints discovered project markers'
printf '%s\n' "$setup_shape_output" | grep -q 'workflow-lane: setup' || fail 'runtime explain keeps project-shape setup in setup lane'
printf '%s\n' "$setup_shape_output" | grep -q 'workflow-target: lilara-cli.generate-config' || fail 'runtime explain routes missing-config setup into generate-config target'
printf '%s\n' "$setup_shape_output" | grep -q 'workflow-reason: This looks like setup work, and the project shape already looks like node, so generate config once before install.' || fail 'runtime explain prints project-shape setup reason'
printf '%s\n' "$setup_shape_output" | grep -q 'workflow-command: bash scripts/generate-config.sh ' || fail 'runtime explain prints generate-config setup command'
printf '%s\n' "$setup_shape_output" | grep -q 'explanation: .*stack=node' || fail 'runtime explain includes project stack in explanation'
printf '%s\n' "$setup_shape_output" | grep -q 'explanation: .*config=missing' || fail 'runtime explain includes missing-config flag in explanation'

wiring_edit_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Edit --command 'edit settings' --target .claude/settings.json --branch feature/hooks)"
printf '%s\n' "$wiring_edit_output" | grep -q 'workflow-lane: wiring' || fail 'runtime explain routes direct settings edits into wiring lane'
printf '%s\n' "$wiring_edit_output" | grep -q 'workflow-target: lilara-cli.wire' || fail 'runtime explain prints wiring target for direct settings edits'
printf '%s\n' "$wiring_edit_output" | grep -q 'workflow-reason: This looks like direct hook or settings editing, so route through wiring guidance first.' || fail 'runtime explain prints tool-aware wiring reason'

strict_wiring_edit_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Edit --command 'edit settings' --target .claude/settings.json --projectRoot "$repo")"
printf '%s\n' "$strict_wiring_edit_output" | grep -q 'workflow-lane: review' || fail 'runtime explain routes strict wiring edits into review lane'
printf '%s\n' "$strict_wiring_edit_output" | grep -q 'workflow-target: lilara-cli.review' || fail 'runtime explain prints strict wiring review target'

protected_wiring_edit_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Edit --command 'edit settings' --target .claude/settings.json --projectRoot "$protected_repo")"
printf '%s\n' "$protected_wiring_edit_output" | grep -q 'workflow-lane: review' || fail 'runtime explain routes protected wiring edits into review lane'
printf '%s\n' "$protected_wiring_edit_output" | grep -q 'workflow-reason: This looks like hook or settings work on protected branch release, so it should route through review before wiring changes continue.' || fail 'runtime explain prints protected wiring review reason'

payload_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'redact payload.json' --target payload.json)"
printf '%s\n' "$payload_route_output" | grep -q 'workflow-lane: payload' || fail 'runtime explain routes payload work into payload lane'
printf '%s\n' "$payload_route_output" | grep -q 'workflow-target: lilara-cli.redact' || fail 'runtime explain prints payload redact target'
printf '%s\n' "$payload_route_output" | grep -q 'workflow-command: lilara-cli.sh redact <file>' || fail 'runtime explain prints payload workflow command'

class_b_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'open customer export' --target exports/customer.csv --payloadClass B --branch feature/ci-test)"
printf '%s\n' "$class_b_route_output" | grep -q 'workflow-lane: payload' || fail 'runtime explain routes class B payloads into payload lane'
printf '%s\n' "$class_b_route_output" | grep -q 'workflow-target: lilara-cli.review' || fail 'runtime explain prints class B review target'

# ADR-002 Option B: class C blocks by default. With an operator-token demotion
# token, F4 yields require-review (legitimate inspection use case). Mint a
# scoped one-shot token, pass it via env, expect review lane.
class_c_demote_token="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" operator-token mint test-class-c-route --scope class-c-review-demote 2>/dev/null | awk -F': ' '/^Token:/ {print $2}')"
class_c_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" LILARA_F4_DEMOTE_TOKEN="$class_c_demote_token" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'inspect incident bundle' --target bundle.zip --payloadClass C --branch feature/incidents)"
printf '%s\n' "$class_c_route_output" | grep -q 'workflow-lane: review' || fail 'runtime explain routes class C payloads into review lane (with demote token)'
printf '%s\n' "$class_c_route_output" | grep -q 'workflow-target: lilara-cli.review' || fail 'runtime explain prints class C review target'

# ADR-002 Option B negative: without operator-token, class C stays blocked.
class_c_blocked_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'inspect incident bundle' --target bundle.zip --payloadClass C --branch feature/incidents)"
printf '%s\n' "$class_c_blocked_output" | grep -q 'workflow-lane: blocked' || fail 'runtime explain routes class C payloads to blocked without demote token'

classify_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'classify payload.json' --target payload.json --branch feature/ci-test)"
printf '%s\n' "$classify_route_output" | grep -q 'workflow-target: lilara-cli.classify' || fail 'runtime explain prints payload classify target'

payload_review_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'review payload.json' --target payload.json --branch feature/ci-test)"
printf '%s\n' "$payload_review_output" | grep -q 'workflow-lane: payload' || fail 'runtime explain keeps payload review in payload lane'
printf '%s\n' "$payload_review_output" | grep -q 'workflow-target: lilara-cli.review' || fail 'runtime explain prints payload review target'
printf '%s\n' "$payload_review_output" | grep -q 'workflow-command: lilara-cli.sh review <file>' || fail 'runtime explain prints payload review command'

review_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'security review auth diff' --target changes.patch)"
printf '%s\n' "$review_route_output" | grep -q 'workflow-lane: review' || fail 'runtime explain routes review work into review lane'
printf '%s\n' "$review_route_output" | grep -q 'workflow-target: lilara-cli.review' || fail 'runtime explain prints review workflow target'
printf '%s\n' "$review_route_output" | grep -q 'workflow-command: lilara-cli.sh review' || fail 'runtime explain prints review workflow command'
escalate_route_output="$(HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'git push --force origin main' --target src/app.ts --branch feature/ci-test)"
printf '%s\n' "$escalate_route_output" | grep -q 'workflow-lane: escalation' || fail 'runtime explain routes force-push into escalation lane'
printf '%s\n' "$escalate_route_output" | grep -q 'workflow-target: human-gate' || fail 'runtime explain prints human-gate target for escalation'
pass 'runtime escalation lane routing works'

pass 'runtime workflow routing guidance works'

dismiss_home="$(mktemp -d)"
cp -r "$tmp_home/." "$dismiss_home/"
HOME="$dismiss_home" LILARA_STATE_DIR="$dismiss_home" bash "$root/scripts/lilara-cli.sh" runtime record-approval --tool Bash --command 'npx -y tsx scripts/cache.ts' --target production/cache.ts >/dev/null
HOME="$dismiss_home" LILARA_STATE_DIR="$dismiss_home" bash "$root/scripts/lilara-cli.sh" runtime record-approval --tool Bash --command 'npx -y tsx scripts/cache.ts' --target production/cache.ts >/dev/null
HOME="$dismiss_home" LILARA_STATE_DIR="$dismiss_home" bash "$root/scripts/lilara-cli.sh" runtime record-approval --tool Bash --command 'npx -y tsx scripts/cache.ts' --target production/cache.ts >/dev/null
dismiss_key="$(HOME="$dismiss_home" LILARA_STATE_DIR="$dismiss_home" node - <<'NODE' "$root"
const path = require('path');
const runtime = require(path.join(process.argv[2], 'runtime'));
const suggestions = runtime.listSuggestions().filter((item) => item.key.includes('auto-download'));
process.stdout.write(suggestions[0].key);
NODE
)"
HOME="$dismiss_home" LILARA_STATE_DIR="$dismiss_home" bash "$root/scripts/lilara-cli.sh" runtime dismiss "$dismiss_key" >/dev/null
dismissed_state="$(HOME="$dismiss_home" LILARA_STATE_DIR="$dismiss_home" bash "$root/scripts/lilara-cli.sh" runtime state)"
printf '%s\n' "$dismissed_state" | grep -q 'dismissed-defaults: 1' || fail 'runtime state tracks dismissed defaults'
printf '%s\n' "$dismissed_state" | grep -q '\[dismissed-defaults\]' || fail 'runtime state lists dismissed defaults'
printf '%s\n' "$dismissed_state" | grep -q 'created-at:' || fail 'runtime state shows dismissed default creation time'
printf '%s\n' "$dismissed_state" | grep -q 'eligible-at:' || fail 'runtime state shows dismissed default eligibility time'
printf '%s\n' "$dismissed_state" | grep -q 'dismissed-at:' || fail 'runtime state shows dismissed timestamp'
dismissed_explain="$(HOME="$dismiss_home" LILARA_STATE_DIR="$dismiss_home" bash "$root/scripts/lilara-cli.sh" runtime explain --tool Bash --command 'npx -y tsx scripts/cache.ts' --target production/cache.ts)"
printf '%s\n' "$dismissed_explain" | grep -q 'promotion-lifecycle:' || fail 'runtime explain prints dismissed lifecycle summary'
printf '%s\n' "$dismissed_explain" | grep -q 'promotion-created-at:' || fail 'runtime explain prints dismissed promotion creation timestamp'
printf '%s\n' "$dismissed_explain" | grep -q 'promotion-eligible-at:' || fail 'runtime explain prints dismissed promotion eligibility timestamp'
printf '%s\n' "$dismissed_explain" | grep -q 'promotion-dismissed-at:' || fail 'runtime explain prints dismissed promotion timestamp'
rm -rf "$dismiss_home"
HOME="$tmp_home" LILARA_STATE_DIR="$tmp_home" bash "$root/scripts/lilara-cli.sh" runtime dismiss 'missing-key' >/dev/null 2>&1 && fail 'runtime dismiss should fail on missing key' || true
pass 'runtime dismiss rejects unknown key'

# B.1 auto-allow-once CLI verb
aao_home="$(mktemp -d)"
HOME="$aao_home" LILARA_STATE_DIR="$aao_home" bash "$root/scripts/lilara-cli.sh" runtime record-approval --tool Bash --command 'npx -y tsx scripts/migrate.ts' --target scripts/ >/dev/null
HOME="$aao_home" LILARA_STATE_DIR="$aao_home" bash "$root/scripts/lilara-cli.sh" runtime record-approval --tool Bash --command 'npx -y tsx scripts/migrate.ts' --target scripts/ >/dev/null
HOME="$aao_home" LILARA_STATE_DIR="$aao_home" bash "$root/scripts/lilara-cli.sh" runtime record-approval --tool Bash --command 'npx -y tsx scripts/migrate.ts' --target scripts/ >/dev/null
aao_key="$(HOME="$aao_home" LILARA_STATE_DIR="$aao_home" node - <<'NODE' "$root"
const path = require('path');
const runtime = require(path.join(process.argv[2], 'runtime'));
const suggestions = runtime.listSuggestions().filter((item) => item.key.includes('auto-download'));
process.stdout.write(suggestions[0].key);
NODE
)"
aao_output="$(HOME="$aao_home" LILARA_STATE_DIR="$aao_home" bash "$root/scripts/lilara-cli.sh" runtime auto-allow-once "$aao_key")"
printf '%s\n' "$aao_output" | grep -q "Granted auto-allow-once for:" || fail 'runtime auto-allow-once prints grant confirmation'
HOME="$aao_home" LILARA_STATE_DIR="$aao_home" bash "$root/scripts/lilara-cli.sh" runtime auto-allow-once 'bash|generic|default-target|A' >/dev/null 2>&1 && fail 'runtime auto-allow-once should fail for non-eligible key' || true
rm -rf "$aao_home"
pass 'runtime auto-allow-once CLI verb works'

printf '\nRuntime CLI checks passed.\n'
