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

sample_repo="$workdir/sample-repo"
mkdir -p "$sample_repo/src" "$sample_repo/backend" "$sample_repo/scripts"
printf 'console.log("hi")\n' > "$sample_repo/src/app.ts"
printf 'def main():\n    return 1\n' > "$sample_repo/backend/app.py"
printf '#!/usr/bin/env bash\necho ok\n' > "$sample_repo/scripts/test.sh"

printf '[check-installation]\n'
printf 'Workspace: %s\n' "$workdir"

# 1. generate starter config
bash "$root/scripts/generate-config.sh" "$sample_repo" --output "$sample_repo/lilara.config.json" >/dev/null
check_file "$sample_repo/lilara.config.json" 'generate-config output'
grep -q '"typescript"' "$sample_repo/lilara.config.json" || fail 'generate-config detects typescript'
grep -q '"python"' "$sample_repo/lilara.config.json" || fail 'generate-config detects python'
pass 'generate-config'

# 2. minimal profile
minimal_target="$workdir/minimal-install"
bash "$root/scripts/install-local.sh" "$minimal_target" --profile minimal >/dev/null
check_file "$minimal_target/README.md" 'minimal install copies README'
check_file "$minimal_target/scripts/install-local.sh" 'minimal install copies install script'
check_file "$minimal_target/claude/hooks/secret-warning.js" 'minimal install copies hooks'
check_missing "$minimal_target/agents/code-reviewer.md" 'minimal install should not copy agents'
check_missing "$minimal_target/skills/code-review.md" 'minimal install should not copy skills'
pass 'install profile: minimal'

# 3. rules profile with auto-detection
rules_target="$sample_repo/.ecc-auto"
bash "$root/scripts/install-local.sh" "$rules_target" --profile rules --auto >/dev/null
check_file "$rules_target/rules/typescript/coding-style.md" 'rules auto copies typescript rules'
check_file "$rules_target/rules/python/coding-style.md" 'rules auto copies python rules'
check_file "$rules_target/rules/common/security.md" 'rules auto copies common rules'
check_missing "$rules_target/rules/rust/coding-style.md" 'rules auto excludes unrelated rust rules'
pass 'install profile: rules --auto'

# 4. agents profile
agents_target="$workdir/agents-install"
bash "$root/scripts/install-local.sh" "$agents_target" --profile agents >/dev/null
check_file "$agents_target/agents/code-reviewer.md" 'agents profile copies agents'
check_missing "$agents_target/skills/code-review.md" 'agents profile should not copy skills'
pass 'install profile: agents'

# 5. skills profile
skills_target="$workdir/skills-install"
bash "$root/scripts/install-local.sh" "$skills_target" --profile skills >/dev/null
check_file "$skills_target/skills/code-review.md" 'skills profile copies skills'
check_missing "$skills_target/agents/code-reviewer.md" 'skills profile should not copy agents'
pass 'install profile: skills'

# 6. full profile + ecc.config consumption
full_target="$workdir/full-install"
mkdir -p "$full_target"
cp "$sample_repo/lilara.config.json" "$full_target/lilara.config.json"
bash "$root/scripts/install-local.sh" "$full_target" >/dev/null
check_file "$full_target/agents/code-reviewer.md" 'config-driven install copies agents'
check_file "$full_target/skills/code-review.md" 'config-driven install copies skills'
check_file "$full_target/rules/typescript/coding-style.md" 'config-driven install copies configured rules'
pass 'install profile from lilara.config.json'

# 7. list mode
list_output="$workdir/list-output.txt"
bash "$root/scripts/install-local.sh" "$sample_repo" --profile rules --auto --list > "$list_output"
grep -q 'rules/typescript/coding-style.md' "$list_output" || fail 'list mode shows expected rule file'
grep -q 'Total:' "$list_output" || fail 'list mode prints total'
pass 'install list mode'

# 8. hook snippet generation
wire_output="$workdir/wire-output.txt"
bash "$root/scripts/wire-hooks.sh" "$minimal_target/claude/hooks" > "$wire_output"
grep -q 'secret-warning.js' "$wire_output" || fail 'wire-hooks emits hook snippet'
grep -q "$minimal_target/claude/hooks/" "$wire_output" || fail 'wire-hooks substitutes absolute path'
pass 'wire-hooks snippet generation'

# 9. hook runtime verification in installed target
(
  cd "$minimal_target"
  bash ./scripts/wire-hooks.sh --verify >/dev/null
)
pass 'wire-hooks --verify'

# 10. install.sh --dry-run
dry_output="$workdir/dry-output.txt"
bash "$root/scripts/install.sh" "$workdir/dry-target" --profile rules --yes --dry-run > "$dry_output"
grep -q 'secret-warning.js' "$dry_output" || fail 'install.sh --dry-run lists hooks'
grep -q 'Total:' "$dry_output" || fail 'install.sh --dry-run prints total'
pass 'install.sh --dry-run'

# 11. install.sh fresh install
fresh_target="$workdir/fresh-install"
bash "$root/scripts/install.sh" "$fresh_target" --profile minimal --tool claude --yes > /dev/null
check_file "$fresh_target/claude/hooks/secret-warning.js" 'install.sh copies hooks'
check_file "$fresh_target/scripts/install-local.sh" 'install.sh copies scripts'
check_file "$fresh_target/VERSION" 'install.sh writes VERSION'
pass 'install.sh fresh install'

# 12. upgrade.sh — same-version is a no-op
same_ver_output="$workdir/same-ver.txt"
bash "$root/scripts/upgrade.sh" "$fresh_target" > "$same_ver_output"
grep -q 'nothing to do' "$same_ver_output" || fail 'upgrade.sh reports nothing-to-do when version matches'
pass 'upgrade.sh same-version no-op'

# 13. upgrade.sh — version bump updates files and preserves lilara.config.json
upgrade_target="$workdir/upgrade-target"
bash "$root/scripts/install-local.sh" "$upgrade_target" --profile minimal >/dev/null
# Write a fake old version and a config that must be preserved
printf '0.9.0\n' > "$upgrade_target/VERSION"
cat > "$upgrade_target/lilara.config.json" <<'CFGEOF'
{"profile":"minimal","_test":"preserved"}
CFGEOF
upgrade_output="$workdir/upgrade-output.txt"
bash "$root/scripts/upgrade.sh" "$upgrade_target" > "$upgrade_output"
grep -q 'updated' "$upgrade_output" || fail 'upgrade.sh reports files updated'
# VERSION should now be current
current_ver="$(cat "$root/VERSION")"
installed_ver="$(cat "$upgrade_target/VERSION")"
[ "$installed_ver" = "$current_ver" ] || fail "upgrade.sh did not update VERSION ($installed_ver != $current_ver)"
# lilara.config.json must be preserved (our _test marker must still be there)
grep -q '_test' "$upgrade_target/lilara.config.json" || fail 'upgrade.sh overwrote lilara.config.json'
check_file "$upgrade_target/claude/hooks/secret-warning.js" 'upgrade.sh kept hooks'
pass 'upgrade.sh version bump'

printf '\nInstallation checks passed.\n'
