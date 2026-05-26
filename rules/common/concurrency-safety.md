---
last_reviewed: 2026-05-26
version_target: 1.0.x
---

# Concurrency Safety Rules

Prevent data races, deadlocks, and TOCTOU vulnerabilities by encoding correct synchronization discipline from the start.

- **Never perform read-modify-write on shared mutable state without synchronization.** Sequences like `counter++`, `map[key] = map[key] + 1`, or `list.append(item)` are not atomic — a context switch between the read and the write corrupts the value under concurrent access. Use language-native atomic operations (`sync/atomic` in Go, `std::atomic` in C++, `Interlocked` in C#, `AtomicInteger` in Java), a mutex guard, or a channel/actor for every shared-state mutation.

- **Enforce a global lock-ordering discipline to prevent deadlocks.** When multiple locks must be held simultaneously, always acquire them in the same order across all code paths. Document the ordering (e.g., `Lock A must always be acquired before Lock B`) in a top-level comment near the lock declarations. Deadlocks arise exclusively from cyclic wait — consistent ordering eliminates the cycle. Use static analysis tools (`go vet -race`, `ThreadSanitizer`, `Helgrind`) to detect ordering violations.

- **Minimize mutex hold time — release before any blocking I/O or long computation.** A mutex held while waiting for a database response, a network call, or a file read blocks every other goroutine/thread that needs the same lock for the duration of the I/O. Compute the value under the lock, assign it to a local variable, release the lock, then perform I/O on the local. This pattern (lock → copy → unlock → use) is the standard mitigation for hold-and-wait.

- **Use compare-and-swap for lock-free counters and state flags.** CAS operations (`sync/atomic.CompareAndSwap` in Go, `std::atomic::compare_exchange_strong` in C++, `Interlocked.CompareExchange` in C#) allow optimistic updates without a mutex. The caller loops until the swap succeeds: `for { old := load(); if CAS(&x, old, new) { break } }`. CAS is appropriate for counters, flags, and pointers; it is not appropriate for multi-field struct updates where consistency across fields is required (use a mutex for that).

- **Select thread-safe data structures based on access pattern, not convenience.** Use `sync.Map` (Go) or `ConcurrentHashMap` (Java) for concurrent key-value access; `java.util.concurrent.CopyOnWriteArrayList` or `sync.RWMutex`-protected slices for read-heavy, write-rare lists; lock-free queues (`mpsc::channel` in Rust, `java.util.concurrent.LinkedBlockingQueue`) for producer-consumer pipelines. A plain `HashMap` under concurrent access without external synchronization is undefined behavior in Java and a data race in Go.

- **Default shared values to immutable; mutate only at well-defined transition points.** Immutable data (frozen objects, Rust's owned values moved between threads, Haskell's pure values) can be shared across threads without synchronization because no concurrent mutation is possible. In languages without immutability guarantees, copy the value before sharing across thread boundaries, and document the sharing contract. Shared-mutable-state should be the exception, not the default.

- **Use channels and message-passing over shared memory for inter-goroutine/inter-thread coordination.** Go's `chan`, Rust's `mpsc`, Erlang's mailboxes, and actor frameworks enforce a single-owner model: one thread mutates, others receive messages. This eliminates the entire class of data-race bugs at the cost of slightly higher allocation. Reserve shared-memory synchronization for hot paths where lock contention is measured and bounded.

- **Avoid the double-checked locking pattern without memory barriers.** In languages without a sequentially-consistent memory model (C++ without `std::atomic`, Java pre-Java-5 without `volatile`), the double-checked locking idiom for lazy initialization is broken — the compiler or CPU may reorder the write to the instance pointer before the object's constructor completes. Use `sync.Once` (Go), `std::call_once` (C++), class-level initialization (Java), or `Lazy<T>` (C#/.NET) — these primitives include the correct memory barriers.

- **Propagate cancellation signals correctly through async call chains.** In async/await runtimes (Node.js, Python asyncio, C# Task), a cancelled `CancellationToken` or `AbortSignal` must be checked and propagated at every `await` point that may block. Failure to propagate cancellation leads to zombie tasks that hold database connections and file handles after the caller has moved on. In Go, pass `context.Context` as the first argument to every function that does I/O, and check `ctx.Err()` at each blocking call.

- **Audit every read-check-then-act sequence for TOCTOU vulnerabilities.** Time-of-check-to-time-of-use races occur when the program checks a condition (file exists, permission granted, balance sufficient) and then acts on it without holding the lock or using an atomic operation across both steps. Mitigate by using atomic file operations (`O_CREAT|O_EXCL`, `rename` for atomic swap), database `SELECT FOR UPDATE` or optimistic locking with version fields, or holding the lock from check through completion of the action.
