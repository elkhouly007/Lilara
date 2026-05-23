#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

pass() { printf '  ok      %s\n' "$1"; }
fail() { printf '  ERROR   %s\n' "$1" >&2; exit 1; }
check_file() { [ -f "$1" ] || fail "$2"; }
check_missing() { [ ! -e "$1" ] || fail "$2"; }

printf '[check-config-integration]\n'

sample_repo="$workdir/sample-repo"
mkdir -p "$sample_repo/src" "$sample_repo/server" "$sample_repo/.claude"
printf 'console.log("x")\n' > "$sample_repo/src/app.ts"
printf 'package main\nfunc main() {}\n' > "$sample_repo/server/main.go"

# 1. generate-config to stdout and file
bash "$root/scripts/generate-config.sh" "$sample_repo" > "$workdir/generated.stdout.json"
grep -Fq '"typescript"' "$workdir/generated.stdout.json" || fail 'generate-config stdout includes typescript'
grep -Fq '"golang"' "$workdir/generated.stdout.json" || fail 'generate-config stdout includes golang'
pass 'generate-config stdout'

bash "$root/scripts/generate-config.sh" "$sample_repo" --output "$sample_repo/lilara.config.json" >/dev/null
check_file "$sample_repo/lilara.config.json" 'generate-config file output'
grep -Fq '"profile": "full"' "$sample_repo/lilara.config.json" || fail 'generate-config default profile is full'
grep -Fq '"runtime": {' "$sample_repo/lilara.config.json" || fail 'generate-config includes runtime block'
grep -Fq '"trust_posture": "balanced"' "$sample_repo/lilara.config.json" || fail 'generate-config runtime trust posture present'
pass 'generate-config file output'

# 2. install-local consumes lilara.config.json automatically
install_target="$workdir/config-install"
mkdir -p "$install_target"
cp "$sample_repo/lilara.config.json" "$install_target/lilara.config.json"
bash "$root/scripts/install-local.sh" "$install_target" >/dev/null
check_file "$install_target/rules/typescript/coding-style.md" 'config-driven install includes typescript rules'
check_file "$install_target/rules/golang/coding-style.md" 'config-driven install includes golang rules'
check_missing "$install_target/rules/python/coding-style.md" 'config-driven install omits unconfigured python rules'
pass 'install-local consumes lilara.config.json languages'

# 3. wire-hooks --check detects stale placeholder in a controlled HOME
fake_home="$workdir/home"
mkdir -p "$fake_home/.claude"
cat > "$fake_home/.claude/settings.json" <<'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {"type": "command", "command": "node /ABS_PATH/session-start.js"}
        ]
      }
    ]
  }
}
EOF
if HOME="$fake_home" bash "$root/scripts/wire-hooks.sh" --check >/tmp/ecc-wire-check.out 2>/tmp/ecc-wire-check.err; then
  fail 'wire-hooks --check should fail when placeholder exists'
fi
grep -Fq '/ABS_PATH/' /tmp/ecc-wire-check.err || fail 'wire-hooks --check reports placeholder'
pass 'wire-hooks --check detects stale placeholder'

# 4. runtime config affects runtime decisions
cat > "$sample_repo/lilara.config.json" <<'EOF'
{
  "profile": "full",
  "languages": ["common"],
  "agents": [],
  "skills": [],
  "extra_rules": [],
  "hooks": {"enforce_secrets": false},
  "runtime": {
    "trust_posture": "strict",
    "protected_branches": ["release"],
    "sensitive_path_patterns": ["vault", "payments"]
  }
}
EOF
LILARA_STATE_DIR="$workdir" node - <<'NODE' "$root" "$sample_repo" || exit 1
const path = require('path');
const root = process.argv[2];
const repo = require('path').resolve(process.argv[3]);
const runtime = require(path.join(root, 'runtime'));
const decision = runtime.decide({
  tool: 'Bash',
  command: ['sudo', 'systemctl', 'restart', 'api'].join(' '),
  targetPath: path.join(repo, 'vault/service'),
  branch: 'release',
  projectRoot: repo,
});
if (!decision.explanation.includes('trust=strict')) throw new Error('expected strict trust posture in explanation');
if (!decision.explanation.includes(`project=${repo}`)) throw new Error('expected project scope in explanation');
if (decision.riskScore < 7) throw new Error(`expected elevated project-aware risk, got ${decision.riskScore}`);
if (decision.context.projectScope !== repo) throw new Error(`expected projectScope ${repo}, got ${decision.context.projectScope}`);
console.log('project-aware-runtime: ok');
NODE
pass 'project config influences runtime decisions'

cat > "$sample_repo/lilara.config.json" <<'EOF'
{
  "profile": "full",
  "languages": ["common", "golang"],
  "agents": [],
  "skills": [],
  "extra_rules": [],
  "hooks": {"enforce_secrets": false},
  "runtime": {
    "trust_posture": "balanced",
    "protected_branches": ["release"]
  }
}
EOF
LILARA_STATE_DIR="$workdir" node - <<'NODE' "$root" "$sample_repo" || exit 1
const path = require('path');
const root = process.argv[2];
const repo = require('path').resolve(process.argv[3]);
const runtime = require(path.join(root, 'runtime'));
const decision = runtime.decide({
  tool: 'Bash',
  command: ['rm', '-rf', '/tmp/build'].join(' '),
  targetPath: path.join(repo, 'tmp/build'),
  projectRoot: repo,
  repeatedApprovals: 0,
  sessionRisk: 0,
});
if (decision.action !== 'require-tests') throw new Error(`expected require-tests, got ${decision.action}`);
if (!Array.isArray(decision.actionPlan.commands) || !decision.actionPlan.commands.includes('go test ./...')) throw new Error(`expected golang-aware test command, got ${decision.actionPlan.commands}`);
console.log('config-stack-runtime: ok');
NODE
pass 'project config languages influence stack-aware runtime plans'

# 5. wire-hooks --check passes after placeholder removal
cat > "$fake_home/.claude/settings.json" <<'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {"type": "command", "command": "node /real/path/session-start.js"}
        ]
      }
    ]
  }
}
EOF
HOME="$fake_home" bash "$root/scripts/wire-hooks.sh" --check >/tmp/ecc-wire-check.out 2>/tmp/ecc-wire-check.err || fail 'wire-hooks --check should pass without placeholder'
pass 'wire-hooks --check clean state'

printf '\nConfig integration checks passed.\n'
