# Skill: project-setup

---
name: project-setup
description: Bootstrap a new project with a Lilara configuration using one of the four built-in blueprints (nextjs, fastapi, rust-cli, node-library). One command generates a ready-to-customize lilara.config.json matched to the project's tech stack.
---

# Project Setup

Bootstrap a new project's Lilara configuration from a battle-tested blueprint. Four project types are supported out of the box. Each blueprint pre-selects the right language domains, specialist agents, workflow gates, trust posture, and sensitive path patterns.

## When to Use

- Starting a new project that doesn't have a `lilara.config.json` yet
- Onboarding an existing project to Lilara for the first time
- Resetting a misconfigured `lilara.config.json` to a known-good baseline
- When you want a starting point that matches a specific tech stack

## Process

1. **Choose a blueprint** — select the one closest to your project type:

   | Blueprint | Best for |
   |---|---|
   | `nextjs` | Next.js, React, full-stack TypeScript |
   | `fastapi` | FastAPI, Flask, Django, Python APIs |
   | `rust-cli` | Rust binaries, CLI tools, systems code |
   | `node-library` | Node.js or TypeScript npm packages |

2. **Run the init command** from your project root:

   ```bash
   bash scripts/lilara-cli.sh init <blueprint>
   ```

   To overwrite an existing config:
   ```bash
   bash scripts/lilara-cli.sh init <blueprint> --force
   ```

3. **Customize** the generated `lilara.config.json`:
   - `languages` — add language domains relevant to your project
   - `agents` — add specialist agents for your specific stack (e.g., `database-reviewer` for SQL-heavy projects)
   - `runtime.protected_branches` — add your production and staging branches
   - `workflow.required_steps` — align with your existing CI pipeline gates
   - `runtime.sensitive_path_patterns` — add any project-specific sensitive paths

4. **Install** the configuration:

   ```bash
   bash scripts/install-local.sh
   ```

5. **Verify** the install:

   ```bash
   bash scripts/lilara-cli.sh check-installation
   ```

## Output Format

Running `lilara init <blueprint>` produces:

```
[Lilara init] Created lilara.config.json from blueprint 'nextjs'
  Next: edit lilara.config.json to match your project, then run: bash scripts/install-local.sh
```

The generated `lilara.config.json` in the current working directory contains all required fields pre-populated.

## Constraints

- Will not overwrite an existing `lilara.config.json` without `--force`. This prevents accidental loss of a customized config.
- Blueprint files live in `templates/blueprints/`. They are read-only references; `lilara init` copies them, not symlinks.
- The schema for `lilara.config.json` is in `schemas/lilara.config.schema.json`. Any manual additions must comply with it.
- Blueprints are opinionated starting points, not exhaustive configurations. Review and customize before running `install-local.sh` in production.
