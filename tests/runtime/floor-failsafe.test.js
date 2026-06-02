"use strict";
// floor-failsafe.test.js — ADR-025 regression tests.
//
// Proves that unexpected throws inside security floor evaluators are caught at
// the caller-level in decide() and routed to require-review, not silently
// allowed. The two highest-stakes cases are F16 (_evalAmbientFloor) and F24
// (_evalCredPersistFloor) — neither has an internal try/catch, so the
// caller-level catch is the sole protection.
//
// Technique (inherited from ADR-022 T15/T16 in mcp-floor-adversarial.test.js):
// non-enumerable throwing getter on an input property that only the target
// floor reads. Non-enumerable so Object.entries(input) in decide()'s explicit
// spread does not pre-trigger the getter.
//
// ADR-025-T1: F24 caller-catch fail-safe (credential-persistence)
//   Seam: input.file_path getter — read only by _collectWriteTargets (F24).
//   discover() reads targetPath/projectRoot but not file_path.
//   isWriteLike() reads tool/ir.fileTargets[].intent but not file_path.
//   Object.entries skips the non-enumerable getter.
//
// ADR-025-T2: F16 caller-catch fail-safe (ambient-authority)
//   Seam: input.ir.fileTargets[0].path getter — read by _collectAmbientCandidatePaths.
//   ADR-025 also adds a guard around the advisory _classifyAmbientTouch(input)
//   call (line 1012) so that call catches the throw and returns no-touch shape,
//   allowing execution to continue to F16 where the next read also throws.
//   Any intervening guarded readers (e.g. F23, which has its own fail-open
//   catch) also swallow the throw without blocking, so the getter reliably
//   fires at the F16 caller-level catch.

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");

const { decide }     = require(path.join(root, "runtime", "decision-engine"));
const { resetCache } = require(path.join(root, "runtime", "session-context"));

let passed = 0;
let failed = 0;
function ok(name)      { console.log(`  ok  ${name}`); passed++; }
function fail(name, m) { console.error(`  FAIL ${name} — ${m}`); failed++; }

// Isolation wrapper: fresh LILARA_STATE_DIR, resetCache(), restore on exit.
// Mirrors mcp-floor-adversarial.test.js isolated().
function isolated(fn) {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), "floor-failsafe-test-"));
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

// ─── ADR-025-T1: F24 caller-catch fail-safe — credential-persistence ─────────
// Before ADR-025: an unexpected throw in _evalCredPersistFloor's caller block
// fell through to allow. After: returns require-review + reasonCode
// "credential-persistence-scan-failed".
//
// Input: tool:"Write" (triggers isFileWrite guard in F24), benign targetPath
// (non-sensitive, skips F16). Non-enumerable getter on file_path throws when
// _collectWriteTargets reads `typeof input.file_path === "string"` (line 510).
isolated(() => {
  const input = {
    tool:       "Write",
    harness:    "claude",
    command:    "",
    branch:     "main",
    targetPath: "src/app.js",   // benign; non-ambient, non-sensitive → F16/F24 won't fire normally
    // file_path: not set as enumerable — getter installed below
  };
  // Non-enumerable so Object.entries(input) in decide()'s explicit spread
  // does not pre-trigger the getter. _evalCredPersistFloor reads it directly
  // via `typeof input.file_path === "string"` (line 510 of _collectWriteTargets).
  Object.defineProperty(input, "file_path", {
    get() { throw new Error("ADR-025 F24 synthetic throw"); },
    enumerable: false,
    configurable: true,
  });
  const result = decide(input);
  result.action !== "allow"
    ? ok("ADR025-T1: F24 caller-throw is NOT allowed (fail-safe)")
    : fail("ADR025-T1: F24 caller-throw is NOT allowed", `action=${result.action} — fail-open regression`);
  result.action === "require-review"
    ? ok("ADR025-T1: F24 caller-throw → require-review")
    : fail("ADR025-T1: F24 caller-throw → require-review", `action=${result.action}`);
  (result.reasonCodes && result.reasonCodes.includes("credential-persistence-scan-failed"))
    ? ok("ADR025-T1: F24 caller-throw → reasonCode=credential-persistence-scan-failed")
    : fail("ADR025-T1: F24 caller-throw → reasonCode", `reasonCodes=${JSON.stringify(result.reasonCodes)}`);
});

// ─── ADR-025-T2: F16 caller-catch fail-safe — ambient-authority ───────────────
// Before ADR-025: an unexpected throw in _evalAmbientFloor's caller block
// fell through to allow. After: returns require-review + reasonCode
// "ambient-authority-scan-failed".
//
// ADR-025 also guards the advisory _classifyAmbientTouch(input) at line 1012
// (which reads the same fileTargets path earlier); that guard catches the first
// throw and returns the no-touch shape, letting execution reach F16 where the
// getter fires again and is caught by the F16 caller-level catch.
//
// Input: ir.fileTargets[0] with a non-enumerable getter on .path. The getter
// throws when _collectAmbientCandidatePaths iterates fileTargets and reads t.path.
// Any intervening readers (e.g. F23, which has its own try/catch) swallow their
// throw independently, so the getter fires fresh at F16.
isolated(() => {
  const throwingTarget = { intent: "write" };
  // Non-enumerable .path getter: fires when _collectAmbientCandidatePaths reads t.path
  Object.defineProperty(throwingTarget, "path", {
    get() { throw new Error("ADR-025 F16 synthetic throw"); },
    enumerable: false,
    configurable: true,
  });
  const input = {
    tool:       "Write",
    harness:    "claude",
    command:    "",
    branch:     "main",
    // No targetPath — no candidate path from that slot so the getter is the sole trigger
    ir:         { fileTargets: [throwingTarget] },
  };
  const result = decide(input);
  result.action !== "allow"
    ? ok("ADR025-T2: F16 caller-throw is NOT allowed (fail-safe)")
    : fail("ADR025-T2: F16 caller-throw is NOT allowed", `action=${result.action} — fail-open regression`);
  result.action === "require-review"
    ? ok("ADR025-T2: F16 caller-throw → require-review")
    : fail("ADR025-T2: F16 caller-throw → require-review", `action=${result.action}`);
  (result.reasonCodes && result.reasonCodes.includes("ambient-authority-scan-failed"))
    ? ok("ADR025-T2: F16 caller-throw → reasonCode=ambient-authority-scan-failed")
    : fail("ADR025-T2: F16 caller-throw → reasonCode", `reasonCodes=${JSON.stringify(result.reasonCodes)}`);
});

// ─── ADR-030-T1: isWriteLike guard — degraded-mode advisory call ──────────────
// Before ADR-030: _degradedMode.isWriteLike(input) at ~line 1025 is called outside
// any try/catch. An adversarial input with a throwing getter on a property that
// isWriteLike reads makes decide() crash before the floor cascade runs.
// After: the call is guarded; the throw is caught and decide() completes normally.
//
// Seam: non-enumerable throwing getter on input.ir (not input.ir.fileTargets), so
// that `input.ir && input.ir.fileTargets` short-circuits on the `input.ir` read.
//   - tool:"Bash" is required so isWriteLike does NOT return early via the tool regex
//     (only Write/Edit/MultiEdit/NotebookEdit match); it proceeds to read input.ir.
//   - discover() does not read input.ir directly; Object.fromEntries spread skips it.
//   - _classifyAmbientTouch at line 1016 (already guarded by ADR-025) reads
//     input.ir.fileTargets inside its guard — fires the getter on input.ir, caught.
//   - isWriteLike at ~1025 reads input.ir again — fires the getter, caught by my guard.
//   - buildEarlyBlock / buildEarlyReview do NOT read input.ir — they read input.envelope
//     (which is undefined/null in this test → no throw from those builders).
//   - Later floor evaluators (F17, F24, F16) that read input.ir are inside their own
//     try/catch, so any additional getter fires are independently handled.
//   - Command "" + safe targetPath ensures no destructive floor fires, so
//     buildEarlyBlock / buildEarlyReview are never invoked in this test path.
//
// Asserts: decide() does NOT throw; returns a well-formed result with a valid action.
isolated(() => {
  const irObj = {};
  // Non-enumerable getter on input.ir so Object.fromEntries(Object.entries(input))
  // at ~990 does NOT pre-trigger it. isWriteLike reads `input.ir && input.ir.fileTargets`
  // — the `input.ir` access fires the getter; my ADR-030 guard must catch it.
  Object.defineProperty(irObj, "fileTargets", {
    get() { throw new Error("ADR-030 isWriteLike synthetic throw via ir.fileTargets"); },
    enumerable: false,
    configurable: true,
  });
  const input = {
    tool:       "Bash",
    harness:    "claude",
    command:    "npm test",  // safe: not write-like via tool regex, not destructive
    branch:     "main",
    targetPath: "src/app.ts",
    ir: irObj,
    // envelope: deliberately absent so buildEarlyBlock/buildEarlyReview's
    // `input.envelope || null` reads return null without throwing.
  };
  let result;
  let threw = false;
  try { result = decide(input); }
  catch (e) { threw = true; result = null; }

  !threw
    ? ok("ADR030-T1: isWriteLike guard — decide() does NOT throw on adversarial ir.fileTargets getter")
    : fail("ADR030-T1: isWriteLike guard", "decide() threw — fail-open regression");
  (result && result.action)
    ? ok(`ADR030-T1: isWriteLike guard — decide() returns well-formed result (action=${result.action})`)
    : fail("ADR030-T1: isWriteLike guard", `result=${JSON.stringify(result)}`);
});

console.log(`\nfloor-failsafe.test.js: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
