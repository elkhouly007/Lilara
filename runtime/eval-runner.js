#!/usr/bin/env node
"use strict";

const fs   = require("fs");
const path = require("path");

// Override the evals directory for test isolation.
function evalsDir() {
  return process.env.LILARA_EVAL_DIR
    ? path.resolve(process.env.LILARA_EVAL_DIR)
    : path.join(__dirname, "..", "evals");
}

/**
 * Discover all *.eval.js files in the evals directory.
 * Returns [{ path, name }]
 */
function discover() {
  const dir = evalsDir();
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith(".eval.js"))
    .sort()
    .map((f) => ({ path: path.join(dir, f), name: f.replace(/\.eval\.js$/, "") }));
}

/**
 * Run all discovered evals against the given corpus.
 * Returns { results: [EvalResult], summary }
 * where EvalResult = { name, passed, failed, total, failures, error }
 */
async function runAll({ corpus = [], format = "text" } = {}) {
  const evals = discover();
  const results = [];

  for (const ev of evals) {
    let mod;
    try {
      mod = require(ev.path);
    } catch (err) {
      results.push({ name: ev.name, passed: 0, failed: 0, total: 0, failures: [], error: String(err.message || err) });
      continue;
    }

    let result;
    try {
      result = await mod.run(corpus);
    } catch (err) {
      results.push({ name: ev.name, passed: 0, failed: 0, total: 0, failures: [], error: String(err.message || err) });
      continue;
    }

    results.push({
      name:     ev.name,
      passed:   result.passed   || 0,
      failed:   result.failed   || 0,
      total:    result.total    || 0,
      failures: Array.isArray(result.failures) ? result.failures : [],
      error:    null,
    });
  }

  const totalPassed  = results.reduce((s, r) => s + r.passed,  0);
  const totalFailed  = results.reduce((s, r) => s + r.failed,  0);
  const totalEntries = results.reduce((s, r) => s + r.total,   0);

  return {
    results,
    summary: { evals: evals.length, totalPassed, totalFailed, totalEntries },
    junit: format === "junit" ? toJUnit(results) : null,
  };
}

/**
 * Convert results to JUnit XML.
 * Hand-rolled string concat — no xml library dependency.
 */
function toJUnit(results) {
  const totalTests   = results.reduce((s, r) => s + r.total,  0);
  const totalFailed  = results.reduce((s, r) => s + r.failed, 0);

  const suites = results.map((r) => {
    const cases = r.failures.map((f) =>
      `      <testcase name="${_esc(String(f.id || "unknown"))}" classname="${_esc(r.name)}">\n` +
      `        <failure message="${_esc(String(f.note || "assertion failed"))}">\n` +
      `          expected: ${_esc(String(f.expected || ""))}\n` +
      `          got: ${_esc(String(f.got || ""))}\n` +
      `        </failure>\n` +
      `      </testcase>`
    );
    // Add passing test cases (one per passed entry — names derived from total-failures)
    const passingCount = r.passed;
    if (passingCount > 0) {
      cases.push(`      <testcase name="${_esc(r.name + ": " + passingCount + " passing")}" classname="${_esc(r.name)}"/>`);
    }
    if (r.error) {
      cases.push(
        `      <testcase name="${_esc(r.name + ": load-error")}" classname="${_esc(r.name)}">\n` +
        `        <error message="${_esc(r.error)}"/>\n` +
        `      </testcase>`
      );
    }

    return (
      `    <testsuite name="${_esc(r.name)}" tests="${r.total}" failures="${r.failed}" errors="${r.error ? 1 : 0}">\n` +
      cases.join("\n") + (cases.length ? "\n" : "") +
      `    </testsuite>`
    );
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites tests="${totalTests}" failures="${totalFailed}">\n` +
    suites.join("\n") + (suites.length ? "\n" : "") +
    `</testsuites>\n`
  );
}

function _esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports = { discover, runAll, toJUnit };
