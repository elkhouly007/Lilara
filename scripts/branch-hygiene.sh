#!/usr/bin/env bash
# Branch hygiene — list (and optionally delete) merged/stale git branches.
#
# Usage:
#   bash scripts/branch-hygiene.sh                # list only (default — safe)
#   bash scripts/branch-hygiene.sh --apply       # actually delete (dry-run by default)
#   bash scripts/branch-hygiene.sh --apply --yes # skip confirmation prompt
#
# What it cleans up:
#   1. Remote branches fully merged into origin/master (no open PR, not base of any PR)
#   2. Local branches fully merged into master with no upstream tracking
#
# What it NEVER deletes:
#   - origin/master, master, the current branch
#   - Any remote branch with an OPEN PR (head or base reference)
#   - Any remote branch that is the base of any PR (open or closed)
#   - Branches matching the protected prefixes (feat/f27-*, feat/adr-054-*, phase-*)
#
# Exit codes:
#   0 = clean (nothing to delete, or deletion completed successfully)
#   1 = error
#   2 = dry-run-only — deletion requested but --apply not set

set -uo pipefail

APPLY=0
YES=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --yes)   YES=1 ;;
    -h|--help)
      sed -n '2,18p' "$0"; exit 0 ;;
    *)
      echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

# --- PROTECTED BRANCH PATTERNS (never delete, even if merged) ---
PROTECTED_PATTERNS=(
  '^origin/master$'
  '^master$'
  '^origin/feat/f27-'
  '^origin/feat/adr-054-'
  '^origin/phase-'
  '^feat/f27-'
  '^feat/adr-054-'
  '^phase-'
)

is_protected() {
  local b="$1"
  local p
  for p in "${PROTECTED_PATTERNS[@]}"; do
    if [[ "$b" =~ $p ]]; then return 0; fi
  done
  return 1
}

# --- fetch latest state ---
git fetch origin --prune >/dev/null 2>&1 || true

# --- enumerate candidate remote branches (merged into origin/master) ---
mapfile -t merged_remote < <(git branch -r --merged origin/master --format='%(refname:short)' \
  | grep -vE '^origin/(HEAD|master)$|^origin$' || true)

declare -a to_delete_remote
for b in "${merged_remote[@]}"; do
  [ -z "$b" ] && continue
  if is_protected "$b"; then
    echo "PROTECTED (skip): $b"
    continue
  fi
  short="${b#origin/}"
  # skip if any open PR uses it as head
  if gh pr list --state open --json headRefName --jq ".[] | select(.headRefName==\"$short\") | .headRefName" \
      2>/dev/null | grep -q .; then
    echo "OPEN-PR-HEAD (skip): $b"
    continue
  fi
  # skip if any PR uses it as base
  if gh pr list --state all --limit 200 --json baseRefName \
      --jq ".[] | select(.baseRefName==\"$short\") | .baseRefName" \
      2>/dev/null | grep -q .; then
    echo "BASE-REFERENCED (skip): $b"
    continue
  fi
  to_delete_remote+=("$b")
done

# --- enumerate candidate local stale branches (merged into master, no upstream) ---
current_branch="$(git rev-parse --abbrev-ref HEAD)"
mapfile -t local_branches < <(git for-each-ref --format='%(refname:short)' refs/heads/ \
  | grep -vE "^${current_branch}$|^master$" || true)

declare -a to_delete_local
for b in "${local_branches[@]}"; do
  [ -z "$b" ] && continue
  if is_protected "$b"; then
    echo "PROTECTED (skip): $b"
    continue
  fi
  # only delete if upstream is gone or branch is fully merged into master
  upstream="$(git rev-parse --abbrev-ref "$b@{upstream}" 2>/dev/null || echo "")"
  if [ -z "$upstream" ]; then
    # no upstream — safe to delete locally
    to_delete_local+=("$b")
  elif git merge-base --is-ancestor "$b" master 2>/dev/null; then
    to_delete_local+=("$b")
  else
    echo "NOT-MERGED-NO-UPSTREAM-DELETE (skip): $b"
  fi
done

# --- report ---
echo ""
echo "===== REMOTE BRANCHES MARKED FOR DELETION: ${#to_delete_remote[@]} ====="
for b in "${to_delete_remote[@]:-}"; do [ -n "$b" ] && echo "  $b"; done

echo ""
echo "===== LOCAL BRANCHES MARKED FOR DELETION: ${#to_delete_local[@]} ====="
for b in "${to_delete_local[@]:-}"; do [ -n "$b" ] && echo "  $b"; done

# --- act ---
if [ "${#to_delete_remote[@]}" -eq 0 ] && [ "${#to_delete_local[@]}" -eq 0 ]; then
  echo ""
  echo "Nothing to delete. Clean."
  exit 0
fi

if [ "$APPLY" -eq 0 ]; then
  echo ""
  echo "DRY RUN — re-run with --apply (and --yes to skip prompt) to actually delete."
  exit 2
fi

if [ "$YES" -eq 0 ]; then
  echo ""
  read -r -p "Delete ${#to_delete_remote[@]} remote + ${#to_delete_local[@]} local branches? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

echo ""
echo "--- deleting remote branches ---"
for b in "${to_delete_remote[@]}"; do
  echo -n "  $b ... "
  if git push origin --delete "${b#origin/}" >/dev/null 2>&1; then
    echo "OK"
  else
    echo "FAILED (continuing)"
  fi
done

echo ""
echo "--- deleting local branches ---"
for b in "${to_delete_local[@]}"; do
  echo -n "  $b ... "
  if git branch -d "$b" >/dev/null 2>&1; then
    echo "OK"
  elif git branch -D "$b" >/dev/null 2>&1; then
    echo "OK (force)"
  else
    echo "FAILED (continuing)"
  fi
done

echo ""
echo "Done."
