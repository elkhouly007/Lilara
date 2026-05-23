#!/usr/bin/env bash
# scripts/lilara-rebrand.sh — one-time rename: HORUS_* → LILARA_*, horus.* → lilara.*
#
# Run once on a clean working tree on the rebrand/lilara branch.
#
# Usage:
#   bash scripts/lilara-rebrand.sh              # preview (dry-run, default)
#   bash scripts/lilara-rebrand.sh --apply      # apply changes (requires clean tree)
#   bash scripts/lilara-rebrand.sh --apply --force  # apply on dirty tree (emergency)
#   bash scripts/lilara-rebrand.sh --verify     # count remaining old-brand refs
#
# What this script applies:
#   Phase 1: HORUS_* → LILARA_* env-var prefix across all source/docs/tests
#   Phase 2: horus.* filename refs → lilara.* in content
#   Phase 3: .horus state-dir path → .lilara in content
#   Phase 4: Brand strings — "Horus Agentic Power" → "Lilara", \bHAP\b → "Lilara"
#   Phase 5: hap- contract ID prefix → lilara- (surgical: contract.js, schema, fixtures)
#   Phase 6: File renames (horus-cli.sh → lilara-cli.sh, schemas, examples, etc.)
#
# Self-exclusion: old brand tokens are stored via shell string concatenation so this
# script is immune to being rewritten by its own phases. See "Old brand tokens" below.
#
# Based on the ECC→Horus precedent in scripts/lilara-rebrand-history.sh with
# improvements: git-clean precheck, cross-platform sed, broader file globs,
# self-exclusion of this script, --force flag, improved --verify mode.

set -euo pipefail

# ── Old brand tokens (split via concatenation — literals never appear here) ────
# Using double-string-concatenation: "HOR""US_" evaluates to HORUS_ at runtime
# but the literal HORUS_ never appears in this source file.

O_ENV="HOR""US_"                   # HORUS_
O_DOT_DIR=".horu""s"               # .horus
O_BARE="horu""s"                   # horus (bare)
O_PROD="Horu""s Agenti""c Power"   # Horus Agentic Power
O_ACRO="HA""P"                     # HAP
O_CON_PRE="ha""p-"                 # hap-
O_CFG_F="horu""s.config"           # horus.config
O_CON_F="horu""s.contract"         # horus.contract
O_CLI="horu""s-cli"                # horus-cli
O_DIFF="horu""s-diff-decisions"    # horus-diff-decisions
O_REBRAND="horu""s-rebrand"        # horus-rebrand

# ── CLI flags ──────────────────────────────────────────────────────────────────

DRY_RUN=1
FORCE=0
VERIFY=0

for arg in "$@"; do
  case "$arg" in
    --apply)    DRY_RUN=0 ;;
    --dry-run)  DRY_RUN=1 ;;
    --force)    FORCE=1 ;;
    --verify)   VERIFY=1 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null \
       || dirname "$(dirname "$0")")"
cd "$ROOT"

# ── Helpers ────────────────────────────────────────────────────────────────────

changed=0
skipped=0

note()    { printf '  %s\n' "$*"; }
delta()   { changed=$((changed + 1)); printf '  CHANGE  %s\n' "$*"; }
rename_f(){ changed=$((changed + 1)); printf '  RENAME  %s → %s\n' "$1" "$2"; }
skip()    { skipped=$((skipped + 1)); printf '  SKIP    %s\n' "$*"; }

# Cross-platform sed -i: BSD macOS needs -i ''; GNU sed (Linux/git-bash) needs -i.
if sed --version 2>/dev/null | grep -q GNU; then
  _SI=(-i)
else
  _SI=(-i '')
fi
sed_i() { sed "${_SI[@]}" "$@"; }

# Bulk recursive content replacement.
# bulk_replace GREP_PAT SED_PAT SED_REP
# - Excludes: .git, node_modules, .claude, artifacts, archive
# - Excludes this script and check-no-horus.sh
# - Includes: *.js *.sh *.json *.md *.jsonc *.yaml *.yml *.txt *.example *.jsonl
bulk_replace() {
  local grep_pat="$1" sed_pat="$2" sed_rep="$3"
  local files
  files=$(grep -rl \
    --include="*.js"   --include="*.sh"     --include="*.json"   \
    --include="*.md"   --include="*.jsonc"  --include="*.yaml"   \
    --include="*.yml"  --include="*.txt"    --include="*.example" \
    --include="*.jsonl" \
    --exclude-dir=".git"         --exclude-dir="node_modules"    \
    --exclude-dir=".claude"      --exclude-dir="artifacts"       \
    --exclude-dir="archive"      \
    --exclude="lilara-rebrand.sh"  --exclude="check-no-horus.sh" \
    -- "$grep_pat" . 2>/dev/null || true)
  [ -z "$files" ] && return 0
  for f in $files; do
    f="${f#./}"
    if [ "$DRY_RUN" -eq 1 ]; then
      delta "would replace '$grep_pat' in $f"
    else
      sed_i "s|${sed_pat}|${sed_rep}|g" "$f"
      delta "replaced '$grep_pat' in $f"
    fi
  done
}

# Single-file targeted replacement.
# sed_file FILE GREP_FIXED_STR SED_SCRIPT
sed_file() {
  local file="$1" grep_str="$2" sed_script="$3"
  [ -f "$file" ] || return 0
  if grep -qF -- "$grep_str" "$file" 2>/dev/null; then
    if [ "$DRY_RUN" -eq 1 ]; then
      delta "would update '$grep_str' in $file"
    else
      sed_i "$sed_script" "$file"
      delta "updated '$grep_str' in $file"
    fi
  fi
}

# Rename a file if source exists and destination does not.
rename_file() {
  local src="$1" dst="$2"
  [ -f "$src" ] || return 0
  if [ -f "$dst" ]; then
    skip "rename $src → $dst (destination already exists)"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    rename_f "$src" "$dst"
  else
    git mv "$src" "$dst" 2>/dev/null || mv "$src" "$dst"
    rename_f "$src" "$dst"
  fi
}

# ── Verify mode ────────────────────────────────────────────────────────────────

if [ "$VERIFY" -eq 1 ]; then
  printf '\n=== Verify: remaining old-brand references ===\n'
  COMMON_ARGS=(
    --include="*.js"   --include="*.sh"   --include="*.json"
    --include="*.md"   --include="*.jsonc" --include="*.yaml"
    --include="*.yml"  --include="*.txt"  --include="*.example"
    --include="*.jsonl"
    --exclude-dir=".git"     --exclude-dir="node_modules"
    --exclude-dir=".claude"  --exclude-dir="archive"
    --exclude="CHANGELOG.md"
    --exclude="lilara-rebrand.sh" --exclude="check-no-horus.sh"
    --exclude="lilara-rebrand-history.sh"
  )
  total=0
  for token in "$O_ENV" "$O_DOT_DIR" "$O_CON_PRE" "$O_PROD"; do
    cnt=$(grep -r "${COMMON_ARGS[@]}" -- "$token" . 2>/dev/null | wc -l || echo 0)
    printf '  %-36s %d occurrence(s)\n' "$token:" "$cnt"
    total=$((total + cnt))
  done
  if [ "$total" -eq 0 ]; then
    printf '\nRebrand complete — no old-brand references found outside allowlist.\n'
    exit 0
  else
    printf '\nRebrand INCOMPLETE — %d occurrence(s) remain. Run --apply.\n' "$total"
    exit 1
  fi
fi

# ── Git-clean precheck ─────────────────────────────────────────────────────────

if [ "$DRY_RUN" -eq 0 ] && [ "$FORCE" -eq 0 ]; then
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    printf 'ERROR: Working tree is dirty. Commit or stash changes before --apply.\n' >&2
    printf 'Use --apply --force to override (not recommended).\n' >&2
    exit 1
  fi
fi

printf 'Mode: %s\n' "$([ "$DRY_RUN" -eq 1 ] && echo "DRY-RUN (preview only)" || echo "APPLY")"

# ── Phase 1: Env-var prefix HORUS_ → LILARA_ ──────────────────────────────────

printf '\n=== Phase 1: env-var prefix %s → LILARA_ ===\n' "$O_ENV"
bulk_replace "$O_ENV" "$O_ENV" "LILARA_"

# ── Phase 2: Filename refs in content ─────────────────────────────────────────

printf '\n=== Phase 2: filename references in content ===\n'

# Longest/most-specific patterns first to avoid partial-match collisions.
bulk_replace "${O_CON_F}.json.draft"      "${O_CON_F}.json.draft"      "lilara.contract.json.draft"
bulk_replace "${O_CON_F}.v3.json.example" "${O_CON_F}.v3.json.example" "lilara.contract.v3.json.example"
bulk_replace "${O_CON_F}.v2.json.example" "${O_CON_F}.v2.json.example" "lilara.contract.v2.json.example"
bulk_replace "${O_CON_F}.json.example"    "${O_CON_F}.json.example"    "lilara.contract.json.example"
bulk_replace "${O_CON_F}.schema.json"     "${O_CON_F}.schema.json"     "lilara.contract.schema.json"
bulk_replace "${O_CON_F}.json"            "${O_CON_F}.json"            "lilara.contract.json"
bulk_replace "${O_CFG_F}.json.example"    "${O_CFG_F}.json.example"    "lilara.config.json.example"
bulk_replace "${O_CFG_F}.schema.json"     "${O_CFG_F}.schema.json"     "lilara.config.schema.json"
bulk_replace "${O_CFG_F}.json"            "${O_CFG_F}.json"            "lilara.config.json"

# CLI + helper script refs (longest match first)
bulk_replace "${O_CLI}.sh"      "${O_CLI}.sh"       "lilara-cli.sh"
bulk_replace "${O_CLI}"         "${O_CLI}"           "lilara-cli"
bulk_replace "${O_DIFF}.sh"     "${O_DIFF}.sh"       "lilara-diff-decisions.sh"
bulk_replace "${O_DIFF}"        "${O_DIFF}"          "lilara-diff-decisions"
bulk_replace "${O_REBRAND}.sh"  "${O_REBRAND}.sh"    "lilara-rebrand-history.sh"
bulk_replace "${O_REBRAND}"     "${O_REBRAND}"       "lilara-rebrand"

# Sweep .claude/horus-plan.md content (excluded from bulk_replace via --exclude-dir=.claude)
_plan_src=".claude/${O_BARE}-plan.md"
if [ -f "$_plan_src" ]; then
  for _token in "$O_ENV" "$O_DOT_DIR" "$O_PROD" "$O_CON_PRE" \
    "${O_CON_F}.json" "${O_CFG_F}.json" "${O_CLI}" "${O_DIFF}" "${O_REBRAND}"; do
    sed_file "$_plan_src" "$_token" "s|${_token}|lilara|g"
  done
fi

# ── Phase 3: State-dir path .horus → .lilara ──────────────────────────────────

printf '\n=== Phase 3: state-dir path %s → .lilara ===\n' "$O_DOT_DIR"
bulk_replace "$O_DOT_DIR" "[.]${O_BARE}" ".lilara"

# ── Phase 4: Brand strings ─────────────────────────────────────────────────────

printf '\n=== Phase 4: brand strings ===\n'
bulk_replace "$O_PROD" "$O_PROD" "Lilara"

# HAP acronym — word-boundary grep (-P) to avoid HAPPY/HAPPEN etc.
_hap_files=$(grep -rlP '\bHAP\b' \
  --include="*.md" --include="*.txt" --include="*.sh" --include="*.js" \
  --exclude-dir=".git" --exclude-dir="node_modules" --exclude-dir=".claude" \
  --exclude-dir="archive" \
  --exclude="CHANGELOG.md" \
  --exclude="lilara-rebrand.sh" --exclude="check-no-horus.sh" \
  . 2>/dev/null || true)
for f in $_hap_files; do
  f="${f#./}"
  if [ "$DRY_RUN" -eq 1 ]; then
    delta "would replace word-boundary HAP in $f"
  else
    sed_i 's/\bHAP\b/Lilara/g' "$f"
    delta "replaced word-boundary HAP in $f"
  fi
done

# ── Phase 5: Contract ID prefix hap- → lilara- (surgical) ─────────────────────

printf '\n=== Phase 5: contract ID prefix %s → lilara- ===\n' "$O_CON_PRE"

# contract.js: the newContractId() return statement (backtick template literal)
sed_file "runtime/contract.js" \
  "return \`${O_CON_PRE}" \
  's/return `'"${O_CON_PRE}"'/return `lilara-/g'

# Schema: replace the contractId regex union (hap|arg) → single prefix lilara
# Using BRE: \^(hap|arg)- matches the literal string ^(hap|arg)- (| is not special in BRE)
_schema_con="schemas/${O_CON_F}.schema.json"
sed_file "$_schema_con" \
  "(${O_CON_PRE:0:3}|arg)-" \
  's/\^(hap|arg)-/^lilara-/g'

# Example contract files (JSON string context: "hap- → "lilara-)
for _f in "${O_CON_F}.json.example" \
          "${O_CON_F}.v2.json.example" \
          "${O_CON_F}.v3.json.example"; do
  sed_file "$_f" "\"${O_CON_PRE}" "s|\"${O_CON_PRE}|\"lilara-|g"
done

# All fixture .input files that embed contract IDs
while IFS= read -r _f; do
  sed_file "$_f" "\"${O_CON_PRE}" "s|\"${O_CON_PRE}|\"lilara-|g"
done < <(find tests/fixtures -name "*.input" 2>/dev/null)

# ── Phase 6: File renames ──────────────────────────────────────────────────────

printf '\n=== Phase 6: file renames ===\n'

rename_file "schemas/${O_CFG_F}.schema.json"   "schemas/lilara.config.schema.json"
rename_file "schemas/${O_CON_F}.schema.json"   "schemas/lilara.contract.schema.json"
rename_file "scripts/${O_CLI}.sh"              "scripts/lilara-cli.sh"
rename_file "scripts/${O_DIFF}.sh"             "scripts/lilara-diff-decisions.sh"
rename_file "scripts/${O_REBRAND}.sh"          "scripts/lilara-rebrand-history.sh"
rename_file "${O_CFG_F}.json.example"          "lilara.config.json.example"
rename_file "${O_CON_F}.json.example"          "lilara.contract.json.example"
rename_file "${O_CON_F}.v2.json.example"       "lilara.contract.v2.json.example"
rename_file "${O_CON_F}.v3.json.example"       "lilara.contract.v3.json.example"
rename_file ".claude/${O_BARE}-plan.md"        ".claude/lilara-plan.md"

# ── Summary ────────────────────────────────────────────────────────────────────

printf '\n=== Summary ===\n'
if [ "$DRY_RUN" -eq 1 ]; then
  printf 'Dry run complete: %d changes previewed, %d skipped.\n' "$changed" "$skipped"
  printf 'Run with --apply (on a clean working tree) to execute.\n'
else
  printf 'Rebrand applied: %d changes, %d skipped.\n' "$changed" "$skipped"
  printf '\nRequired follow-up steps:\n'
  printf '  1. bash scripts/verify-hooks-integrity.sh --update\n'
  printf '  2. node tests/fixtures/replay-corpus/build-corpus.js\n'
  printf '  3. node tests/fixtures/replay-corpus/build-adversarial.js\n'
  printf '  4. node tests/fixtures/replay-corpus/build-f16-adversarial.js\n'
  printf '  5. bash scripts/check-no-horus.sh\n'
  printf '  6. bash scripts/lilara-cli.sh ci\n'
  printf '  7. git add -A && git commit -m "chore(rebrand): apply Lilara rename"\n'
fi
