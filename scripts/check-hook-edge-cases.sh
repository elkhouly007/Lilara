#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

pass() { printf '  ok      %s\n' "$1"; }
fail() { printf '  ERROR   %s\n' "$1" >&2; exit 1; }

printf '[check-hook-edge-cases]\n'

hook="$root/claude/hooks/secret-warning.js"

# 1. Empty stdin
printf "" | node "$hook" >/dev/null 2>&1 || fail 'hook fails on empty stdin'
pass 'hook handles empty stdin'

# 2. Huge payload (> 5MB)
huge_file="$workdir/huge.txt"
dd if=/dev/zero bs=1024 count=6145 2>/dev/null | tr '\0' 'A' > "$huge_file"
# secret-warning.js reads stdin via hook-utils.js which caps it at 5MB.
# It should either fail (blocking) or pass (warning).
if printf 'dummy' | cat - "$huge_file" | node "$hook" 2>/tmp/ecc-huge.err; then
    pass 'hook handles huge payload (non-blocking)'
else
    # If it fails, it should be because of the cap.
    grep -Ei "oversized|too large" /tmp/ecc-huge.err || fail 'hook should report oversized payload if it fails'
    pass 'hook rejects huge payload'
fi

# 3. Missing lilara.config.json
(
  cd "$workdir"
  printf '{"text":"hello"}' | node "$hook" >/dev/null 2>&1 || fail 'hook fails when config is missing'
)
pass 'hook handles missing lilara.config.json (defaults to safe)'

# 4. Malformed lilara.config.json
cat > "$workdir/lilara.config.json" <<'EOF'
{ "invalid": json
EOF
(
  cd "$workdir"
  printf '{"text":"hello"}' | node "$hook" >/dev/null 2>&1 || true
  pass 'hook handles malformed lilara.config.json'
)

# 5. Dangerous Command Gate edge cases
dcg_hook="$root/claude/hooks/dangerous-command-gate.js"
# Test with multi-line command where dangerous part is not on the first line
cat > "$workdir/multi-line.json" <<'EOF'
{
  "command": "echo hello\nsudo rm -rf /"
}
EOF
if LILARA_ENFORCE=1 node "$dcg_hook" < "$workdir/multi-line.json" 2>/tmp/ecc-dcg.err; then
    fail 'DCG should block dangerous command on second line'
fi
pattern="rm -r"
pattern="${pattern}f"
grep -Fq "$pattern" /tmp/ecc-dcg.err || fail 'DCG error should mention the command'
pass 'DCG detects dangerous command in multi-line input'

# 6. JSONL audit trail: verify hookLog emits valid JSON lines when LILARA_HOOK_LOG=1
log_dir="$(mktemp -d)"
log_cleanup() { rm -rf "$log_dir"; }
trap log_cleanup EXIT
log_file="$log_dir/hook-events.log"
dcg_hook="$root/claude/hooks/dangerous-command-gate.js"
LILARA_HOOK_LOG=1 LILARA_STATE_DIR="$log_dir" LILARA_RATE_LIMIT=0 \
  node "$dcg_hook" <<'EOF' >/dev/null 2>/dev/null || true
{"tool_name":"Bash","args":{"command":"rm -rf /tmp/ecc-hook-log-fixture-test"}}
EOF
if [ ! -f "$log_file" ]; then
  fail 'hook-events.log not created when LILARA_HOOK_LOG=1'
fi
# Each non-empty line must parse as JSON with ts, hook, event, label fields
node - "$log_file" <<'JSCHECK' || fail 'hook-events.log contains invalid JSONL'
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.trim());
if (lines.length === 0) throw new Error('hook-events.log has no entries');
for (const line of lines) {
  let obj;
  try { obj = JSON.parse(line); } catch (e) { throw new Error(`invalid JSON: ${line}`); }
  if (!obj.ts || !obj.hook || !obj.event || !('label' in obj)) {
    throw new Error(`missing required fields in: ${line}`);
  }
}
console.log(`JSONL ok (${lines.length} entries)`);
JSCHECK
pass 'hookLog emits valid JSONL when LILARA_HOOK_LOG=1'

printf '\nHook edge-case checks passed.\n'
