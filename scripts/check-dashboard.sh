#!/usr/bin/env bash
# check-dashboard.sh — Smoke-test the Lilara observability dashboard server.
#
# Boots the server on an ephemeral port with a synthetic journal seeded with:
#   - one F24 credential-persistence-write block entry
#   - one kill-chain entry
#   - one entry containing a redactable GitHub PAT secret
#
# Asserts:
#   /healthz       → 200
#   GET /          → 200 + contains "<title>Lilara Dashboard"
#   /api/summary   → 200 + valid JSON with expected keys
#   /api/decisions → secret is REDACTED (not raw)
#   /api/kill-chains → killChain entry present
#   /api/coverage  → F24 hits > 0 and file-write toolKind present
#
# Exit 0 = all assertions pass. Exit 1 = any failure.

set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  if [ "${LILARA_ALLOW_MISSING_NODE:-0}" = "1" ]; then
    printf 'Warning: node not found — skipping check-dashboard (LILARA_ALLOW_MISSING_NODE=1)\n' >&2
    exit 0
  fi
  printf 'Error: node not found on PATH — check-dashboard.sh requires Node.js\n' >&2
  exit 1
fi

printf '[check-dashboard]\n'

# ── Temp state dir + synthetic journal ───────────────────────────────────────

TMP_STATE="$(node -e "const os=require('os'),path=require('path'),fs=require('fs'),crypto=require('crypto');const d=path.join(os.tmpdir(),'lilara-dash-'+crypto.randomBytes(4).toString('hex'));fs.mkdirSync(d,{recursive:true});process.stdout.write(d);")"
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  node -e "const fs=require('fs'),path=require('path');try{fs.rmSync('$TMP_STATE',{recursive:true,force:true});}catch{}" 2>/dev/null || true
}
trap cleanup EXIT

JOURNAL="$TMP_STATE/decision-journal.jsonl"

# Write synthetic journal — all via node to avoid line-ending and path issues
node - "$JOURNAL" <<'NODE'
"use strict";
const fs = require("fs");
const journal = process.argv[2];
const entries = [
  // Entry 1: F24 block (file-write, non-Bash toolKind)
  {"kind":"runtime-decision","ts":"2026-05-28T00:00:01.000Z","action":"block","riskLevel":"critical","decisionSource":"credential-persistence-write-denied","floorFired":"credential-persistence-write","rung":17.625,"toolKind":"file-write","tool":"Write","targetPath":"/proj/.git/hooks/pre-commit","sessionId":"test-dash-001","reasonCodes":["credential-persistence-write-denied"],"latticeVersion":"1"},
  // Entry 2: kill-chain (observe)
  {"kind":"runtime-decision","ts":"2026-05-28T00:00:02.000Z","action":"observe","riskLevel":"critical","decisionSource":"kill-chain-detected","toolKind":"bash","tool":"Bash","sessionId":"test-dash-001","killChain":{"chainType":"injection-to-exec","severity":"critical","detected":true,"enforced":false,"wouldAction":"escalate","steps":[{"tool":"WebFetch","role":"source","ts":"2026-05-28T00:00:00.000Z"},{"tool":"Write","role":"intermediate","ts":"2026-05-28T00:00:01.500Z"},{"tool":"Bash","role":"exec","ts":"2026-05-28T00:00:02.000Z"}]}},
  // Entry 3: entry with a raw GitHub PAT — must be REDACTED in /api/decisions
  {"kind":"runtime-decision","ts":"2026-05-28T00:00:03.000Z","action":"allow","riskLevel":"low","toolKind":"bash","tool":"Bash","command":"echo hello","notes":"token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA end","sessionId":"test-dash-001"},
];
fs.writeFileSync(journal, entries.map(e => JSON.stringify(e)).join("\n") + "\n", "utf8");
NODE

# ── Allocate an ephemeral port ────────────────────────────────────────────────

PORT="$(node -e "
const net = require('net');
const s = net.createServer();
s.listen(0, '127.0.0.1', () => { process.stdout.write(String(s.address().port)); s.close(); });
")"

if [ -z "$PORT" ]; then
  printf '  FAIL    could not allocate ephemeral port\n' >&2
  exit 1
fi

# ── Start server ──────────────────────────────────────────────────────────────

LILARA_STATE_DIR="$TMP_STATE" LILARA_DASHBOARD_PORT="$PORT" \
  node "${root}/scripts/dashboard-server.js" </dev/null &
SERVER_PID="$!"

# ── All assertions run inside a single Node.js process ───────────────────────
# This avoids mktemp/shell path issues on Windows — Node handles all HTTP
# fetching and file I/O with native Windows paths.
#
# MINGW64 hang fix (2026-06): the two lines that previously appeared here
#   result="$(node - "$PORT" 2>&1)"   # node reads program from STDIN — NO heredoc
#   EXIT_CODE=$?                       # immediately overwritten at end of file
# caused 'node -' to block reading stdin until EOF. Under the lilara-cli.sh
# umbrella, stdin is the inherited console/pipe that never sends EOF, so the
# Dashboard gate hung forever. Both lines were dead (result unused, EXIT_CODE
# overwritten). They have been removed. See references/lilara-contract.md §Env.

node - "$PORT" <<NODE
"use strict";
const http = require("http");

let passed = 0;
let failed = 0;
const results = [];

function ok(label)   { results.push({ ok: true,  label }); }
function fail(label) { results.push({ ok: false, label }); }

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: Number(process.argv[2]), path }, (res) => {
      let body = "";
      res.on("data", (d) => body += d);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(4000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function poll() {
  for (let i = 0; i < 20; i++) {
    try {
      const { status } = await get("/healthz");
      if (status === 200) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  if (!await poll()) {
    fail("/healthz did not return 200 within 10 s (server may have crashed)");
    print();
    process.exit(1);
  }
  ok("/healthz returned 200");

  // GET /
  {
    const { status, body } = await get("/");
    status === 200 ? ok("GET / returned 200") : fail("GET / returned " + status + " (expected 200)");
    body.includes("<title>Lilara Dashboard") ? ok("GET / contains <title>Lilara Dashboard") : fail("GET / body missing '<title>Lilara Dashboard'");
  }

  // /api/summary
  {
    const { status, body } = await get("/api/summary");
    status === 200 ? ok("/api/summary returned 200") : fail("/api/summary returned " + status + " (expected 200)");
    try {
      const d = JSON.parse(body);
      (d.byAction && d.byLevel && typeof d.total === "number")
        ? ok("/api/summary is valid JSON with expected keys")
        : fail("/api/summary JSON missing byAction/byLevel/total");
    } catch { fail("/api/summary response is not valid JSON"); }
  }

  // /api/decisions — secret redaction
  {
    const { status, body } = await get("/api/decisions?limit=100");
    status === 200 ? ok("/api/decisions returned 200") : fail("/api/decisions returned " + status + " (expected 200)");
    const PAT_RAW = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    body.includes(PAT_RAW)
      ? fail("/api/decisions: raw GitHub PAT still present (redaction failed)")
      : ok("/api/decisions: raw GitHub PAT is absent (redacted)");
    body.includes("[REDACTED:github-pat:")
      ? ok("/api/decisions: REDACTED token found for github-pat")
      : fail("/api/decisions: no [REDACTED:github-pat:...] token found");
  }

  // /api/kill-chains
  {
    const { status, body } = await get("/api/kill-chains");
    status === 200 ? ok("/api/kill-chains returned 200") : fail("/api/kill-chains returned " + status + " (expected 200)");
    try {
      const d = JSON.parse(body);
      (Array.isArray(d) && d.length >= 1 && d[0].chainType)
        ? ok("/api/kill-chains contains at least one kill-chain entry")
        : fail("/api/kill-chains: no kill-chain entries found (expected 1)");
    } catch { fail("/api/kill-chains response is not valid JSON"); }
  }

  // /api/coverage — F24 hits + file-write toolKind
  {
    const { status, body } = await get("/api/coverage");
    status === 200 ? ok("/api/coverage returned 200") : fail("/api/coverage returned " + status + " (expected 200)");
    try {
      const d = JSON.parse(body);
      (d.byToolKind && typeof d.byToolKind["file-write"] === "number" && d.byToolKind["file-write"] >= 1
        && typeof d.f24Hits === "number" && d.f24Hits >= 1)
        ? ok("/api/coverage: file-write toolKind count ≥ 1 and f24Hits ≥ 1")
        : fail("/api/coverage: byToolKind[file-write] or f24Hits missing/zero");
    } catch { fail("/api/coverage response is not valid JSON"); }
  }

  print();
  process.exit(failed > 0 ? 1 : 0);
}

function print() {
  for (const r of results) {
    process.stdout.write(r.ok ? "  ok      " + r.label + "\n" : "  FAIL    " + r.label + "\n");
  }
  if (results.every((r) => r.ok)) {
    process.stdout.write("  All dashboard smoke tests passed.\n");
  } else {
    process.stderr.write("  One or more dashboard smoke tests failed.\n");
  }
}

main().catch((err) => {
  process.stderr.write("  FAIL    unexpected error: " + err.message + "\n");
  process.exit(1);
});
NODE

EXIT_CODE=$?
[ "$EXIT_CODE" -eq 0 ] && exit 0 || exit 1
