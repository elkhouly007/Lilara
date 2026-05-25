"use strict";

const assert = require("node:assert");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");
const { execSync } = require("child_process");

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

function testAsync(name, fn) {
  return fn().then(() => {
    console.log("  ok      " + name);
    passed++;
  }).catch((e) => {
    console.error("  FAIL    " + name);
    console.error("          " + e.message);
    failed++;
  });
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ghscan-test-"));
}

// Create a minimal git repo with 3 commits; one contains a fake AWS-style key.
function makeFixtureRepo() {
  const d = tmpDir();
  const opts = { cwd: d, stdio: "pipe" };
  execSync("git init --initial-branch=main", opts);
  execSync("git config user.email test@test.com", opts);
  execSync("git config user.name Test", opts);

  // Commit 1: clean file
  fs.writeFileSync(path.join(d, "README.md"), "# test\n");
  execSync("git add README.md", opts);
  execSync("git commit -m init", opts);

  // Commit 2: leak a fake AWS key
  fs.writeFileSync(path.join(d, "config.env"), "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET=secret\n");
  execSync("git add config.env", opts);
  execSync("git commit -m add-config", opts);

  // Commit 3: remove the key (but history still has it)
  fs.writeFileSync(path.join(d, "config.env"), "# credentials removed\n");
  execSync("git add config.env", opts);
  execSync("git commit -m remove-key", opts);

  return d;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const allTests = [
  testAsync("finds fake AWS key in git history", async () => {
    const d = makeFixtureRepo();
    const { scanHistory } = require("../../runtime/git-history-scanner");
    const findings = await scanHistory({ format: "json", cwd: d });
    const awsHit = findings.find((f) => /aws/i.test(f.secretName));
    assert.ok(awsHit, "expected an AWS key finding");
    assert.ok(awsHit.firstSeenCommit, "firstSeenCommit should be set");
    fs.rmSync(d, { recursive: true, force: true });
  }),

  testAsync("deduplicates same secret across commits", async () => {
    const d = makeFixtureRepo();
    const { scanHistory } = require("../../runtime/git-history-scanner");
    const findings = await scanHistory({ format: "json", cwd: d });
    const awsFindings = findings.filter((f) => /aws/i.test(f.secretName));
    // Same key in multiple commits should collapse to 1 entry
    assert.ok(awsFindings.length >= 1, "should have at least 1 AWS finding");
    assert.ok(awsFindings.length <= 2, "dedup should not produce excessive entries");
    fs.rmSync(d, { recursive: true, force: true });
  }),

  testAsync("--since filter excludes older commits", async () => {
    const d = tmpDir();
    const opts = { cwd: d, stdio: "pipe" };
    execSync("git init --initial-branch=main", opts);
    execSync("git config user.email t@t.com", opts);
    execSync("git config user.name T", opts);
    fs.writeFileSync(path.join(d, "old.env"), "AKIAIOSFODNN7EXAMPLE\n");
    execSync("git add old.env", opts);
    execSync("git commit -m old", opts);

    const { scanHistory } = require("../../runtime/git-history-scanner");
    // Since "tomorrow" — should find nothing
    const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const findings = await scanHistory({ format: "json", since: future, cwd: d });
    assert.strictEqual(findings.length, 0, "future --since should exclude everything");
    fs.rmSync(d, { recursive: true, force: true });
  }),

  testAsync("format=markdown returns string with headings", async () => {
    const d = makeFixtureRepo();
    const { scanHistory } = require("../../runtime/git-history-scanner");
    const md = await scanHistory({ format: "markdown", cwd: d });
    assert.ok(typeof md === "string");
    assert.ok(md.includes("# Secrets in Git History"), "should have markdown heading");
    fs.rmSync(d, { recursive: true, force: true });
  }),

  testAsync("clean repo returns empty findings", async () => {
    const d = tmpDir();
    const opts = { cwd: d, stdio: "pipe" };
    execSync("git init --initial-branch=main", opts);
    execSync("git config user.email t@t.com", opts);
    execSync("git config user.name T", opts);
    fs.writeFileSync(path.join(d, "clean.txt"), "no secrets here\n");
    execSync("git add clean.txt", opts);
    execSync("git commit -m clean", opts);

    const { scanHistory } = require("../../runtime/git-history-scanner");
    const findings = await scanHistory({ format: "json", cwd: d });
    assert.strictEqual(findings.length, 0);
    fs.rmSync(d, { recursive: true, force: true });
  }),
];

Promise.all(allTests).then(() => {
  console.log();
  console.log("git-history-scanner: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
});
