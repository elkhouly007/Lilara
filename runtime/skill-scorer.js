"use strict";

const fs   = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// skill-scorer.js
// Score each skill file 1-5 on five 1-point dimensions.
// Five dimensions:
//   1. YAML frontmatter block (--- ... --- inside body, after the title line)
//   2. ## Process heading (or alias: ## Setup Process)
//   3. ## Constraints heading
//   4. ## Output Format heading (or alias: ## Output)
//   5. ## When to Use heading (or alias: ## Trigger)
// ---------------------------------------------------------------------------

const DIMENSIONS = [
  { name: "yaml_frontmatter",   test: (text) => /^---\s*\n[\s\S]*?\n---/m.test(text) },
  { name: "process_heading",    test: (text) => /^##\s+(Process|Setup Process)\b/im.test(text) },
  { name: "constraints_heading",test: (text) => /^##\s+Constraints\b/im.test(text) },
  { name: "output_format",      test: (text) => /^##\s+(Output Format|Output)\b/im.test(text) },
  { name: "when_to_use",        test: (text) => /^##\s+(When to Use|Trigger)\b/im.test(text) },
];

function scoreOne(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return { file: filePath, score: 0, missing: DIMENSIONS.map((d) => d.name) };
  }

  const missing = [];
  let score = 0;
  for (const dim of DIMENSIONS) {
    if (dim.test(text)) {
      score++;
    } else {
      missing.push(dim.name);
    }
  }

  return { file: filePath, score, missing };
}

function scoreAll({ skillsDir } = {}) {
  const dir = skillsDir || path.join(process.cwd(), "skills");
  let files;
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .map((f) => path.join(dir, f));
  } catch {
    return { results: [], average: 0, count: 0 };
  }

  const results = files.map((f) => scoreOne(f));
  const average = results.length > 0
    ? Math.round((results.reduce((sum, r) => sum + r.score, 0) / results.length) * 10) / 10
    : 0;

  return { results, average, count: results.length };
}

module.exports = { scoreOne, scoreAll };
