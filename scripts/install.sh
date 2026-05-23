#!/usr/bin/env bash
# install.sh — One-command install for Agent Runtime Guard.
#
# Usage:
#   bash scripts/install.sh [TARGET_DIR] [OPTIONS]
#
# Options:
#   --profile  minimal|rules|agents|skills|full   content profile (default: rules)
#   --tool     claude|opencode|openclaw            target harness (default: claude)
#   --auto     auto-detect languages from TARGET_DIR
#   --yes      skip confirmation prompt
#   --dry-run  show what would be installed, exit 0
#   -h|--help  show this message
#
# After install, paste the hook snippet printed at the end into your
# harness settings file (e.g. ~/.claude/settings.json → "hooks" section).
#
# State files (learned-policy, session-context, decision-journal) live in
# ~/.lilara/ and are never touched by this script.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

# ── colours ──────────────────────────────────────────────────────────────────

if [ -t 1 ]; then
  BOLD="$(tput bold 2>/dev/null || printf '')"
  GREEN="$(tput setaf 2 2>/dev/null || printf '')"
  CYAN="$(tput setaf 6 2>/dev/null || printf '')"
  YELLOW="$(tput setaf 3 2>/dev/null || printf '')"
  RED="$(tput setaf 1 2>/dev/null || printf '')"
  RESET="$(tput sgr0 2>/dev/null || printf '')"
else
  BOLD="" GREEN="" CYAN="" YELLOW="" RED="" RESET=""
fi

ok()   { printf '%s  ✓  %s%s\n' "$GREEN" "$1" "$RESET"; }
warn() { printf '%s  ⚠  %s%s\n' "$YELLOW" "$1" "$RESET" >&2; }
die()  { printf '%s  ✗  %s%s\n' "$RED" "$1" "$RESET" >&2; exit 1; }
info() { printf '     %s\n' "$1"; }

# ── argument parsing ──────────────────────────────────────────────────────────

target=""
profile="rules"
tool="claude"
auto_detect=0
yes=0
dry_run=0

usage() {
  cat <<'EOF'
Usage: install.sh [TARGET_DIR] [OPTIONS]

  TARGET_DIR   project directory to install into (default: current directory)

Options:
  --profile  minimal|rules|agents|skills|full   (default: rules)
  --tool     claude|opencode|openclaw            (default: claude)
  --auto     auto-detect languages from TARGET_DIR
  --yes      skip confirmation prompt
  --dry-run  show what would be installed, exit 0
  -h|--help  show this message

Profiles:
  minimal   hooks + core policy only
  rules     minimal + language rule files  (recommended)
  agents    minimal + agent definitions
  skills    minimal + skill files
  full      everything
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)  usage; exit 0 ;;
    --dry-run)  dry_run=1 ;;
    --yes|-y)   yes=1 ;;
    --auto)     auto_detect=1 ;;
    --profile)
      shift
      case "${1:-}" in
        minimal|rules|agents|skills|full) profile="$1" ;;
        *) die "Unknown profile: ${1:-}. Choose: minimal|rules|agents|skills|full" ;;
      esac
      ;;
    --profile=*)
      val="${1#--profile=}"
      case "$val" in
        minimal|rules|agents|skills|full) profile="$val" ;;
        *) die "Unknown profile: $val. Choose: minimal|rules|agents|skills|full" ;;
      esac
      ;;
    --tool)
      shift
      case "${1:-}" in
        claude|opencode|openclaw) tool="$1" ;;
        codex|clawcode|antegravity)
          die "'${1:-}' is planned but not yet supported. Supported: claude|opencode|openclaw" ;;
        *) die "Unknown tool: ${1:-}. Choose: claude|opencode|openclaw" ;;
      esac
      ;;
    --tool=*)
      val="${1#--tool=}"
      case "$val" in
        claude|opencode|openclaw) tool="$val" ;;
        *) die "Unknown tool: $val. Choose: claude|opencode|openclaw" ;;
      esac
      ;;
    -*) die "Unknown option: $1. Run with --help for usage." ;;
    *)  target="$1" ;;
  esac
  shift
done

target="${target:-.}"

# ── prereq checks ─────────────────────────────────────────────────────────────

printf '\n%s%s Agent Runtime Guard — Install%s\n\n' "$BOLD$CYAN" "═══" "$RESET"

if ! command -v node >/dev/null 2>&1; then
  warn "Node.js not found in PATH."
  warn "The runtime hooks require Node.js 18+. Install it before using the hooks."
  warn "Install will proceed — hooks will not be executable until Node.js is available."
fi

if ! command -v git >/dev/null 2>&1; then
  warn "git not found. context-discovery and branch protection features will be limited."
fi

# ── resolve target ────────────────────────────────────────────────────────────

if [ ! -d "$target" ]; then
  if [ "$dry_run" -eq 0 ]; then
    printf "Target directory '%s' does not exist. Create it? [Y/n] " "$target"
    if [ "$yes" -eq 0 ]; then
      IFS= read -r _ans </dev/tty || _ans=""
    else
      _ans="y"
      printf 'y\n'
    fi
    case "${_ans:-y}" in
      [nN]*) die "Aborted." ;;
      *) mkdir -p "$target" ;;
    esac
  fi
fi

if [ -d "$target" ]; then
  target="$(cd -- "$target" && pwd)"
else
  # dry-run: directory not yet created — resolve to absolute path without cd
  case "$target" in
    /*) ;;
    *) target="$(pwd)/$target" ;;
  esac
fi

info "Target  : $target"
info "Profile : $profile"
info "Tool    : $tool"
[ "$auto_detect" -eq 1 ] && info "Languages: auto-detect"
printf '\n'

# ── dry run ───────────────────────────────────────────────────────────────────

if [ "$dry_run" -eq 1 ]; then
  printf '%sDry run — files that would be installed:%s\n' "$BOLD" "$RESET"
  install_args="$target --profile $profile"
  [ "$auto_detect" -eq 1 ] && install_args="$install_args --auto"
  bash "${root}/scripts/install-local.sh" $install_args --list
  exit 0
fi

# ── confirmation ──────────────────────────────────────────────────────────────

if [ "$yes" -eq 0 ]; then
  printf 'Install Agent Runtime Guard into %s? [Y/n] ' "$target"
  IFS= read -r _confirm </dev/tty || _confirm=""
  case "${_confirm:-y}" in
    [nN]*) die "Aborted." ;;
  esac
fi

# ── install ───────────────────────────────────────────────────────────────────

install_args="$target --profile $profile"
[ "$auto_detect" -eq 1 ] && install_args="$install_args --auto"

bash "${root}/scripts/install-local.sh" $install_args >/dev/null
ok "Files installed (profile: $profile)"

# ── generate lilara.config.json if not present ───────────────────────────────────

config_path="$target/lilara.config.json"
if [ ! -f "$config_path" ]; then
  if command -v node >/dev/null 2>&1 && [ -f "${root}/scripts/generate-config.sh" ]; then
    bash "${root}/scripts/generate-config.sh" "$target" --output "$config_path" >/dev/null 2>&1 && \
      ok "Generated lilara.config.json" || \
      warn "Could not auto-generate lilara.config.json — copy lilara.config.json.example manually"
  else
    warn "lilara.config.json not found. Copy $target/lilara.config.json.example to $target/lilara.config.json and edit it."
  fi
else
  ok "lilara.config.json already present — not overwritten"
fi

# Copy VERSION into installed dir so upgrade.sh can read it
[ -f "${root}/VERSION" ] && cp "${root}/VERSION" "$target/VERSION" || true

# ── wire-hooks snippet ────────────────────────────────────────────────────────

if [ "$tool" = "claude" ] || [ "$tool" = "both" ]; then
  printf '\n%s%s Next Step: Wire hooks into Claude Code %s%s\n' "$BOLD$CYAN" "═══" "═══" "$RESET"
  printf 'Add this snippet to your %s~/.claude/settings.json%s under the "hooks" key:\n\n' "$BOLD" "$RESET"
  bash "${root}/scripts/wire-hooks.sh" "$target/claude/hooks" 2>/dev/null || \
    printf '  (wire-hooks.sh failed — run manually: bash %s/scripts/wire-hooks.sh %s/claude/hooks)\n' "$root" "$target"
fi

if [ "$tool" = "opencode" ]; then
  printf '\n%sOpenCode:%s review %s/opencode/opencode.safe.jsonc and copy relevant parts into your OpenCode config.\n' \
    "$BOLD" "$RESET" "$target"
fi

if [ "$tool" = "openclaw" ]; then
  printf '\n%sOpenClaw:%s review %s/openclaw/WIRING_PLAN.md for integration steps.\n' \
    "$BOLD" "$RESET" "$target"
fi

# ── summary ───────────────────────────────────────────────────────────────────

version=""
[ -f "${root}/VERSION" ] && version="$(cat "${root}/VERSION")"

printf '\n%s%s Installation complete %s%s\n' "$BOLD$GREEN" "═══" "═══" "$RESET"
[ -n "$version" ] && printf '  Version  : %s\n' "$version"
printf '  Location : %s\n' "$target"
printf '  Profile  : %s\n' "$profile"
printf '\n'
printf '  To upgrade later: bash %s/scripts/upgrade.sh "%s"\n' "$root" "$target"
printf '  To verify:        bash %s/scripts/wire-hooks.sh --verify\n' "$root"
printf '  To check health:  bash %s/scripts/lilara-cli.sh check\n' "$root"
printf '\n'
