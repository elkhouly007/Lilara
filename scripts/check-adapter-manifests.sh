#!/usr/bin/env bash
# check-adapter-manifests.sh — Validate the six adapter capability manifests
# under <harness>/manifest.json.
#
# Asserts (per G4 PR #44 brief):
#   1. all six manifests exist (claude, opencode, openclaw, codex, clawcode,
#      antegravity)
#   2. required top-level keys are present and have the expected types
#   3. harness field matches the directory name (no unknown harness names)
#   4. enum values come from the documented sets (mirrors runtime/action-ir.js
#      KNOWN_* constants):
#        - harnessVersion: any string (or "unverified")
#        - argsFidelity / cwdFidelity: "exact" | "best-effort" | "opaque"
#        - mcpInterception / skillInterception: "supported" | "unsupported"
#          | "unverified"
#        - outputChannels.<key>: "intercept" | "observe" | "none"
#        - capabilities.pretoolBlocking / posttoolObservation: "supported"
#          | "unsupported" | "unverified"
#        - capabilities.argsFidelity: same as top-level argsFidelity enum
#        - capabilities.finalMessageInterception: outputChannels enum
#        - capabilities.outputChannelCoverage: "full" | "broad" | "partial"
#          | "minimal" | "none"
#        - envelopeReporting / capabilities.envelopeReporting / capabilities
#          .exactCwd / capabilities.exactEnv: boolean
#   5. all seven outputChannels keys are present (toolOutput, generatedFiles,
#      commitText, prText, finalMessage, terminal, screenshots)
#   6. every "none", "best-effort", or "unverified" capability has a matching
#      entry in negativeCapabilities OR is mentioned by a compensating
#      restriction string
#   7. negativeCapabilities entries are { capability, reason, evidence } shaped
#   8. verifiedAt is either null or absent (no faked timestamps)
#
# Zero new dependencies — uses Node.js with built-ins only.
#
# Usage: bash scripts/check-adapter-manifests.sh

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  if [ "${HORUS_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-adapter-manifests.sh (HORUS_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-adapter-manifests.sh requires Node.js\n' >&2
  exit 1
fi

printf '[check-adapter-manifests]\n'

if node - "$root" <<'NODE'
"use strict";
const fs   = require("fs");
const path = require("path");
const root = process.argv[2];

const HARNESSES = ["claude", "opencode", "openclaw", "codex", "clawcode", "antegravity"];

const FIDELITY = new Set(["exact", "best-effort", "opaque"]);
const INTERCEPTION = new Set(["supported", "unsupported", "unverified"]);
const CHANNEL_STATE = new Set(["intercept", "observe", "none"]);
const COVERAGE = new Set(["full", "broad", "partial", "minimal", "none"]);
const REQUIRED_CHANNEL_KEYS = [
  "toolOutput", "generatedFiles", "commitText", "prText",
  "finalMessage", "terminal", "screenshots",
];

// Values that are "weaker than verified" and therefore require an explicit
// negative-capability entry or compensating restriction.
const WEAK_VALUES = new Set(["best-effort", "unverified", "none", "opaque", false]);

let failed = 0;
function fail(harness, msg) {
  process.stderr.write(`  ERROR   ${harness}: ${msg}\n`);
  failed++;
}
function pass(msg) {
  process.stdout.write(`  ok      ${msg}\n`);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isString(v) { return typeof v === "string" && v.length > 0; }
function isBool(v) { return typeof v === "boolean"; }

function hasMention(restrictions, capability) {
  if (!Array.isArray(restrictions)) return false;
  const needle = String(capability).toLowerCase();
  for (const r of restrictions) {
    if (typeof r !== "string") continue;
    if (r.toLowerCase().includes(needle)) return true;
  }
  return false;
}

for (const harness of HARNESSES) {
  const file = path.join(root, harness, "manifest.json");
  if (!fs.existsSync(file)) { fail(harness, `manifest.json missing at ${file}`); continue; }

  let m;
  try { m = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (err) { fail(harness, `manifest.json is not valid JSON: ${err.message}`); continue; }

  // 1. Required top-level keys.
  const REQUIRED = [
    "harness", "harnessVersion", "envelopeReporting",
    "argsFidelity", "cwdFidelity", "mcpInterception", "skillInterception",
    "outputChannels",
    "capabilities", "negativeCapabilities", "compensatingRestrictions",
  ];
  for (const k of REQUIRED) {
    if (!(k in m)) fail(harness, `required key missing: ${k}`);
  }

  // 2. harness matches dir.
  if (m.harness !== harness) fail(harness, `harness field "${m.harness}" does not match directory "${harness}"`);

  // 3. harnessVersion must be a string (any value, including "unverified").
  if (!isString(m.harnessVersion)) fail(harness, "harnessVersion must be a non-empty string");

  // 4. Enums on top-level fields.
  if (!FIDELITY.has(m.argsFidelity)) fail(harness, `argsFidelity "${m.argsFidelity}" not in {exact, best-effort, opaque}`);
  if (!FIDELITY.has(m.cwdFidelity))  fail(harness, `cwdFidelity "${m.cwdFidelity}" not in {exact, best-effort, opaque}`);
  if (!INTERCEPTION.has(m.mcpInterception))   fail(harness, `mcpInterception "${m.mcpInterception}" not in {supported, unsupported, unverified}`);
  if (!INTERCEPTION.has(m.skillInterception)) fail(harness, `skillInterception "${m.skillInterception}" not in {supported, unsupported, unverified}`);
  if (!isBool(m.envelopeReporting)) fail(harness, "envelopeReporting must be boolean");

  // 5. outputChannels shape.
  if (!isPlainObject(m.outputChannels)) {
    fail(harness, "outputChannels must be an object");
  } else {
    for (const k of REQUIRED_CHANNEL_KEYS) {
      if (!(k in m.outputChannels)) fail(harness, `outputChannels.${k} missing`);
      else if (!CHANNEL_STATE.has(m.outputChannels[k])) fail(harness, `outputChannels.${k} "${m.outputChannels[k]}" not in {intercept, observe, none}`);
    }
  }

  // 6. capabilities sub-object.
  const c = m.capabilities;
  if (!isPlainObject(c)) {
    fail(harness, "capabilities must be an object");
  } else {
    const CAP_REQUIRED = [
      "pretoolBlocking", "posttoolObservation",
      "exactCwd", "exactEnv",
      "argsFidelity",
      "mcpInterception", "skillInterception",
      "finalMessageInterception",
      "outputChannelCoverage",
      "envelopeReporting",
    ];
    for (const k of CAP_REQUIRED) {
      if (!(k in c)) fail(harness, `capabilities.${k} missing`);
    }
    if (c.pretoolBlocking != null && !INTERCEPTION.has(c.pretoolBlocking))
      fail(harness, `capabilities.pretoolBlocking "${c.pretoolBlocking}" not in {supported, unsupported, unverified}`);
    if (c.posttoolObservation != null && !INTERCEPTION.has(c.posttoolObservation))
      fail(harness, `capabilities.posttoolObservation "${c.posttoolObservation}" not in {supported, unsupported, unverified}`);
    if (c.argsFidelity != null && !FIDELITY.has(c.argsFidelity))
      fail(harness, `capabilities.argsFidelity "${c.argsFidelity}" not in fidelity enum`);
    if (c.mcpInterception != null && !INTERCEPTION.has(c.mcpInterception))
      fail(harness, `capabilities.mcpInterception "${c.mcpInterception}" not in interception enum`);
    if (c.skillInterception != null && !INTERCEPTION.has(c.skillInterception))
      fail(harness, `capabilities.skillInterception "${c.skillInterception}" not in interception enum`);
    if (c.finalMessageInterception != null && !CHANNEL_STATE.has(c.finalMessageInterception))
      fail(harness, `capabilities.finalMessageInterception "${c.finalMessageInterception}" not in channel-state enum`);
    if (c.outputChannelCoverage != null && !COVERAGE.has(c.outputChannelCoverage))
      fail(harness, `capabilities.outputChannelCoverage "${c.outputChannelCoverage}" not in {full, broad, partial, minimal, none}`);
    if (c.exactCwd != null && !isBool(c.exactCwd)) fail(harness, "capabilities.exactCwd must be boolean");
    if (c.exactEnv != null && !isBool(c.exactEnv)) fail(harness, "capabilities.exactEnv must be boolean");
    if (c.envelopeReporting != null && !isBool(c.envelopeReporting)) fail(harness, "capabilities.envelopeReporting must be boolean");

    // Cross-check: top-level vs capabilities must agree.
    if (m.argsFidelity !== c.argsFidelity) fail(harness, `argsFidelity drift: top-level "${m.argsFidelity}" vs capabilities "${c.argsFidelity}"`);
    if (m.mcpInterception !== c.mcpInterception) fail(harness, `mcpInterception drift: top-level "${m.mcpInterception}" vs capabilities "${c.mcpInterception}"`);
    if (m.skillInterception !== c.skillInterception) fail(harness, `skillInterception drift: top-level "${m.skillInterception}" vs capabilities "${c.skillInterception}"`);
    if (m.envelopeReporting !== c.envelopeReporting) fail(harness, `envelopeReporting drift: top-level ${m.envelopeReporting} vs capabilities ${c.envelopeReporting}`);
    if (isPlainObject(m.outputChannels) && c.finalMessageInterception !== m.outputChannels.finalMessage)
      fail(harness, `finalMessageInterception drift: capabilities "${c.finalMessageInterception}" vs outputChannels.finalMessage "${m.outputChannels.finalMessage}"`);
  }

  // 7. negativeCapabilities — array of {capability, reason, evidence}.
  const negs = m.negativeCapabilities;
  if (!Array.isArray(negs)) {
    fail(harness, "negativeCapabilities must be an array");
  } else {
    for (let i = 0; i < negs.length; i++) {
      const n = negs[i];
      if (!isPlainObject(n)) { fail(harness, `negativeCapabilities[${i}] must be an object`); continue; }
      if (!isString(n.capability)) fail(harness, `negativeCapabilities[${i}].capability must be non-empty string`);
      if (!isString(n.reason))     fail(harness, `negativeCapabilities[${i}].reason must be non-empty string`);
      if (!isString(n.evidence))   fail(harness, `negativeCapabilities[${i}].evidence must be non-empty string`);
    }
  }

  // 8. compensatingRestrictions — array of non-empty strings.
  const restr = m.compensatingRestrictions;
  if (!Array.isArray(restr)) {
    fail(harness, "compensatingRestrictions must be an array");
  } else {
    for (let i = 0; i < restr.length; i++) {
      if (!isString(restr[i])) fail(harness, `compensatingRestrictions[${i}] must be non-empty string`);
    }
  }

  // 9. Every weak capability needs a negative-capability entry or a
  //    compensating-restriction mention.
  if (isPlainObject(c) && Array.isArray(negs)) {
    const negCaps = new Set(negs.map((n) => n && n.capability).filter(Boolean));
    const WEAK_CAPS = [
      ["pretoolBlocking", c.pretoolBlocking],
      ["posttoolObservation", c.posttoolObservation],
      ["exactCwd", c.exactCwd],
      ["exactEnv", c.exactEnv],
      ["argsFidelity", c.argsFidelity],
      ["mcpInterception", c.mcpInterception],
      ["skillInterception", c.skillInterception],
      ["finalMessageInterception", c.finalMessageInterception],
      ["outputChannelCoverage", c.outputChannelCoverage],
      ["envelopeReporting", c.envelopeReporting],
    ];
    for (const [name, value] of WEAK_CAPS) {
      if (!WEAK_VALUES.has(value)) continue;
      if (negCaps.has(name)) continue;
      if (hasMention(restr, name)) continue;
      fail(harness, `weak capability "${name}=${value}" needs a matching negativeCapabilities entry or compensatingRestrictions mention`);
    }
  }

  // 10. verifiedAt — must be null or absent (no faked timestamps).
  if ("verifiedAt" in m && m.verifiedAt !== null) {
    fail(harness, `verifiedAt must be null until live verification lands; got ${JSON.stringify(m.verifiedAt)}`);
  }

  if (failed === 0 || ![...Array(failed).keys()].length /* always pass per-harness summary */) {
    // Per-harness pass line is printed below only when no failures.
  }
}

if (failed === 0) {
  for (const h of HARNESSES) pass(`${h}/manifest.json — capabilities, negativeCapabilities, compensatingRestrictions present and consistent`);
  process.stdout.write(`\nAll ${HARNESSES.length} adapter manifests validated.\n`);
  process.exit(0);
} else {
  process.stderr.write(`\ncheck-adapter-manifests FAILED — ${failed} error(s) above.\n`);
  process.exit(1);
}
NODE
then
  printf '\ncheck-adapter-manifests: PASS\n'
  exit 0
else
  printf '\ncheck-adapter-manifests: FAIL\n' >&2
  exit 1
fi
