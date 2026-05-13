#!/usr/bin/env bash
# check-action-ir-parity.sh — Assert that all six harness adapters
# (claude, openclaw, opencode, codex, clawcode, antegravity) produce a
# byte-identical canonical Action IR for the same logical action, modulo
# harness-specific fields (harness, harnessVersion, tool name case,
# manifest-derived trustMeta/outputChannels, raw-payload-hash, irHash).
#
# HAP ADR-007 PR-B acceptance gate: closes the cross-adapter parity gap that
# has been leaking semantic differences into floors and receipts since v0.4.
#
# Reads:
#   tests/fixtures/action-ir/<adapter>/<scenario>.input         (raw payload)
#   tests/fixtures/action-ir/parity/<scenario>.expected-ir.json (canonical IR)
#
# For each scenario: builds the IR via runtime/action-ir.build() for each
# adapter from its raw payload, projects to the parity-stable subset, and
# diffs against the canonical expected-IR. Any divergence fails the check.
#
# Six baseline scenarios (per ADR-007 plan §7):
#   rm-rf, force-push, curl-pipe, secret-payload, safe-ls, safe-git-status
#
# Usage: bash scripts/check-action-ir-parity.sh

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  if [ "${HORUS_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-action-ir-parity.sh (HORUS_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-action-ir-parity.sh requires Node.js\n' >&2
  exit 1
fi

printf '[check-action-ir-parity]\n'

if node - "$root" <<'NODE'
"use strict";
const path = require("path");
const fs   = require("fs");
const root = process.argv[2];
process.chdir(root);

const { build: buildIr } = require("./runtime/action-ir");
const { canonicalJson }  = require("./runtime/canonical-json");

const FIXTURE_DIR = path.join(root, "tests", "fixtures", "action-ir");
const PARITY_DIR  = path.join(FIXTURE_DIR, "parity");

const HARNESSES = ["claude", "opencode", "openclaw", "codex", "clawcode", "antegravity"];
const SCENARIOS = ["rm-rf", "force-push", "curl-pipe", "secret-payload", "safe-ls", "safe-git-status"];

// Fields that legitimately differ across adapters. Stay in sync with the
// generator at the bottom of this file; adding a parity-stable field here is a
// breaking change to the parity contract.
const STRIP = new Set([
  "harness", "harnessVersion",
  "tool",
  "sessionId", "toolUseId", "agentIdentity", "ts",
  "cwd", "projectRoot", "branch",
  "outputChannels", "trustMeta",
  "rawPayloadHash", "irHash",
]);

function projectLogical(ir) {
  const out = {};
  for (const k of Object.keys(ir).sort()) {
    if (STRIP.has(k)) continue;
    out[k] = ir[k];
  }
  return out;
}

function loadInput(adapter, scenario) {
  const file = path.join(FIXTURE_DIR, adapter, scenario + ".input");
  if (!fs.existsSync(file)) return { ok: false, reason: `missing-input:${file}` };
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (err) {
    return { ok: false, reason: `parse-error:${file}:${err.message}` };
  }
}

function loadExpected(scenario) {
  const file = path.join(PARITY_DIR, scenario + ".expected-ir.json");
  if (!fs.existsSync(file)) {
    throw new Error(`expected-ir missing: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

let failed = 0;
let scenarioCount = 0;

for (const scenario of SCENARIOS) {
  scenarioCount++;
  const expected = loadExpected(scenario);
  const expectedJson = canonicalJson(expected);
  const adapterIRs = {};
  let scenarioOk = true;

  for (const harness of HARNESSES) {
    const r = loadInput(harness, scenario);
    if (!r.ok) {
      process.stderr.write(`FAIL  ${scenario}/${harness}: ${r.reason}\n`);
      failed++;
      scenarioOk = false;
      continue;
    }
    // Pass the same cwd via ctx so file targets are deterministic across
    // adapters (cwd otherwise comes from harness-specific fields like workdir,
    // tool_input.cwd, etc., which would all resolve to the same place anyway
    // here but using ctx removes the per-fixture variability).
    const ir = buildIr(r.value, {
      harness,
      cwd: "/test/cwd",
    });
    const logical = projectLogical(ir);
    adapterIRs[harness] = canonicalJson(logical);
  }

  for (const harness of HARNESSES) {
    if (adapterIRs[harness] === undefined) continue;
    if (adapterIRs[harness] !== expectedJson) {
      process.stderr.write(`FAIL  ${scenario}/${harness}: divergent IR\n`);
      process.stderr.write(`      expected: ${expectedJson}\n`);
      process.stderr.write(`      got:      ${adapterIRs[harness]}\n`);
      failed++;
      scenarioOk = false;
    }
  }
  if (scenarioOk) {
    process.stdout.write(`  ok    ${scenario} (${HARNESSES.length} adapters byte-identical)\n`);
  }
}

if (failed === 0) {
  process.stdout.write(`\nAll ${scenarioCount} scenarios × ${HARNESSES.length} adapters produced byte-identical IR.\n`);
}
process.exit(failed > 0 ? 1 : 0);
NODE
then
  printf '\ncheck-action-ir-parity: PASS\n'
  exit 0
else
  printf '\ncheck-action-ir-parity: FAIL\n' >&2
  exit 1
fi
