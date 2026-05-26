# Skill: bundle-analyzer

---
name: bundle-analyzer
description: Analyse the JavaScript/TypeScript bundle size by reading build tool output (webpack stats JSON, esbuild metafile, or Vite bundle report) to identify the heaviest imports, "whole-library for one function" antipatterns, duplicated packages, and tree-shaking failures. Produces a prioritised optimisation list with concrete code changes (dynamic import, named import, tree-shaking annotation) and an estimated size saving per change.
---

# Bundle Analyzer

Find the 20% of imports that account for 80% of the bundle weight — then give each one a concrete fix, not a vague "consider code splitting" note.

## When to Use

- The bundle size has grown past a size budget (e.g. > 200 KB gzipped for the initial chunk)
- Lighthouse or WebPageTest reports a large "eliminate render-blocking resources" warning
- A new dependency was added and the build is noticeably slower or the output file is larger
- Preparing for a Core Web Vitals audit and need to prioritise JS reduction work

## Process

1. **Generate the build stats file** — produce machine-readable output from the build tool:

   ```bash
   # Webpack
   npx webpack --profile --json > dist/stats.json

   # esbuild
   node build.js --metafile=dist/meta.json   # (or add metafile:true to build config)

   # Vite
   npx vite-bundle-visualizer --json > dist/bundle-report.json
   # or: npx rollup-plugin-visualizer with json output
   ```

   If no stats file exists and the build tool is unknown, read `package.json` scripts and identify the bundler.

2. **Read the stats file** — parse the top-level size breakdown:
   - For webpack stats: read `assets[].size` and sort descending.
   - For esbuild metafile: read `outputs[].bytes` per chunk.
   - Extract the `inputs` map (file → bytes contributed) from the heaviest chunks.

3. **Rank the top 20 heaviest imports** — sort the input-file map by byte contribution. Flag any entry where:
   - A single `node_modules/<package>` file exceeds 20 KB before gzip
   - A package appears to be imported in its entirety when only a subset is used (e.g. `import _ from 'lodash'` vs `import { debounce } from 'lodash'`)

4. **Detect antipatterns** — scan the source files for the heaviest packages:

   ```bash
   # Whole-library imports (lodash, date-fns, ramda, rxjs, etc.)
   grep -rn --include='*.{js,ts,jsx,tsx}' \
     -E "^import [A-Z][a-zA-Z]* from '(lodash|moment|rxjs|ramda|date-fns)'" src/

   # CommonJS barrel imports
   grep -rn --include='*.{js,ts}' \
     -E "require\('(lodash|moment|ramda|rxjs)'\)" src/
   ```

5. **Identify duplicated packages** — check if multiple versions of the same package appear in the bundle (a common webpack deduplication failure):

   ```bash
   npx dedupe --check 2>/dev/null || npm ls --all 2>&1 | grep -E "deduped|UNMET"
   ```

6. **Propose concrete optimisations** — for each antipattern found, write the current import line and the fixed version:

   | Antipattern | Fix | Est. saving |
   |-------------|-----|-------------|
   | `import _ from 'lodash'` | `import debounce from 'lodash/debounce'` | ~70 KB |
   | `import moment from 'moment'` | `import { parseISO, format } from 'date-fns'` | ~230 KB |
   | Large route bundle (monolith) | `const Page = React.lazy(() => import('./Page'))` | variable |

7. **Write the report** — output as a markdown table with package, current size, proposed fix, estimated saving.

## Output Format

```
## Bundle Analysis Report

Build tool: webpack 5.x
Total bundle: 847 KB (gzip: 312 KB)
Largest chunk: main.js (782 KB / 289 KB gzip)

### Top 10 Heaviest Imports

| Module | Bytes (raw) | % of bundle | Antipattern |
|--------|-------------|-------------|-------------|
| moment/moment.js | 289 KB | 34% | Whole library — replace with date-fns |
| lodash/lodash.js | 71 KB | 8% | Barrel import — use named imports |
| react-icons/ai/index.js | 38 KB | 4% | Full icon pack — import individual icons |

### Optimisation Priority List

1. Replace `moment` with `date-fns` named imports
   - Current: import moment from 'moment'  (src/utils/dateHelpers.ts:3)
   - Fix:     import { parseISO, format } from 'date-fns'
   - Estimated saving: 230 KB unminified / ~80 KB gzip

2. Switch lodash to per-function imports (4 usages found)
   - src/utils/array.ts:1 — import { groupBy, orderBy } from 'lodash/groupBy', 'lodash/orderBy'
   - Estimated saving: 60 KB / ~20 KB gzip

3. Dynamic import for /admin route
   - src/router.ts:12 — wrap AdminPanel in React.lazy()
   - Estimated saving: 145 KB removed from initial chunk

Total estimated reduction: ~370 KB unminified / ~130 KB gzip (~42% of current size)
```

## Constraints

- Requires a build stats file to be generated first; this skill does not run the build itself.
- Byte savings are estimates — actual savings depend on minification settings, scope hoisting, and whether the replaced package has side effects.
- Dynamic import splitting requires a router that supports lazy loading (React Router v6+, Next.js, Vue Router); the skill notes this dependency but does not configure the router.
- Tree-shaking only works with ES module `import` syntax (`import { X }`, not `require`); CommonJS modules are not tree-shaken by webpack.
- Does not analyse CSS, image, or font bundle contributions — those require a separate asset audit.
