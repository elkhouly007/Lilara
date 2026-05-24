#!/usr/bin/env bash
# lilara-diff-decisions.sh — Replay the last N journal entries through the current
# decision engine and report any action or source divergence vs the recorded values.
#
# Used as a regression gate before Phase 4 flips LILARA_CONTRACT_ENABLED=1 default.
# Requires the decision journal at ~/.lilara/decision-journal.jsonl
#
# Usage:
#   bash scripts/lilara-diff-decisions.sh [--max N] [--journal /path/to/journal.jsonl]
#
# Exit 0 = clean (zero divergence ignoring legitimate contract-allow source changes).
# Exit 1 = divergence found.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  printf 'Error: node not found — skipping lilara-diff-decisions.sh\n' >&2
  exit 0
fi

MAX_ENTRIES=1000
JOURNAL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --max)     shift; MAX_ENTRIES="${1:-1000}" ;;
    --max=*)   MAX_ENTRIES="${1#--max=}" ;;
    --journal) shift; JOURNAL="${1:-}" ;;
    --journal=*) JOURNAL="${1#--journal=}" ;;
    *) printf 'Unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

node - "$root" "$MAX_ENTRIES" "$JOURNAL" <<'EOF'
"use strict";
const path = require("path");
const fs   = require("fs");
const os   = require("os");

const root       = process.argv[2];
const maxEntries = Number(process.argv[3] || 1000);
const journalArg = process.argv[4] || "";

// Locate journal
const defaultJournal = path.join(
  process.env.LILARA_STATE_DIR || path.join(os.homedir(), ".openclaw", "agent-runtime-guard"),
  "decision-journal.jsonl"
);
const journalPath = journalArg || defaultJournal;

if (!fs.existsSync(journalPath)) {
  console.log("No journal found at", journalPath, "— nothing to replay.");
  process.exit(0);
}

// Parse journal entries
const lines = fs.readFileSync(journalPath, "utf8").trim().split("\n").filter(Boolean);
const entries = [];
for (const line of lines) {
  try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
}
const toReplay = entries.filter(e => e.kind === "runtime-decision").slice(-maxEntries);

if (toReplay.length === 0) {
  console.log("No runtime-decision entries in journal — nothing to replay.");
  process.exit(0);
}

const { decide } = require(path.join(root, "runtime/decision-engine"));

let diverged = 0;
let replayed = 0;

for (const entry of toReplay) {
  const input = {
    tool:        entry.tool       || "Bash",
    command:     entry.command    || "",
    targetPath:  entry.targetPath || "",
    branch:      entry.branch     || "",
    payloadClass: entry.payloadClass || "A",
    notes:       "diff-replay",
  };

  let result;
  try {
    result = decide(input);
  } catch (err) {
    console.error("REPLAY ERROR:", err.message, "entry:", JSON.stringify(entry).slice(0, 120));
    diverged++;
    continue;
  }

  replayed++;

  // Source changes: contract-allow is a legitimate new source — not a divergence
  const sourceOk = result.decisionSource === entry.source ||
                   result.decisionSource === "contract-allow";

  // Action changes: contract-allow may demote — only flag promotions (more restrictive)
  const actionRank = { allow: 0, route: 1, modify: 1, "require-tests": 2, "require-review": 2, escalate: 3, block: 4 };
  const oldRank = actionRank[entry.action]   ?? -1;
  const newRank = actionRank[result.action]  ?? -1;
  const actionOk = result.action === entry.action || (result.decisionSource === "contract-allow" && newRank <= oldRank);

  if (!actionOk || !sourceOk) {
    console.error(`DIVERGE: action ${entry.action}→${result.action} source ${entry.source}→${result.decisionSource}`);
    console.error("  entry:", JSON.stringify(entry).slice(0, 200));
    diverged++;
  }
}

console.log(`Replayed ${replayed} entries. Divergences: ${diverged} (ignoring legitimate contract-allow demotions).`);
process.exit(diverged > 0 ? 1 : 0);
EOF
