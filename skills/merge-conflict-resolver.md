# Skill: merge-conflict-resolver

---
name: merge-conflict-resolver
description: Structured merge conflict resolution that reads both sides of every conflict marker, reconstructs the intent behind each change, and proposes a resolution with a written rationale — not just a mechanical pick-one-side. Works with Git conflict markers (<<<<<<<//>>>>>>) in any language. Flags conflicts that require product-level context decisions and cannot be resolved mechanically.
---

# Merge Conflict Resolver

Turn conflict markers into understood, intentional resolutions by analysing what each side was trying to accomplish before touching a single line of code.

## When to Use

- A merge or rebase left conflict markers in one or more files
- You are unsure which side's change should win, or whether the correct resolution is a blend
- A batch of files conflict after a long-running feature branch is rebased onto main
- You want a written record of why each conflict was resolved the way it was (audit trail)

## Process

1. **Enumerate all conflict sites** — list every file with markers:

   ```bash
   git diff --name-only --diff-filter=U
   ```

   Read each file in full. Note the surrounding context (function body, class, config block) around every `<<<<<<< HEAD` / `=======` / `>>>>>>> branch-name` triplet.

2. **Reconstruct each side's intent** — for each conflict block:
   - **Ours (HEAD):** what was the HEAD change trying to accomplish? Check `git log --oneline HEAD~5..HEAD -- <file>` for nearby commit messages.
   - **Theirs (incoming):** same for the merge/rebase source branch — `git log --oneline MERGE_HEAD~5..MERGE_HEAD -- <file>` or the equivalent rebase ref.
   - Label each side's purpose in plain language before proposing anything.

3. **Classify the conflict** — assign one of four categories:
   - **Disjoint** — both sides edited different lines of the same hunk; blend both by including both changes in their logical order.
   - **Overlapping compatible** — both sides changed the same lines toward the same goal; one version is a superset of the other; keep the superset.
   - **Overlapping incompatible** — both sides changed the same lines toward different goals; pick the side aligned with the current sprint/feature intent, or draft a combined solution.
   - **Requires product decision** — the conflict reflects a genuine design disagreement (e.g. different API contracts, different security models); flag for human review and do not resolve mechanically.

4. **Draft the resolution** — write the resolved block outside the conflict markers. Explain the rationale in a one-line comment above the resolution site (remove the comment later if it adds noise).

5. **Verify syntax and semantics** — after resolving all markers in a file:

   ```bash
   # Remove leftover markers (should be zero)
   grep -n "^<<<<<<\|^=======\|^>>>>>>>" <file>

   # Run the language-appropriate quick-check
   node --check <file>          # JS/TS syntax
   python -m py_compile <file>  # Python
   cargo check 2>&1 | head -20  # Rust
   ```

6. **Stage and summarise** — once all files resolve cleanly:

   ```bash
   git add <resolved-files>
   git status   # confirm no remaining conflict markers
   ```

   Produce a per-conflict summary (see Output Format) to include in the merge/rebase commit message or PR description.

## Output Format

```
## Conflict Resolution Summary — <branch> → <target>

### src/auth/middleware.ts (2 conflicts)

**Conflict 1** — lines 42–57
  HEAD:    rate-limit check applied before authentication
  Theirs:  rate-limit check moved to post-authentication (avoids unauthenticated cost)
  Class:   Overlapping incompatible
  Resolution: kept Theirs — aligns with ADR-018 decision to gate unauthenticated traffic
              at the load-balancer level, not at middleware cost.

**Conflict 2** — lines 88–91
  HEAD:    added `X-Request-ID` header injection
  Theirs:  added `X-Correlation-ID` header injection (different name, same purpose)
  Class:   Disjoint (functionally equivalent, different names)
  Resolution: kept both headers to preserve backward compatibility;
              filed tech-debt note to unify naming in a follow-up PR.

### config/database.yml (1 conflict)
  ⚠ REQUIRES PRODUCT DECISION — both sides set `pool_size` to different values
    (HEAD: 20 for staging, Theirs: 50 for production load). Leaving marked.
```

## Constraints

- Does not automatically apply resolutions; it produces proposals that the developer reviews and applies manually.
- Flags "Requires product decision" conflicts rather than guessing; forcing a resolution on design disagreements creates silent correctness bugs.
- Does not rewrite commit history — the resolution goes into a merge commit or continuation of the rebase.
- Works with Git standard markers only; custom diff3 format (`git config merge.conflictstyle diff3`) adds a base section that this skill reads but many tools strip.
- Large binary file conflicts (images, compiled artefacts) cannot be resolved by this skill — always take one side for binaries.
