#!/usr/bin/env bash
# check-no-implicit-demotion.sh — HAP ADR-007 PR-C anti-drift gate.
#
# Every `source = …` reassignment in runtime/decision-engine.js MUST source
# from a LATTICE constant (the `_F*` / `_LA` / `_AAO` / `_CA` / `_TN` aliases,
# a direct `LATTICE.*`, or a `getEntry(...)` read). A bare string literal
# (e.g. `source = "contract-allow";`) is forbidden — it bypasses the lattice
# and is the most likely shape of future drift.
#
# `action = …` reassignments are accepted as long as the surrounding block
# also writes a LATTICE-anchored `source` or `floorFired` — the precedence
# ladder's verb cycling (allow → route → require-review → escalate → block)
# would otherwise be too noisy to ban directly. The companion gate is the
# `lattice-receipts` fixture sweep, which pins the emitted receipt fields.
#
# Belt-and-suspenders alongside `scripts/check-lattice-receipts.sh` (runtime
# behaviour) and `scripts/check-lattice-ordering.sh` (table invariants).
#
# Usage: bash scripts/check-no-implicit-demotion.sh

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

target="$root/runtime/decision-engine.js"

printf '[check-no-implicit-demotion]\n'

if [ ! -f "$target" ]; then
  printf '  ERROR   %s missing\n' "$target" >&2
  exit 1
fi

# Iterate every `source =` reassignment line and verify the RHS is anchored
# in LATTICE. Anything else is flagged.
errors=0
scanned=0
while IFS= read -r raw; do
  lineno="${raw%%:*}"
  body="${raw#*:}"
  trimmed="${body#"${body%%[![:space:]]*}"}"

  # Skip comment-only lines
  case "$trimmed" in "//"*|"*"*|"/*"*) continue ;; esac

  scanned=$((scanned + 1))

  # Strip trailing `// …` inline comment
  no_comment="${trimmed%//*}"
  no_comment="${no_comment%"${no_comment##*[![:space:]]}"}"

  # Allowed: any reference to a LATTICE-derived constant or helper.
  if printf '%s\n' "$no_comment" | grep -qE '(_F[0-9]+b?|_LA|_AAO|_CA|_TN)\.(source|name)|LATTICE\.|getEntry\('; then
    continue
  fi

  # Initial declaration `let source = _F3.source;` is matched above. The
  # only other expected shape today is the conditional contract-allow
  # variant resolved via `_CA.source[0/1]`, also LATTICE-anchored.
  printf '  ERROR   implicit demotion at decision-engine.js:%s: %s\n' "$lineno" "$trimmed" >&2
  errors=$((errors + 1))
done < <(grep -n -E '(^|[[:space:]])source = ' "$target")

if [ "$errors" -ne 0 ]; then
  printf '\ncheck-no-implicit-demotion FAILED — %d unauthorized `source =` assignment(s).\n' "$errors" >&2
  exit 1
fi

printf '  ok      scanned %s source-assignments in decision-engine.js; all LATTICE-anchored\n' "$scanned"

# Sanity check: confirm canDemote() actually appears in decision-engine.js —
# fails if a future refactor removes the demotion guard entirely.
if ! grep -q 'canDemote(' "$target"; then
  printf '  ERROR   canDemote() not referenced in decision-engine.js — demotion guard missing\n' >&2
  exit 1
fi
printf '  ok      canDemote() referenced in decision-engine.js\n'

printf '\ncheck-no-implicit-demotion passed.\n'
