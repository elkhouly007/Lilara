# Skill: secrets-history-scan

---
name: secrets-history-scan
description: Scan the entire git history of a repository for leaked secrets using Lilara's existing secret-scan patterns. Deduplicates findings by (secretName + redactedSample) across commits. Outputs a Markdown or JSON report with first/last seen commit, author, file, and remediation guidance.
---

# Secrets History Scan

Full git-history secret scan using `git log --all -p --no-color` streamed line-by-line to avoid memory issues on large repos. Reuses Lilara's existing F4-class secret patterns. Identifies which commits introduced each unique secret and collapses repeated occurrences.

## When to Use

- Investigating a suspected historical credential leak
- Pre-release audit to verify no secrets were ever committed to the repo
- Onboarding a new repo: establish a clean-history baseline before adding Lilara
- Incident response: determine exposure window (first seen → last seen commit)

Do NOT use as a substitute for real-time secret scanning on commit hooks (use `secret-warning.js` for that). This scan covers history; the hook covers new commits.

## Process

1. **Run the scan** from the project root:

   ```bash
   bash scripts/lilara-cli.sh scan history [--since YYYY-MM-DD] [--format json|markdown]
   ```

   - `--since` (optional): limit scan to commits after this date (ISO format).
   - `--format` (optional): `markdown` (default, human-readable) or `json` (machine-readable).

2. **Review the output** — each unique finding shows:
   - Secret type (e.g. `AWS access key`, `OpenAI-style API key`)
   - First seen commit hash + date
   - Last seen commit hash
   - Author name
   - File path
   - Redacted line snippet (sensitive content replaced by `[REDACTED]`)
   - Occurrence count across all commits

3. **Remediate** — for each finding:
   - **Rotate immediately**: the leaked credential is compromised from `firstSeenCommit` onward.
   - **Rewrite history**: use `git filter-repo` or BFG Repo Cleaner to remove the secret from all commits. Force-push after rewriting.
   - **Audit access logs**: check provider logs for unauthorized use during the exposure window.

## Output Format

**Markdown** (default):

```
# Secrets in Git History

Found 2 unique secret(s).

## AWS access key
- First seen: `a1b2c3d4` (2025-03-14T10:22:00Z)
- Last seen:  `e5f6g7h8`
- Author: Alice Smith
- File: `config/deploy.env`
- Snippet (redacted): `AWS_ACCESS_KEY_ID=[REDACTED]`
- Occurrences: 3

## Remediation
Use `git filter-repo` or BFG Repo Cleaner to rewrite history...
```

**JSON** (`--format json`): array of `{ secretName, firstSeenCommit, lastSeenCommit, author, dateISO, file, lineSnippet, occurrences }`.

## Constraints

- Streams `git log` output line-by-line; does not buffer the full diff in memory (safe for large repos).
- Deduplication is by `(secretName + redactedSampleHash)` — two different secrets of the same type in different files produce two separate findings.
- Only scans added lines (`+` prefix in diffs). Deleted lines are not scanned.
- Accuracy depends on Lilara's pattern set (`claude/hooks/secret-patterns.json`). Pattern miss = missed secret. Verify patterns before using this for compliance evidence.
- Does not modify any files. Scan is read-only.
- F4 implication: any secret found is a class-C secret (F4_SECRET_CLASS_C) for floor purposes.
