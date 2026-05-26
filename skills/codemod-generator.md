# Skill: codemod-generator

---
name: codemod-generator
description: Generates an AST-based codemod for large-scale refactors in JavaScript/TypeScript (jscodeshift) or Python (libcst). Given a target pattern to find and a replacement pattern, writes the transformer script, runs a dry-run on a sample of 5 representative files to validate output, produces a diff for human review, and emits batch-apply instructions with a pre-apply safety checklist. Designed for renames, API migrations, and idiom upgrades that touch hundreds of files too tedious to edit by hand.
---

# Codemod Generator

Transform a large-scale refactor from a manual multi-day edit session into a reviewed, automated codemod that applies in seconds and can be replayed on any branch.

## When to Use

- Renaming a function, method, or type across an entire codebase (50+ call sites)
- Migrating from one API to a newer version (e.g., `ReactDOM.render` → `createRoot`, `moment` → `date-fns`, deprecated config keys)
- Enforcing a new coding idiom at scale (e.g., replacing `var` with `const`/`let`, converting callbacks to async/await, adding required error-handling wrappers)
- Preparing a codebase for a framework upgrade that requires mechanical source changes

## Process

1. **Characterize the pattern** — ask the user to describe the before and after. Classify the transformation:
   - **Identifier rename**: function name, variable name, property name, import path
   - **Signature change**: argument added/removed/reordered, return type change
   - **API migration**: one expression pattern replaced by another (may span multiple nodes)
   - **Structural transformation**: block rewriting (e.g., callback → promise)

   Identify the target language (JS/TS → jscodeshift; Python → libcst) and verify the dependency is available in the project (`npx jscodeshift --version` or `python -m libcst --version`).

2. **Write the transformer script** — generate the codemod as a self-contained script file:

   For jscodeshift (JS/TS), output `codemods/<name>.js`:

   ```javascript
   // codemods/rename-getUser-to-fetchUser.js
   module.exports = function transformer(file, api) {
     const j = api.jscodeshift;
     const root = j(file.source);

     root.find(j.CallExpression, {
       callee: { type: 'Identifier', name: 'getUser' }
     }).replaceWith(path =>
       j.callExpression(j.identifier('fetchUser'), path.node.arguments)
     );

     return root.toSource({ quote: 'single' });
   };
   ```

   For libcst (Python), output `codemods/<name>.py`:

   ```python
   # codemods/rename_get_user.py
   import libcst as cst
   import libcst.matchers as m

   class RenameGetUser(cst.CSTTransformer):
       def leave_Call(self, original_node, updated_node):
           if m.matches(updated_node.func, m.Name("get_user")):
               return updated_node.with_changes(func=cst.Name("fetch_user"))
           return updated_node

   def transform(context, tree):
       return tree.visit(RenameGetUser())
   ```

3. **Dry-run on 5 representative files** — select 5 files that are likely to contain the pattern (use `grep -rl 'pattern' src/ | head -5`) and run the codemod in dry-run mode:

   ```bash
   # jscodeshift dry-run
   npx jscodeshift --dry --print \
     -t codemods/rename-getUser-to-fetchUser.js \
     src/api/user.ts src/hooks/useUser.ts src/pages/profile.tsx

   # libcst dry-run
   python -m libcst.tool codemod codemods.rename_get_user \
     --no-format --jobs 1 \
     src/api/user.py src/services/auth.py
   ```

4. **Review the diff output** — print the before/after diff for each dry-run file. Flag any unexpected changes (e.g., false positives, incomplete transforms, whitespace corruption). If false positives appear, add a scope guard to the matcher (e.g., check that the call is not inside a `test()` block, or that it imports from the correct module).

5. **Produce the batch-apply instructions** — write the full apply command and a safety checklist:

   ```bash
   # Apply to entire codebase
   npx jscodeshift -t codemods/rename-getUser-to-fetchUser.js \
     --parser=babel --extensions=ts,tsx,js,jsx \
     src/

   # Run tests immediately after
   npm test
   ```

   Safety checklist:
   - [ ] Dry-run reviewed and approved for all 5 sample files
   - [ ] Branch created: `git checkout -b codemod/rename-getUser`
   - [ ] All tests passing before applying: `npm test`
   - [ ] Codemod applied and staged: `git add -A`
   - [ ] Tests passing after applying: `npm test`
   - [ ] Manual review of 3–5 randomly selected diff hunks
   - [ ] PR opened with codemod script committed alongside the changes

## Output Format

```
## Codemod: rename getUser → fetchUser

Language: TypeScript/JavaScript (jscodeshift)
Scope: src/**/*.{ts,tsx,js,jsx}
Pattern type: Identifier rename (CallExpression)

### Transformer: codemods/rename-getUser-to-fetchUser.js

[transformer code as above]

### Dry-Run Results (5 files)

File 1: src/api/user.ts
  - Line 14: getUser(id) → fetchUser(id)  ✓ expected

File 2: src/hooks/useUser.ts
  - Line 8:  getUser(userId) → fetchUser(userId)  ✓ expected
  - Line 23: getUser(ctx.id) → fetchUser(ctx.id)  ✓ expected

File 3: src/utils/cache.ts
  - No matches  (expected — this file uses a local getUser closure, not the import)

File 4: src/pages/profile.tsx
  - Line 41: getUser(props.id) → fetchUser(props.id)  ✓ expected

File 5: tests/api.test.ts
  - Line 7:  getUser(mockId) → fetchUser(mockId)  ⚠ check: ensure mock is also renamed

Dry-run verdict: Safe to apply. One warning on tests/api.test.ts — verify mock rename.

### Apply Command

npx jscodeshift -t codemods/rename-getUser-to-fetchUser.js \
  --parser=babel --extensions=ts,tsx,js,jsx src/

### Safety Checklist

[checklist as above]
```

## Constraints

- The codemod script operates on the AST, not on raw text — it will not transform string literals that contain the pattern name (e.g., a log message `"calling getUser"` will not be renamed). Flag any such strings for manual update.
- jscodeshift requires Node.js ≥ 14 and is invoked via `npx` — no global install is needed. libcst requires Python ≥ 3.8 and must be installed in the project's virtualenv.
- The skill does not execute the codemod — it generates the script and provides instructions. Execution is the engineer's responsibility after reviewing the dry-run diff.
- Complex transformations (e.g., multi-argument reordering with type narrowing, cross-file import updates) may require a multi-pass codemod or a manual cleanup step — the skill will flag these cases explicitly.
- Codemods that touch `*.test.*` files must be reviewed separately — test mock names, assertion strings, and test descriptions often require manual updates that the AST transform cannot safely automate.
