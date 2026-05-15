#!/usr/bin/env bash
# adversarial-weekly-summary.sh — locked scope §5.1 adversarial track.
# Reads last 7d of artifacts/adversarial/run-*.json and writes a
# weekly-<ISO-week>.md rollup. Pure bash + inline node — no jq.
# Usage: bash scripts/adversarial-weekly-summary.sh [--dir <dir>] [--dry-run]
set -eu
dir=""; dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)     dir="$2"; shift 2;;
    --dir=*)   dir="${1#--dir=}"; shift;;
    --dry-run) dry_run=1; shift;;
    -h|--help) printf 'Usage: %s [--dir <dir>] [--dry-run]\n' "$0"; exit 0;;
    *) printf 'unknown flag: %s\n' "$1" >&2; exit 2;;
  esac
done
root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
[ -n "$dir" ] || dir="$root/artifacts/adversarial"

node - "$dir" "$dry_run" <<'NODEJS'
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const [, , dir, dryRunArg] = process.argv;
const dryRun = dryRunArg === "1";
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const fT = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((t - fT) / 86400000 - 3 + (fT.getUTCDay() + 6) % 7) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}
const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
let files = [];
try { files = fs.readdirSync(dir).filter((f) => /^run-.*\.json$/.test(f)).map((f) => path.join(dir, f)); }
catch { /* dir absent → empty week */ }
const runs = [];
for (const f of files) {
  try {
    if (fs.statSync(f).mtimeMs < cutoff) continue;
    runs.push({ file: path.basename(f), data: JSON.parse(fs.readFileSync(f, "utf8")) });
  } catch (err) { process.stderr.write(`  WARN  ${f}: ${err.message}\n`); }
}
let totalPatterns = 0, totalBypasses = 0, totalDegraded = 0;
const perPattern = new Map();
for (const { data } of runs) {
  totalPatterns += Number(data.totalPatterns || 0);
  for (const b of (data.bypasses || [])) {
    totalBypasses += 1;
    const id = b.patternId || "(unknown)";
    perPattern.set(id, (perPattern.get(id) || 0) + 1);
  }
  totalDegraded += (data.degraded || []).length;
}
const weekId  = isoWeek(new Date());
const outDir  = dryRun ? path.join(os.tmpdir(), "arg-adversarial-weekly-dryrun") : dir;
const outName = `weekly-${weekId}.md`;
const outPath = path.join(outDir, outName);
let prior = null;
try {
  const cands = fs.readdirSync(dir).filter((f) => /^weekly-\d{4}-W\d{2}\.md$/.test(f) && f !== outName).sort();
  if (cands.length > 0) {
    const txt = fs.readFileSync(path.join(dir, cands[cands.length - 1]), "utf8");
    const m = txt.match(/^total_bypasses:\s*(\d+)/m);
    if (m) prior = { file: cands[cands.length - 1], totalBypasses: Number(m[1]) };
  }
} catch { /* no priors */ }
const delta = prior ? totalBypasses - prior.totalBypasses : null;
const sign = delta !== null && delta >= 0 ? "+" : "";
const ls = [
  "---",
  `week: ${weekId}`,
  `runs_evaluated: ${runs.length}`,
  `total_patterns: ${totalPatterns}`,
  `total_bypasses: ${totalBypasses}`,
  `total_degraded: ${totalDegraded}`,
  `prior_week_file: ${prior ? prior.file : "(none)"}`,
  `delta_bypasses: ${delta === null ? "n/a" : String(delta)}`,
  `dry_run: ${dryRun}`,
  `generated_at: ${new Date().toISOString()}`,
  "---",
  "",
  `# Adversarial weekly summary — ${weekId}`,
  "",
  `- Runs evaluated (last 7 days): **${runs.length}**`,
  `- Total patterns exercised:    **${totalPatterns}**`,
  `- Total bypasses:              **${totalBypasses}**`,
  `- Total degraded:              **${totalDegraded}**`,
  prior
    ? `- Prior week (${prior.file}): ${prior.totalBypasses} bypasses — delta this week: **${sign}${delta}**`
    : "- Prior week: none on file",
  "",
  "## Per-pattern bypass hits",
  "",
];
if (perPattern.size === 0) ls.push("_No bypasses in the last 7 days._");
else for (const [id, c] of [...perPattern.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
  ls.push(`- \`${id}\`: ${c}`);
ls.push("", "Source: locked scope §5.1 adversarial track — driver `tests/adversarial/run-adversarial.js`.", "");
try { fs.mkdirSync(outDir, { recursive: true }); } catch { /* exists */ }
fs.writeFileSync(outPath, ls.join("\n"));
const tag = dryRun ? "DRY-RUN" : "OK";
process.stdout.write(`adversarial-weekly-summary[${tag}]: ${runs.length} runs, ${totalBypasses} bypasses, ${totalDegraded} degraded → ${outPath}\n`);
NODEJS
