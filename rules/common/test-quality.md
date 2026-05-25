---
last_reviewed: 2026-05-25
version_target: 1.0.x
---

# Test Quality

Universal principles for writing tests that catch real bugs, survive refactoring, and communicate clearly.

## Coverage

- Every public/exported function has at least one test. Untested exports are untested contracts.
- Cover the happy path, at least one boundary (zero, empty, max), and at least one error path per function.
- Test the contract, not the implementation. If a refactor breaks your tests but not behavior, the tests were wrong.
- A test that only passes is not a test — confirm the assertion actually fails when the behavior is wrong before committing it.

## Determinism

- Tests produce the same result on every machine, in any order, at any time. No `Date.now()`, no `Math.random()`, no real network calls inside unit tests.
- Inject all non-deterministic dependencies (time, randomness, I/O) so they can be controlled in tests.
- Never rely on test execution order. Each test sets up its own state and tears it down.
- Avoid `sleep` / `time.Sleep` / `asyncio.sleep` in tests. If you need to wait, use a callback, promise, or channel.

## Assertion Quality

- One logical assertion per test. If a test name contains "and", split it into two tests.
- Assert the specific value, not just truthiness. `expect(result).toBe(42)` beats `expect(result).toBeTruthy()`.
- Assert on the outcome visible to callers, not on internal state. Test what the function promises, not how it delivers it.
- For error assertions, verify both that the error is thrown and that the error message or type is correct.

## Isolation

- Each test creates its own fixtures. Shared mutable state across tests causes flaky failures that are impossible to reproduce in isolation.
- Restore all global state after a test (environment variables, module caches, database state). Use `afterEach` / `defer` / `setUp`/`tearDown` for cleanup.
- Mock only at I/O boundaries: filesystem, network, database, external APIs. Do not mock business logic or domain objects.
- Keep test helpers small and named. A helper named `makeUser()` is reusable; one named `setupEverythingForLoginTest()` is a maintenance liability.
