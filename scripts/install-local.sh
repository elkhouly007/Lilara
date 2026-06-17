#!/usr/bin/env bash
set -eu

# install-local.sh — Copy Agent Runtime Guard files into a target directory.
#
# Usage:
#   ./scripts/install-local.sh [target-dir] [--profile minimal|rules|agents|skills|full]
#   ./scripts/install-local.sh [target-dir] --list
#   ./scripts/install-local.sh [target-dir] --auto   (detect languages from target repo)
#
# Profiles:
#   minimal  (default) — hooks, prompts, core policy. No agents/rules/skills.
#   rules    — minimal + rule files for detected or all languages.
#   agents   — minimal + all agent definitions.
#   skills   — minimal + all skill definitions.
#   full     — everything.
#
# No npm install. No global file changes. Copies files only into target-dir.

usage() {
  cat <<'EOF'
Usage: install-local.sh [target-dir] [options]

Options:
  --profile  minimal|rules|agents|skills|full   content profile (default: minimal)
  --auto     detect languages from target repo and copy only relevant rule files
  --list     show what would be copied, then exit (dry run)
  -h|--help  show this message

Profiles:
  minimal   hooks + prompts + core policy (safe for all projects)
  rules     minimal + language rule files
  agents    minimal + agent definition files
  skills    minimal + skill files
  full      everything
EOF
}

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
target="./.lilara"
profile="minimal"
auto_detect=0
list_only=0

# ── argument parsing ──────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)     usage; exit 0 ;;
    --list)        list_only=1 ;;
    --auto)        auto_detect=1 ;;
    --profile)
      shift
      case "${1:-}" in
        minimal|rules|agents|skills|full) profile="$1" ;;
        *) printf 'Unknown profile: %s\n' "${1:-}" >&2; usage; exit 2 ;;
      esac
      ;;
    --profile=*)
      val="${1#--profile=}"
      case "$val" in
        minimal|rules|agents|skills|full) profile="$val" ;;
        *) printf 'Unknown profile: %s\n' "$val" >&2; usage; exit 2 ;;
      esac
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2; usage; exit 2
      ;;
    *)
      target="$1"
      ;;
  esac
  shift
done

[ -n "$target" ] || { usage; exit 2; }

# ── lilara.config.json loading ───────────────────────────────────────────────────
# If lilara.config.json exists in the target directory, read profile and languages
# from it. CLI flags always override config file values.

config_profile=""
config_langs=""
config_agents=""
config_skills=""

load_ecc_config() {
  local cfg="$1"
  [ -f "$cfg" ] || return 0
  if ! command -v node >/dev/null 2>&1; then
    printf 'NOTE: node not found — skipping lilara.config.json.\n' >&2
    return 0
  fi
  # Use node to safely parse JSON — no external npm packages required.
  local parsed
  parsed="$(node - "$cfg" <<'JSEOF'
const fs   = require("fs");
const path = process.argv[2];
let cfg;
try { cfg = JSON.parse(fs.readFileSync(path, "utf8")); } catch { process.exit(0); }

const profile  = typeof cfg.profile   === "string" ? cfg.profile : "";
const langs    = Array.isArray(cfg.languages) ? cfg.languages.join(" ") : "";
const agents   = Array.isArray(cfg.agents)    ? cfg.agents.join(" ")    : "";
const skills   = Array.isArray(cfg.skills)    ? cfg.skills.join(" ")    : "";
// Output as key=value pairs for eval
console.log("config_profile=" + JSON.stringify(profile));
console.log("config_langs="   + JSON.stringify(langs));
console.log("config_agents="  + JSON.stringify(agents));
console.log("config_skills="  + JSON.stringify(skills));
JSEOF
  )" || return 0

  eval "$parsed" 2>/dev/null || true
  [ -n "$config_profile" ] && printf 'lilara.config.json: profile=%s\n' "$config_profile"
  [ -n "$config_langs"   ] && printf 'lilara.config.json: languages=%s\n' "$config_langs"
  return 0
}

# Look for config in the target directory (where the project is)
config_file="$target/lilara.config.json"
[ -f "$config_file" ] && load_ecc_config "$config_file"

# Apply config values if not overridden by CLI flags
# (profile variable was set from CLI; only use config if still at default)
[ "$profile" = "minimal" ] && [ -n "$config_profile" ] && profile="$config_profile"

# ── language auto-detection ───────────────────────────────────────────────────

# Maps file extension to rule directory name.
detect_languages() {
  local scan_dir="$1"
  local langs=""

  # Build extension → language mapping
  has_ext() { find "$scan_dir" -maxdepth 6 -name "*.$1" -not -path '*/.git/*' -not -path '*/node_modules/*' | head -1 | grep -q .; }

  has_ext "py"                          && langs="$langs python"
  { has_ext "ts" || has_ext "tsx"; }    && langs="$langs typescript"
  has_ext "go"                          && langs="$langs golang"
  has_ext "java"                        && langs="$langs java"
  has_ext "kt" || has_ext "kts"         && langs="$langs kotlin"
  has_ext "rs"                          && langs="$langs rust"
  { has_ext "cpp" || has_ext "cc" || has_ext "cxx"; } && langs="$langs cpp"
  has_ext "cs"                          && langs="$langs csharp"
  has_ext "swift"                       && langs="$langs swift"
  has_ext "php"                         && langs="$langs php"
  { has_ext "pl" || has_ext "pm"; }     && langs="$langs perl"
  has_ext "sql"                         && langs="$langs database"
  { has_ext "html" || has_ext "css" || has_ext "jsx"; } && langs="$langs web"

  # Always include common and infrastructure
  langs="$langs common infrastructure"

  # Deduplicate and trim
  printf '%s\n' $langs | sort -u | tr '\n' ' '
}

# ── file list builders ────────────────────────────────────────────────────────

minimal_files() {
  cat <<'EOF'
README.md
SECURITY_MODEL.md
MODULES.md
DECISIONS.md
claude/AGENTS.md
claude/manifest.json
opencode/opencode.safe.jsonc
opencode/prompts/planner.md
opencode/prompts/code-review.md
opencode/prompts/security-review.md
opencode/prompts/build-fix.md
openclaw/README.md
openclaw/prompts/planner.md
openclaw/prompts/reviewer.md
openclaw/prompts/security.md
hermes/manifest.json
hermes/README.md
hermes/WIRING_PLAN.md
hermes/HERMES_POLICY_MAP.md
hermes/hooks/adapter.js
hermes/hooks/post-adapter.js
references/phase1-policy.md
references/phase2-policy.md
references/phase3-policy.md
scripts/install-local.sh
scripts/audit-local.sh
scripts/wire-hooks.sh
EOF
}

rules_files() {
  local langs="$1"
  for lang in $langs; do
    dir="$root/rules/$lang"
    [ -d "$dir" ] || continue
    for f in "$dir"/*.md; do
      [ -f "$f" ] || continue
      printf 'rules/%s/%s\n' "$lang" "$(basename "$f")"
    done
  done
}

agents_files() {
  for f in "$root/agents"/*.md; do
    [ -f "$f" ] || continue
    printf 'agents/%s\n' "$(basename "$f")"
  done
}

skills_files() {
  for f in "$root/skills"/*.md; do
    [ -f "$f" ] || continue
    printf 'skills/%s\n' "$(basename "$f")"
  done
}

# hooks_files — every file under claude/hooks/ (js, json, md). Replaces the
# former hardcoded list in minimal_files() so new hooks/patterns are picked up
# automatically without a manifest update.
hooks_files() {
  ( cd "$root" && find claude/hooks -type f ) | sort
}

# runtime_files — the full decision engine (78 js modules, incl. consent/ and
# notify/ subdirs). Shipped to <target>/runtime/ so the thin hook adapters can
# resolve ../../runtime/pretool-gate correctly from <target>/claude/hooks/.
runtime_files() {
  ( cd "$root" && find runtime -type f -name '*.js' ) | sort
}

# schemas_files — JSON schemas read by runtime/config-validator.js on the
# decide() path (lilara.config.schema.json, lilara.contract.schema.json).
schemas_files() {
  ( cd "$root" && find schemas -type f -name '*.json' ) | sort
}

# ── build file list ───────────────────────────────────────────────────────────

# Determine which languages to include for rule profiles.
# Priority: --auto flag > lilara.config.json languages > all languages.
if [ "$auto_detect" -eq 1 ] && [ -d "$target" ]; then
  langs="$(detect_languages "$target")"
elif [ "$auto_detect" -eq 1 ]; then
  # If target does not exist yet, prefer scanning its parent project directory.
  parent_dir="$(dirname -- "$target")"
  if [ -d "$parent_dir" ] && [ "$parent_dir" != "." ] && [ "$parent_dir" != "$target" ]; then
    langs="$(detect_languages "$parent_dir")"
  else
    # Fall back to current directory.
    langs="$(detect_languages "$(pwd)")"
  fi
elif [ -n "$config_langs" ]; then
  # Use languages from lilara.config.json
  langs="$config_langs common infrastructure"
  langs="$(printf '%s\n' $langs | sort -u | tr '\n' ' ')"
  printf 'Using languages from lilara.config.json: %s\n' "$langs"
else
  # All languages
  langs="$(ls "$root/rules/" | grep -v README | tr '\n' ' ')"
fi

# Collect all paths.
# hooks/runtime/schemas are core enforcement infrastructure shipped for EVERY
# profile — an installed target without runtime/ silently fails open (exit 1,
# not exit 2) under LILARA_ENFORCE=1 because hook-utils.js can't resolve
# ../../runtime at module load time.
all_files="$(minimal_files)
$(hooks_files)
$(runtime_files)
$(schemas_files)"

case "$profile" in
  rules)
    all_files="$all_files
$(rules_files "$langs")"
    ;;
  agents)
    all_files="$all_files
$(agents_files)"
    ;;
  skills)
    all_files="$all_files
$(skills_files)"
    ;;
  full)
    all_files="$all_files
$(rules_files "$langs")
$(agents_files)
$(skills_files)"
    ;;
esac

# Deduplicate
all_files="$(printf '%s\n' $all_files | sort -u)"

# ── list mode ────────────────────────────────────────────────────────────────

if [ "$list_only" -eq 1 ]; then
  printf 'Profile  : %s\n' "$profile"
  printf 'Target   : %s\n' "$target"
  [ "$auto_detect" -eq 1 ] && printf 'Languages: %s\n' "$langs"
  printf '\nFiles that would be copied:\n'
  printf '%s\n' "$all_files" | grep -v '^$' | while read -r f; do
    if [ -f "$root/$f" ]; then printf '  %s\n' "$f"
    else                        printf '  %s  [MISSING IN SOURCE]\n' "$f"
    fi
  done
  count="$(printf '%s\n' "$all_files" | grep -c '[^[:space:]]' || true)"
  printf '\nTotal: %s files\n' "$count"
  exit 0
fi

# ── copy ─────────────────────────────────────────────────────────────────────

mkdir -p "$target"

copy_path() {
  src="$root/$1"
  dest="$target/$1"
  if [ ! -f "$src" ]; then
    printf 'SKIP (missing): %s\n' "$1" >&2
    return
  fi
  mkdir -p "$(dirname -- "$dest")"
  cp "$src" "$dest"
}

printf '%s\n' "$all_files" | grep -v '^$' | while read -r f; do
  copy_path "$f"
done

# Make scripts and hooks executable
find "$target/scripts" -name '*.sh' -exec chmod +x {} \; 2>/dev/null || true
find "$target/claude/hooks" -name '*.js' -exec chmod +x {} \; 2>/dev/null || true

# Copy VERSION if it exists
[ -f "$root/VERSION" ] && cp "$root/VERSION" "$target/VERSION" || true

printf '\n'
printf 'Installed Agent Runtime Guard → %s\n' "$target"
printf 'Profile  : %s\n' "$profile"
[ "$auto_detect" -eq 1 ] && printf 'Languages: %s\n' "$langs"
printf '\n'
printf 'Next steps:\n'
printf '  1. Run: %s/scripts/wire-hooks.sh\n' "$target"
printf '     Copy the printed snippet into your Claude Code / OpenClaw settings.\n'
printf '  2. Run: %s/scripts/audit-local.sh\n' "$target"
printf 'No dependencies installed. No global files changed.\n'
