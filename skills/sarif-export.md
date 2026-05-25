# Skill: sarif-export

---
name: sarif-export
description: Export Lilara decision-journal entries with floorFired into a SARIF 2.1.0 JSON document for import into GitHub code scanning, VulnHawk, or any SARIF-aware security tooling. One command generates a complete structured finding list from the runtime audit trail.
---

# SARIF Export

Convert Lilara's runtime decision journal into a SARIF 2.1.0 document. Entries with a truthy `floorFired` field become findings; all other entries are filtered out. The output is suitable for GitHub Advanced Security, VulnHawk, Semgrep, and any tool that accepts SARIF 2.1.0.

## When to Use

- Generating a compliance or audit report from Lilara's runtime decisions
- Feeding floor-fired findings into GitHub code scanning (`upload-sarif` action)
- Sending Lilara findings to a SARIF-aware dashboard or SIEM
- Exporting a window of decisions from a specific date range

## Process

1. **Run the export command** — from the project root:

   ```bash
   bash scripts/lilara-cli.sh export sarif [--since 2026-01-01] [--output path/to/findings.sarif.json]
   ```

   - `--since` (optional): ISO 8601 date/time — only entries at or after this timestamp are included.
   - `--output` (optional): file path for the SARIF JSON. Default: `./lilara-decisions.sarif.json`.

2. **Inspect the output** — verify the driver name and result count:

   ```bash
   node -e "const s=require('./lilara-decisions.sarif.json'); console.log(s.runs[0].tool.driver.name, s.runs[0].results.length, 'results')"
   ```

3. **Upload to GitHub code scanning** (if using GitHub Actions):

   ```yaml
   - uses: github/codeql-action/upload-sarif@v3
     with:
       sarif_file: lilara-decisions.sarif.json
   ```

4. **Interpret findings** — each result maps:
   - `ruleId` ← the `floorFired` code (e.g. `F8_PROTECTED_BRANCH`)
   - `level` ← `error` for CRITICAL/HIGH, `warning` for MEDIUM, `note` for LOW
   - `message.text` ← the `notes` field from the journal entry
   - `locations[].physicalLocation.artifactLocation.uri` ← the `targetPath` from the entry
   - `partialFingerprints.irHash` ← content hash of the input record (when present)
   - `properties` ← `{ reasonCodes, riskScore, tool, branch, intent, contractId, timestamp }`

## Output Format

SARIF 2.1.0 JSON:

```json
{
  "version": "2.1.0",
  "$schema": "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0.json",
  "runs": [{
    "tool": {
      "driver": {
        "name": "Lilara",
        "version": "0.2.0",
        "rules": [{ "id": "F8_PROTECTED_BRANCH", ... }]
      }
    },
    "results": [{
      "ruleId": "F8_PROTECTED_BRANCH",
      "level": "error",
      "message": { "text": "..." },
      "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "src/auth.ts" } } }]
    }]
  }]
}
```

## Constraints

- Only entries with a truthy `floorFired` field are exported; `allow` and `require-review` decisions without a floor are excluded.
- Reads rotated journal files (`.1.jsonl`, `.2.jsonl.gz`, `.3.jsonl.gz`) in addition to the primary journal.
- No network calls — output is generated entirely from local state files.
- The SARIF `version` field is always `"2.1.0"` regardless of Lilara runtime version.
- `--since` filtering is by entry `timestamp` field; entries without a timestamp are included when `--since` is set.
