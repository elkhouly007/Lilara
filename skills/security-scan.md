# Skill: security-scan

---
name: security-scan
description: Full SAST sweep of a codebase using the 34-class vulnerability taxonomy from rules/common/vulnerability-classes.md. Two-pass pattern: enumerate potential hits, then judge-verify each hit to reduce false positives. Outputs a structured report with severity ratings and a SARIF-compatible finding list.
---

# Security Scan

Whole-codebase SAST sweep covering 34 vulnerability classes. Two passes: scan-to-enumerate potential hits, then verify each hit in context to filter false positives. Generates a structured report with CRITICAL/HIGH/MEDIUM/LOW findings and an optional SARIF-formatted output.

## When to Use

- Full security audit of a codebase before a release
- Assessing a new codebase for security posture
- Generating a SAST report for compliance or audit purposes
- Deep security sweep where `security-reviewer` (diff-oriented) is too narrow

## Process

1. **Build a file map** — `find . -type f \( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" \) | grep -v node_modules`. Exclude generated, vendored, and minified files.

2. **Pass 1 — Enumerate** — For each vulnerability class in `rules/common/vulnerability-classes.md`, apply the "Look for:" pattern hints:
   - Run targeted `grep` patterns per class (e.g., SQL injection: look for string concatenation near SQL keywords; SSRF: unvalidated URLs passed to HTTP clients)
   - Record: file, line number, matched text, class name
   - Do NOT filter in this pass — collect everything suspicious

3. **Pass 2 — Judge-verify** — For each hit from Pass 1:
   - Read the full function context (±30 lines)
   - Determine: Is the hit a real vulnerability, a false positive, or uncertain?
   - Apply the "Look for" heuristics more carefully: is input user-controlled? Is the dangerous function reachable from untrusted input? Is there any validation/escaping?
   - Label each: CONFIRMED / FALSE_POSITIVE / NEEDS_REVIEW
   - Discard FALSE_POSITIVEs from the final report

4. **Rate severity** — For CONFIRMED and NEEDS_REVIEW findings:
   - CRITICAL: exploit likely, no auth required, data loss or RCE possible
   - HIGH: exploit plausible, auth bypass or significant data exposure
   - MEDIUM: requires specific conditions or partial mitigations in place
   - LOW: defense-in-depth issue, no direct exploitability

5. **Generate report** — See Output Format below. Optionally write SARIF JSON if operator requests.

6. **Delegate to agents** — For CRITICAL findings: note "Invoke `security-scanner` for remediation detail on file X."

## Output Format

```
## Security Scan — <project-root>
Scanned: N files  |  Hits (pass 1): N  |  Confirmed: N  |  FP filtered: N

### Findings

#### [CRITICAL] <class> — <file>:<line>
Issue: <description>
Evidence: <code snippet>
Recommendation: <fix approach>

#### [HIGH] …
#### [MEDIUM] …
#### [LOW] …

### SARIF (optional)
{"version":"2.1.0","runs":[{"results":[…]}]}
```

## Constraints

- Does not modify source files. Reports only.
- Pass 2 judgment is heuristic — NEEDS_REVIEW findings require human confirmation before treating as confirmed vulnerabilities.
- Skips generated code, minified files, vendored packages, and test fixtures.
- Regex patterns are approximations — purpose is to surface likely vulnerabilities, not to guarantee exhaustive coverage.
