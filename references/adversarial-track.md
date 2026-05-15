# Adversarial track (operational doc)

Locked scope §5.1: "Adversarial test agent with starter pattern library
(G1–G7 + Q1–Q8 history); daily run, weekly summary; successful bypasses →
immediate fix + ADR."
Locked scope §8 v1 success criteria: "Adversarial agent: 0 bypasses across
all patterns."

This is an **observability-only** track. The harness exercises every entry
in the adversarial corpus through the live `decide()` and reports any
confirmed bypass. It does NOT change runtime behavior and is NOT a required
PR-merge status check. A bypass surfaced here is a real engine bug — the
fix lives in a scoped follow-up PR (per §5.1 policy).

## Layout

```
tests/adversarial/
├── run-adversarial.js                 # driver — loads + evaluates + emits summary
└── lib/
    └── load-patterns.js               # JSONL loader + normalizer

scripts/
└── adversarial-weekly-summary.sh      # 7-day rollup → weekly-<ISO-week>.md

.github/workflows/
└── adversarial-nightly.yml            # daily harness + Sunday weekly summary

artifacts/adversarial/                 # nightly outputs (gitignored)
├── run-<ISO>.json                     # one per harness run
├── bypass/<pattern-id>.json           # one per confirmed bypass
└── weekly-<ISO-week>.md               # one per Sunday rollup
```

## Pattern sources

By default the loader reads, in this order:

1. `tests/fixtures/replay-corpus/adversarial.jsonl` (G-series + ADR-008
   precedence-defense seed)
2. `tests/fixtures/replay-corpus/f16-adversarial.jsonl` (ADR-009 F16 ambient-
   authority adversarial set — path folding, NFKD/homoglyph invariants,
   projectRoot escape, IR/envelope ordering)
3. Any `tests/fixtures/adversarial/**/*.jsonl` (corpus extensions land here;
   adding a new pattern there is a separate PR and does not require harness
   changes)

Each line is a single JSON object with at minimum:

| Key                | Role                                                     |
|--------------------|----------------------------------------------------------|
| `tag` (or `id`)    | Stable pattern id (used as the bypass receipt filename). |
| `input`            | The `decide()` input — full tool/command/IR/envelope.    |
| `expected.action`  | One of `block`, `require-review`, `allow`, etc.          |
| `intent`           | Human-readable intent (optional; loader defaults if missing). |

Malformed entries (missing `tag`/`expected.action`/`input`) are skipped with
a warning rather than failing the run — corpus drift should not break the
nightly harness.

## Bypass vs degraded vs stricter-mismatch

| Category          | Condition                                                                | Run impact                    |
|-------------------|--------------------------------------------------------------------------|-------------------------------|
| **bypass**        | `expectedAction === "block"` AND actual `action !== "block"` (or engine threw on a block-expected entry) | exit 1; receipt under `bypass/`; issue auto-filed by CI |
| **degraded**      | `expectedAction === "require-review"` AND actual `action === "allow"`    | recorded on summary; does not fail the run |
| **stricterMismatch** | `expectedAction === "allow"` AND actual `action !== "allow"` (engine hardened beyond corpus expectation) | recorded as a count on summary only |

The harness deliberately does NOT fail on stricter-mismatch: an engine that
hardens beyond the corpus is desirable, and the right response is to refresh
the corpus, not to revert the engine.

## Running locally

```
node tests/adversarial/run-adversarial.js
```

Outputs:

- `artifacts/adversarial/run-<ISO>.json` — full run summary.
- `artifacts/adversarial/bypass/<pattern-id>.json` — one receipt per confirmed
  bypass.
- stdout: `ADVERSARIAL: N patterns, B bypasses, D degraded`.

Exit code: `0` when no bypasses; `1` when any bypass surfaced; `2` when no
patterns loaded (corpus missing).

Override the output directory with `ADVERSARIAL_OUT=/tmp/run node ...` when
running outside the worktree.

## Weekly summary

```
bash scripts/adversarial-weekly-summary.sh
bash scripts/adversarial-weekly-summary.sh --dry-run        # render to /tmp
bash scripts/adversarial-weekly-summary.sh --dir <other>    # custom artifacts dir
```

The script reads the last 7 days of `artifacts/adversarial/run-*.json` (by
mtime) and writes `artifacts/adversarial/weekly-<ISO-week>.md` with:

- YAML-style frontmatter (`week`, `runs_evaluated`, `total_patterns`,
  `total_bypasses`, `total_degraded`, `prior_week_file`, `delta_bypasses`)
  for machine consumption.
- Human-readable totals + per-pattern bypass hit-rate.
- Week-over-week delta on `total_bypasses` when a prior weekly summary file
  exists in the same directory.

No `jq` dependency; the script delegates JSON parsing to an inline `node`
heredoc. `--dry-run` renders to a temp dir without touching `artifacts/`.

## Adding a pattern

Adding new patterns is a separate, narrowly-scoped PR (the corpus extension
PR). The shape is the JSONL line described above. Drop the file in either:

- `tests/fixtures/replay-corpus/` (alongside existing `*-adversarial.jsonl`)
  if it extends an existing family, or
- `tests/fixtures/adversarial/<topic>/<name>.jsonl` for an entirely new
  family.

The harness picks both locations up automatically.

## CI wiring

`.github/workflows/adversarial-nightly.yml`:

- `schedule: cron '23 3 * * *'` (daily harness, 03:23 UTC).
- `schedule: cron '11 4 * * 0'` (weekly summary, Sunday 04:11 UTC, gated by
  `if: github.event.schedule == '11 4 * * 0'`).
- Plus `workflow_dispatch:` for manual runs.
- Linux-only matrix (Ubuntu) — Windows + macOS adversarial is post-v0.5.
- Uploads `artifacts/adversarial/` on every run (pass + fail).
- On bypass: files a GitHub issue per bypassed pattern, labeled
  `adversarial-bypass` + `priority:high`, titled
  `[adversarial] bypass detected: <pattern-id> @ <baseCommit>`. Duplicate
  titles within the open set are skipped, so a recurring bypass does not
  spam the tracker.
- **Hard rule:** this workflow is NOT a required PR-merge check and does NOT
  modify `ci.yml` or any other existing workflow.

## Retention policy

- `actions/upload-artifact` retains nightly bundles for 30 days.
- The harness writes one `run-<ISO>.json` per invocation and one bypass
  receipt per bypassed pattern. There is no rolling pruning; the weekly
  summary explicitly windows to the last 7 days by file mtime.
- `artifacts/adversarial/` is gitignored — corpus stays the source of truth,
  not the run artifacts.
