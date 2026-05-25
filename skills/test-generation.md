# Skill: test-generation

---
name: test-generation
description: Generate unit tests from source code — analyzes function signatures and behavior, produces happy-path, edge-case, and error-handling tests for JavaScript/Node, Python, Go, and Rust.
---

# Test Generation

Generates unit tests from source code by analyzing function signatures, return types, documented behavior, and observable side effects. Produces tests that cover the happy path, edge cases, and error handling.

## When to Use

- Adding tests to existing code that has none
- Generating a test scaffold for a new function or module before or after writing it
- Finding blind spots: what inputs does the existing test suite not exercise?
- Setting up the test file structure for a new language or framework in the project

## Process

1. **Read the source** — Read the file to test. Extract all exported/public functions: their names, parameter types, return types, error conditions, and any `@param`/`@returns`/docstring annotations.

2. **Identify the framework** — Detect by inspecting `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, or nearby test files:
   - JavaScript/Node: Jest (`*.test.js`) or Node `assert` (`test/*.js`) — default to Jest if both present
   - Python: pytest (`test_*.py`)
   - Go: `testing` package (`_test.go`)
   - Rust: inline `#[cfg(test)]` module (`mod tests`)

3. **Plan the test cases** — For each exported function, list:
   - Happy path: typical inputs → expected output
   - Edge cases: empty string, zero, null/undefined, empty array, max integer, empty map
   - Error handling: invalid type, out-of-range value, I/O failure, network error (where applicable)
   - State side effects: mutations, file writes, DB calls (mock or stub as needed)

4. **Generate the test file** — Write tests using the detected framework. Follow `rules/common/test-quality.md`: one assertion per test, descriptive test names, isolated fixtures, no logic inside test bodies.

5. **Check framework conventions** — Read 1–2 existing test files in the project to match naming, import style, and describe/it vs function-per-test conventions before writing.

6. **Run and report** — Run the tests with the project's test command. Report: N passing, N failing, N skipped. For failing tests, show the assertion error and suggest whether it reveals a bug in the source or a wrong expectation in the test.

## Output Format

```
## Test Generation Report — <file-under-test>

Framework: <Jest|pytest|go/testing|Rust/cargo test>
Functions covered: N
Test cases generated: N (happy: N, edge: N, error: N)

### Generated file: <test-file-path>
<test file content>

### Run results (if executed)
Passing: N  Failing: N  Skipped: N

### Gaps
- <function X: no error path reachable without dependency injection>
- <function Y: requires real network — marked as skipped>
```

## Constraints

- Does not modify source files — only creates or extends test files.
- Does not invent behavior: if a function's contract is ambiguous, writes a test with a `// TODO: confirm expected behavior` comment.
- Does not mock framework internals — only mocks I/O boundaries (HTTP, filesystem, DB).
- Skips generated files, lock files, and binary assets.
