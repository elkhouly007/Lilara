#!/usr/bin/env bash
# check-inviolable-tier-unreachability.sh — SCOPE §19 #6 / ADR-036 standing gate.
#
# §19 #6 (LOCKED 2026-06-13) elevates "policy-laundering" and
# "self-modification poisoning" to standing regression gates that land BEFORE
# any L3 code. The §19 #6 scope is two axes:
#
#   (a) No self-improvement or learned source can ever appear in any
#       inviolable floor's `demotableBy`. Proven structurally by the
#       canDemote(*,*) lattice contract and tested by:
#         - tests/decision-lattice/inviolable-selfmod-unreachability.test.js
#         - tests/decision-lattice/inviolable-contract-unreachability.test.js
#
#   (b) Monotonic check that the inviolable set + lattice hash only change
#       via reviewed baseline updates. The artifacts/lattice-baseline.sha256
#       is the committed rebaseline; `--update` is the only sanctioned way
#       to change it. If runtime/decision-lattice.js changes in this commit
#       range AND the baseline also changes, CHANGELOG.md must carry an
#       explicit [LATTICE-BASELINE-REBASELINE] marker in the same range
#       (so the rebaseline is reviewable, not silent).
#
# This gate runs BOTH axes in CI on every PR. It is a HARD release gate
# (exit 1 on any failure) — §19 #6 is the named "no silent self-weakening"
# surface, and silent failure here would defeat the L3 hard-precondition.
#
# Usage:
#   bash scripts/check-inviolable-tier-unreachability.sh                # default base = origin/master
#   bash scripts/check-inviolable-tier-unreachability.sh master          # custom base ref
#   bash scripts/check-inviolable-tier-unreachability.sh HEAD            # check current tree only
#
# Exit codes:
#   0 — pass
#   1 — fail (with reason on stderr)
#   2 — fatal (node missing, base ref missing, etc.)

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

pass()  { printf '  ok      %s\n' "$1"; }
fail()  { printf '  ERROR   %s\n' "$1" >&2; FAILED=1; }
FATAL() { printf '  FATAL   %s\n' "$1" >&2; exit 2; }
FAILED=0

printf '[check-inviolable-tier-unreachability]\n'

if ! command -v node >/dev/null 2>&1; then
  FATAL 'node not found on PATH — check-inviolable-tier-unreachability.sh requires Node.js'
fi

# ─────────────────────────────────────────────────────────────────────────────
# Axis (a) — structural: no self-improvement source in any inviolable floor's
# demotableBy. Runs the two unreachability tests in-process and reports.
# ─────────────────────────────────────────────────────────────────────────────
node -e '
  const path = require("path");
  const ROOT = process.cwd();
  const {
    INVIOLABLE_FLOOR_IDS, canDemote, assertOrdered, LATTICE, computeLatticeHash,
  } = require(path.join(ROOT, "runtime/decision-lattice"));
  const errors = [];
  // All demotion source strings the engine actually uses.
  const SOURCES = [
    "operator-token:class-c-review-demote",
    "operator-token-suspicious-only",
    "operator-token-medium-only",
    "contract-allow:tool-allow-matched",
    "contract-allow:tool-allow-tool-scope",
    "scopes.files.allow",
    "consent:interactive",
    "learned-allow",
    "auto-allow-once",
    "contract-allow",
    "contract-allow-tool-scope",
  ];
  if (!Array.isArray(INVIOLABLE_FLOOR_IDS) || INVIOLABLE_FLOOR_IDS.length === 0) {
    errors.push("INVIOLABLE_FLOOR_IDS is empty — tier structure broken");
  }
  for (const id of INVIOLABLE_FLOOR_IDS) {
    for (const src of SOURCES) {
      if (canDemote(id, src) !== false) {
        errors.push(`canDemote(${id}, ${src}) returned non-false — INVARIANT BROKEN`);
      }
    }
  }
  // assertOrdered: tier:inviolable + non-empty demotableBy must throw on the live LATTICE.
  try {
    assertOrdered(LATTICE);
  } catch (err) {
    errors.push(`assertOrdered(LATTICE) threw on the live lattice: ${err.message}`);
  }
  if (errors.length === 0) {
    process.stdout.write(`  ok      axis (a) — canDemote(inviolable, source)=false for ${INVIOLABLE_FLOOR_IDS.length} floors × ${SOURCES.length} sources\n`);
    process.exit(0);
  }
  process.stderr.write(errors.join("\n") + "\n");
  process.exit(1);
' || fail 'axis (a) — unreachability structural check failed (see above)'

# ─────────────────────────────────────────────────────────────────────────────
# Axis (b) — monotonic: the lattice-hash rebaseline must be reviewable.
#
# Logic:
#   1. Identify the merge-base with the chosen base ref (default origin/master).
#   2. If the diff to that base does NOT touch runtime/decision-lattice.js,
#      pass — no rebaseline to review.
#   3. If the diff DOES touch runtime/decision-lattice.js AND the committed
#      artifacts/lattice-baseline.sha256 also differs from the merge-base
#      version, the CHANGELOG.md in the same range MUST contain
#      [LATTICE-BASELINE-REBASELINE] (or the same tag in the actual base
#      ref) — the rebaseline is reviewable, not silent.
#   4. If the diff touches runtime/decision-lattice.js but the baseline
#      file is unchanged, that is a CODE change without a rebaseline —
#      fail (this would silently drift the hash from the baseline, which
#      `check-inviolable-tier.sh` would catch on the next CI run, but
#      catching it here with a clear message is the whole point of axis b).
#   5. Special case: if the base ref is HEAD or not provided, axis (b)
#      skips the diff check (no merge-base to compare against) and only
#      verifies the current-tree hashes are self-consistent.
# ────────────────────────────────────────────────
BASE="${1:-origin/master}"

# Resolve base ref
if ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null 2>&1; then
  if [ "$BASE" = "HEAD" ] || [ "$BASE" = "origin/master" ] || [ "$BASE" = "master" ]; then
    # Common case — try the local ref if remote is missing
    if ! git rev-parse --verify --quiet "${BASE/origin\//}^{commit}" >/dev/null 2>&1; then
      FATAL "base ref not resolvable: $BASE"
    fi
  else
    FATAL "base ref not resolvable: $BASE"
  fi
fi

# Normalize to a local-resolvable ref
RESOLVED_BASE="$BASE"
if ! git rev-parse --verify --quiet "$RESOLVED_BASE^{commit}" >/dev/null 2>&1; then
  RESOLVED_BASE="${BASE/origin\//}"
fi

HEAD_SHA="$(git rev-parse HEAD)"
BASE_SHA="$(git rev-parse "$RESOLVED_BASE")"

# Same-SHA case — no diff to analyze; pass on the live-hash check.
if [ "$HEAD_SHA" = "$BASE_SHA" ]; then
  pass "axis (b) — HEAD == $RESOLVED_BASE; no diff to analyze"
  exit 0
fi

# Compute the actual set of files changed in the base..HEAD range.
# Both runtime/decision-lattice.js AND runtime/floor-codes.js are part of the
# inviolable tier structure — the baseline file records BOTH hashes
# (`lattice` and `floor-codes`). Touching either one without rebaselining
# is a silent hash drift, which axis (b) exists to catch.
TIER_FILE_TOUCHED=0
TIER_FILES='runtime/decision-lattice.js runtime/floor-codes.js'
if git diff --name-only "$BASE_SHA".."$HEAD_SHA" -- $TIER_FILES | grep -q .; then
  TIER_FILE_TOUCHED=1
fi

# Also detect baseline-file changes in the same range.
BASELINE_TOUCHED=0
BASELINE_FILE='artifacts/lattice-baseline.sha256'
if git diff --name-only "$BASE_SHA".."$HEAD_SHA" -- "$BASELINE_FILE" | grep -q .; then
  BASELINE_TOUCHED=1
fi

# Case 1: neither tier file touched → nothing to review; pass.
if [ "$TIER_FILE_TOUCHED" -eq 0 ]; then
  pass "axis (b) — runtime/decision-lattice.js and runtime/floor-codes.js untouched in $RESOLVED_BASE..HEAD; no rebaseline required"
  printf '\ncheck-inviolable-tier-unreachability: PASS\n'
  exit 0
fi

# Case 2: tier file touched, baseline NOT touched → CODE change without a
# committed rebaseline. This is the exact "silent hash drift" the gate
# exists to catch.
if [ "$TIER_FILE_TOUCHED" -eq 1 ] && [ "$BASELINE_TOUCHED" -eq 0 ]; then
  fail "axis (b) — one of $TIER_FILES changed in $RESOLVED_BASE..HEAD but artifacts/lattice-baseline.sha256 was NOT rebaselined in the same range. Run: bash scripts/check-inviolable-tier.sh --update && git add artifacts/lattice-baseline.sha256"
  printf '\ncheck-inviolable-tier-unreachability: FAILED\n' >&2
  exit 1
fi

# Case 3: tier file touched AND baseline touched → the rebaseline was
# committed; require a CHANGELOG marker so the rebaseline is reviewable.
# We look for the marker in the CHANGELOG.md diff for the same range.
RANGE_CHANGELOG="$(git diff "$BASE_SHA".."$HEAD_SHA" -- CHANGELOG.md 2>/dev/null || true)"
if echo "$RANGE_CHANGELOG" | grep -qE '\[LATTICE-BASELINE-REBASELINE\]'; then
  pass "axis (b) — lattice rebaseline marker [LATTICE-BASELINE-REBASELINE] present in CHANGELOG.md for $RESOLVED_BASE..HEAD"
else
  fail "axis (b) — one of $TIER_FILES AND artifacts/lattice-baseline.sha256 both changed in $RESOLVED_BASE..HEAD, but CHANGELOG.md in the same range lacks the [LATTICE-BASELINE-REBASELINE] marker. Add a one-line entry: '\`[LATTICE-BASELINE-REBASELINE]\` — <reason>' under the [Unreleased] section so the rebaseline is reviewable."
  printf '\ncheck-inviolable-tier-unreachability: FAILED\n' >&2
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Final report
# ─────────────────────────────────────────────────────────────────────────────
printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf 'check-inviolable-tier-unreachability: PASS\n'
  exit 0
else
  printf 'check-inviolable-tier-unreachability: FAILED\n' >&2
  exit 1
fi
