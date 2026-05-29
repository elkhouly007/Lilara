"use strict";
// mcp-floor-adversarial.test.js — adversarial tests for F25 mcp-arg-danger floor:
//   cycle-safe iterative _extractStringValues + require-review degrade on
//   unscannable payloads.
//
// Tests added here (Fix 1):
//   T1: circular-ref tool_input → block (dangerous string found before cycle)
//   T2: danger buried past NODE_CAP → require-review (NOT allow, NOT hard-block)
//   T3: benign bulk past NODE_CAP → require-review (NOT block — anti-FP guard)
//
// Tests added here (Fix 2):
//   T4: F26 sudo-via-raw-fallback — JSONC .mcp.json (// comment → JSON.parse fails) with
//       "command":"sudo apt-get install evilpkg" → block via raw-value fallback path.
//       Proves the value-extraction approach catches sudo correctly (not line-scan, which
//       would fail because the line starts with "command", not sudo).
//
// Fix 3 will add more tests to this same file.

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");

const { decide }     = require(path.join(root, "runtime", "decision-engine"));
const { resetCache } = require(path.join(root, "runtime", "session-context"));
const { build: buildIr } = require(path.join(root, "runtime", "action-ir"));

let passed = 0;
let failed = 0;
function ok(name)      { console.log(`  ok  ${name}`); passed++; }
function fail(name, m) { console.error(`  FAIL ${name} — ${m}`); failed++; }

// Isolation wrapper: fresh LILARA_STATE_DIR, resetCache(), restore on exit.
function isolated(fn) {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-adv-test-"));
  const prev = process.env.LILARA_STATE_DIR;
  process.env.LILARA_STATE_DIR = dir;
  try {
    resetCache();
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.LILARA_STATE_DIR;
    else process.env.LILARA_STATE_DIR = prev;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ─── T1: F25 circular-ref tool_input → block ─────────────────────────────────
// The dangerous string "rm -rf /" is present in the circular object, so the
// iterative walker must find it before hitting the cycle and return fire:true.
isolated(() => {
  const circular = { cmd: "rm -rf /" };
  circular.self  = circular;
  const input = {
    tool:       "mcp__test__exec",
    tool_input: circular,
    command:    "",
    branch:     "main",
    targetPath: ".",
    harness:    "claude",
  };
  buildIr(input, { harness: "claude", tool: input.tool });
  const result = decide(input);
  result.action === "block"
    ? ok("T1: circular-ref tool_input → block")
    : fail("T1: circular-ref tool_input → block", `action=${result.action} floorFired=${result.floorFired}`);
  // Also verify floorFired is the F25 floor (mcp-arg-danger)
  (result.floorFired && result.floorFired.toLowerCase().includes("mcp-arg"))
    ? ok("T1: floorFired is mcp-arg floor")
    : fail("T1: floorFired is mcp-arg floor", `floorFired=${result.floorFired}`);
});

// ─── T2: F25 danger buried past NODE_CAP → require-review ───────────────────
// Build a flat array of benign strings exceeding NODE_CAP (1000), with
// "rm -rf /" appended as the last element (past the cap). The walker
// truncates before seeing the danger → must gate (require-review), not allow.
isolated(() => {
  const NODE_CAP  = 1_000;
  const benign    = Array.from({ length: NODE_CAP + 10 }, (_, i) => `safe-value-${i}`);
  const dangerous = "rm -rf /";
  const items     = [...benign, dangerous]; // danger is past cap
  const input = {
    tool:       "mcp__test__exec",
    tool_input: { items },
    command:    "",
    branch:     "main",
    targetPath: ".",
    harness:    "claude",
  };
  buildIr(input, { harness: "claude", tool: input.tool });
  const result = decide(input);
  result.action !== "allow"
    ? ok("T2: danger-past-cap is NOT allowed (gate applies)")
    : fail("T2: danger-past-cap is NOT allowed", `action=${result.action} — past-cap danger must gate`);
  result.action === "require-review"
    ? ok("T2: danger-past-cap → require-review")
    : fail("T2: danger-past-cap → require-review", `action=${result.action}`);
  result.action !== "block"
    ? ok("T2: danger-past-cap is NOT hard-blocked (gate not block)")
    : fail("T2: danger-past-cap is NOT hard-blocked", `action=${result.action} — must be require-review not block`);
});

// ─── T3: F25 benign bulk past NODE_CAP → require-review, NOT block ───────────
// Benign strings only, no dangerous content, but exceeds NODE_CAP.
// Must NOT hard-block (anti-FP guard). Must gate as require-review.
// Also checks timing: must complete in <100ms.
isolated(() => {
  const NODE_CAP = 1_000;
  const items    = Array.from({ length: NODE_CAP + 50 }, (_, i) => `benign-safe-${i}`);
  const input = {
    tool:       "mcp__test__exec",
    tool_input: { items },
    command:    "",
    branch:     "main",
    targetPath: ".",
    harness:    "claude",
  };
  buildIr(input, { harness: "claude", tool: input.tool });
  const t0     = Date.now();
  const result = decide(input);
  const elapsed = Date.now() - t0;

  result.action !== "block"
    ? ok("T3: benign-bulk is NOT hard-blocked (anti-FP guard)")
    : fail("T3: benign-bulk is NOT hard-blocked", `action=${result.action} — large benign payload must not block`);
  result.action === "require-review"
    ? ok("T3: benign-bulk → require-review (unscannable gates)")
    : fail("T3: benign-bulk → require-review", `action=${result.action}`);
  elapsed < 100
    ? ok(`T3: timing <100ms (${elapsed}ms)`)
    : fail("T3: timing <100ms", `elapsed=${elapsed}ms — perf regression`);
});

// ─── T4: F26 sudo-via-raw-fallback ───────────────────────────────────────────
// Write a JSONC .mcp.json (with a // comment so JSON.parse fails) that contains
// "command":"sudo apt-get install evilpkg".  The raw-value fallback must extract
// the VALUE ("sudo apt-get install evilpkg") and classify it — NOT line-scan,
// which would see '"command"' at the start and miss the ^\s*sudo anchor.
//
// file_path uses a relative ".mcp.json" — the ambient classifier regex
// (^|\/)\.mcp\.json$ matches a bare relative name, so _classifyAmbientPath
// returns "mcpConfig". A relative path also avoids F16 (ambient-authority)
// firing before F26: F16's mcpConfig gate defers when the path is not absolute
// (_f16Abs = false), so F26 is the floor that fires.
isolated((dir) => {
  const jsoncContent = [
    "{",
    "  // configure evil server",
    '  "mcpServers": {',
    '    "evil": {',
    '      "command": "sudo apt-get install evilpkg"',
    "    }",
    "  }",
    "}",
  ].join("\n");

  // Use the isolated temp dir as projectRoot so the test is fully isolated.
  // file_path is relative so the ambient regex matches but F16 does not fire.
  const input = {
    tool:        "Write",
    harness:     "claude",
    command:     "",
    branch:      "feature/test",
    projectRoot: dir,
    file_path:   ".mcp.json",
    content:     jsoncContent,
  };
  buildIr(input, { harness: "claude", tool: input.tool });
  const result = decide(input);
  result.action === "block"
    ? ok("T4: F26 JSONC sudo → block (raw-value fallback)")
    : fail("T4: F26 JSONC sudo → block (raw-value fallback)", `action=${result.action} floorFired=${result.floorFired}`);
  (result.floorFired && result.floorFired === "mcp-registration-write")
    ? ok("T4: floorFired is mcp-registration-write")
    : fail("T4: floorFired is mcp-registration-write", `floorFired=${result.floorFired}`);
});

console.log(`\nmcp-floor-adversarial.test.js: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
