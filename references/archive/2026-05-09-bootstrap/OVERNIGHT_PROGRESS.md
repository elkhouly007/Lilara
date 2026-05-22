# Overnight Progress Log

Append-only. One line per checkpoint.

- 2026-05-08 00:30 — Autonomous run started. Beginning bench diagnostic (5× master, 5× A5).
- 2026-05-08 00:35 — Bench diagnostic complete. Master p99 53.8–66.9ms (median 55ms); A5 p99 53.5–54.8ms. All 10 runs green. Earlier 102ms was machine load noise. Filed D31. Proceeding to merges.

# Run 2 — 2026-05-08

- 2026-05-08 — Wave 2 prep autonomous run started. 4 tracks: B3 (accept gate), E2 (wiring docs), B1 (payload research), D27-D30+bench.
- 2026-05-08 — Track 1 complete: B3 accept-gate hardening. PR #14 opened. module.exports updated, operator-token CLI added, 6 inline tests, CONTRACT.md §Operator Token Flow, D32, CHANGELOG breaking change. All 7 CI gates pass.
- 2026-05-08 — Track 2 complete: E2 wiring docs parity. PR #15 opened. openclaw fixture count corrected (12→19); codex/clawcode/antegravity gain Scope/Fixtures/PostToolUse/Target Paths/Wiring Model/Approval Mapping/DoD sections. Corrected premature post-adapter claims (A3 pending PR #13).
- 2026-05-08 — Track 3 complete: B1 payload research. PR #16 opened. codex/clawcode/antegravity POSTTOOL_RESEARCH.md created with 3 shape hypotheses each, verification procedure, open unknowns.
- 2026-05-08 — Track 4a+4b complete: D33-D36 filed (renumbered from D27-D30 to avoid conflict with A5's D27-D30 A4-smells) + D31 bench empirical update. PR #17 opened. Bench 5-run spread=14.4% (below 30%) → accepted noise. OVERNIGHT_REPORT_2.md written. Stopping.

# Run 3 — 2026-05-08

- 2026-05-08 — B2 Phase 1 (v2 wire-up) autonomous run started. 4 commits planned: validity, contextTrust, scopes.tools.perToolAllow, docs+example.
- 2026-05-08 — Run 3 baseline p99=63.0ms (D31 reference 61.2ms, cap 1.5x = 91.8ms).
- 2026-05-08 — Commit 1 complete: validity-window floor (F11). 3 fixtures pass (237 total). Bench p99=56.2ms. 7 gates green.
- 2026-05-08 — Commit 2 complete: contextTrust per-branch posture override. 3 fixtures pass (240 total). Bench p99=55.2ms. 7 gates green.
- 2026-05-08 — Commit 3 complete: scopes.tools.perToolAllow per-tool allowlist. 3 fixtures pass (243 total). Bench p99=56.0ms. 7 gates green.
- 2026-05-08 — Commit 4 complete: CONTRACT.md v2 sections + horus.contract.v2.json.example + G7 PARTIAL + integration fixture. 244 fixtures pass. Bench p99=60.6ms. 7 gates green.
- 2026-05-08 — B2 Phase 1 complete. PR #19 opened. 4 commits, 10 fixtures, 7 gates green per commit. Cumulative p99=60.6ms (baseline 63.0ms). OVERNIGHT_REPORT_3.md written. Stopping.

# Run 4 — 2026-05-08

- 2026-05-08 — B2 Phase 2 (v3 schema + migration) autonomous run started. Branch: feat/b2-v3-schema-migration from master 72f83af. 4 commits planned: scopes.mcp/skills (F12/F13), scopes.budget/session (F14), migration script, docs+integration.
- 2026-05-08 — Run 4 baseline p99=54.6ms (5-run median; D31 reference 61.2ms, cap 1.5x = 81.9ms).
- 2026-05-08 — Commit 1 complete: scopes.mcp + scopes.skills (F12, F13). 6 fixtures pass. Bench p99=57.8ms. 7 gates green.
- 2026-05-08 — Commit 2 complete: scopes.session.maxDurationMin + scopes.budget (F14/F14b). NEW runtime/session-budget.js. 3 fixtures (budget:destructive-block, budget:bytes-block, session:over-duration-require-review). 243 fixtures pass. Bench p99=55.7ms. 7 gates green.
- 2026-05-08 — Commit 3 complete: v2→v3 migration script + CI gate + v3 example. NEW scripts/migrateV2ToV3.js, scripts/check-migrate-v2-v3.sh, horus.contract.v3.json.example. Registered in check.yml. 2 migration fixtures. 245 fixtures pass. Bench p99=56.0ms. 8 gates green.
- 2026-05-08 — Commit 4 complete: CONTRACT.md v3 sections + G7 COVERED + OWASP updates + integration fixture. 246 fixtures pass. Bench p99=57.2ms. 8 gates green.
- 2026-05-08 — B2 Phase 2 complete. PR #20 opened. 4 commits, 13 new fixtures (246 total), 8 gates green per commit. Cumulative p99=57.2ms (D31 baseline 61.2ms, cap 91.8ms). OVERNIGHT_REPORT_4.md written. Stopping.

# Run 5 — Wave-2 cleanup autonomous session (2026-05-08)

- 2026-05-08 — Wave-2 cleanup run started. Branch: feat/wave2-cleanup off master 72f83af. Plan approved with 3 corrections (F4 class-C def, EXTERNAL_TOOLS union, F6 locked semantic). 8 commits target.
- 2026-05-08 — Commit 1 done: doc-drift (D25 F3 threshold, F10 ladder row, gitignore overnight reports). All 7 CI gates green.
- 2026-05-08 — Commit 2 done: operator-token hardening (D43 drop rename-fallback, D44 O_EXCL lock, D45 list/revoke). 3 fixtures added.
- 2026-05-08 — Commit 3 done: F10 taint tool-class filter (D37). Read/Grep/Glob/LS/NotebookRead exempt from F10. 2 fixtures.
- 2026-05-08 — Commit 4 done: createPostAdapter factory (D38, D39). All 6 harnesses refactored. Parity script updated with 5th assertion. Byte-identical output confirmed.
- 2026-05-08 — Commit 5 done: secret-scan.redact() with per-pattern slugified labels (D27, D28, D29). jredact fixture updated to assert [REDACTED:openai-api-key] format.
- 2026-05-08 — Commit 6 done: rate-limit tmp+rename atomic write (D41). Stale-lock threshold comment added (D42).
- 2026-05-08 — Commit 7 done: F4/F6/F7 engine-baked floors (D26, D40). floorFired added to decide() return. 6 floor fixtures (3 pos + 3 neg). 246/246 pass. Replay: 0 divergences.
- 2026-05-08 — Commit 8 done: D30 fixture pattern locked; E2E integration test added (PreToolUse→PostToolUse→journal cycle). 247/247 pass.
- 2026-05-08 — Final CI gates: fixtures 247/0, parity OK, replay 0 divergences, config-validator OK, horus-cli status OK. Hash stable. Bench feat 40.4ms avg vs master 55ms median (0.73× — within 1.5× constraint). D25-D30+D37-D45 all closed. Pushing PR. OVERNIGHT_REPORT_5.md written.
