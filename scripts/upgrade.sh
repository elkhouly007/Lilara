#!/usr/bin/env bash
# upgrade.sh — Upgrade an existing Agent Runtime Guard installation in-place.
#
# Usage:
#   bash scripts/upgrade.sh [INSTALLED_DIR]
#
# What it does:
#   1. Reads the old VERSION from INSTALLED_DIR/VERSION.
#   2. Reads the profile from INSTALLED_DIR/lilara.config.json (falls back to minimal).
#   3. Re-runs install-local.sh with the same profile, updating all kit files.
#   4. Preserves INSTALLED_DIR/lilara.config.json — never overwritten.
#   5. Prints a summary: old version → new version, files updated.
#
# What it does NOT touch:
#   - Your lilara.config.json (preserved always).
#   - State files (learned-policy.json, session-context.json, decision-journal.jsonl)
#     which live in LILARA_STATE_DIR (~/.lilara/ by default)
#     and are completely outside the install directory.

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

target="${1:-.}"

if [ ! -d "$target" ]; then
  die "Directory not found: $target"
fi

target="$(cd -- "$target" && pwd)"

# ── read old version ──────────────────────────────────────────────────────────

old_version="unknown"
if [ -f "$target/VERSION" ]; then
  old_version="$(cat "$target/VERSION")"
fi

new_version="unknown"
if [ -f "${root}/VERSION" ]; then
  new_version="$(cat "${root}/VERSION")"
fi

printf '\n%s%s Agent Runtime Guard — Upgrade%s\n\n' "$BOLD$CYAN" "═══" "$RESET"
info "Target      : $target"
info "Installed   : $old_version"
info "Available   : $new_version"
printf '\n'

if [ "$old_version" = "$new_version" ]; then
  ok "Already at v${new_version} — nothing to do."
  printf '\n'
  exit 0
fi

# ── read profile from installed lilara.config.json ───────────────────────────────

profile="minimal"
config_path="$target/lilara.config.json"

if [ -f "$config_path" ] && command -v node >/dev/null 2>&1; then
  _read_profile="$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$config_path','utf8'));
      if (c.profile && /^(minimal|rules|agents|skills|full)$/.test(c.profile)) {
        process.stdout.write(c.profile);
      }
    } catch {}
  " 2>/dev/null || true)"
  [ -n "$_read_profile" ] && profile="$_read_profile"
fi

info "Profile     : $profile (from lilara.config.json)"
printf '\n'

# ── preserve lilara.config.json ──────────────────────────────────────────────────
# install-local.sh does not copy lilara.config.json, so it is never overwritten.
# We record its mtime for the post-upgrade check, as belt-and-suspenders.

config_exists=0
config_mtime=""
if [ -f "$config_path" ]; then
  config_exists=1
  config_mtime="$(date -r "$config_path" '+%s' 2>/dev/null || stat -c '%Y' "$config_path" 2>/dev/null || printf '')"
fi

# ── run install ───────────────────────────────────────────────────────────────

bash "${root}/scripts/install-local.sh" "$target" --profile "$profile" >/dev/null
ok "Kit files updated"

# ── update VERSION in installed dir ──────────────────────────────────────────

[ -f "${root}/VERSION" ] && cp "${root}/VERSION" "$target/VERSION"
ok "VERSION updated: $old_version → $new_version"

# ── verify lilara.config.json was not touched ────────────────────────────────────

if [ "$config_exists" -eq 1 ]; then
  if [ ! -f "$config_path" ]; then
    warn "lilara.config.json was unexpectedly removed — restoring from backup is not possible."
    warn "Re-generate it with: bash ${root}/scripts/generate-config.sh \"$target\" --output \"$config_path\""
  else
    ok "lilara.config.json preserved"
  fi
fi

# ── summary ───────────────────────────────────────────────────────────────────

printf '\n%s%s Upgrade complete %s%s\n' "$BOLD$GREEN" "═══" "═══" "$RESET"
printf '  %s → %s\n' "$old_version" "$new_version"
printf '  Location : %s\n' "$target"
printf '\n'
printf '  State files in ~/.lilara/ were not touched.\n'
printf '  To verify hooks: bash %s/scripts/wire-hooks.sh --verify\n' "$root"
printf '\n'
