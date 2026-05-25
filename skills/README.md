# Skills

High-level workflow definitions that orchestrate agents, rules, and tools for common development tasks. **32 skills** are available across ARG runtime management, code analysis, testing, security, deployment, and intelligence amplification.

## Core Skills

| Skill | Use When |
|---|---|
| `configure-lilara` | Setting up or reconfiguring ARG components for a new project |
| `arg-runtime-debug` | A command was blocked or allowed unexpectedly by ARG |
| `arg-policy-tune` | Adjusting what ARG permits or blocks |
| `arg-learning-review` | Auditing accumulated ARG policies before a release |
| `deep-code-analysis` | Getting comprehensive architectural and risk analysis of a codebase |
| `intelligence-amplification` | Getting 10x more value from agent interactions |
| `semantic-refactor` | Safe, test-protected code restructuring |
| `test-intelligence` | Finding blind spots and highest-value tests to add |
| `deployment-safety` | Pre-deployment safety checklist |
| `orchestration-design` | Planning a multi-agent workflow |

## Category Overview

This table is a set of selected examples, not an exhaustive index of all 22 skills.

| Category | Skills |
|---|---|
| **ARG runtime** | arg-runtime-debug, arg-policy-tune, arg-learning-review, capability-audit |
| **Code analysis** | deep-code-analysis, pattern-extraction, semantic-refactor |
| **Testing** | test-intelligence |
| **Intelligence** | intelligence-amplification, context-maximizer, autonomous-improvement |
| **Multi-agent** | multi-agent-debug, orchestration-design, multi-agent-orchestration |
| **Deployment** | deployment-safety, workflow-acceleration |
| **Setup / meta** | configure-lilara, git-worktree-patterns, pm2-patterns |
| **Content** | investor-outreach, content-engine |

## How to Use

Skills are entry points. They select the right agents and rules for the task, then orchestrate the workflow.

Run a skill by typing its name (e.g. `/security-review`) or referencing it in an agent prompt.

## Adding Skills

New skills should:
- Have a clear trigger (when to use it).
- Define the process (which agents/rules to apply).
- Define the expected output.
- State the safe behavior (what the skill does and does not do automatically).

See `check-skills.sh` to validate a new skill's structure.
