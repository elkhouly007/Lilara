---
last_reviewed: 2026-05-26
version_target: 1.0.x
---

# Naming Conventions Rules

Consistent, intention-revealing names eliminate cognitive load, reduce ambiguity, and make refactoring safer.

- **Enforce case discipline per language and identifier type.** Use `camelCase` for variables and functions in JS/TS/Java/Kotlin/C#; `snake_case` for Python, Rust, Go identifiers; `PascalCase` for types, classes, interfaces, and components in all languages; `SCREAMING_SNAKE_CASE` for compile-time constants and environment variable names. Mixing styles within a codebase creates unnecessary friction and defeats IDE name search.

- **Name methods and functions with a verb-noun pair that states the intent.** `getUser`, `validatePayload`, `publishEvent`, `computeChecksum` are clear; `handle`, `process`, `do`, `run` are not — they describe mechanism, not intent. A function name should make the purpose obvious without reading its body. One exception: zero-argument predicates that return bool may omit the noun when the subject is the receiver (`user.isActive()`, not `user.checkIfUserIsActive()`).

- **Name entities (classes, structs, interfaces, types) as nouns or noun phrases.** `OrderProcessor`, `PaymentGateway`, `UserRepository` name a thing; `ProcessOrder`, `DoPayment`, `HandleUser` name an action — use those as method names instead. A type that starts with a verb almost always signals that it should be a function, not a type.

- **Avoid Hungarian notation and type-encoding in names.** `strUsername`, `intCount`, `boolIsActive`, `arrItems` redundantly encode the type that the compiler already tracks. Modern IDEs surface type information on hover; names that duplicate it rot when the type changes. The sole exception is pointer/reference sigils in C/C++ when the distinction is semantically load-bearing.

- **Eliminate abbreviations except for universal domain abbreviations.** `req`, `usr`, `mgr`, `cfg`, `tmp`, `msg`, `btn`, `val`, `res`, `err` compress the name without preserving meaning and create inconsistency (`req` vs `request` vs `httpReq`). Allowed abbreviations are those universally understood in the domain: `id`, `url`, `db`, `api`, `http`, `io`, `ctx`, `tx`, `md`, `pdf`. Anything beyond this list must be spelled out.

- **Source names from the ubiquitous language of the domain.** Names that match the domain glossary allow engineers and domain experts to communicate without translation. If the business calls it a "settlement" and the code calls it a "transfer", every conversation requires a mental mapping step. Align code names to domain terms; when a domain term changes, rename the code to match.

- **Name booleans with an affirmative `is*`, `has*`, or `can*` prefix.** `isActive`, `hasPermission`, `canRetry` parse instantly as yes/no questions. Avoid negated names (`isNotEmpty`, `hasNoErrors`, `cannotDelete`) — they create double-negatives in conditionals (`if (!isNotEmpty)`) that require mental unwrapping. Use positive forms and negate at the call site.

- **Name constants with SCREAMING_SNAKE_CASE and a scope prefix when they coexist with module globals.** `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT_MS`, `PAYMENT_GATEWAY_BASE_URL` are immediately recognizable as compile-time or module-level constants. Inline magic numbers (`if (retries > 3)`) must be extracted to a named constant before review — the name documents intent, the value is an implementation detail.

- **Match file names to their primary exported symbol.** A file that exports `OrderProcessor` should be named `OrderProcessor.ts` (PascalCase for classes), `order-processor.ts` (kebab-case for modules), or `order_processor.py` (snake_case for Python). Mismatched file and export names make symbol discovery harder and break tree-shaking in module bundlers that rely on file-name hints.

- **Use plural names for collections, singular names for single items.** `orders`, `users`, `events` for arrays/lists/maps; `order`, `user`, `event` for a single element. Symmetric naming (`const order = orders.find(...)`) makes loops and destructuring read naturally. Do not name arrays `orderList`, `userArray`, or `eventsData` — the collection type is implicit in the variable's role.

- **Never use negated names for identifiers that flip meaning.** `isNotValid`, `hasNoErrors`, `disableNotifications`, `nonEmptyList` introduce cognitive inversion that compounds across nested conditions. Rename to the positive form: `isValid`, `hasErrors`, `notificationsEnabled`, `nonEmpty` or `hasItems`. Negation belongs in the condition, not the name.

- **Enforce reserved-prefix discipline for framework-idiomatic sigils.** In Python, `_name` is module-private and `__name` triggers name-mangling — use them only for their intended access-control semantics, not as ad-hoc naming decoration. In JavaScript/TypeScript, the `_` prefix on a parameter signals intentional non-use; `$` is reserved for framework-generated DOM references and reactive signals (Angular, RxJS). Misusing these prefixes confuses framework tooling and linters.
