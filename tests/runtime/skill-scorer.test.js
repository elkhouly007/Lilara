"use strict";

const assert = require("node:assert");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("  ok      " + name);
    passed++;
  } catch (e) {
    console.error("  FAIL    " + name);
    console.error("          " + e.message);
    failed++;
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scorer-test-"));
}

function writeSkill(dir, name, content) {
  fs.writeFileSync(path.join(dir, name + ".md"), content, "utf8");
}

const { scoreOne, scoreAll } = require("../../runtime/skill-scorer");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("scoreOne: perfect skill scores 5/5", () => {
  const d = tmpDir();
  const f = path.join(d, "perfect.md");
  fs.writeFileSync(f, [
    "# Skill: perfect",
    "",
    "---",
    "name: perfect",
    "description: test",
    "---",
    "",
    "## When to Use",
    "always",
    "",
    "## Process",
    "do it",
    "",
    "## Output Format",
    "text",
    "",
    "## Constraints",
    "none",
  ].join("\n"), "utf8");
  const r = scoreOne(f);
  assert.strictEqual(r.score, 5);
  assert.deepStrictEqual(r.missing, []);
  fs.rmSync(d, { recursive: true, force: true });
});

test("scoreOne: missing all → score 0, 5 missing", () => {
  const d = tmpDir();
  const f = path.join(d, "bare.md");
  fs.writeFileSync(f, "# Bare\n\nJust a title.\n", "utf8");
  const r = scoreOne(f);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.missing.length, 5);
  fs.rmSync(d, { recursive: true, force: true });
});

test("scoreOne: alias 'Setup Process' counts for process_heading", () => {
  const d = tmpDir();
  const f = path.join(d, "alias.md");
  fs.writeFileSync(f, "## Setup Process\nsteps\n", "utf8");
  const r = scoreOne(f);
  assert.ok(r.missing.indexOf("process_heading") === -1, "process_heading should not be missing");
  fs.rmSync(d, { recursive: true, force: true });
});

test("scoreOne: alias 'Output' counts for output_format", () => {
  const d = tmpDir();
  const f = path.join(d, "alias2.md");
  fs.writeFileSync(f, "## Output\nresult\n", "utf8");
  const r = scoreOne(f);
  assert.ok(r.missing.indexOf("output_format") === -1, "output_format should not be missing");
  fs.rmSync(d, { recursive: true, force: true });
});

test("scoreAll: README.md excluded, average computed", () => {
  const d = tmpDir();
  // README.md should be excluded
  fs.writeFileSync(path.join(d, "README.md"), "# Skills\n", "utf8");
  // One perfect skill
  fs.writeFileSync(path.join(d, "skill1.md"), [
    "---\nname: s\ndescription: d\n---\n",
    "## When to Use\n## Process\n## Output Format\n## Constraints\n",
  ].join(""), "utf8");
  // One bare skill (score 0)
  fs.writeFileSync(path.join(d, "skill2.md"), "# Bare\n", "utf8");

  const r = scoreAll({ skillsDir: d });
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.average, 2.5); // (5 + 0) / 2 = 2.5
  fs.rmSync(d, { recursive: true, force: true });
});

test("scoreAll: empty directory returns average 0", () => {
  const d = tmpDir();
  const r = scoreAll({ skillsDir: d });
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.average, 0);
  fs.rmSync(d, { recursive: true, force: true });
});

test("live skills/ directory scores >= 2.5 average", () => {
  const r = scoreAll({ skillsDir: path.join(process.cwd(), "skills") });
  assert.ok(r.average >= 2.5, "live skills average " + r.average + " < 2.5");
  assert.ok(r.count > 0, "should have some skills");
});

console.log();
console.log("skill-scorer: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
