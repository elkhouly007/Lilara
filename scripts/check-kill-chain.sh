#!/usr/bin/env bash
# check-kill-chain.sh — Multi-step provenance/kill-chain fixture harness (ADR-017).
#
# Replays tests/fixtures/kill-chain/*.steps.json through the F23 kill-chain
# evaluation engine. Each fixture drives a sequence of steps against one shared
# isolated stateDir (mirroring real PostToolUse → decide() ordering):
#
#   source    — directly records a provenance source node (simulates PostToolUse)
#   derivative— records a tainted derivative node (simulates Write propagation)
#   decide    — calls decide() under LILARA_KILL_CHAIN_ENFORCE=1 and asserts
#               the killChain receipt field
#
# Benign fixtures must stay expectedDetected:false (FP guard).
#
# Exit 0 = all fixtures pass. Exit 1 = any fixture fails.
#
# Usage: bash scripts/check-kill-chain.sh

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  printf '[check-kill-chain] node not found on PATH\n' >&2
  exit 1
fi

FIXTURE_DIR="tests/fixtures/kill-chain"
if [ ! -d "$FIXTURE_DIR" ]; then
  printf '[check-kill-chain] fixture dir missing: %s\n' "$FIXTURE_DIR" >&2
  exit 1
fi

printf '[check-kill-chain]\n'

FAILED=0
TOTAL=0
PASS=0

for fixture in "$FIXTURE_DIR"/*.steps.json; do
  [ -f "$fixture" ] || continue
  TOTAL=$((TOTAL + 1))
  rel="${fixture#$root/}"

  # Run the fixture via an inline Node.js harness
  if LILARA_FIXTURE_PATH="$fixture" LILARA_ROOT="$root" node - << 'NODEEOF'
"use strict";
const fs   = require("fs");
const os   = require("os");
const path = require("path");

const root        = process.env.LILARA_ROOT;
const fixturePath = process.env.LILARA_FIXTURE_PATH;
const fixture     = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

// Resolve module paths from root
function req(rel) { return require(path.join(root, rel)); }

// Isolated per-fixture stateDir
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilara-kc-"));
process.env.LILARA_STATE_DIR       = stateDir;
process.env.LILARA_KILL_CHAIN_ENFORCE = "1";   // enforce so decide() action changes
process.env.LILARA_CONTRACT_ENABLED   = "0";
process.env.LILARA_TRAJECTORY_WINDOW_MIN = "0";
process.env.LILARA_RATE_LIMIT          = "0";
process.env.LILARA_BRANCH_OVERRIDE     = "replay/isolated-context";
delete process.env.LILARA_KILL_SWITCH;
delete process.env.LILARA_CONTRACT_REQUIRED;
delete process.env.LILARA_F4_DEMOTE_TOKEN;

let exitCode = 0;
try {
  const { resetCache, recordProvenanceStep } = req("runtime/session-context");
  const { tokenHashSet, pathHash }           = req("runtime/provenance-graph");
  const { decide }                           = req("runtime/decision-engine");
  const { build: buildIr }                  = req("runtime/action-ir");

  // Replay each step in order
  for (const step of fixture.steps) {
    // Clear in-memory cache between steps (mirrors fresh PostToolUse process)
    // but keep the stateDir so graph nodes persist across steps.
    // We only clear _stateCache (session-trajectory), NOT _graphCache —
    // the graph must accumulate across steps to form the chain.
    // resetCache() clears both caches; we reload the graph from disk each step.
    resetCache();

    if (step.type === "source") {
      // Simulate PostToolUse source recording
      const tokens = tokenHashSet(String(step.content || ""));
      const ph     = step.path ? pathHash(step.path) : null;
      const uh     = step.url  ? pathHash(step.url)  : null;
      const host   = step.url ? (() => { try { return new URL(step.url).hostname; } catch { return null; } })() : null;
      if (tokens.length >= 3) {
        recordProvenanceStep({
          role:        "source",
          sourceClass: step.sourceClass || "sensitive",
          pathHash:    ph,
          urlHash:     uh,
          host:        host || null,
          tokenHashes: tokens,
          ts:          Date.now(),
        });
      }
    } else if (step.type === "derivative") {
      // Simulate write-propagation recording (normally done inside decide())
      const tokens = tokenHashSet(String(step.content || ""));
      const ph     = step.targetPath ? pathHash(step.targetPath) : null;
      if (tokens.length >= 3 && ph) {
        recordProvenanceStep({
          role:           "derivative",
          sourceClass:    step.sourceClass || "sensitive",
          targetPathHash: ph,
          tokenHashes:    tokens.slice(0, 32),
          ts:             Date.now(),
        });
      }
    } else if (step.type === "decide") {
      const inp = Object.assign({ branch: "feature/test" }, step.input || {});

      // Build the canonical IR so decide() F23 block can evaluate the chain.
      // pretool-gate.js normally does this before calling decide(); the harness
      // calls decide() directly, so we must build it here.
      inp.ir = buildIr(inp, {
        harness: "claude",
        tool:    inp.tool || "Bash",
        command: inp.command || "",
        cwd:     inp.targetPath || "",
        branch:  inp.branch || "feature/test",
      });

      resetCache(); // ensure fresh state for this decide() call
      const result = decide(inp);

      const expectedDet  = Boolean(step.expectedDetected);
      const expectedType = step.expectedChainType || null;
      const gotDet  = Boolean(result.killChain && result.killChain.detected);
      const gotType = (result.killChain && result.killChain.chainType) || null;

      if (gotDet !== expectedDet || gotType !== expectedType) {
        process.stderr.write(
          `  FAIL  ${path.basename(fixturePath)}: ` +
          `detected=${gotDet} (expected ${expectedDet}) ` +
          `chainType=${gotType} (expected ${expectedType})\n`
        );
        exitCode = 1;
      }
    }
  }

  // Final fixture-level assertion (last decide step result cached in closure)
  // Individual step assertions above are sufficient.

} catch (err) {
  process.stderr.write(`  ERROR  ${path.basename(fixturePath)}: ${err.message}\n`);
  exitCode = 1;
} finally {
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

process.exit(exitCode);
NODEEOF
  then
    PASS=$((PASS + 1))
    printf '  ok      %s\n' "$rel"
  else
    FAILED=1
    printf '  ERROR   %s\n' "$rel" >&2
  fi
done

if [ "$TOTAL" -eq 0 ]; then
  printf '\ncheck-kill-chain: no fixtures found in %s\n' "$FIXTURE_DIR"
  exit 0
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\ncheck-kill-chain FAILED (%d/%d fixtures passed)\n' "$PASS" "$TOTAL" >&2
  exit 1
fi

printf '\ncheck-kill-chain passed (%d/%d)\n' "$PASS" "$TOTAL"
