"use strict";

const assert = require("node:assert");

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

// We need to reload the module for each env-stub test to avoid caching.
// Use isolated require by clearing the module cache.
function freshRequire(mod) {
  const key = require.resolve(mod);
  delete require.cache[key];
  return require(mod);
}

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("detectVcs: GITHUB_ACTIONS=true → 'github'", () => {
  withEnv({ GITHUB_ACTIONS: "true", GITLAB_CI: undefined, BITBUCKET_BUILD_NUMBER: undefined }, () => {
    const { detectVcs } = freshRequire("../../runtime/vcs-adapter");
    assert.strictEqual(detectVcs(), "github");
  });
});

test("detectVcs: GITLAB_CI=true → 'gitlab'", () => {
  withEnv({ GITHUB_ACTIONS: undefined, GITLAB_CI: "true", BITBUCKET_BUILD_NUMBER: undefined }, () => {
    const { detectVcs } = freshRequire("../../runtime/vcs-adapter");
    assert.strictEqual(detectVcs(), "gitlab");
  });
});

test("detectVcs: BITBUCKET_BUILD_NUMBER set → 'bitbucket'", () => {
  withEnv({ GITHUB_ACTIONS: undefined, GITLAB_CI: undefined, BITBUCKET_BUILD_NUMBER: "42" }, () => {
    const { detectVcs } = freshRequire("../../runtime/vcs-adapter");
    assert.strictEqual(detectVcs(), "bitbucket");
  });
});

test("detectVcs: no CI env → 'local'", () => {
  withEnv({ GITHUB_ACTIONS: undefined, GITLAB_CI: undefined, BITBUCKET_BUILD_NUMBER: undefined }, () => {
    const { detectVcs } = freshRequire("../../runtime/vcs-adapter");
    assert.strictEqual(detectVcs(), "local");
  });
});

test("getCurrentBranch: LILARA_BRANCH_OVERRIDE wins over CI env", () => {
  withEnv({ LILARA_BRANCH_OVERRIDE: "override-branch", GITHUB_ACTIONS: "true", GITHUB_REF_NAME: "ci-branch" }, () => {
    const { getCurrentBranch } = freshRequire("../../runtime/vcs-adapter");
    assert.strictEqual(getCurrentBranch(), "override-branch");
  });
});

test("getCurrentBranch: GITHUB_HEAD_REF used when available", () => {
  withEnv({ LILARA_BRANCH_OVERRIDE: undefined, GITHUB_ACTIONS: "true", GITHUB_HEAD_REF: "feature/pr-branch", GITHUB_REF_NAME: "main" }, () => {
    const { getCurrentBranch } = freshRequire("../../runtime/vcs-adapter");
    assert.strictEqual(getCurrentBranch(), "feature/pr-branch");
  });
});

test("getCurrentBranch: GitLab CI_COMMIT_REF_NAME used", () => {
  withEnv({ LILARA_BRANCH_OVERRIDE: undefined, GITHUB_ACTIONS: undefined, GITLAB_CI: "true", CI_COMMIT_REF_NAME: "gl-feature" }, () => {
    const { getCurrentBranch } = freshRequire("../../runtime/vcs-adapter");
    assert.strictEqual(getCurrentBranch(), "gl-feature");
  });
});

test("getCurrentBranch: local → returns a non-empty string (real git branch)", () => {
  withEnv({ LILARA_BRANCH_OVERRIDE: undefined, GITHUB_ACTIONS: undefined, GITLAB_CI: undefined, BITBUCKET_BUILD_NUMBER: undefined }, () => {
    const { getCurrentBranch } = freshRequire("../../runtime/vcs-adapter");
    const branch = getCurrentBranch();
    assert.ok(typeof branch === "string", "should return a string");
    // On this repo we're on a feature branch
    assert.ok(branch.length > 0, "should be non-empty (we are in a git repo)");
  });
});

test("getProtectedBranches: GITHUB_BASE_REF included", () => {
  withEnv({ LILARA_BRANCH_OVERRIDE: undefined, GITHUB_ACTIONS: "true", GITHUB_BASE_REF: "main" }, () => {
    const { getProtectedBranches } = freshRequire("../../runtime/vcs-adapter");
    const branches = getProtectedBranches();
    assert.ok(branches.includes("main"), "main should be protected");
  });
});

console.log();
console.log("vcs-adapter: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
