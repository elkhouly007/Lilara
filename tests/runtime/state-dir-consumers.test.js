"use strict";
// state-dir-consumers.test.js — ADR-028 regression tests.
//
// Proves that each state-consumer (decision-journal, policy-store, session-context,
// cross-agent-lock) degrades safely when LILARA_STATE_DIR is world-writable (POSIX
// only) rather than writing security state to a poisoned location.
//
// Pattern mirrors mcp-pin.test.js:withPins + chmodSync(0o777) + assert-degrade (ADR-024).
// Platform gate: poisoned-dir checks use POSIX mode bits and are skipped on Windows
// (ensureStateDirSafe returns true on win32 — meaningless NTFS ACL mode bits).
// Windows branch: asserts normal operation with no false-unsafe.

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");

let passed = 0;
let failed = 0;
function ok(name)      { console.log(`  ok  ${name}`); passed++; }
function fail(name, m) { console.error(`  FAIL ${name} — ${m}`); failed++; }

// Isolation wrapper: fresh LILARA_STATE_DIR per test, restored on exit.
function withStateDir(fn) {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), "state-dir-consumers-test-"));
  const prev = process.env.LILARA_STATE_DIR;
  process.env.LILARA_STATE_DIR = dir;
  try { fn(dir); }
  finally {
    if (prev === undefined) delete process.env.LILARA_STATE_DIR;
    else process.env.LILARA_STATE_DIR = prev;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ─── decision-journal.js ──────────────────────────────────────────────────────

const { append: journalAppend, journalPaths } = require(path.join(root, "runtime", "decision-journal"));

if (process.platform !== "win32") {
  // ADR-028-J1 (POSIX): world-writable state dir → journal disabled, no file written.
  withStateDir((dir) => {
    // Create the baseDir first (so the validation code sees it), then poison it.
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o777);
    try {
      // journal is gated by LILARA_DECISION_JOURNAL (default on); set a fresh env
      const prevJournal = process.env.LILARA_DECISION_JOURNAL;
      delete process.env.LILARA_DECISION_JOURNAL; // default=enabled
      let result;
      try { result = journalAppend({ action: "allow", riskLevel: "low", reasonCodes: [], tool: "Bash", branch: "main", targetPath: "/tmp" }); }
      finally { if (prevJournal !== undefined) process.env.LILARA_DECISION_JOURNAL = prevJournal; }
      result === false
        ? ok("ADR028-J1 (POSIX): poisoned state dir → journal append returns false (warn-and-disable)")
        : fail("ADR028-J1 (POSIX): journal should return false on poisoned dir", `result=${result}`);
      const logFile = journalPaths().logFile;
      !fs.existsSync(logFile)
        ? ok("ADR028-J1 (POSIX): no journal file written to poisoned location")
        : fail("ADR028-J1 (POSIX): journal file must NOT be written to poisoned dir", `exists: ${logFile}`);
    } finally {
      fs.chmodSync(dir, 0o700); // restore for rmSync cleanup
    }
  });
} else {
  // Windows: no poisoned-dir path (ensureStateDirSafe returns true on NTFS).
  withStateDir(() => {
    const prevJournal = process.env.LILARA_DECISION_JOURNAL;
    delete process.env.LILARA_DECISION_JOURNAL;
    let result;
    try { result = journalAppend({ action: "allow", riskLevel: "low", reasonCodes: [], tool: "Bash", branch: "main", targetPath: "/tmp" }); }
    finally { if (prevJournal !== undefined) process.env.LILARA_DECISION_JOURNAL = prevJournal; }
    result === true
      ? ok("ADR028-J1 (Windows): safe state dir → journal append succeeds (no false-unsafe)")
      : fail("ADR028-J1 (Windows): journal should succeed on safe dir", `result=${result}`);
  });
}

// ─── policy-store.js ──────────────────────────────────────────────────────────
// Reload policy-store fresh per test to avoid the module-level _policyCache
// contaminating cross-test reads. We do this by requiring a fresh module path
// (caching is per-file; we'd need cache-busting tricks, so instead we just
// run each sub-test in a withStateDir and rely on cache invalidation through
// the module's own resetCache-like pattern).
// Note: policy-store has no resetCache export, so we use a fresh process env
// to ensure loadPolicy() reads from the test dir, not from a cached stale path.

if (process.platform !== "win32") {
  // ADR-028-P1 (POSIX): world-writable state dir → loadPolicy returns emptyPolicy (fail-closed).
  withStateDir((dir) => {
    // Create and pre-seed a policy file, then poison the dir — to ensure validation
    // fires (not ENOENT) and the policy grants are NOT returned.
    const policyFile = path.join(dir, "learned-policy.json");
    const fakePolicy = { learnedAllows: { "v2|rm-rf|DANGEROUS": true }, approvalCounts: {}, suggestions: {}, autoAllowOnce: {} };
    fs.writeFileSync(policyFile, JSON.stringify(fakePolicy), { mode: 0o600 });
    fs.chmodSync(dir, 0o777);
    try {
      // Require fresh (no inter-test cache pollution via module cache busting trick)
      // We can't easily bust Node's module cache without delete require.cache,
      // so we check the loadPolicy function's behavior directly. Since the
      // module cache retains _policyCache, we must call loadPolicy() after the
      // module's cache was cleared by any previous savePolicy or on first require.
      // To be safe, require a fresh instance by temporarily clearing cache:
      const modPath = path.join(root, "runtime", "policy-store");
      delete require.cache[require.resolve(modPath)];
      const ps = require(modPath);
      const policy = ps.loadPolicy();
      const hasGrant = policy.learnedAllows && policy.learnedAllows["v2|rm-rf|DANGEROUS"];
      !hasGrant
        ? ok("ADR028-P1 (POSIX): poisoned state dir → loadPolicy() returns emptyPolicy (no grants from poisoned store)")
        : fail("ADR028-P1 (POSIX): grants from poisoned store must be suppressed", `learnedAllows=${JSON.stringify(policy.learnedAllows)}`);
      // Re-delete cache after test to avoid polluting subsequent tests.
      delete require.cache[require.resolve(modPath)];
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });

  // ADR-028-P2 (POSIX): world-writable state dir → savePolicy() does cache-only, no file write.
  withStateDir((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o777);
    try {
      const modPath = path.join(root, "runtime", "policy-store");
      delete require.cache[require.resolve(modPath)];
      const ps = require(modPath);
      const prev = process.env.LILARA_READONLY_CONTRACT;
      delete process.env.LILARA_READONLY_CONTRACT;
      const fakePolicy = ps.emptyPolicy ? ps.emptyPolicy() : { learnedAllows: {}, approvalCounts: {}, suggestions: {}, autoAllowOnce: {} };
      try { ps.savePolicy(fakePolicy); }
      finally { if (prev !== undefined) process.env.LILARA_READONLY_CONTRACT = prev; }
      const policyFile = path.join(dir, "learned-policy.json");
      !fs.existsSync(policyFile)
        ? ok("ADR028-P2 (POSIX): poisoned state dir → savePolicy() writes nothing (cache-only)")
        : fail("ADR028-P2 (POSIX): no policy file should be written to poisoned dir", `exists: ${policyFile}`);
      delete require.cache[require.resolve(modPath)];
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });
} else {
  // Windows: assert safe operation only.
  withStateDir(() => {
    const modPath = path.join(root, "runtime", "policy-store");
    delete require.cache[require.resolve(modPath)];
    const ps = require(modPath);
    const policy = ps.loadPolicy();
    (policy && typeof policy === "object")
      ? ok("ADR028-P1 (Windows): safe state dir → loadPolicy() returns a valid policy (no false-unsafe)")
      : fail("ADR028-P1 (Windows): loadPolicy should return valid policy on safe dir", String(policy));
    delete require.cache[require.resolve(modPath)];
  });
}

// ─── session-context.js ───────────────────────────────────────────────────────

const { loadState, saveState, resetCache } = require(path.join(root, "runtime", "session-context"));

if (process.platform !== "win32") {
  // ADR-028-S1 (POSIX): world-writable state dir → loadState() returns emptyState, no file read.
  withStateDir((dir) => {
    // Pre-seed a session-context.json with non-empty data, then poison the dir.
    const sessionFile = path.join(dir, "session-context.json");
    const fakeState = { sessions: { "test-session": [{ action: "allow" }] }, recent: [{ action: "allow" }], updatedAt: null };
    fs.writeFileSync(sessionFile, JSON.stringify(fakeState), { mode: 0o600 });
    fs.chmodSync(dir, 0o777);
    try {
      resetCache(); // clear in-process cache
      const state = loadState();
      const isEmpty = !state.sessions || Object.keys(state.sessions).length === 0;
      isEmpty
        ? ok("ADR028-S1 (POSIX): poisoned state dir → loadState() returns emptyState (no attacker trajectory)")
        : fail("ADR028-S1 (POSIX): attacker trajectory must not bleed into session state", `sessions=${JSON.stringify(state.sessions)}`);
    } finally {
      fs.chmodSync(dir, 0o700);
      resetCache();
    }
  });

  // ADR-028-S2 (POSIX): world-writable state dir → saveState() writes nothing (cache-only).
  withStateDir((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o777);
    try {
      resetCache();
      const testState = { sessions: { "sid": [{ action: "escalate" }] }, recent: [], updatedAt: null };
      const prev = process.env.LILARA_READONLY_CONTRACT;
      delete process.env.LILARA_READONLY_CONTRACT;
      try { saveState(testState); }
      finally { if (prev !== undefined) process.env.LILARA_READONLY_CONTRACT = prev; }
      const sessionFile = path.join(dir, "session-context.json");
      !fs.existsSync(sessionFile)
        ? ok("ADR028-S2 (POSIX): poisoned state dir → saveState() writes nothing (cache-only)")
        : fail("ADR028-S2 (POSIX): no session file should be written to poisoned dir", `exists: ${sessionFile}`);
    } finally {
      fs.chmodSync(dir, 0o700);
      resetCache();
    }
  });
} else {
  // Windows: assert safe operation.
  withStateDir(() => {
    resetCache();
    const state = loadState();
    (state && typeof state === "object")
      ? ok("ADR028-S1 (Windows): safe state dir → loadState() returns valid state (no false-unsafe)")
      : fail("ADR028-S1 (Windows): loadState should return valid state on safe dir", String(state));
    resetCache();
  });
}

// ─── cross-agent-lock.js ──────────────────────────────────────────────────────

const { readLockState, LOCK_SUBDIR } = require(path.join(root, "runtime", "cross-agent-lock"));

if (process.platform !== "win32") {
  // ADR-028-L1 (POSIX): lock dir exists under a world-writable state dir →
  // readLockState() returns { ok:false, malformed:[{reason:"state-dir-insecure"}] }.
  // Engine treats malformed→ok=false as fail-closed for write-like calls.
  withStateDir((dir) => {
    // Create the lock subdir (so the existence check fires and we reach validation).
    const lockDir = path.join(dir, LOCK_SUBDIR);
    fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o777); // poison state root (not the lock subdir)
    try {
      const state = readLockState(dir);
      (!state.ok && state.malformed.some((m) => m.reason === "state-dir-insecure"))
        ? ok("ADR028-L1 (POSIX): poisoned state dir + lock dir exists → readLockState ok=false reason=state-dir-insecure")
        : fail("ADR028-L1 (POSIX): readLockState must return ok=false on poisoned dir", JSON.stringify(state));
      state.locks.length === 0
        ? ok("ADR028-L1 (POSIX): no lock records returned from poisoned state dir")
        : fail("ADR028-L1 (POSIX): lock records must be empty from poisoned state dir", JSON.stringify(state.locks));
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });

  // ADR-028-L2 (POSIX): absent lock dir + poisoned state root → no-op (common case,
  // no FP). The lock dir existence check short-circuits before validation runs.
  withStateDir((dir) => {
    fs.chmodSync(dir, 0o777);
    try {
      const state = readLockState(dir);
      // No lock dir → early return { ok:true, locks:[], malformed:[] } — no FP.
      (state.ok && state.locks.length === 0 && state.malformed.length === 0)
        ? ok("ADR028-L2 (POSIX): poisoned state dir + NO lock dir → no-op (no FP for common case)")
        : fail("ADR028-L2 (POSIX): absent lock dir must short-circuit before validation", JSON.stringify(state));
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });
} else {
  // Windows: assert safe operation.
  withStateDir((dir) => {
    const lockDir = path.join(dir, LOCK_SUBDIR);
    fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    const state = readLockState(dir);
    (state.ok && state.locks.length === 0)
      ? ok("ADR028-L1 (Windows): safe state dir → readLockState ok=true no locks (no false-unsafe)")
      : fail("ADR028-L1 (Windows): readLockState should be ok on safe dir", JSON.stringify(state));
  });
}

console.log(`\nstate-dir-consumers.test.js: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
