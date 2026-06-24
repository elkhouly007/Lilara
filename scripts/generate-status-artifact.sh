#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
out_dir="${1:-$root/artifacts/status}"
summary_file="$out_dir/status-summary.txt"
meta_file="$out_dir/status-summary.meta"

mkdir -p "$out_dir"

generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
version="$(tr -d '[:space:]' < "$root/VERSION" 2>/dev/null || echo unknown)"

# Environment variables (both name an absolute path to a pre-captured
# status-summary body; both are optional):
#   ARG_STATUS_SUMMARY_FILE    — Path (A) capture, already inside $out_dir.
#   ARG_STATUS_SUMMARY_CAPTURE — Path (B) capture, OUTSIDE $out_dir; copied in.
#
# Capture path resolution. The script supports two invocation paths in
# the workflow:
#   (A) Status summary step passes ARG_STATUS_SUMMARY_FILE (the absolute
#       path to artifacts/status/status-summary.txt) AND calls this script
#       with $out_dir = artifacts/status. The captured file IS already
#       inside $out_dir — do not copy, it would collide.
#   (B) Check status artifact step calls this script with $out_dir = a
#       mktemp -d workdir. It needs a captured file from somewhere. It
#       prefers ARG_STATUS_SUMMARY_CAPTURE (an explicit absolute path,
#       mirroring Path A's ARG_STATUS_SUMMARY_FILE contract) and falls
#       back to the hardcoded /tmp/status-summary-capture.txt default for
#       backwards compat during the transition window — both are populated
#       by the Status summary step's tee.
#
# For (A): trust the captured file as the artifact body. Metadata's
# `path=` points at the captured file directly. check-status-artifact.sh
# follows the metadata's path= field (it greps `^path=` and validates the
# file exists) rather than assuming the body is at
# $out_dir/status-summary.txt — verified by de-mask PR (2026-06-24); the
# path= contract was introduced by #195.
#
# For (B): the captured file is OUTSIDE the workdir, so write it into
# $out_dir via `cat` (NOT `cp` — `cp` is fine when source != dest, but
# `cat` is the simplest form that always works regardless of path
# relationship, and it avoids any future same-file-collision risk).
#
# Why we do NOT recurse into status-summary.sh here: check-status-artifact.sh
# runs late in the workflow, AFTER the outer status-summary.sh step has
# already invoked every sub-script once. The recursive call would re-invoke
# all 26 sub-scripts serially, paying the cold-cache cost a second time
# and adding 5+ min to the windows run (proven on master cf331ba run
# 2026-06-23 between 21:20:43 and 21:25:46).
#
# Pre-flight: if neither capture path is set, the workflow did not run
# the Status summary step before this script was invoked. Fail loud.
if [ -n "${ARG_STATUS_SUMMARY_FILE:-}" ] && [ -f "${ARG_STATUS_SUMMARY_FILE}" ]; then
  summary_source="captured:${ARG_STATUS_SUMMARY_FILE}"
  summary_body="${ARG_STATUS_SUMMARY_FILE}"
  # Path (A) above — captured file is inside $out_dir, no copy needed.
elif [ -n "${ARG_STATUS_SUMMARY_CAPTURE:-}" ] && [ -f "${ARG_STATUS_SUMMARY_CAPTURE}" ]; then
  summary_source="captured:${ARG_STATUS_SUMMARY_CAPTURE}"
  summary_body="$out_dir/status-summary.txt"
  mkdir -p "$out_dir"
  cat "${ARG_STATUS_SUMMARY_CAPTURE}" > "$summary_body"
  # Path (B) above — explicit capture path via env var; body copied into
  # $out_dir; metadata points at it.
elif [ -f "/tmp/status-summary-capture.txt" ]; then
  summary_source="captured:/tmp/status-summary-capture.txt"
  summary_body="$out_dir/status-summary.txt"
  mkdir -p "$out_dir"
  cat "/tmp/status-summary-capture.txt" > "$summary_body"
  # Path (B) fallback — hardcoded /tmp default; backwards-compat during the
  # transition window for callers not yet passing ARG_STATUS_SUMMARY_CAPTURE.
else
  printf 'error: status-summary.sh not pre-captured (no ARG_STATUS_SUMMARY_FILE, no ARG_STATUS_SUMMARY_CAPTURE, no /tmp fallback)\n' >&2
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
