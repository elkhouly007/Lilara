#!/usr/bin/env bash
# check-post-adapter-parity.sh — Verify PostToolUse secret-scan + taint parity
# across all 6 harnesses.
#
# For each harness, checks that the PostToolUse adapter:
#   (a) requires runtime/secret-scan.js
#   (b) requires runtime/taint.js (for provenance/taint recording)
#   (c) calls scanSecrets() on tool output
#   (d) calls recordExternalRead() for external-source tool output
#
# Usage: bash scripts/check-post-adapter-parity.sh

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

pass()  { printf '  ok      %s\n' "$1"; }
fail()  { printf '  ERROR   %s\n' "$1" >&2; FAILED=1; }
FAILED=0

printf '[check-post-adapter-parity]\n'

# ---------------------------------------------------------------------------
# Harness definitions: name → path to PostToolUse adapter
# ---------------------------------------------------------------------------
declare -A POST_ADAPTERS
POST_ADAPTERS["claude"]="claude/hooks/output-sanitizer.js"
POST_ADAPTERS["opencode"]="opencode/hooks/post-adapter.js"
POST_ADAPTERS["openclaw"]="openclaw/hooks/post-adapter.js"
POST_ADAPTERS["codex"]="codex/hooks/post-adapter.js"
POST_ADAPTERS["clawcode"]="clawcode/hooks/post-adapter.js"
POST_ADAPTERS["antegravity"]="antegravity/hooks/post-adapter.js"
POST_ADAPTERS["hermes"]="hermes/hooks/post-adapter.js"

for harness in claude opencode openclaw codex clawcode antegravity hermes; do
  adapter="${POST_ADAPTERS[$harness]}"

  if [ ! -f "$adapter" ]; then
    fail "$harness: post-adapter missing at $adapter"
    continue
  fi

  ok=1

  if ! grep -qF "secret-scan" "$adapter" && ! grep -qF "post-adapter-factory" "$adapter"; then
    fail "$harness: secret-scan not required in $adapter (and not delegating to factory)"; ok=0
  fi

  if ! grep -qF "taint" "$adapter" && ! grep -qF "post-adapter-factory" "$adapter"; then
    fail "$harness: taint not required in $adapter (and not delegating to factory)"; ok=0
  fi

  if ! grep -qF "scanSecrets" "$adapter" && ! grep -qF "post-adapter-factory" "$adapter"; then
    fail "$harness: scanSecrets() not called in $adapter (and not delegating to factory)"; ok=0
  fi

  if ! grep -qF "recordExternalRead" "$adapter" && ! grep -qF "post-adapter-factory" "$adapter"; then
    fail "$harness: recordExternalRead() not called in $adapter (and not delegating to factory)"; ok=0
  fi

  if ! grep -qF "createPostAdapter" "$adapter"; then
    fail "$harness: adapter does not use createPostAdapter factory — drift risk"; ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    pass "$harness: $adapter (secret-scan + taint)"
  fi
done

printf '\n'
if [ "$FAILED" -ne 0 ]; then
  printf 'check-post-adapter-parity FAILED — see errors above.\n' >&2
  exit 1
fi
printf 'check-post-adapter-parity passed — all 7 harnesses use createPostAdapter (secret-scan + taint).\n'
