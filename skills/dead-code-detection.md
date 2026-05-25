# Skill: dead-code-detection

---
name: dead-code-detection
description: Detect unused exports, unreachable functions, unused imports, dead CSS selectors, and orphan files in a codebase. Supports JavaScript/TypeScript, Python, and Go. Reports confidence scores (LOW/MED/HIGH) per finding.
---

# Dead Code Detection

Scans a codebase for code that is never executed or referenced. Reports unused exports, unreachable functions, unused imports, orphan files, and dead CSS selectors with per-finding confidence scores.

## When to Use

- Pre-release cleanup: remove dead code to reduce maintenance surface
- Security audit: dead code can hide vulnerabilities or be re-activated accidentally
- Performance optimization: unused imports inflate bundle size
- Codebase health check after a major refactor

## Process

1. **Detect language(s)** — Check for `package.json` (JS/TS), `go.mod` (Go), `pyproject.toml`/`setup.py`/`*.py` (Python). Run language-specific analysis for each.

2. **JavaScript / TypeScript** — Leverage TypeScript compiler flags:
   ```bash
   npx tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1 | grep "is declared but"
   ```
   Then for unused exports: grep for `export ` declarations and cross-reference against imports across the project:
   ```bash
   grep -rn "^export " src/ | while read f; do name=$(echo "$f" | sed 's/.*export [a-z]* //;s/ .*//');\
   grep -rl "$name" src/ | grep -v "^${f%:*}" || echo "UNUSED: $f"; done
   ```
   Orphan files: `find src -name "*.ts" | while read f; do grep -rl "$f" src/ || echo "ORPHAN: $f"; done`

3. **Python** — Use the `ast` stdlib (no external packages):
   ```bash
   python3 -c "
   import ast, os, sys
   for root,dirs,files in os.walk('.'):
     dirs[:] = [d for d in dirs if d not in ['__pycache__','.venv','venv','node_modules']]
     for f in files:
       if not f.endswith('.py'): continue
       path = os.path.join(root, f)
       try:
         tree = ast.parse(open(path).read())
         for node in ast.walk(tree):
           if isinstance(node, ast.FunctionDef) and node.name.startswith('_unused_'):
             print(f'SUSPECT: {path}:{node.lineno} {node.name}')
       except: pass
   "
   ```
   Cross-reference `def <name>` declarations against imports and call sites via grep.

4. **Go** — The compiler enforces no unused imports. For unused exported functions:
   ```bash
   go vet ./... 2>&1
   # Then check for exported symbols unreferenced outside their package:
   grep -rn "^func [A-Z]" . | while read f; do \
     name=$(echo "$f" | grep -o 'func [A-Z][A-Za-z]*' | cut -d' ' -f2); \
     grep -rl "$name" . | grep -v "^${f%:*}" || echo "UNUSED_EXPORT: $f"; \
   done
   ```

5. **CSS / dead selectors** — If CSS files are present, extract all class/id names and cross-reference against HTML/JSX/template files. Flag selectors with zero references as LOW confidence (may be dynamically added).

6. **Assign confidence scores** — Each finding gets:
   - HIGH: TypeScript compiler or Go compiler confirmed (compiler-backed evidence)
   - MED: Grep-based cross-reference found no callers in the project tree
   - LOW: Heuristic only (naming convention, orphan file pattern, dynamic import possible)

7. **Report** — See Output Format below.

## Output Format

```
## Dead Code Report — <project-root>
Scanned: N files  |  Findings: N (HIGH: N, MED: N, LOW: N)

### [HIGH] Unused export — <file>:<line>
Symbol: <name>
Evidence: no import found in project tree

### [MED] Unused function — <file>:<line>
Symbol: <name>
Evidence: 0 call sites via grep

### [LOW] Orphan file — <file>
Evidence: no import/require found; may be entry point or dynamically loaded

### Summary
- Safe to remove (HIGH): N symbols
- Review before removing (MED): N symbols
- Needs human judgment (LOW): N files/symbols
```

## Constraints

- Does not modify or delete any code — reports only.
- Dynamic imports, `eval`, `require(variable)`, and reflection-based access cannot be tracked by static analysis — findings involving such patterns are downgraded to LOW confidence.
- Go and TypeScript compiler-backed findings (HIGH) can be treated as safe-to-remove. MED and LOW always require human review.
- Does not analyze test files for dead code — test utilities that appear unused may be test helpers.
