# Skill: dependency-graph-analyzer

---
name: dependency-graph-analyzer
description: Map import and require chains across JS/TS, Python, Go, and Rust source trees to produce an adjacency-list dependency graph. Surfaces circular dependencies, high fan-in hotspots (most-imported modules), high fan-out coupling (most-importing modules), and orphan modules with no inbound references. Emits a JSON graph and a human-readable summary report. Zero runtime deps — parses source files directly with regex patterns calibrated per language.
---

# Dependency Graph Analyzer

Trace every import and require statement across a codebase to produce an explicit, queryable module dependency graph — then surface the structural problems hidden inside it.

## When to Use

- A circular dependency error is breaking the build and you need to find the exact cycle
- Refactoring a module and need to know every file that imports it (fan-in)
- Planning a module split and need to understand what a module currently depends on (fan-out)
- Doing an architecture review and want a map of the real structure, not the intended one

## Process

1. **Detect language and root** — identify the source root (`src/`, `lib/`, `app/`, `pkg/`, or project root) and the primary language from `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, or `setup.py`:

   ```bash
   ls package.json go.mod Cargo.toml pyproject.toml setup.py 2>/dev/null
   ```

2. **Extract import statements per language** — parse each source file for import lines:

   ```bash
   # JS / TS: import ... from '...' and require('...')
   grep -rn --include='*.{js,ts,mjs,cjs}' \
     -E "^(import|export).+from ['\"]([^'\"]+)['\"]|require\(['\"]([^'\"]+)['\"]\)" src/

   # Python: import X or from X import Y
   grep -rn --include='*.py' \
     -E "^(import |from [a-zA-Z])" .

   # Go: import blocks
   grep -rn --include='*.go' -A5 '^import' .

   # Rust: mod declarations and use statements
   grep -rn --include='*.rs' -E "^(use |mod )" src/
   ```

3. **Resolve to module identifiers** — strip file extensions, normalise path separators, and resolve relative paths to canonical project-relative module names. Discard external package imports (node_modules, stdlib, crates.io) — keep only first-party modules.

4. **Build the adjacency list** — produce a JSON graph:

   ```json
   {
     "nodes": ["auth/middleware", "auth/token", "utils/logger"],
     "edges": [
       { "from": "auth/middleware", "to": "auth/token" },
       { "from": "auth/middleware", "to": "utils/logger" }
     ]
   }
   ```

5. **Detect cycles** — run a depth-first search on the adjacency list. For each back-edge found, record the full cycle path:

   ```
   Cycle: auth/middleware → auth/token → auth/middleware
   ```

6. **Score coupling metrics** — for each module, compute:
   - **Fan-in** (number of modules that import it): high values = architectural hotspot
   - **Fan-out** (number of modules it imports): high values = high coupling risk
   - **Orphan** (fan-in = 0 and not an entry point): dead code candidate

7. **Write the report** — emit the adjacency JSON to `dependency-graph.json` and a markdown summary to stdout.

## Output Format

```
## Dependency Graph Analysis — src/ (47 modules)

### Circular Dependencies — 2 found ⚠
  1. auth/middleware → auth/token → auth/middleware
  2. db/models/user → db/queries/account → db/models/user

### Fan-In Hotspots (most imported)
  utils/logger           fan-in: 31
  config/env             fan-in: 22
  errors/AppError        fan-in: 18

### Fan-Out Hotspots (most coupling)
  api/routes/v2/admin    fan-out: 14
  services/orchestrator  fan-out: 11

### Orphan Modules (no inbound references)
  scripts/seed-data        (not an entry point)
  utils/legacyFormat       (not an entry point)

Graph written to: dependency-graph.json (47 nodes, 183 edges)
```

## Constraints

- Parses import syntax statically — dynamic imports (`require(variable)`) and programmatic module loading are not traced.
- Resolves only first-party project modules; external package dependencies are excluded from the graph by design.
- Path aliasing (`@/`, `~/`, tsconfig `paths`) must be resolved manually if the aliases are non-standard.
- Does not modify any source files — read-only analysis only.
- Accuracy in Go and Rust depends on consistent package naming; generated code or vendor directories should be excluded via `.gitignore`-equivalent patterns.
