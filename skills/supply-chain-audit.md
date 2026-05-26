# Skill: supply-chain-audit

---
name: supply-chain-audit
description: Audit npm, pip, and Cargo dependencies against the OSV vulnerability database (api.osv.dev) by reading lockfiles directly and querying OSV one package at a time via curl. Produces a SARIF-compatible finding list (compatible with skills/sarif-export.md) with severity, advisory ID, affected version range, and a fix version per vulnerable package. Zero runtime dependencies — uses curl and node for JSON parsing.
---

# Supply Chain Audit

Check every first-party dependency against the OSV database before shipping — without pulling in a separate vulnerability scanning tool or requiring internet access to npm audit servers.

## When to Use

- Before a production release to confirm no known CVEs are in the dependency tree
- After adding or upgrading a dependency to spot newly-introduced vulnerabilities
- As part of a security audit where `npm audit` is unavailable or its output format is insufficient
- When generating a SARIF report for GitHub code scanning from dependency findings

## Process

1. **Detect the package manager** — find the lockfile:

   ```bash
   ls package-lock.json yarn.lock pnpm-lock.yaml \
      requirements.txt Pipfile.lock \
      Cargo.lock 2>/dev/null | head -5
   ```

2. **Extract the dependency list** — parse the lockfile for all resolved packages with their versions:

   ```bash
   # npm — package-lock.json (v2/v3 format)
   node -e "
     const lock = require('./package-lock.json');
     const pkgs = Object.entries(lock.packages || {})
       .filter(([k]) => k.startsWith('node_modules/') && !k.includes('node_modules/', 13))
       .map(([k, v]) => ({ name: k.replace('node_modules/', ''), version: v.version }));
     console.log(JSON.stringify(pkgs));
   " 2>/dev/null

   # pip — requirements.txt (pinned)
   grep -E '^[A-Za-z]' requirements.txt | grep '==' | \
     awk -F'==' '{print "{\"name\":\"" $1 "\",\"version\":\"" $2 "\"}"}'

   # Cargo — Cargo.lock
   awk '/^\[\[package\]\]/{name=""; version=""} /^name =/{name=$3} /^version =/{version=$3}
        name && version{print "{\"name\":" name ",\"version\":" version "}"; name=""; version=""}' \
     Cargo.lock
   ```

3. **Query the OSV API per package** — for each package, POST to the OSV batch query endpoint:

   ```bash
   # OSV v1 query — one package at a time
   curl -s -X POST https://api.osv.dev/v1/query \
     -H "Content-Type: application/json" \
     -d '{"version":"1.2.3","package":{"name":"lodash","ecosystem":"npm"}}' | \
     node -e "
       const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
       if (r.vulns && r.vulns.length) {
         r.vulns.forEach(v => console.log(JSON.stringify({
           id: v.id, summary: v.summary,
           severity: v.database_specific?.severity || 'UNKNOWN',
           fixed: v.affected?.[0]?.ranges?.[0]?.events?.find(e=>e.fixed)?.fixed || 'no fix'
         })));
       }
     " 2>/dev/null
   ```

   Ecosystem values: `npm` for Node.js, `PyPI` for Python, `crates.io` for Rust.

4. **Rate-limit the requests** — OSV allows up to 100 req/s; add a short sleep between batches to avoid throttling:

   ```bash
   # Between every 50 packages, pause 1 s
   if [ $((i % 50)) -eq 0 ]; then sleep 1; fi
   ```

5. **Aggregate findings** — collect all vulnerability responses into a structured list. For each vulnerable package, record:
   - Package name + installed version
   - OSV ID (e.g. `GHSA-xxxx`, `CVE-xxxx-xxxx`)
   - Severity (CRITICAL / HIGH / MEDIUM / LOW)
   - Summary (one line)
   - Fixed version (or "no fix available")

6. **Classify by severity and write the report** — group findings by severity bucket and emit a SARIF-compatible structure (compatible with `skills/sarif-export.md` for upload to GitHub code scanning).

## Output Format

```
## Supply Chain Audit Report

Package manager: npm
Packages scanned: 247
Vulnerable packages: 4 (1 CRITICAL, 2 HIGH, 1 MEDIUM)

### CRITICAL
  lodash@4.17.20
    OSV: GHSA-35jh-r3h4-6jhm (Prototype Pollution via zipObjectDeep)
    Fix: upgrade to >=4.17.21

### HIGH
  minimist@1.2.5
    OSV: GHSA-xvch-5gv4-984h (Prototype Pollution)
    Fix: upgrade to >=1.2.6

  follow-redirects@1.14.8
    OSV: GHSA-74fj-2j2h-c42q (Exposure of Sensitive Information via Redirect)
    Fix: upgrade to >=1.14.9

### MEDIUM
  ajv@6.12.6
    OSV: GHSA-c2qf-rxjj-qqgw (Inefficient Regular Expression Complexity)
    Fix: upgrade to >=8.0.0 (breaking change — see MIGRATION.md)

SARIF output: dependency-vulns.sarif.json (ready for github/codeql-action/upload-sarif)
```

## Constraints

- Requires network access to `api.osv.dev`; offline environments must pre-download OSV vulnerability feeds (`https://osv-vulnerabilities.storage.googleapis.com/<ecosystem>/all.zip`).
- Scans direct and transitive dependencies from the lockfile — not the live installed tree; if lockfile is out of sync with `node_modules`, results may be inaccurate.
- OSV data completeness varies by ecosystem: npm and PyPI coverage is comprehensive; crates.io is comprehensive; other ecosystems may have gaps.
- This skill does not resolve transitive dependency graphs for Python `requirements.txt` without a pinned lockfile (`pip freeze > requirements.txt` first).
- Rate-limiting: burst > 100 req/s may result in 429 from the OSV API; the skill adds inter-batch sleep to stay within limits.
- Does not auto-upgrade packages — generates the finding list only; apply fixes manually and re-scan to confirm.
