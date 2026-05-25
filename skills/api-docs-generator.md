# Skill: api-docs-generator

---
name: api-docs-generator
description: Generate API documentation from source code by extracting function signatures, JSDoc/docstrings/godoc comments, route definitions, and request/response shapes. Outputs structured Markdown suitable for a docs site or README API reference section.
---

# API Docs Generator

Generates API documentation directly from source code — exported functions, HTTP routes, request/response schemas — without relying on manual annotations being complete.

## When to Use

- Project has no API documentation
- Documentation is out of sync with the code
- Preparing a public API reference for a library or service
- Generating docs for review before a release

## Process

1. **Identify the API surface** — Determine type: library (exported functions), HTTP server (route definitions), or CLI (command definitions).

2. **Library APIs** — Find all exported symbols:
   - JavaScript/TypeScript: `export function`, `export class`, `export const` with function types
   - Python: `def ` at module top level or in exported classes
   - Go: `func [A-Z]` and exported types
   Extract: name, parameters (with types if available), return type, JSDoc/docstring (first paragraph only).

3. **HTTP server APIs** — Detect framework (Express, FastAPI, Gin, Axum, Spring). Extract route definitions:
   - Method: GET/POST/PUT/DELETE/PATCH
   - Path: with parameter placeholders
   - Handler name
   - Request body type if inferrable from schema validation or type annotations
   - Response type if returned explicitly

4. **CLI commands** — Parse argument definitions (yargs, click, cobra, clap). Extract: command name, flags, arguments, descriptions.

5. **Write docs** — One section per exported function/route/command:
   - Signature with types
   - Description from docstring (or "No description" if absent)
   - Parameters table: name, type, required/optional, description
   - Returns / Response: type and description
   - Example (where inferrable from tests or usage in other files)

6. **Coverage report** — List symbols that are exported but undocumented (no JSDoc/docstring). These are the gaps the developer should fill.

## Output Format

```markdown
## `functionName(param: Type): ReturnType`
<description from docstring or "Undocumented">

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| param | Type | Yes | … |

**Returns** `ReturnType` — <description>

**Example**
```code
…
```

## Coverage
- Documented: N/total
- Undocumented symbols: <list>
```

## Constraints

- Does not invent parameter descriptions. If a docstring is absent, uses the parameter name only.
- Does not modify source files.
- For dynamic route definitions (route loaded from config at runtime), note as "dynamically registered — static analysis incomplete."
