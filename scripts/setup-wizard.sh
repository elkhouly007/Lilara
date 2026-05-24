#!/usr/bin/env bash
# setup-wizard.sh — Guided onboarding for Agent Runtime Guard.
#
# Asks 5 questions, then outputs:
#   1. A ready-to-run install command.
#   2. A starter lilara.config.json to copy into <target-dir>/lilara.config.json.
#
# Usage:
#   ./scripts/setup-wizard.sh                  # interactive
#   ./scripts/setup-wizard.sh --non-interactive \
#     --target ./my-project \
#     --tool claude \
#     --languages python,javascript \
#     --profile rules \
#     --wire-hooks yes
#
# The wizard never modifies files; it only prints what to run and what to copy.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

# ── colours ──────────────────────────────────────────────────────────────────

if [ -t 1 ]; then
  BOLD="$(tput bold 2>/dev/null || printf '')"
  DIM="$(tput dim 2>/dev/null || printf '')"
  GREEN="$(tput setaf 2 2>/dev/null || printf '')"
  CYAN="$(tput setaf 6 2>/dev/null || printf '')"
  YELLOW="$(tput setaf 3 2>/dev/null || printf '')"
  RESET="$(tput sgr0 2>/dev/null || printf '')"
else
  BOLD="" DIM="" GREEN="" CYAN="" YELLOW="" RESET=""
fi

banner() {
  printf '\n%s╔══════════════════════════════════════════════════════╗%s\n' "$CYAN" "$RESET"
  printf '%s║   Agent Runtime Guard  —  Onboarding Wizard                ║%s\n' "$CYAN" "$RESET"
  printf '%s╚══════════════════════════════════════════════════════╝%s\n\n' "$CYAN" "$RESET"
}

step() { printf '%s[%s]%s %s\n' "$BOLD$GREEN" "$1" "$RESET" "$2"; }
info() { printf '%s  →  %s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '%s  ⚠  %s%s\n' "$YELLOW" "$1" "$RESET"; }

# ── argument parsing ──────────────────────────────────────────────────────────

non_interactive=0
opt_target=""
opt_tool=""
opt_languages=""
opt_profile=""
opt_wire=""

while [ $# -gt 0 ]; do
  case "$1" in
    --non-interactive) non_interactive=1 ;;
    --target)     shift; opt_target="${1:-}" ;;
    --tool)       shift; opt_tool="${1:-}" ;;
    --languages)  shift; opt_languages="${1:-}" ;;
    --profile)    shift; opt_profile="${1:-}" ;;
    --wire-hooks) shift; opt_wire="${1:-}" ;;
    -h|--help)
      printf 'Usage: %s [--non-interactive --target DIR --tool claude|opencode|openclaw|both --languages LANG,... --profile minimal|rules|agents|skills|full --wire-hooks yes|no]\n' "$0"
      exit 0
      ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

# ── question helper ───────────────────────────────────────────────────────────

ask() {
  # ask <varname> <prompt> <default> <choices-hint>
  local varname="$1"
  local prompt="$2"
  local default="$3"
  local hint="$4"

  if [ "$non_interactive" -eq 1 ]; then
    eval "$varname=\"\${opt_${varname}:-$default}\""
    return
  fi

  printf '\n%s%s%s\n' "$BOLD" "$prompt" "$RESET"
  [ -n "$hint" ] && printf '%s  Options: %s%s\n' "$DIM" "$hint" "$RESET"
  [ -n "$default" ] && printf '%s  Default: %s%s\n' "$DIM" "$default" "$RESET"
  printf '  > '
  # shellcheck disable=SC2034
  IFS= read -r _answer </dev/tty || _answer=""
  eval "$varname=\"\${_answer:-$default}\""
}

# ── wizard ────────────────────────────────────────────────────────────────────

banner

printf 'This wizard sets up Agent Runtime Guard in your project directory.\n'
printf 'Answer 5 short questions. Press Enter to accept the default.\n'

# Q1 — target directory
if [ "$non_interactive" -eq 0 ] && [ -z "$opt_target" ]; then
  step "1/5" "Where is your project? (target directory)"
  info "This is the directory that will receive the .claude/ or .opencode/ folder."
  printf '  Default: . (current directory)\n  > '
  IFS= read -r target </dev/tty || target=""
  target="${target:-.}"
else
  target="${opt_target:-.}"
fi

if [ ! -d "$target" ]; then
  warn "Directory '$target' not found — it will be treated as a new project."
fi

# Q2 — which tool
ask "tool" "2/5  Which AI coding tool do you use?" "claude" "claude | opencode | openclaw | both"
case "$tool" in
  claude|opencode|openclaw|both|codex|clawcode) ;;
  antegravity)
    printf '\n%sNOT YET SUPPORTED: "%s" integration is planned but not yet implemented.%s\n' "$YELLOW" "$tool" "$RESET" >&2
    printf 'Supported tools: claude | opencode | openclaw | both | codex | clawcode\n' >&2
    printf 'See the Harness Support Matrix in README.md for details.\n' >&2
    printf 'Stub integration contract: %s/README.md\n' "$root/$tool" >&2
    exit 1
    ;;
  *)
    printf '\n%sUnknown tool: "%s". Supported: claude | opencode | openclaw | both | codex | clawcode%s\n' "$YELLOW" "$tool" "$RESET" >&2
    printf 'Planned (not yet supported): antegravity\n' >&2
    printf 'See the Harness Support Matrix in README.md for details.\n' >&2
    exit 1
    ;;
esac

# Q3 — languages
ask "languages" "3/5  Which languages does this project use? (comma-separated)" "auto" \
  "python, javascript, typescript, golang, rust, java, kotlin, csharp, cpp, swift — or 'auto'"

# Q4 — profile
ask "profile" "4/5  Which content profile?" "rules" "minimal | rules | agents | skills | full"
case "$profile" in
  minimal|rules|agents|skills|full) ;;
  *) warn "Unknown profile '$profile' — defaulting to 'rules'"; profile="rules" ;;
esac

# Q5 — wire hooks
ask "wire" "5/5  Auto-wire hooks into settings.json?" "yes" "yes | no"
case "$wire" in
  yes|y|1|true)  wire="yes" ;;
  *)             wire="no" ;;
esac

# ── build install command ─────────────────────────────────────────────────────

printf '\n%s━━━ Generated Install Command ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n\n' "$CYAN" "$RESET"

install_cmd="bash ${root}/scripts/install-local.sh \"${target}\" --profile ${profile}"
config_note=""

if [ "$languages" != "auto" ] && [ -n "$languages" ]; then
  config_note="Selected languages are provided via lilara.config.json, so copy the generated config before running install."
else
  install_cmd="${install_cmd} --auto"
fi

printf '%s%s%s\n' "$BOLD" "$install_cmd" "$RESET"
[ -n "$config_note" ] && printf '%s# %s%s\n' "$DIM" "$config_note" "$RESET"

if [ "$wire" = "yes" ] && [ "$tool" = "claude" -o "$tool" = "both" ]; then
  printf '\n# Wire Claude hooks (run after install):\n'
  printf '%sbash %s/scripts/wire-hooks.sh \"%s/claude/hooks\"%s\n' "$BOLD" "$root" "$target" "$RESET"
fi

if [ "$wire" = "yes" ] && [ "$tool" = "opencode" -o "$tool" = "both" ]; then
  printf '\n# OpenCode uses the reviewed config template in your installed target:\n'
  printf '%s# Review %s/opencode/opencode.safe.jsonc and copy the relevant parts into your OpenCode config manually.%s\n' "$DIM" "$target" "$RESET"
fi

if [ "$wire" = "yes" ] && [ "$tool" = "openclaw" -o "$tool" = "both" ]; then
  printf '\n# OpenClaw uses project-local prompts and policy docs from your installed target:\n'
  printf '%s# Review %s/openclaw/WIRING_PLAN.md and %s/openclaw/OPENCLAW_APPLY_CHECKLIST.md before applying project-local integration.%s\n' "$DIM" "$target" "$target" "$RESET"
fi

# ── generate starter lilara.config.json ─────────────────────────────────────────

printf '\n%s━━━ Starter lilara.config.json ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n\n' "$CYAN" "$RESET"

# Build languages array
if [ "$languages" = "auto" ] || [ -z "$languages" ]; then
  lang_array="[]"
else
  lang_array="[$(printf '"%s"' "${languages}" | sed 's/,/","/g')]"
fi

# Enforce default based on profile
if [ "$profile" = "minimal" ]; then
  enforce_val="false"
else
  enforce_val="true"
fi

config_path="${target}/lilara.config.json"

# Use mktemp — never write to a predictable /tmp path (symlink attack risk).
_tmp_config="$(mktemp)"
trap 'rm -f "$_tmp_config"' EXIT

cat > "$_tmp_config" <<JSONEOF
{
  "_comment": "Agent Runtime Guard project configuration. Generated by setup-wizard.sh.",
  "profile": "${profile}",
  "languages": ${lang_array},
  "hooks": {
    "enforce_secrets": ${enforce_val},
    "enforce_dangerous_commands": false,
    "log_events": false
  },
  "tool": "${tool}"
}
JSONEOF

cat "$_tmp_config"

printf '\n%s# To write this config, copy the JSON above into:%s\n' "$DIM" "$RESET"
printf '%s  %s/lilara.config.json%s\n' "$BOLD" "$target" "$RESET"
printf '%s# Or simply: copy the JSON above into %s/lilara.config.json%s\n' "$DIM" "$target" "$RESET"

# ── summary ───────────────────────────────────────────────────────────────────

printf '\n%s━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$CYAN" "$RESET"
printf '  Target    : %s\n' "$target"
printf '  Tool      : %s\n' "$tool"
printf '  Languages : %s\n' "$languages"
printf '  Profile   : %s\n' "$profile"
printf '  Wire hooks: %s\n' "$wire"
printf '\n%sRun the command above to install Agent Runtime Guard into your project.%s\n\n' "$GREEN" "$RESET"
