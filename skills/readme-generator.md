# Skill: readme-generator

---
name: readme-generator
description: Generate a README.md for a project by analyzing the codebase — entry points, package config, public API, scripts, tests, and environment setup. Produces a structured README with installation, usage, configuration, and contributing sections.
---

# README Generator

Generates a `README.md` by reading the project's code, config, and test structure. No templates — the output is derived from what the project actually is.

## When to Use

- New project has no README
- Existing README is a placeholder or outdated stub
- Handing off a project and need documentation that matches current reality

## Process

1. **Read project config** — `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`. Extract: project name, description, version, license, main entry point, scripts (start/build/test), dependencies.

2. **Discover entry points** — Identify the main executable or importable package. Read it to understand what the project does in one paragraph.

3. **Find the test command** — From scripts or common test file patterns. Note the test framework.

4. **Read environment setup** — Check for `.env.example`, `config/`, `schema/`, `docker-compose.yml`, and any README fragments. Extract required environment variables and service dependencies.

5. **Read the public API** — For libraries: read exported functions/classes and extract signature + first docstring/JSDoc. For CLIs: run `--help` if safe. For servers: read route definitions.

6. **Write README.md** — Structure: Project name + tagline, Badges (if CI config exists), Description (1–2 paragraphs), Prerequisites, Installation, Configuration (env vars), Usage (quick start + examples), API Reference (for libraries), Contributing, License. Use real commands from the codebase, not generic placeholders.

7. **Validate** — Check that every command in the README actually exists in the project (scripts, binaries, test commands). Remove any section that would be empty or placeholder-only.

## Output Format

```markdown
# Project Name

> One-line tagline derived from package description.

## Installation
<real commands>

## Usage
<real entry-point invocation>

## Configuration
<actual env vars with types and defaults>

## API (if library)
<exported functions with signatures>

## Contributing
<real test command and PR process if detectable>

## License
<from package config>
```

## Constraints

- Does not invent behavior or placeholder content. Every section is either derived from the codebase or omitted.
- Does not overwrite an existing README without operator confirmation.
- Skips sections that have no content derivable from the current project state.
