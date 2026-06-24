#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
out_dir="${1:-$root/artifacts/status}"
summary_file="$out_dir/status-summary.txt"
meta_file="$out_dir/status-summary.meta"

mkdir -p "$out_dir"

generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
version="$(tr -d '[:space:]' < "$root/VERSION" 2>/dev/null || echo unknown)"

# Capture path (pre-captured by the workflow tee'd stdout into $out_dir, or by
# the optional ARG_STATUS_SUMMARY_FILE env override). We do NOT cp the file
# into the artifact — the captured file IS the artifact body, the workflow
# already wrote it to the correct location. Just record the source in metadata.
#
# Previous approach (cp captured → ${out_dir}/status-summary.txt) collided
# whenever the captured path was inside ${out_dir}: cp's "are the same file"
# guard exits 1 and the step fails (proven on PR #195 CI runs #28065417666
# ubuntu, #28065391540 push, plus the windows recovery). This rewrite trusts
# the workflow's capture path and lets it stand as the artifact.
#
# Fallback: if neither ARG_STATUS_SUMMARY_FILE nor the legacy /tmp capture
# path is set, we still must produce a body. The recursive run is the worst
# option (hangs 5+ min on cold-cache Windows — proven on master cf331ba run
# 2026-06-23 between 21:20:43 and 21:25:46) so refuse to do it here. Fail
# loud instead: the workflow MUST capture stdout before invoking this
# script. A pre-flight check verifies the body file exists, so a missing
# capture surfaces a clear "no capture file" error rather than a silent
# 5-min hang.
if [ -n "${ARG_STATUS_SUMMARY_FILE:-}" ] && [ -f "${ARG_STATUS_SUMMARY_FILE}" ]; then
  summary_source="captured:${ARG_STATUS_SUMMARY_FILE}"
  summary_body="${ARG_STATUS_SUMMARY_FILE}"
elif [ -f "/tmp/status-summary-capture.txt" ]; then
  summary_source="captured:/tmp/status-summary-capture.txt"
  summary_body="/tmp/status-summary-capture.txt"
else
  printf 'error: status-summary.sh not pre-captured and no /tmp fallback exists\n' >&2
  printf 'error: the workflow must capture status-summary stdout via tee before invoking generate-status-artifact.sh\n' >&2
  exit 1
fi

# Pre-flight: the artifact body must exist at the path the metadata will
# advertise. If the workflow passed a captured path but the file vanished
# (rare; e.g. concurrent cleanup), surface a clear error.
[ -f "${summary_body}" ] || { printf 'error: capture file missing: %s\n' "${summary_body}" >&2; exit 1; }

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
path=${summary_body}
agents=${agents_count}
rules=${rules_count}
skills=${skills_count}
scripts=${scripts_count}
fixtures=${fixtures_count}
checks=${checks_count}
EOF

printf 'Status artifact written to: %s\n' "$summary_file"
printf 'Status artifact metadata: %s\n' "$meta_file"
