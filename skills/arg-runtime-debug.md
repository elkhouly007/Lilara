# Skill: arg-runtime-debug

---
name: arg-runtime-debug
description: Debug ARG runtime decisions, policy mismatches, and hook behavior using structured diagnostic steps
---

# ARG Runtime Debug

Diagnose why ARG approved, blocked, or escalated a specific command or action.

## When to Use

- A command was blocked unexpectedly
- A command was allowed when it should have been blocked
- The decision source (learned-allow, auto-allow-once, trajectory-nudge) is surprising
- Hook output or JSONL journal entries are malformed

## Steps

1. Check the decision journal:
   ```bash
   tail -50 ~/.lilara/decision-journal.jsonl | node -e "
     const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n');
     lines.forEach(l => { try { console.log(JSON.stringify(JSON.parse(l), null, 2)) } catch(e) {} });
   "
   ```

2. Inspect the policy store for the relevant tool/command:
   ```bash
   node -e "
     const {PolicyStore} = require('./runtime/policy-store');
     const ps = new PolicyStore();
     console.log(JSON.stringify(ps.getAll(), null, 2));
   "
   ```

3. Trace the decision path manually:
   ```bash
   LILARA_DEBUG=1 node -e "
     const {decide} = require('./runtime/decision-engine');
     decide({ tool: 'Bash', input: { command: 'YOUR_COMMAND' } }).then(r => console.log(r));
   "
   ```

4. Check session trajectory:
   ```bash
   node -e "
     const {SessionContext} = require('./runtime/session-context');
     const sc = new SessionContext();
     console.log(sc.getSessionTrajectory());
   "
   ```

5. Verify kill switches are not engaged:
   ```bash
   echo "LILARA_KILL_SWITCH: ${LILARA_KILL_SWITCH:-unset}"
   echo "ARG_DECISION_JOURNAL: ${ARG_DECISION_JOURNAL:-unset}"
   ```

## Interpreting Results

- `decisionSource: 'kill-switch'`: kill switch env var is set — all actions blocked
- `decisionSource: 'learned-allow'`: previous manual allow created a policy
- `decisionSource: 'auto-allow-once'`: short-term grant was active (check if consumed)
- `decisionSource: 'trajectory-nudge'`: session escalation count triggered review mode
- `decisionSource: 'default-allow'`: no policy matched, default permit applied
