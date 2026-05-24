# Skill: autonomous-improvement

---
name: autonomous-improvement
description: Run a self-improvement cycle on the ARG agent ecosystem — identify weak agents, measure output quality, and update rules or prompts to improve future performance
---

# Autonomous Improvement

A structured cycle for making the ARG agent ecosystem measurably better over time.

## When to Use


## Step 1: Identify Low-Performing Agents

Review recent agent outputs for patterns of:
- Generic advice not specific to the codebase
- Missed issues that were caught in manual review
- Repeated misunderstandings requiring multiple correction turns
- Outputs that were rejected or significantly edited

```bash
# Check agent invocation history if ARG journal is enabled
grep '"agent"' ~/.lilara/decision-journal.jsonl | \
  node -e "
    const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n');
    const agents = lines.map(l => { try { return JSON.parse(l).agent } catch(e){} }).filter(Boolean);
    const counts = agents.reduce((a, v) => ({...a, [v]: (a[v]||0)+1}), {});
    Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(v, k));
  "
```

## Step 2: Diagnose Root Cause

For each underperforming agent:

1. Read the agent definition: `cat agents/<agent-name>.md`
2. Is the Mission statement specific enough?
3. Is the Protocol sequential and deterministic?
4. Are the Amplification Techniques concrete or vague?
5. Does Done When have measurable criteria?

## Step 3: Targeted Update

- Mission too broad → narrow it to one specific amplification
- Protocol too vague → add explicit tool calls and output formats
- Missing context → add a "Context Required" section listing what to inject
- Done When unmeasurable → add specific file/output/count criteria

## Step 4: Test the Update

After editing an agent file:
1. Run it on a known problem where the old version underperformed
2. Compare output quality
3. Check if Done When criteria are now achievable

## Step 5: Update Rules if Needed

If an agent keeps encountering the same bad pattern, it indicates a missing rule:
- Add the pattern to the relevant `rules/<lang>/patterns.md`
- Add a security check to `rules/<lang>/security.md`
- The agent then cites the rule rather than inventing advice

## Improvement Log

Track improvements in `CHANGELOG.md` under `[Unreleased]`:
```markdown
### Improved
- `code-reviewer`: added explicit SQL injection pattern detection step
- `rules/typescript/security.md`: added prototype pollution rule
```
