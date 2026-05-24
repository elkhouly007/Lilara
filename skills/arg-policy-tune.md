# Skill: arg-policy-tune

---
name: arg-policy-tune
description: Add, remove, or adjust ARG policies to calibrate what actions the runtime permits, blocks, or escalates
---

# ARG Policy Tuning

Fine-tune the ARG policy store to match your project's risk tolerance and workflow.

## When to Use

Use when ARG is blocking commands that should be allowed for your project, when you want to add explicit blocks for dangerous operations, or when you want to review and clean up accumulated session policies.

## Policy Structure

Each policy record in the store:

```json
{
  "tool": "Bash",
  "pattern": "git push",
  "decision": "allow",
  "scope": "session | permanent",
  "createdAt": "2026-04-23T00:00:00Z",
  "createdBy": "user | agent",
  "note": "Routine push to feature branch"
}
```

## Adding a Permanent Allow

```bash
node -e "
  const {PolicyStore} = require('./runtime/policy-store');
  const ps = new PolicyStore();
  ps.addPolicy({
    tool: 'Bash',
    pattern: 'npm test',
    decision: 'allow',
    scope: 'permanent',
    note: 'Test suite is always safe to run'
  });
  console.log('Policy added');
"
```

## Adding a Block Rule

```bash
node -e "
  const {PolicyStore} = require('./runtime/policy-store');
  const ps = new PolicyStore();
  ps.addPolicy({
    tool: 'Bash',
    pattern: 'rm -rf',
    decision: 'block',
    scope: 'permanent',
    note: 'Never allow recursive deletion'
  });
"
```

## Removing a Policy

```bash
node -e "
  const {PolicyStore} = require('./runtime/policy-store');
  const ps = new PolicyStore();
  const all = ps.getAll();
  const idx = all.findIndex(p => p.pattern === 'npm test');
  if (idx >= 0) { ps.removeAt(idx); console.log('Removed'); }
  else console.log('Not found');
"
```

## Calibration Checklist

- [ ] Block patterns cover your project's destructive operations
- [ ] Permanent allows exist for safe repeated commands (test, lint, build)
- [ ] No overly broad wildcards that bypass sensitive-path detection
- [ ] Session-scoped policies expire — review if they were promoted to permanent
- [ ] `LILARA_ENFORCE=1` set in CI to make blocks terminal rather than advisory
