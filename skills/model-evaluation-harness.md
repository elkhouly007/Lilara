# Skill: model-evaluation-harness

---
name: model-evaluation-harness
description: Generates a complete evaluation harness for an LLM feature from a requirements document: produces a JSONL eval dataset skeleton with input/expected_output/tags fields, a per-requirement scoring rubric with pass/fail criteria, and a zero-dependency Node.js runner script that emits per-case results plus aggregate score. Designed for teams that need structured, repeatable evals before promoting a prompt or model configuration to production.
---

# Model Evaluation Harness

Turn a requirements document into a complete, runnable evaluation suite — dataset skeleton, scoring rubric, and runner script — without introducing any runtime dependencies.

## When to Use

- Before promoting a prompt or model configuration from development to production
- When a product team needs evidence that an LLM feature meets stated requirements
- After a model upgrade to verify behavioral parity with the previous configuration
- When building a CI-integrated regression gate for LLM outputs

## Process

1. **Parse requirements** — read the source requirements document and extract every verifiable behavioral claim. Each claim becomes one eval dimension. Group claims into functional areas (e.g., accuracy, format, refusal behavior, latency proxy via output length).

2. **Generate the eval dataset skeleton** — write a JSONL file (`eval/dataset.jsonl`) where each line is one test case:

   ```jsonl
   {"id": "TC-001", "input": "<prompt or user message>", "expected_output": "<expected or pattern>", "tags": ["accuracy", "happy-path"], "rubric_ref": "R-01"}
   {"id": "TC-002", "input": "<edge case input>", "expected_output": null, "tags": ["refusal", "boundary"], "rubric_ref": "R-03"}
   ```

   Coverage targets: at minimum one happy-path case per requirement, one boundary case per refusal/rejection requirement, one adversarial case for any security-sensitive requirement.

3. **Write the scoring rubric** — produce `eval/rubric.json` with one entry per requirement:

   ```json
   [
     {
       "id": "R-01",
       "requirement": "The model returns a JSON object with keys `action` and `confidence`.",
       "scorer": "schema_match",
       "pass_criteria": "Output parses as JSON and contains both required keys.",
       "fail_criteria": "Output is prose, missing keys, or invalid JSON.",
       "weight": 2
     }
   ]
   ```

   Supported scorer types: `schema_match` (JSON structure), `substring_match` (required phrases), `regex_match` (format patterns), `semantic_similarity` (cosine ≥ threshold — note: requires embedding call, flag as optional), `manual` (human review required).

4. **Generate the runner script** — write `eval/run-eval.js` as a zero-dependency Node.js script. The script reads `dataset.jsonl` and `rubric.json`, calls the target API (configurable via `EVAL_API_URL` and `EVAL_API_KEY` env vars), scores each case against its rubric entry, and writes `eval/results.jsonl` plus a summary to stdout:

   ```javascript
   #!/usr/bin/env node
   // eval/run-eval.js  —  zero dependencies, Node 18+
   const fs = require('fs');
   const https = require('https');

   const dataset = fs.readFileSync('eval/dataset.jsonl', 'utf8')
     .split('\n').filter(Boolean).map(JSON.parse);
   const rubric = JSON.parse(fs.readFileSync('eval/rubric.json', 'utf8'));
   const rubricMap = Object.fromEntries(rubric.map(r => [r.id, r]));

   // ... callApi, scoreCase, main functions omitted for brevity
   ```

   The runner emits per-case `{ id, pass, score, actual, expected, rubric_id }` to `results.jsonl`, then prints:

   ```
   Eval complete: 18/20 passed (90.0%)  weighted: 87.5%
   FAILED: TC-007 [R-03] regex_match — output did not match /^\d{4}-\d{2}-\d{2}$/
   FAILED: TC-014 [R-07] schema_match — missing key "confidence"
   ```

5. **Write the CI integration snippet** — append to output a GitHub Actions step that runs the harness and fails the build if weighted pass rate drops below the configured threshold:

   ```yaml
   - name: Run LLM eval
     env:
       EVAL_API_URL: ${{ secrets.EVAL_API_URL }}
       EVAL_API_KEY: ${{ secrets.EVAL_API_KEY }}
       EVAL_PASS_THRESHOLD: "0.85"
     run: node eval/run-eval.js
   ```

6. **Produce the eval summary report** — write a markdown report `eval/EVAL-REPORT.md` listing: requirements covered, gap requirements (no test cases), scorer type distribution, and recommended manual-review cases.

## Output Format

```
## Model Evaluation Harness — Output

Generated: eval/dataset.jsonl     (22 test cases)
Generated: eval/rubric.json       (8 requirements)
Generated: eval/run-eval.js       (zero-dependency runner, Node 18+)
Generated: eval/EVAL-REPORT.md

### Coverage Summary

| Requirement | Cases | Scorer | Gap? |
|-------------|-------|--------|------|
| R-01: JSON schema output | 3 | schema_match | — |
| R-02: Refusal for off-topic | 2 | substring_match | — |
| R-03: Date format YYYY-MM-DD | 2 | regex_match | — |
| R-04: Confidence 0–1 range | 2 | regex_match | — |
| R-05: No PII in output | 2 | regex_match + manual | ⚠ manual review |
| R-06: Response ≤ 150 tokens | 2 | regex_match (proxy) | — |
| R-07: Language matching input | 2 | substring_match | — |
| R-08: Source citation present | 2 | substring_match | — |

### Adversarial Coverage

- Prompt injection attempt: 2 cases (tags: ["injection"])
- Jailbreak pattern: 1 case (tags: ["adversarial"])
- Malformed input: 2 cases (tags: ["boundary"])

### Run Eval

  node eval/run-eval.js

Expected output: pass rate and per-case failures printed to stdout.
results.jsonl written for downstream tooling.
```

## Constraints

- The runner script uses only Node.js built-ins (`fs`, `https`, `readline`) — no npm install required.
- `semantic_similarity` scorer is flagged as optional in the rubric; the runner skips it and marks those cases `manual` unless an embedding endpoint is configured via `EVAL_EMBED_URL`.
- Dataset cases are skeletons — the `input` and `expected_output` fields must be filled in by the engineer with real test values before the harness is useful; the skill generates structure and coverage targets, not fabricated test data.
- The skill generates the evaluation infrastructure only — it does not call any LLM or execute the runner itself.
- For prompts with non-deterministic outputs, `regex_match` and `schema_match` scorers are preferred over exact `substring_match` to reduce flakiness.
