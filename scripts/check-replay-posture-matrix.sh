#!/usr/bin/env bash
# check-replay-posture-matrix.sh — SCOPE §19 #14 (LOCKED 2026-06-13)
# posture-matrix replay gate.
#
# §19 #14 pins the four posture flags that decide() reads from ambient env
# (LILARA_TAINT_EGRESS, LILARA_DELETE_COORD, LILARA_KILL_CHAIN_ENFORCE,
# LILARA_F27_CONSENT) and requires a posture-matrix replay: the shipped corpus
# must be replayed under EVERY combination of those flags, and the canonical
# baseline posture (all flags off) MUST be zero-drift. The other 15 combinations
# may show legitimate drift (e.g. DELETE_COORD=1 engages the F29 floor, which
# changes require-tests → require-review for destructive rm patterns; and
# LILARA_F27_CONSENT=1 shifts the F27 secret-egress surface to consent-required);
# that drift is the posture surface being exposed, not a regression.
#
# This gate is two-faced:
#
#   1. CANONICAL BASELINE (all-off, TE=0 DC=0 KC=0): MUST be zero-drift. A
#      non-zero drift here is a regression in the shipped default — the
#      corpus's recorded irHashes are the canonical baseline; if the engine
#      now produces different actions/irHashes for the same input under the
#      default posture, the corpus is silently invalidated. The check exits
#      NON-ZERO on any drift in this combination.
#
#   2. POSTURE SURFACE (the other 15 combinations): the script replays and
#      REPORTS the per-entry drift per combination so a reviewer can see the
#      posture surface (which floors engage when which flags are on, and
#      which corpus entries flip). Drift in these combinations is NOT a
#      gate failure — it's the documented posture surface. The exit code
#      is still 0 for these combinations as long as the canonical baseline
#      (1) is zero-drift.
#
# Future work (NEEDS-APPROVAL, not in P3.3): regenerate the corpus per
# posture so EVERY combination has a canonical baseline and the gate
# requires zero-drift everywhere. That is the §19 #14 long-term ask; P3.3
# is the surface-detection scaffold.
#
# The 16 combinations (2^4):
#   0000 — canonical baseline (all off) — MUST be zero-drift
#   0001..1111 — posture surface (drift reported, not failed)
#
# For each combination, every shipped corpus file is replayed via
# scripts/replay-decisions.js. The script sets LILARA_REPLAY_RESPECT_POSTURE=1
# to opt replay-decisions.js out of its default posture pin (so the matrix
# flags take effect), then exports the three flags for that combination.
#
# CONSENT FLAG-ON CANONICAL (PR-B): the consent-family corpora
# (secret-egress-consent*.jsonl) record the FLAG-ON interactive consent path
# (escalate / secret-egress-consent-required) and are scoped OUT of the all-off
# canonical baseline (replaying them at LILARA_F27_CONSENT=0 is a guaranteed,
# meaningless drift). They have their OWN canonical baseline: F27=1 with all
# other posture flags off, plus an emulated controlling TTY
# (LILARA_REPLAY_FORCE_TTY=1, harness-only — the engine is unchanged). That
# combination MUST be zero-drift; drift there is a real regression in the F27
# consent gate, not a posture surface. This is the genuine flag-on coverage that
# the all-off baseline cannot provide for these corpora.
#
# Exit codes:
#   0 — canonical baseline (all-off) is zero-drift AND the consent family is
#       zero-drift at its flag-on canonical posture; other combinations may
#       have reported drift but the gate is satisfied for this PR
#   1 — canonical baseline (all-off) has drift, OR the consent family drifts at
#       its flag-on canonical posture — REGRESSION, must be fixed
#   2 — fatal (node missing, corpus dir missing, etc.)

set -u

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

CORPUS_DIR="tests/fixtures/replay-corpus"

if ! command -v node >/dev/null 2>&1; then
  if [ "${LILARA_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf '[check-replay-posture-matrix] node not found — skipping (LILARA_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'FATAL: node not found on PATH\n' >&2
  exit 2
fi

if [ ! -d "$CORPUS_DIR" ]; then
  printf 'FATAL: corpus dir missing: %s\n' "$CORPUS_DIR" >&2
  exit 2
fi

# Note: we deliberately use `set -u` (not `set -eu`) so the script does NOT
# abort on a non-zero exit from the per-corpus `node` invocation. Drift is
# a normal posture-matrix result that we capture and report; it must not
# kill the rest of the matrix sweep.

printf '[check-replay-posture-matrix]\n'

CANONICAL_DRIFT=0
CONSENT_FLAGON_DRIFT=0
TOTAL_RUNS=0
TOTAL_ENTRIES=0
COMBINATIONS=16
BASELINE_LABEL="TE=0 DC=0 KC=0 F27=0"

for TE in 0 1; do
  for DC in 0 1; do
    for KC in 0 1; do
      for F27 in 0 1; do
        LABEL="TE=${TE} DC=${DC} KC=${KC} F27=${F27}"
        IS_CANONICAL=0
        if [ "$TE" = "0" ] && [ "$DC" = "0" ] && [ "$KC" = "0" ] && [ "$F27" = "0" ]; then
          IS_CANONICAL=1
        fi
        for corpus in "$CORPUS_DIR"/*.jsonl; do
          [ -f "$corpus" ] || continue
          rel="${corpus#$root/}"
          FORCE_TTY=0
          IS_CONSENT_CANONICAL=0
          case "$(basename -- "$corpus")" in
            secret-egress-consent*.jsonl)
              if [ "$F27" = "0" ]; then
                # Flag-off: the consent family records the FLAG-ON behavior, so
                # replaying it at LILARA_F27_CONSENT=0 is a guaranteed, meaningless
                # drift (escalate→block, consent-required→external-denied). Scope
                # it out here exactly as check-replay-corpus.sh does; the F27=1
                # combinations below are where it is genuinely exercised.
                printf '  skip    %s | %s | consent corpus family scoped to LILARA_F27_CONSENT=1\n' "$LABEL" "$rel"
                continue
              fi
              # Flag-on: the consent family records the INTERACTIVE consent path
              # (escalate / secret-egress-consent-required), which the engine only
              # takes with a controlling TTY. Emulate the TTY (harness-only; the
              # engine is unchanged) so the recorded flag-on outputs are reproduced
              # instead of failing closed to a headless no-tty block.
              FORCE_TTY=1
              # The corpus generator pins ONLY LILARA_F27_CONSENT=1 (TE/DC/KC off).
              # That posture — F27=1 with all other flags off, plus the emulated
              # TTY — is the consent family's CANONICAL baseline and MUST be
              # zero-drift (genuine flag-on coverage, not a tolerated surface).
              if [ "$TE" = "0" ] && [ "$DC" = "0" ] && [ "$KC" = "0" ]; then
                IS_CONSENT_CANONICAL=1
              fi
              ;;
          esac
          # Capture the inner rc first (before the || true on the next line eats it).
          out="$(LILARA_REPLAY_RESPECT_POSTURE=1 \
                 LILARA_REPLAY_FORCE_TTY="$FORCE_TTY" \
                 LILARA_TAINT_EGRESS="$TE" \
                 LILARA_DELETE_COORD="$DC" \
                 LILARA_KILL_CHAIN_ENFORCE="$KC" \
                 LILARA_F27_CONSENT="$F27" \
                 node scripts/replay-decisions.js --corpus "$corpus" 2>&1)"
          rc=$?
          : "${rc:=0}"  # normalize unset to 0
          TOTAL_RUNS=$((TOTAL_RUNS + 1))
          # Extract the entry count from the "N entries OK" line if present.
          # A drift line says "N/M entries" — use the M (total) for the matrix tally.
          entries="$(echo "$out" | grep -oE '[0-9]+ entries OK' | head -1 | grep -oE '^[0-9]+' | head -1)"
          total_replayed="$(echo "$out" | grep -oE 'DRIFT in [0-9]+/[0-9]+ entries' | head -1 | grep -oE '[0-9]+ entries' | grep -oE '^[0-9]+' | head -1)"
          # For drift lines, total_replayed is set; for clean lines, entries is set.
          if [ -n "$total_replayed" ]; then
            TOTAL_ENTRIES=$((TOTAL_ENTRIES + total_replayed))
          else
            TOTAL_ENTRIES=$((TOTAL_ENTRIES + ${entries:-0}))
          fi
          if [ "$rc" -ne 0 ]; then
            if [ "$IS_CANONICAL" -eq 1 ]; then
              printf '  REGRESSION  %s | %s\n' "$LABEL" "$rel" >&2
              echo "$out" | sed 's/^/    /' >&2
              CANONICAL_DRIFT=1
            elif [ "$IS_CONSENT_CANONICAL" -eq 1 ]; then
              # Consent family at its flag-on canonical posture MUST be zero-drift.
              # Drift here means the engine no longer reproduces the recorded
              # interactive consent outputs under LILARA_F27_CONSENT=1 — a real
              # regression in the F27 consent gate, not a posture surface.
              printf '  REGRESSION  %s | %s (consent flag-on canonical)\n' "$LABEL" "$rel" >&2
              echo "$out" | sed 's/^/    /' >&2
              CONSENT_FLAGON_DRIFT=1
            else
              # Non-canonical combination: report drift as posture surface, do not fail.
              drift_count="$(echo "$out" | grep -oE 'DRIFT in [0-9]+/' | head -1 | grep -oE '[0-9]+' | head -1)"
              drift_count="${drift_count:-?}"
              printf '  surface  %s | %s | %s entries drifted (legitimate posture surface)\n' "$LABEL" "$rel" "$drift_count"
            fi
          else
            if [ "$IS_CANONICAL" -eq 1 ]; then
              printf '  ok      [CANONICAL]  %s | %s | %s entries\n' "$LABEL" "$rel" "$entries"
            elif [ "$IS_CONSENT_CANONICAL" -eq 1 ]; then
              printf '  ok      [CONSENT-CANONICAL]  %s | %s | %s entries (flag-on genuine coverage)\n' "$LABEL" "$rel" "$entries"
            else
              printf '  ok      %s | %s | %s entries\n' "$LABEL" "$rel" "$entries"
            fi
          fi
        done
      done
    done
  done
done

printf '\n'
printf 'combinations: %d | runs: %d | total entries: %d\n' "$COMBINATIONS" "$TOTAL_RUNS" "$TOTAL_ENTRIES"
printf 'canonical baseline: %s\n' "$BASELINE_LABEL"

if [ "$CANONICAL_DRIFT" -ne 0 ]; then
  printf '\ncheck-replay-posture-matrix: FAILED\n' >&2
  printf 'The canonical baseline (all posture flags off) MUST be zero-drift.\n' >&2
  printf 'Drift in the canonical baseline is a regression in the shipped default\n' >&2
  printf 'posture — the corpus has been silently invalidated.\n' >&2
  exit 1
fi
if [ "$CONSENT_FLAGON_DRIFT" -ne 0 ]; then
  printf '\ncheck-replay-posture-matrix: FAILED\n' >&2
  printf 'The consent corpus family MUST be zero-drift at its flag-on canonical\n' >&2
  printf 'posture (LILARA_F27_CONSENT=1, all other flags off, interactive TTY).\n' >&2
  printf 'Drift there is a regression in the F27 consent gate — the recorded\n' >&2
  printf 'escalate / secret-egress-consent-required outputs are no longer\n' >&2
  printf 'reproduced. This is genuine flag-on coverage, not a posture surface.\n' >&2
  exit 1
fi
printf 'check-replay-posture-matrix: PASS\n'
printf '  (canonical baseline is zero-drift; consent family is zero-drift at its\n'
printf '   flag-on canonical posture; other combinations reported as posture surface)\n'
exit 0
