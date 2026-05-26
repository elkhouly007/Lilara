# Skill: diagram-generator

---
name: diagram-generator
description: Generates Mermaid (preferred) or PlantUML diagrams from codebase analysis: class diagrams from type and struct definitions, sequence diagrams from a named call flow or HTTP trace, flow diagrams from a control-flow description or decision tree, and component diagrams from the module map. Output is a markdown file with a fenced mermaid block ready to render in GitHub, GitLab, Notion, or any Mermaid-compatible renderer.
---

# Diagram Generator

Turn source code and architecture descriptions into rendered-ready Mermaid diagrams without writing diagram syntax by hand.

## When to Use

- Documenting a module's class hierarchy or data model for a new contributor
- Illustrating a complex request flow (authentication, payment, multi-step form) for a design review
- Creating a component diagram to accompany a new ARCHITECTURE.md or ADR
- Generating a decision flowchart from a complex conditional block or state machine in the code

## Process

1. **Identify the diagram type** from the request:

   | Type | Source material | Output |
   |---|---|---|
   | **Class diagram** | TypeScript interfaces/classes, Python dataclasses, Go structs, Rust structs | UML-style class boxes with fields, methods, and inheritance arrows |
   | **Sequence diagram** | A named function call chain, HTTP request trace, or described user flow | Lifeline boxes with numbered message arrows |
   | **Flow diagram** | A conditional block, state machine, or described decision tree | Decision diamonds and process rectangles |
   | **Component diagram** | Module map (`MODULES.md`, directory structure, import graph) | Boxes for components with dependency arrows |

2. **Parse the source material** — for each diagram type:

   - **Class diagram**: read the relevant type definition files (`*.ts`, `*.py`, `*.go`, `*.rs`). Extract: class/struct names, fields with types, public methods, inheritance (`extends`, `implements`, embedded struct, trait impl).
   - **Sequence diagram**: read the entry-point function and follow the call chain up to 4 hops deep. Identify the actors (caller, service, database, external API) and the messages between them (function call name, HTTP verb + path, SQL statement class).
   - **Flow diagram**: read the function or describe the decision logic. Map each `if`/`else`/`switch` branch to a diamond; each terminal state to a rectangle.
   - **Component diagram**: read `MODULES.md` or list top-level directories. Map each module to a component box; infer dependencies from import statements (`grep -r "from.*moduleA" src/moduleB`).

3. **Generate Mermaid syntax** — prefer Mermaid over PlantUML for GitHub/GitLab compatibility:

   **Class diagram example:**
   ```mermaid
   classDiagram
     class User {
       +string id
       +string email
       +Role role
       +createdAt: Date
       +isActive() bool
     }
     class Order {
       +string id
       +string userId
       +OrderStatus status
       +decimal total
       +submit() void
       +cancel() void
     }
     class Role {
       <<enumeration>>
       ADMIN
       MEMBER
       GUEST
     }
     User "1" --> "0..*" Order : places
     User --> Role : has
   ```

   **Sequence diagram example:**
   ```mermaid
   sequenceDiagram
     actor User
     participant API as API Gateway
     participant Auth as AuthService
     participant DB as PostgreSQL

     User->>API: POST /auth/login {email, password}
     API->>Auth: validateCredentials(email, password)
     Auth->>DB: SELECT user WHERE email=? AND active=true
     DB-->>Auth: User row
     Auth->>Auth: bcrypt.compare(password, hash)
     Auth-->>API: {userId, sessionToken}
     API-->>User: 200 {token, expiresIn}
   ```

   **Flow diagram example:**
   ```mermaid
   flowchart TD
     A([Request received]) --> B{Auth token present?}
     B -- No --> C[Return 401 Unauthorized]
     B -- Yes --> D{Token valid & not expired?}
     D -- No --> E[Return 401 Token expired]
     D -- Yes --> F{User has required role?}
     F -- No --> G[Return 403 Forbidden]
     F -- Yes --> H([Proceed to handler])
   ```

   **Component diagram example:**
   ```mermaid
   graph LR
     subgraph API Layer
       GW[API Gateway]
       Auth[AuthService]
       Orders[OrderService]
     end
     subgraph Data Layer
       DB[(PostgreSQL)]
       Cache[(Redis)]
     end
     subgraph External
       Stripe[Stripe API]
       Email[SendGrid]
     end

     GW --> Auth
     GW --> Orders
     Auth --> DB
     Auth --> Cache
     Orders --> DB
     Orders --> Stripe
     Orders --> Email
   ```

4. **Write the output file** — save as `docs/diagrams/<name>.md` with a title, description, and fenced `mermaid` block:

   ```markdown
   # Diagram: User Authentication Flow

   **Type:** Sequence diagram
   **Generated:** 2026-05-26
   **Source:** src/auth/AuthService.ts, src/middleware/auth.ts

   This diagram shows the login flow from the client through the API Gateway,
   AuthService, and PostgreSQL.

   ` `` `mermaid
   sequenceDiagram
     ...
   ` `` `
   ```

5. **Flag Mermaid limitations** — note when the diagram requires PlantUML or manual adjustment:
   - Mermaid class diagrams do not support interface/abstract class stereotypes as richly as PlantUML — use `<<interface>>` notation
   - Mermaid sequence diagrams cap at ~20 participants cleanly — for larger flows, split into sub-flow diagrams
   - Mermaid does not support deployment diagrams — use a component diagram with subgraphs as an approximation

## Output Format

```
## Diagram Generator — Output

Type: Sequence diagram
Title: User Authentication Flow
Source files: src/auth/AuthService.ts, src/middleware/auth.ts
Output: docs/diagrams/auth-flow.md

### Mermaid Source

` `` `mermaid
sequenceDiagram
  actor User
  participant API as API Gateway
  participant Auth as AuthService
  participant DB as PostgreSQL

  User->>API: POST /auth/login {email, password}
  API->>Auth: validateCredentials(email, password)
  Auth->>DB: SELECT user WHERE email=? AND active=true
  DB-->>Auth: User row
  Auth->>Auth: bcrypt.compare(password, hash)
  Auth-->>API: {userId, sessionToken}
  API-->>User: 200 {token, expiresIn}
` `` `

### Rendering

Paste the mermaid block into:
- GitHub/GitLab Markdown (renders inline)
- Notion (use /code block → select Mermaid)
- VS Code (Markdown Preview Enhanced extension)
- https://mermaid.live (live editor for iteration)

### Diagram Notes

- The bcrypt.compare step is synchronous in this implementation — it will block the event
  loop for ~80ms at cost factor 12. Consider worker_threads for production.
- Error paths (invalid email, account locked) are omitted for clarity — see the error flow
  diagram at docs/diagrams/auth-error-flow.md.
```

## Constraints

- Diagram generation is static analysis — it reads source files and descriptions, it does not execute code or produce runtime traces.
- Sequence diagrams are limited to the call depth visible in source; async callbacks and event-driven flows may require a supplementary description from the engineer.
- The skill generates Mermaid by default; switch to PlantUML by specifying it explicitly. PlantUML requires a local `plantuml.jar` or a PlantUML server — no rendering happens in the skill itself.
- Class diagrams include only explicitly declared fields and methods — dynamic properties (Python `__setattr__`, JavaScript Proxy) are not captured.
- For large component diagrams (> 15 components), the skill generates multiple focused diagrams (by layer or domain) rather than one unreadable megadiagram.
