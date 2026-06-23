#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
out_dir="${1:-$root/artifacts/status}"
summary_file="$out_dir/status-summary.txt"
meta_file="$out_dir/status-summary.meta"

mkdir -p "$out_dir"

generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
version="$(tr -d '[:space:]' < "$root/VERSION" 2>/dev/null || echo unknown)"

# Why we no longer recurse into status-summary.sh here:
# check-status-artifact.sh runs late in the workflow, AFTER the outer status-summary.sh
# step (#41) has already invoked every sub-script once and the per-step CI steps above
# have warmed the FS cache. On cold-cache Windows the recursive call below would
# re-invoke all 26 sub-scripts serially — paying the cold-cache cost a second time and
# adding minutes to the windows run (proven on the master cf331ba push run: the
# 5-min gap between 21:20:43 check-status-artifact and 21:25:46 check-fixture-count
# IS this recursion). The artifact only needs the summary's output bytes plus the
# metadata; both can be sourced without re-executing the sub-scripts.
#
# Acceptance order:
#   (1) ARG_STATUS_SUMMARY_FILE is set (workflow passed in the captured stdout from
#       step #41), copy it as the artifact body.
#   (2) /tmp/status-summary-capture.txt exists from a sibling workflow (rare; covers
#       scripts that invoke generate-status-artifact.sh outside the workflow).
#   (3) Fallback — must re-invoke. Logged as a warning so it shows up in CI output.
if [ -n "${ARG_STATUS_SUMMARY_FILE:-}" ] && [ -f "${ARG_STATUS_SUMMARY_FILE}" ]; then
  cp "${ARG_STATUS_SUMMARY_FILE}" "${summary_file}"
  summary_source="captured:${ARG_STATUS_SUMMARY_FILE}"
elif [ -f "/tmp/status-summary-capture.txt" ]; then
  cp "/tmp/status-summary-capture.txt" "${summary_file}"
  summary_source="captured:/tmp/status-summary-capture.txt"
else
  printf 'warning: status-summary.sh not pre-captured; falling back to recursive run (will hang on cold-cache Windows)\n' >&2
  ARG_SKIP_STATUS_ARTIFACT_CHECK=1 bash "$root/scripts/status-summary.sh" > "${summary_file}"
  summary_source="recursive-run"
fi

# Count repo contents from filesystem (used by check-status-artifact.sh for drift detection)
agents_count="$(find "$root/agents" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
rules_count="$(find "$root/rules" -name '*.md' | wc -l | tr -d ' ')"
skills_count="$(find "$root/skills" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
scripts_count="$(find "$root/scripts" -maxdepth 1 -type f | wc -l | tr -d ' ')"
fixtures_count="$(find "$root/tests/fixtures" -name '*.input' | wc -l | tr -d ' ')"
checks_count="$(find "$root/scripts" -maxdepth 1 -name 'check-*.sh' | wc -l | tr -d ' ')"

cat > "$meta_file" <<EOF
artifact=status-summary
version=${version}
generated_at=${generated_at}
source=scripts/status-summary.sh
summary_source=${summary_source}
path=${summary_file}
agents=${agents_count}
rules=${rules_count}
skills=${skills_count}
scripts=${scripts_count}
fixtures=${fixtures_count}
checks=${checks_count}
EOF

printf 'Status artifact written to: %s\n' "$summary_file"
printf 'Status artifact metadata: %s\n' "$meta_file"
