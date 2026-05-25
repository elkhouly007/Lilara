#!/usr/bin/env bash
# check-skill-quality.sh — CI gate: average skill quality score must be >= 2.5.
#
# Scores each skills/*.md file on 5 dimensions (YAML frontmatter, Process,
# Constraints, Output Format, When to Use). Each dimension is worth 1 point.
# Gate threshold: 2.5 / 5.
#
# TODO: raise threshold to 3.0 once all Format-A skills are upgraded to Format-B
# with full YAML frontmatter. Current Format-A skills score ~3 at best.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  if [ "${LILARA_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-skill-quality.sh\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH\n' >&2
  exit 1
fi

THRESHOLD="${LILARA_SKILL_QUALITY_THRESHOLD:-2.5}"

result=$(node - "$root" "$THRESHOLD" <<'__SKILL_QUALITY_EOF__'
"use strict";
const path = require("path");
const root      = process.argv[2];
const threshold = parseFloat(process.argv[3]) || 2.5;
const { scoreAll } = require(path.join(root, "runtime/skill-scorer"));
const { results, average, count } = scoreAll({ skillsDir: path.join(root, "skills") });

process.stdout.write("  average skill score: " + average + " / 5 (" + count + " skills)\n");

if (average < threshold) {
  process.stderr.write("  ERROR   average skill quality " + average + " is below threshold " + threshold + "\n");
  // Print lowest scorers for debugging
  const low = results.filter((r) => r.score < threshold).sort((a, b) => a.score - b.score).slice(0, 5);
  for (const r of low) {
    process.stderr.write("          score=" + r.score + "  " + path.basename(r.file) + "  missing=[" + r.missing.join(",") + "]\n");
  }
  process.exit(1);
}
process.stdout.write("  ok      average skill quality " + average + " >= " + threshold + "\n");
__SKILL_QUALITY_EOF__
) && rc=0 || rc=$?

printf '%s' "$result"
exit "$rc"
