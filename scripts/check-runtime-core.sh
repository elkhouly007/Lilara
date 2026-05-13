#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

pass() { printf '  ok      %s\n' "$1"; }
fail() { printf '  ERROR   %s\n' "$1" >&2; exit 1; }

printf '[check-runtime-core]\n'

[ -f "$root/runtime/decision-engine.js" ] || fail 'runtime decision engine missing'
[ -f "$root/runtime/risk-score.js" ] || fail 'runtime risk score missing'
[ -f "$root/runtime/decision-journal.js" ] || fail 'runtime decision journal missing'
[ -f "$root/runtime/policy-store.js" ] || fail 'runtime policy store missing'
[ -f "$root/runtime/session-context.js" ] || fail 'runtime session context missing'
[ -f "$root/runtime/project-policy.js" ] || fail 'runtime project policy missing'
[ -f "$root/runtime/context-discovery.js" ] || fail 'runtime context discovery missing'
[ -f "$root/runtime/action-planner.js" ] || fail 'runtime action planner missing'
[ -f "$root/runtime/promotion-guidance.js" ] || fail 'runtime promotion guidance missing'
[ -f "$root/runtime/workflow-router.js" ] || fail 'runtime workflow router missing'
pass 'runtime core files present'

tmp_home="$(mktemp -d)"
cleanup() { rm -rf "$tmp_home"; }
trap cleanup EXIT

HOME="$tmp_home" HORUS_STATE_DIR="$tmp_home" node - <<'NODE' "$root" || exit 1
const path = require('path');
const root = process.argv[2];
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

// On Windows, bash provides POSIX paths (e.g. /tmp/xxx) that Node.js path.resolve()
// converts to Windows paths (e.g. C:\tmp\xxx) — a different location than the bash
// temp dir. Override HORUS_STATE_DIR and HOME with Node.js os.tmpdir() paths so all
// file I/O uses a valid, writable, platform-native location.
//
// Additionally, os.tmpdir() on Windows can return an 8.3 short path
// (e.g. C:\Users\RUNNER~1\AppData\Local\Temp on GitHub Actions) while git
// returns the canonical long path. Resolve to canonical form so that path
// comparisons in discover-git-repo tests don't fail due to short/long mismatch.
const _testStateDirRaw = path.join(os.tmpdir(), 'ecc-runtime-test-' + process.pid);
fs.mkdirSync(_testStateDirRaw, { recursive: true, mode: 0o700 });
// realpathSync.native calls GetFinalPathNameByHandleW on Windows which resolves 8.3 short
// names (e.g. RUNNER~1 → runneradmin); plain realpathSync only resolves symlinks/./../
const _realpathFn = typeof fs.realpathSync.native === 'function' ? fs.realpathSync.native : fs.realpathSync;
const _testStateDir = (function() { try { return _realpathFn(_testStateDirRaw); } catch { return _testStateDirRaw; } })();
process.env.HORUS_STATE_DIR = _testStateDir;
process.env.HOME = _testStateDir;
process.env.HORUS_DECISION_JOURNAL = '0'; // suppress journal file writes during tests
const { score } = require(path.join(root, 'runtime/risk-score.js'));
const { decide } = require(path.join(root, 'runtime/decision-engine.js'));
const { build: buildEnvelope, verify: verifyEnvelope } = require(path.join(root, 'runtime/envelope.js'));
const { discover } = require(path.join(root, 'runtime/context-discovery.js'));
const { recordApproval, setLearnedAllow, isLearnedAllowed, listSuggestions, acceptSuggestion, summarizePolicy, decisionKey, getSuggestion, grantAutoAllowOnce, hasAutoAllowOnce, getSuggestionForInput } = require(path.join(root, 'runtime/policy-store.js'));
const { fineKey: computeFineKey } = require(path.join(root, 'runtime/decision-key.js'));
const { getSessionRisk, saveState } = require(path.join(root, 'runtime/session-context.js'));

// Diagnostic helper: writes current test step to stderr before each block.
// When a test fails, the last [step] line in CI output identifies the failing test.
function step(name) { process.stderr.write(`[step] ${name}\n`); }

step('risk-score-low');
const low = score({ command: 'npm test', targetPath: 'src/app.ts' });
if (low.level !== 'low') throw new Error(`expected low, got ${low.level}`);

step('risk-score-high');
const forcedPush = ['git', 'push', '--force', 'origin', 'main'].join(' ');
const high = score({ command: forcedPush, targetPath: 'prod/config.yml', protectedBranch: true });
if (!(high.score >= 8)) throw new Error(`expected high score >=8, got ${high.score}`);

step('decide-block-critical');
const destructive = ['rm', '-rf', '/'].join(' ');
const blocked = decide({ command: destructive, targetPath: '/', tool: 'Bash', branch: 'main', notes: 'runtime-core-check' });
if (blocked.action !== 'block') throw new Error(`expected block, got ${blocked.action}`);
if (blocked.riskLevel !== 'critical') throw new Error(`expected critical, got ${blocked.riskLevel}`);

step('decide-medium-route');
const mediumInput = { command: ['sudo', 'systemctl', 'restart', 'app'].join(' '), targetPath: 'ops/service', tool: 'Bash', sessionRisk: 0 };
const routed = decide(mediumInput);
if (routed.action !== 'route') throw new Error(`expected route, got ${routed.action}`);

step('policy-approve-and-learn');
recordApproval(mediumInput);
recordApproval(mediumInput);
recordApproval(mediumInput);
const suggestions = listSuggestions();
if (suggestions.length < 1) throw new Error('expected at least one pending suggestion');
if (!acceptSuggestion(suggestions[0].key)) throw new Error('expected suggestion acceptance to succeed');
setLearnedAllow(mediumInput, true);
// B2: learned-allow is narrowed to destructive-delete-pattern at high risk only.
// Medium-risk commands (sudo) stay 'route' even with a learned allow set.
const learnedMedium = decide(mediumInput);
if (learnedMedium.action !== 'route') throw new Error(`expected route for medium-risk with learned-allow (B2 narrowed), got ${learnedMedium.action}`);
const summary = summarizePolicy();
if (summary.learnedAllowCount < 1) throw new Error('expected learned allow count >= 1');

step('learned-allow-destructive-delete');
// Verify the valid learned-allow demotion path: high-risk destructive-delete +
// explicit learned allow + no floor → action: "allow", source: "learned-allow".
// projectRoot + absolute targetPath ensure fineKey is identical in setLearnedAllow and
// inside decide() (which enriches via discover() and would otherwise find a different root).
const destructiveInput = { command: 'rm -rf dist/old', targetPath: path.join(root, 'dist', 'old'), tool: 'Bash', sessionRisk: 0, branch: 'feature/build-cleanup', protectedBranches: [], projectRoot: root, repeatedApprovals: 0 };
recordApproval(destructiveInput);
recordApproval(destructiveInput);
recordApproval(destructiveInput);
const destSuggestions = listSuggestions();
if (destSuggestions.length < 1) throw new Error('expected suggestion for destructive input');
if (!acceptSuggestion(destSuggestions[0].key)) throw new Error('expected destructive suggestion acceptance to succeed');
setLearnedAllow(destructiveInput, true);
const learnedDestructive = decide(destructiveInput);
if (learnedDestructive.action !== 'allow') throw new Error(`expected allow for destructive-delete with learned-allow, got ${learnedDestructive.action}`);
if (learnedDestructive.decisionSource !== 'learned-allow') throw new Error(`expected learned-allow source, got ${learnedDestructive.decisionSource}`);

step('session-risk-buildup');
const destructive2 = decide({ command: ['rm', '-rf', '/tmp/cache'].join(' '), targetPath: '/tmp/cache', tool: 'Bash' });
const destructive3 = decide({ command: ['rm', '-rf', '/tmp/build'].join(' '), targetPath: '/tmp/build', tool: 'Bash' });
if (!['require-tests', 'escalate', 'block', 'allow'].includes(destructive2.action)) throw new Error(`unexpected action ${destructive2.action}`);
if (!['require-tests', 'escalate', 'block', 'allow'].includes(destructive3.action)) throw new Error(`unexpected action ${destructive3.action}`);
if (getSessionRisk() < 1) throw new Error('expected session risk to increase after repeated risky actions');

step('discover-git-repo');
// Clear accumulated trajectory from prior test steps so the protected-branch assertion
// runs without trajectory-nudge interference (3 blocks accumulate above).
saveState({ sessions: {}, recent: [], updatedAt: null });
const repo = path.resolve(process.env.HOME, 'sample-repo');
fs.mkdirSync(repo, { recursive: true });
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['checkout', '-b', 'release'], { cwd: repo, stdio: 'ignore' });
fs.writeFileSync(path.join(repo, 'horus.config.json'), JSON.stringify({ runtime: { protected_branches: ['release'], trust_posture: 'balanced' } }, null, 2));
const discovered = discover({ targetPath: path.join(repo, 'src') });
// Normalize path separators and resolve 8.3 short names (realpathSync.native) before comparing.
// Git always returns the canonical long path; os.tmpdir() on GitHub Actions Windows runner
// can return a short path (RUNNER~1) even after mkdir, so canonicalize both sides.
let _repoCanon = repo; try { _repoCanon = _realpathFn(repo); } catch {}
let _discCanon = discovered.projectRoot; try { _discCanon = _realpathFn(discovered.projectRoot); } catch {}
const normDiscovered = path.normalize(_discCanon).replace(/\\/g, '/').toLowerCase();
const normRepo = path.normalize(_repoCanon).replace(/\\/g, '/').toLowerCase();
if (normDiscovered !== normRepo) throw new Error(`expected projectRoot ${repo}, got ${discovered.projectRoot}`);
if (discovered.branch !== 'release') throw new Error(`expected discovered branch release, got ${discovered.branch}`);
const protectedDecision = decide({ command: ['sudo', 'systemctl', 'restart', 'api'].join(' '), targetPath: path.join(repo, 'src'), tool: 'Bash', projectRoot: repo, sessionRisk: 0 });
if (protectedDecision.action !== 'require-review') throw new Error(`expected require-review, got ${protectedDecision.action}`);
if (protectedDecision.enforcementAction !== 'block') throw new Error(`expected enforcement block, got ${protectedDecision.enforcementAction}`);
if (protectedDecision.actionPlan.reviewType !== 'protected-branch-review') throw new Error(`expected protected-branch-review, got ${protectedDecision.actionPlan.reviewType}`);
if (!protectedDecision.explanation.includes('trust=balanced')) throw new Error('expected balanced trust explanation');

step('decide-require-tests');
const testsDecision = decide({ command: ['rm', '-rf', '/tmp/cache'].join(' '), targetPath: '/tmp/cache', tool: 'Bash', sessionRisk: 0, repeatedApprovals: 0 });
if (testsDecision.action !== 'require-tests') throw new Error(`expected require-tests, got ${testsDecision.action}`);
if (!Array.isArray(testsDecision.actionPlan.commands) || testsDecision.actionPlan.commands.length < 1) throw new Error('expected test commands in action plan');

step('decide-stack-aware-tests');
const testsShapeRepo = path.resolve(process.env.HOME, 'tests-shape-repo');
fs.mkdirSync(testsShapeRepo, { recursive: true });
execFileSync('git', ['init'], { cwd: testsShapeRepo, stdio: 'ignore' });
execFileSync('git', ['checkout', '-b', 'feature/tests'], { cwd: testsShapeRepo, stdio: 'ignore' });
fs.writeFileSync(path.join(testsShapeRepo, 'package.json'), '{"name":"tests-shape-repo"}\n');
const stackAwareTestsDecision = decide({ command: ['rm', '-rf', '/tmp/cache'].join(' '), targetPath: path.join(testsShapeRepo, 'build'), tool: 'Bash', sessionRisk: 0, repeatedApprovals: 0, projectRoot: testsShapeRepo });
if (stackAwareTestsDecision.action !== 'require-tests') throw new Error(`expected stack-aware require-tests, got ${stackAwareTestsDecision.action}`);
if (stackAwareTestsDecision.actionPlan.commands.join(' | ') !== 'npm test | npm run lint') throw new Error(`expected stack-aware test commands, got ${stackAwareTestsDecision.actionPlan.commands.join(' | ')}`);

step('adaptive-tests-decision');
// Use explicit projectRoot + absolute targetPath inside root so fineKey is identical in
// recordApproval (no discover) and decide() (enriched via discover). /tmp/cache paths
// produce discover.projectRoot=/tmp which diverges from recordApproval's default-target bucket.
const _adaptiveKey = { command: 'rm -rf dist/cache', targetPath: path.join(root, 'dist', 'cache'), tool: 'Bash', branch: 'feature/cleanup', protectedBranches: [], projectRoot: root };
recordApproval(_adaptiveKey);
recordApproval(_adaptiveKey);
recordApproval(_adaptiveKey);
const adaptiveTestsDecision = decide({ ..._adaptiveKey, sessionRisk: 0 });
if (!adaptiveTestsDecision.actionPlan.summary.includes('consider')) throw new Error('expected adaptive require-tests summary');
if (adaptiveTestsDecision.workflowRoute?.lane !== 'verification') throw new Error(`expected verification lane, got ${adaptiveTestsDecision.workflowRoute?.lane}`);
if (adaptiveTestsDecision.workflowRoute?.suggestedTarget !== 'horus-cli.check') throw new Error(`expected verification target horus-cli.check, got ${adaptiveTestsDecision.workflowRoute?.suggestedTarget}`);

step('workflow-routing');
// Reset trajectory state so escalations from prior steps (decide-require-tests,
// adaptive-tests-decision, etc.) do not trip trajectory-nudge upgrades during
// workflow-routing assertions. Required after ADR-001 Option D where F7 routes
// intent-unknown-strict cases to require-review (which trajectory-nudge can
// further upgrade to escalate without this reset).
saveState({ sessions: {}, recent: [], updatedAt: null });
const lowRoute = decide({ command: 'npm test', targetPath: 'web/app.ts', tool: 'Bash', sessionRisk: 0 });
if (lowRoute.workflowRoute?.lane !== 'checks') throw new Error(`expected checks lane, got ${lowRoute.workflowRoute?.lane}`);
if (lowRoute.workflowRoute?.suggestedTarget !== 'horus-cli.check') throw new Error(`expected checks target horus-cli.check, got ${lowRoute.workflowRoute?.suggestedTarget}`);

const sourceRoute = decide({ command: 'update module', targetPath: 'src/runtime/app.ts', tool: 'Bash', sessionRisk: 0 });
if (sourceRoute.workflowRoute?.lane !== 'checks') throw new Error(`expected source route checks lane, got ${sourceRoute.workflowRoute?.lane}`);
if (sourceRoute.workflowRoute?.suggestedTarget !== 'horus-cli.check') throw new Error(`expected source route target horus-cli.check, got ${sourceRoute.workflowRoute?.suggestedTarget}`);

const sourceShapeRepo = path.resolve(process.env.HOME, 'source-shape-repo');
fs.mkdirSync(path.join(sourceShapeRepo, 'src'), { recursive: true });
execFileSync('git', ['init'], { cwd: sourceShapeRepo, stdio: 'ignore' });
execFileSync('git', ['checkout', '-b', 'feature/runtime'], { cwd: sourceShapeRepo, stdio: 'ignore' });
fs.writeFileSync(path.join(sourceShapeRepo, 'package.json'), '{"name":"source-shape-repo"}\n');
const sourceShapeRoute = decide({ command: 'update module', targetPath: path.join(sourceShapeRepo, 'src/app.ts'), tool: 'Bash', sessionRisk: 0, projectRoot: sourceShapeRepo });
if (sourceShapeRoute.workflowRoute?.lane !== 'checks') throw new Error(`expected source-shape route checks lane, got ${sourceShapeRoute.workflowRoute?.lane}`);
if (!String(sourceShapeRoute.workflowRoute?.reason || '').includes('node project')) throw new Error('expected stack-aware source route reason');
if (sourceShapeRoute.workflowRoute?.suggestedCommand !== 'horus-cli.sh check && npm test') throw new Error(`expected stack-aware source route command, got ${sourceShapeRoute.workflowRoute?.suggestedCommand}`);

const sourceEditRoute = decide({ command: 'edit module', targetPath: 'src/runtime/app.ts', tool: 'Edit', sessionRisk: 0 });
if (sourceEditRoute.workflowRoute?.lane !== 'checks') throw new Error(`expected source edit checks lane, got ${sourceEditRoute.workflowRoute?.lane}`);
if (!String(sourceEditRoute.workflowRoute?.reason || '').includes('direct edits')) throw new Error('expected tool-aware source edit reason');

const strictSourceRoute = decide({ command: 'update module', targetPath: 'src/runtime/app.ts', tool: 'Bash', sessionRisk: 0, trustPosture: 'strict' });
if (strictSourceRoute.workflowRoute?.lane !== 'review') throw new Error(`expected strict source route review lane, got ${strictSourceRoute.workflowRoute?.lane}`);
if (strictSourceRoute.workflowRoute?.suggestedTarget !== 'horus-cli.review') throw new Error(`expected strict source route target horus-cli.review, got ${strictSourceRoute.workflowRoute?.suggestedTarget}`);

const protectedSourceRoute = decide({ command: 'update module', targetPath: 'src/runtime/app.ts', tool: 'Bash', sessionRisk: 0, branch: 'release', protectedBranches: ['release'] });
if (protectedSourceRoute.workflowRoute?.lane !== 'review') throw new Error(`expected protected source route review lane, got ${protectedSourceRoute.workflowRoute?.lane}`);
if (!String(protectedSourceRoute.workflowRoute?.reason || '').includes('protected branch release')) throw new Error('expected protected branch source reason');

const strictSourceEditRoute = decide({ command: 'edit module', targetPath: 'src/runtime/app.ts', tool: 'Edit', sessionRisk: 0, trustPosture: 'strict' });
if (strictSourceEditRoute.workflowRoute?.lane !== 'review') throw new Error(`expected strict source edit review lane, got ${strictSourceEditRoute.workflowRoute?.lane}`);
if (!String(strictSourceEditRoute.workflowRoute?.reason || '').includes('direct code edits')) throw new Error('expected tool-aware strict source edit reason');

const protectedSourceEditRoute = decide({ command: 'edit module', targetPath: 'src/runtime/app.ts', tool: 'Edit', sessionRisk: 0, branch: 'release', protectedBranches: ['release'] });
if (protectedSourceEditRoute.workflowRoute?.lane !== 'review') throw new Error(`expected protected source edit review lane, got ${protectedSourceEditRoute.workflowRoute?.lane}`);
if (!String(protectedSourceEditRoute.workflowRoute?.reason || '').includes('direct edits should route through review first')) throw new Error('expected protected branch source edit reason');

const docsRoute = decide({ command: 'update docs', targetPath: 'docs/runtime-notes.md', tool: 'Bash', sessionRisk: 0 });
if (docsRoute.workflowRoute?.lane !== 'direct') throw new Error(`expected docs route direct lane, got ${docsRoute.workflowRoute?.lane}`);

const setupRoute = decide({ command: 'setup profile full', targetPath: 'horus.config.json', tool: 'Bash', sessionRisk: 0 });
if (setupRoute.workflowRoute?.lane !== 'setup') throw new Error(`expected setup lane, got ${setupRoute.workflowRoute?.lane}`);
if (setupRoute.workflowRoute?.suggestedTarget !== 'horus-cli.setup') throw new Error(`expected setup target horus-cli.setup, got ${setupRoute.workflowRoute?.suggestedTarget}`);

step('setup-shape-route');
const shapeRepo = path.resolve(process.env.HOME, 'shape-repo');
fs.mkdirSync(shapeRepo, { recursive: true });
execFileSync('git', ['init'], { cwd: shapeRepo, stdio: 'ignore' });
execFileSync('git', ['checkout', '-b', 'feature/setup'], { cwd: shapeRepo, stdio: 'ignore' });
fs.writeFileSync(path.join(shapeRepo, 'package.json'), '{"name":"shape-repo"}\n');
const setupShapeRoute = decide({ command: 'setup project', targetPath: shapeRepo, tool: 'Bash', sessionRisk: 0, projectRoot: shapeRepo });
if (setupShapeRoute.workflowRoute?.lane !== 'setup') throw new Error(`expected setup shape lane, got ${setupShapeRoute.workflowRoute?.lane}`);
if (setupShapeRoute.workflowRoute?.suggestedTarget !== 'horus-cli.generate-config') throw new Error(`expected setup shape target horus-cli.generate-config, got ${setupShapeRoute.workflowRoute?.suggestedTarget}`);
if (!String(setupShapeRoute.workflowRoute?.reason || '').includes('looks like node')) throw new Error('expected project-shape setup reason');
if (!String(setupShapeRoute.workflowRoute?.suggestedCommand || '').includes('generate-config.sh')) throw new Error('expected generate-config setup command');
if (!String(setupShapeRoute.explanation || '').includes('stack=node')) throw new Error('expected project-shape stack in explanation');
if (!String(setupShapeRoute.explanation || '').includes('config=missing')) throw new Error('expected missing-config explanation flag');

// ADR-009 PR-B: writes into `.claude/settings.json` classify as `mcpConfig`
// (auto-loaded on next agent start) and trigger F16 even when project-local —
// `mcpConfig` is not on F16's project-local exception list. Operators editing
// the Claude Code hooks config must opt in via
// `scopes.ambient.allow[{class:"mcpConfig"}]`. To preserve the workflow
// router test (which is what this section asserts), point at a wiring-routed
// path that doesn't classify as ambient: `claude/hooks/settings-edit.json`
// still matches the router's `hook|hooks\.json|settings\.json` regex but
// lives under `claude/` (no leading dot) so the ambient classifier skips it.
const wiringEditRoute = decide({ command: '', targetPath: 'claude/hooks/settings-edit.json', tool: 'Edit', sessionRisk: 0, branch: 'feature/hooks' });
if (wiringEditRoute.workflowRoute?.lane !== 'wiring') throw new Error(`expected wiring edit lane, got ${wiringEditRoute.workflowRoute?.lane}`);
if (wiringEditRoute.workflowRoute?.suggestedTarget !== 'horus-cli.wire') throw new Error(`expected wiring edit target horus-cli.wire, got ${wiringEditRoute.workflowRoute?.suggestedTarget}`);
if (!String(wiringEditRoute.workflowRoute?.reason || '').includes('direct hook or settings editing')) throw new Error('expected tool-aware wiring reason');

const strictWiringEditRoute = decide({ command: 'edit settings', targetPath: 'claude/hooks/settings-edit.json', tool: 'Edit', sessionRisk: 0, trustPosture: 'strict' });
if (strictWiringEditRoute.workflowRoute?.lane !== 'review') throw new Error(`expected strict wiring edit review lane, got ${strictWiringEditRoute.workflowRoute?.lane}`);
if (strictWiringEditRoute.workflowRoute?.suggestedTarget !== 'horus-cli.review') throw new Error(`expected strict wiring edit target horus-cli.review, got ${strictWiringEditRoute.workflowRoute?.suggestedTarget}`);

const protectedWiringEditRoute = decide({ command: 'edit settings', targetPath: 'claude/hooks/settings-edit.json', tool: 'Edit', sessionRisk: 0, branch: 'release', protectedBranches: ['release'] });
if (protectedWiringEditRoute.workflowRoute?.lane !== 'review') throw new Error(`expected protected wiring edit review lane, got ${protectedWiringEditRoute.workflowRoute?.lane}`);
if (!String(protectedWiringEditRoute.workflowRoute?.reason || '').includes('protected branch release')) throw new Error('expected protected wiring review reason');

const payloadRoute = decide({ command: 'redact payload.json', targetPath: 'payload.json', tool: 'Bash', sessionRisk: 0 });
if (payloadRoute.workflowRoute?.lane !== 'payload') throw new Error(`expected payload lane, got ${payloadRoute.workflowRoute?.lane}`);
if (payloadRoute.workflowRoute?.suggestedTarget !== 'horus-cli.redact') throw new Error(`expected payload target horus-cli.redact, got ${payloadRoute.workflowRoute?.suggestedTarget}`);

const classBRoute = decide({ command: 'open customer export', targetPath: 'exports/customer.csv', tool: 'Bash', sessionRisk: 0, payloadClass: 'B' });
if (classBRoute.workflowRoute?.lane !== 'payload') throw new Error(`expected class B payload lane, got ${classBRoute.workflowRoute?.lane}`);
if (classBRoute.workflowRoute?.suggestedTarget !== 'horus-cli.review') throw new Error(`expected class B payload target horus-cli.review, got ${classBRoute.workflowRoute?.suggestedTarget}`);

// ADR-002 Option B: class C blocks by default (F4 floor). Operator demotes to
// require-review by minting a one-shot scoped token for legitimate inspection
// (incident response, customer-data audit). Test the demotion path here so the
// review-lane assertion remains meaningful after F4's stricter default.
const { mintOperatorToken: _mintCRoute } = require(path.join(root, 'runtime/contract.js'));
const _classCDemoteToken = _mintCRoute('test-class-c-route', 'class-c-review-demote');
process.env.HORUS_F4_DEMOTE_TOKEN = _classCDemoteToken;
const classCRoute = decide({ command: 'inspect incident bundle', targetPath: 'bundle.zip', tool: 'Bash', sessionRisk: 0, payloadClass: 'C', branch: 'feature/incidents' });
delete process.env.HORUS_F4_DEMOTE_TOKEN;
if (classCRoute.workflowRoute?.lane !== 'review') throw new Error(`expected class C review lane (with demote token), got ${classCRoute.workflowRoute?.lane}`);
if (classCRoute.workflowRoute?.suggestedTarget !== 'horus-cli.review') throw new Error(`expected class C review target horus-cli.review, got ${classCRoute.workflowRoute?.suggestedTarget}`);

// ADR-002 Option B negative: class C without operator token stays blocked.
const classCBlockedRoute = decide({ command: 'inspect incident bundle', targetPath: 'bundle.zip', tool: 'Bash', sessionRisk: 0, payloadClass: 'C', branch: 'feature/incidents' });
if (classCBlockedRoute.workflowRoute?.lane !== 'blocked') throw new Error(`expected class C blocked lane (without demote token), got ${classCBlockedRoute.workflowRoute?.lane}`);
if (classCBlockedRoute.floorFired !== 'secret-class-C') throw new Error(`expected class C secret-class-C floor, got ${classCBlockedRoute.floorFired}`);

const classifyRoute = decide({ command: 'classify inbound.txt', targetPath: 'payload.txt', tool: 'Bash', sessionRisk: 0 });
if (classifyRoute.workflowRoute?.suggestedTarget !== 'horus-cli.classify') throw new Error(`expected classify target horus-cli.classify, got ${classifyRoute.workflowRoute?.suggestedTarget}`);

const payloadReviewRoute = decide({ command: 'review payload.json', targetPath: 'payload.json', tool: 'Bash', sessionRisk: 0 });
if (payloadReviewRoute.workflowRoute?.lane !== 'payload') throw new Error(`expected payload review lane, got ${payloadReviewRoute.workflowRoute?.lane}`);
if (payloadReviewRoute.workflowRoute?.suggestedTarget !== 'horus-cli.review') throw new Error(`expected payload review target horus-cli.review, got ${payloadReviewRoute.workflowRoute?.suggestedTarget}`);
if (payloadReviewRoute.workflowRoute?.suggestedCommand !== 'horus-cli.sh review <file>') throw new Error(`expected payload review command, got ${payloadReviewRoute.workflowRoute?.suggestedCommand}`);

const reviewRoute = decide({ command: 'security review auth diff', targetPath: 'changes.patch', tool: 'Bash', sessionRisk: 0 });
if (reviewRoute.workflowRoute?.lane !== 'review') throw new Error(`expected review lane, got ${reviewRoute.workflowRoute?.lane}`);
if (reviewRoute.workflowRoute?.suggestedTarget !== 'horus-cli.review') throw new Error(`expected review target horus-cli.review, got ${reviewRoute.workflowRoute?.suggestedTarget}`);
if (reviewRoute.workflowRoute?.suggestedCommand !== 'horus-cli.sh review') throw new Error(`expected review command, got ${reviewRoute.workflowRoute?.suggestedCommand}`);

const modifyDecision = decide({ command: ['cat', 'prod/config'].join(' '), targetPath: path.join(repo, 'prod/service'), tool: 'Bash', branch: 'feature/payments', sessionRisk: 0 });
if (modifyDecision.action !== 'modify') throw new Error(`expected modify, got ${modifyDecision.action}`);
if (!Array.isArray(modifyDecision.actionPlan.modificationHints) || modifyDecision.actionPlan.modificationHints.length < 1) throw new Error('expected modification hints');

step('promotion-guidance');
// --- promotion guidance checks ---
const { evaluate } = require(path.join(root, 'runtime/promotion-guidance.js'));

// critical risk is ineligible
const critPromo = evaluate({ key: 'x', approvalCount: 5, learnedAllow: false }, { level: 'critical', reasons: [] });
if (critPromo.stage !== 'ineligible') throw new Error(`expected ineligible, got ${critPromo.stage}`);

// new pattern with zero approvals
const newPromo = evaluate({ key: 'y', approvalCount: 0, learnedAllow: false }, { level: 'medium', reasons: [] });
if (newPromo.stage !== 'new') throw new Error(`expected new, got ${newPromo.stage}`);
if (newPromo.remaining !== 3) throw new Error(`expected remaining=3, got ${newPromo.remaining}`);

// approaching with 2 approvals
const approachPromo = evaluate({ key: 'z', approvalCount: 2, learnedAllow: false }, { level: 'medium', reasons: [] });
if (approachPromo.stage !== 'approaching') throw new Error(`expected approaching, got ${approachPromo.stage}`);
if (approachPromo.remaining !== 1) throw new Error(`expected remaining=1, got ${approachPromo.remaining}`);

// eligible with pending suggestion
const eligiblePromo = evaluate({ key: 'w', approvalCount: 3, learnedAllow: false, pendingSuggestion: { status: 'pending' } }, { level: 'medium', reasons: [] });
if (eligiblePromo.stage !== 'eligible') throw new Error(`expected eligible, got ${eligiblePromo.stage}`);
if (!eligiblePromo.cliHint || !eligiblePromo.cliHint.includes('promote')) throw new Error('expected promote CLI hint');

// promoted learned allow
const promotedPromo = evaluate({ key: 'v', approvalCount: 5, learnedAllow: true }, { level: 'medium', reasons: [] });
if (promotedPromo.stage !== 'promoted') throw new Error(`expected promoted, got ${promotedPromo.stage}`);

// decision engine includes promotionGuidance
const blockedPromo = decide({ command: destructive, targetPath: '/', tool: 'Bash', branch: 'main', notes: 'promo-check', sessionRisk: 0 });
if (!blockedPromo.promotionGuidance) throw new Error('expected promotionGuidance in decision');
if (blockedPromo.promotionGuidance.stage !== 'ineligible') throw new Error(`expected ineligible in critical decision, got ${blockedPromo.promotionGuidance.stage}`);

// adaptive action plan includes promotionHint
if (adaptiveTestsDecision.actionPlan.promotionHint == null) throw new Error('expected promotionHint in adaptive action plan');

// --- W2: escalate lane, payloadClass routing, sessionRisk routing ---
step('W2-escalate');
// force-push without protectedBranch → high risk, non-protected-branch, non-destructive → escalate
const escalateDecision = decide({ command: 'git push --force origin main', targetPath: 'src/app.ts', tool: 'Bash', sessionRisk: 0 });
if (escalateDecision.action !== 'escalate') throw new Error(`expected escalate, got ${escalateDecision.action}`);
if (escalateDecision.workflowRoute?.lane !== 'escalation') throw new Error(`expected escalation lane, got ${escalateDecision.workflowRoute?.lane}`);
if (escalateDecision.workflowRoute?.suggestedSurface !== 'security-reviewer') throw new Error(`expected security-reviewer surface, got ${escalateDecision.workflowRoute?.suggestedSurface}`);
if (escalateDecision.workflowRoute?.suggestedTarget !== 'human-gate') throw new Error(`expected human-gate target, got ${escalateDecision.workflowRoute?.suggestedTarget}`);
if (escalateDecision.enforcementAction !== 'block') throw new Error(`expected block enforcement for escalate, got ${escalateDecision.enforcementAction}`);

// classifyCommandPayload: C-class payload defaults to blocked (F4 floor). With an
// operator-token demotion (ADR-002 B), it routes to review for legitimate inspection.
const _classifyCToken = _mintCRoute('test-classify-c', 'class-c-review-demote');
process.env.HORUS_F4_DEMOTE_TOKEN = _classifyCToken;
const classifyCDecision = decide({ command: 'cat incident-report.pdf', targetPath: 'reports/', tool: 'Bash', sessionRisk: 0, payloadClass: 'C', branch: 'feature/hooks' });
delete process.env.HORUS_F4_DEMOTE_TOKEN;
if (classifyCDecision.workflowRoute?.lane !== 'review') throw new Error(`expected class C → review lane (with demote token), got ${classifyCDecision.workflowRoute?.lane}`);

// sessionRisk bump: elevated sessionRisk should add score and affect route for borderline commands
const sessionRiskDecision = decide({ command: 'sudo systemctl restart app', targetPath: 'ops/service', tool: 'Bash', sessionRisk: 3 });
if (!['route', 'escalate', 'require-review'].includes(sessionRiskDecision.action)) throw new Error(`expected non-allow action with session risk, got ${sessionRiskDecision.action}`);
if (!sessionRiskDecision.explanation.includes('session-risk')) throw new Error('expected session-risk in explanation');

// hook-utils classifyCommandPayload function (in-process)
const { classifyCommandPayload } = require(path.join(root, 'claude/hooks/hook-utils.js'));
if (classifyCommandPayload('echo api_key=abc123') !== 'C') throw new Error('expected C for api_key= command');
if (classifyCommandPayload('cat internal-only/report.md') !== 'B') throw new Error('expected B for internal-only command');
if (classifyCommandPayload('npm test') !== 'A') throw new Error('expected A for safe command');

step('B1-auto-allow-once');
// B.1 auto-allow-once: grant for eligible (pending) policy, consume on decide, expire after single use
// Use explicit projectRoot + branch so fineKey is identical in recordApproval (no discover) and
// inside decide() (enriched via discover, explicit overrides). policyKey in decide() now uses fineKey.
const autoInput = { command: 'npx -y tsx scripts/migrate.ts', tool: 'Bash', targetPath: 'scripts/', payloadClass: 'A', branch: 'feature/docs', sessionRisk: 0, protectedBranches: [], projectRoot: root };
for (let i = 0; i < 3; i++) recordApproval(autoInput);
const autoKey = computeFineKey(autoInput);
const autoSuggestion = getSuggestion(autoKey);
if (!autoSuggestion || autoSuggestion.status !== 'pending') throw new Error('expected pending suggestion for auto-allow-once test');
if (!grantAutoAllowOnce(autoKey)) throw new Error('grantAutoAllowOnce should succeed for eligible pending policy');
if (!hasAutoAllowOnce(autoKey)) throw new Error('hasAutoAllowOnce should return true after grant');
if (grantAutoAllowOnce('bash|generic|default-target|unknown-branch|A')) throw new Error('grantAutoAllowOnce should fail for non-eligible key');
const autoDecision = decide({ ...autoInput });
if (autoDecision.action !== 'allow') throw new Error(`expected allow from auto-allow-once, got ${autoDecision.action}`);
if (autoDecision.decisionSource !== 'auto-allow-once') throw new Error(`expected auto-allow-once source, got ${autoDecision.decisionSource}`);
if (!autoDecision.explanation.includes('auto-allow-once=consumed')) throw new Error('expected auto-allow-once=consumed in explanation');
if (hasAutoAllowOnce(autoKey)) throw new Error('auto-allow-once token should be consumed after single use');
console.log('auto-allow-once-lifecycle: ok');

step('B2-trajectory-nudge');
// B.2 trajectory nudge: 3 recent escalations should nudge allow → route
const now = Date.now();
saveState({
  recent: [
    { ts: new Date(now - 5*60*1000).toISOString(), action: 'escalate', riskLevel: 'high', reasonCodes: [] },
    { ts: new Date(now - 4*60*1000).toISOString(), action: 'escalate', riskLevel: 'high', reasonCodes: [] },
    { ts: new Date(now - 3*60*1000).toISOString(), action: 'escalate', riskLevel: 'high', reasonCodes: [] },
  ],
  updatedAt: new Date().toISOString(),
});
const trajDecision = decide({ command: 'ls -la', tool: 'Bash', targetPath: '.', branch: 'feature/test', sessionRisk: 0, repeatedApprovals: 0 });
if (trajDecision.action !== 'route') throw new Error(`expected route from trajectory nudge, got ${trajDecision.action}`);
if (trajDecision.decisionSource !== 'trajectory-nudge') throw new Error(`expected trajectory-nudge source, got ${trajDecision.decisionSource}`);
if (!trajDecision.explanation.includes('trajectory-nudge')) throw new Error('expected trajectory-nudge in explanation');
if (!trajDecision.trajectoryNudge) throw new Error('expected trajectoryNudge field in result');
console.log('trajectory-nudge: ok');

step('B3-trajectory-nudge-negative-learned-allow');
// Trajectory-nudge NEGATIVE tests: learned-allow and auto-allow-once are exempt
// Case A: learned-allow must NOT be nudged despite 3+ escalations
const negTs = Date.now();
saveState({
  recent: [
    { ts: new Date(negTs - 1000 * 60).toISOString(), action: 'escalate', riskLevel: 'high', reasonCodes: [] },
    { ts: new Date(negTs - 1000 * 90).toISOString(), action: 'escalate', riskLevel: 'high', reasonCodes: [] },
    { ts: new Date(negTs - 1000 * 120).toISOString(), action: 'escalate', riskLevel: 'high', reasonCodes: [] },
  ],
  updatedAt: new Date().toISOString(),
});
// B2: learned-allow only applies to high-risk destructive-delete; must use that command class.
// Explicit projectRoot + branch ensures fineKey in setLearnedAllow matches policyKey in decide().
const _laInput = { command: 'rm -rf dist/nudge-test', targetPath: path.join(root, 'dist', 'nudge-test'), tool: 'Bash', branch: 'feature/cleanup', protectedBranches: [], projectRoot: root, sessionRisk: 0, repeatedApprovals: 0 };
setLearnedAllow(_laInput, true);
const learnedDecision = decide(_laInput);
if (learnedDecision.decisionSource !== 'learned-allow') throw new Error(`expected learned-allow source, got ${learnedDecision.decisionSource}`);
if (learnedDecision.trajectoryNudge) throw new Error('trajectory nudge must NOT fire when source is learned-allow');
console.log('trajectory-nudge exempt for learned-allow: ok');

step('B3-trajectory-nudge-negative-auto-allow-once');
// Case B: auto-allow-once must NOT be nudged either
// Re-use the eligible suggestion left by the B.1 lifecycle test above (npx -y)
// That test consumed the token but left the suggestion as pending; re-grant it.
// Use same projectRoot/branch as autoInput in B1 so fineKey matches.
const aaoInput = { command: 'npx -y tsx scripts/migrate.ts', tool: 'Bash', targetPath: 'scripts/', payloadClass: 'A', branch: 'feature/docs', sessionRisk: 0, protectedBranches: [], projectRoot: root };
const aaoKey = computeFineKey(aaoInput);
const aaoSugg = getSuggestion(aaoKey);
if (!aaoSugg || aaoSugg.status !== 'pending') throw new Error('expected pending suggestion for auto-allow-once negative test (re-grant)');
// Seed 3 escalations using the correct session-context format
const nowMs = Date.now();
saveState({
  recent: [
    { ts: new Date(nowMs - 1000 * 60).toISOString(), action: 'escalate', riskLevel: 'high', reasonCodes: [] },
    { ts: new Date(nowMs - 1000 * 90).toISOString(), action: 'escalate', riskLevel: 'high', reasonCodes: [] },
    { ts: new Date(nowMs - 1000 * 120).toISOString(), action: 'escalate', riskLevel: 'high', reasonCodes: [] },
  ],
  updatedAt: new Date().toISOString(),
});
grantAutoAllowOnce(aaoKey);
if (!hasAutoAllowOnce(aaoKey)) throw new Error('auto-allow-once token should exist before consume');
const aaoDecision = decide({ ...aaoInput });
if (aaoDecision.decisionSource !== 'auto-allow-once') throw new Error(`expected auto-allow-once source, got ${aaoDecision.decisionSource}`);
if (aaoDecision.trajectoryNudge) throw new Error('trajectory nudge must NOT fire when source is auto-allow-once');
console.log('trajectory-nudge exempt for auto-allow-once: ok');

step('C3-kill-switch');
// C.3 kill switch: HORUS_KILL_SWITCH=1 should block all decisions regardless of risk
const origKS = process.env.HORUS_KILL_SWITCH;
process.env.HORUS_KILL_SWITCH = '1';
const ksDecision = decide({ command: 'npm test', tool: 'Bash', targetPath: '.', branch: 'feature/test', sessionRisk: 0 });
if (ksDecision.action !== 'block') throw new Error(`expected block from kill switch, got ${ksDecision.action}`);
if (ksDecision.decisionSource !== 'kill-switch') throw new Error(`expected kill-switch source, got ${ksDecision.decisionSource}`);
if (!ksDecision.explanation.includes('kill-switch engaged')) throw new Error('expected kill-switch engaged in explanation');
// Restore env: delete may be unreliable on Windows Node 20; set to '' then delete.
if (origKS !== undefined && origKS !== '') {
  process.env.HORUS_KILL_SWITCH = origKS;
} else {
  process.env.HORUS_KILL_SWITCH = '';
  delete process.env.HORUS_KILL_SWITCH;
}
// Guard: ensure kill switch is truly off before continuing (Windows env var quirk)
if (process.env.HORUS_KILL_SWITCH === '1') throw new Error('kill-switch not cleared after test — env var delete failed');
console.log('kill-switch: ok');

step('R1-learned-allow-destructive-delete');
// R1: learned-allow source attribution for high-risk destructive-delete.
// Must test on a non-protected branch so the score stays at 7 (high) not 10 (critical).
// Critical always blocks regardless of learned-allow — that is correct behaviour.
// This test verifies that at "high" risk + destructive-delete, a learned-allow is
// correctly attributed as decisionSource=learned-allow, not risk-engine.
saveState({ recent: [], updatedAt: new Date().toISOString() }); // clear trajectory
// Explicit projectRoot + absolute targetPath ensure fineKey matches in setLearnedAllow (raw input)
// and in decide() (enriched via discover). Without projectRoot, pathBucket diverges.
const destructiveLearnedInput = { command: 'rm -rf dist/', targetPath: path.join(root, 'dist'), tool: 'Bash', sessionRisk: 0, repeatedApprovals: 0, branch: 'feature/build-cleanup', protectedBranches: [], projectRoot: root };
setLearnedAllow(destructiveLearnedInput, true);
// Direct module-level assertion: isLearnedAllowed must return true immediately after setLearnedAllow.
// This verifies the in-process cache is always updated (try-finally in savePolicy guarantees this
// even when disk I/O fails on Windows CI runners under AV scanning).
if (!isLearnedAllowed(destructiveLearnedInput)) {
  throw new Error(`R1: isLearnedAllowed returned false immediately after setLearnedAllow — key=${decisionKey(destructiveLearnedInput)}`);
}
const destructiveLearnedDecision = decide({ ...destructiveLearnedInput });
if (destructiveLearnedDecision.action !== 'allow') {
  const { isLearnedAllowed: _ila, loadPolicy: _lp, decisionKey: _dk } = require(path.join(root, 'runtime/policy-store.js'));
  const { discover: _disc } = require(path.join(root, 'runtime/context-discovery.js'));
  const { loadProjectPolicy: _lpp } = require(path.join(root, 'runtime/project-policy.js'));
  const _dbgPolicy = _lp();
  const _r1Disc = _disc({ ...destructiveLearnedInput });
  const _r1Exp = Object.fromEntries(Object.entries({ ...destructiveLearnedInput }).filter(([,v]) => v !== '' && v != null));
  const _r1PP = _lpp({ ..._r1Disc, ..._r1Exp });
  const _r1Enriched = { ..._r1PP, ..._r1Disc, ..._r1Exp };
  const _enrichedKey = _dk(_r1Enriched);
  const _inputKey = _dk(destructiveLearnedInput);
  process.stderr.write(`[R1-diag] action=${destructiveLearnedDecision.action} source=${destructiveLearnedDecision.decisionSource} inputLearnedAllow=${_ila(destructiveLearnedInput)} enrichedLearnedAllow=${_ila(_r1Enriched)} HORUS_KILL_SWITCH=${JSON.stringify(process.env.HORUS_KILL_SWITCH)} policyKeys=${Object.keys(_dbgPolicy.learnedAllows||{}).join(',')} inputKey=${_inputKey} enrichedKey=${_enrichedKey} enrichedPayloadClass=${_r1Enriched.payloadClass}\n`);
  throw new Error(`R1: expected allow for learned destructive-delete on non-protected branch, got ${destructiveLearnedDecision.action} (inputKey=${_inputKey} enrichedKey=${_enrichedKey})`);
}
if (destructiveLearnedDecision.decisionSource !== 'learned-allow') throw new Error(`R1: expected learned-allow source for destructive-delete, got ${destructiveLearnedDecision.decisionSource}`);
console.log('learned-allow source attribution for destructive-delete: ok');

step('R3-global-package-install-key');
// R3: global-package-install commandClass in decisionKey produces distinct key from generic
const { decisionKey: dkey } = require(path.join(root, 'runtime/policy-store.js'));
const globalInstallKey = dkey({ command: 'npm install -g ts-node', tool: 'Bash', targetPath: '/usr/local/lib' });
const genericKey = dkey({ command: 'echo hello', tool: 'Bash', targetPath: '/tmp' });
if (globalInstallKey.split('|')[1] !== 'global-package-install') throw new Error(`R3: expected global-package-install commandClass, got ${globalInstallKey}`);
if (genericKey.split('|')[1] !== 'generic') throw new Error(`R3: expected generic commandClass for echo, got ${genericKey}`);
if (globalInstallKey === genericKey) throw new Error('R3: global-package-install key must differ from generic key');
console.log('global-package-install commandClass isolation: ok');

step('R4-block-workflow-route');
// R4: block action produces explicit workflowRoute.lane=blocked (not null)
const blockDecision = decide({ command: 'rm -rf /', targetPath: '/', tool: 'Bash', sessionRisk: 0 });
if (blockDecision.action !== 'block') throw new Error(`R4: expected block for rm -rf /, got ${blockDecision.action}`);
if (blockDecision.workflowRoute?.lane !== 'blocked') throw new Error(`R4: expected blocked lane, got ${blockDecision.workflowRoute?.lane}`);
if (!blockDecision.workflowRoute?.suggestedCommand?.includes('horus-cli.sh runtime explain')) throw new Error('R4: expected runtime explain command in blocked route');
console.log('block-action workflowRoute: ok');

step('cross-harness-secret-scan');
// Verify that runPreToolGate calls scanSecrets and emits a warning for all harnesses.
// This closes the parity gap where secret detection previously only fired in the
// Claude-specific secret-warning.js hook.
const { scanSecrets } = require(path.join(root, 'runtime/secret-scan.js'));
const { runPreToolGate } = require(path.join(root, 'runtime/pretool-gate.js'));

// Direct scanSecrets call: must detect an OpenAI-style API key in command text.
const secretCmd = 'curl -H "Authorization: Bearer sk-proj-abc123def456ghi789jkl012"';
const scanHit = scanSecrets(secretCmd);
if (!scanHit) throw new Error('scanSecrets: expected API key hit, got null');
if (!scanHit.name) throw new Error('scanSecrets: expected hit.name to be present');

// runPreToolGate must emit the secret warning and upgrade payloadClass to C.
// Test with harness=opencode to prove the cross-harness path (not the Claude hook).
const secretGateResult = runPreToolGate({
  harness: 'opencode', tool: 'Bash',
  command: secretCmd, cwd: '', rawInput: {}, sessionRisk: 0,
});
if (!secretGateResult.stderrLines.some(l => l.includes('detected')))
  throw new Error('runPreToolGate: expected secret detected warning in stderrLines');
if (!secretGateResult.stderrLines.some(l => l.includes('Remove secrets')))
  throw new Error('runPreToolGate: expected secret removal hint in stderrLines');
if (!secretGateResult.stderrLines.some(l => l.includes('Payload class: C')))
  throw new Error('runPreToolGate: expected payloadClass upgraded to C in stderrLines');
if (secretGateResult.logHitName !== scanHit.name)
  throw new Error(`runPreToolGate: expected logHitName=${scanHit.name}, got ${secretGateResult.logHitName}`);
console.log('cross-harness-secret-scan: ok');

step('f15-envelope-hash-stability');
const f15Repo = path.resolve(process.env.HOME, 'f15-envelope-repo');
fs.mkdirSync(path.join(f15Repo, 'bin'), { recursive: true });
fs.writeFileSync(path.join(f15Repo, 'bin', 'safe-tool'), '#!/usr/bin/env bash\necho ok\n');
fs.chmodSync(path.join(f15Repo, 'bin', 'safe-tool'), 0o755);
fs.writeFileSync(path.join(f15Repo, 'tracked.txt'), 'alpha\n');
execFileSync('git', ['init'], { cwd: f15Repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'f15@example.com'], { cwd: f15Repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'F15 Test'], { cwd: f15Repo, stdio: 'ignore' });
execFileSync('git', ['add', '.'], { cwd: f15Repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'init'], { cwd: f15Repo, stdio: 'ignore' });
const baseEnv = { ...process.env, PATH: path.join(f15Repo, 'bin') + path.delimiter + process.env.PATH, BASH_ALIASES: "safe-tool='safe-tool --flag'", HORUS_ENVELOPE_TEST: 'alpha' };
const envA = buildEnvelope({ harness: 'claude', command: 'safe-tool tracked.txt', cwd: f15Repo, targetPath: path.join(f15Repo, 'tracked.txt'), projectRoot: f15Repo, env: baseEnv, persistEnvBaseline: false, envBaseline: { PATH: baseEnv.PATH, BASH_ALIASES: baseEnv.BASH_ALIASES, HORUS_ENVELOPE_TEST: baseEnv.HORUS_ENVELOPE_TEST } });
const envB = buildEnvelope({ harness: 'claude', command: 'safe-tool tracked.txt', cwd: f15Repo, targetPath: path.join(f15Repo, 'tracked.txt'), projectRoot: f15Repo, env: baseEnv, persistEnvBaseline: false, envBaseline: { PATH: baseEnv.PATH, BASH_ALIASES: baseEnv.BASH_ALIASES, HORUS_ENVELOPE_TEST: baseEnv.HORUS_ENVELOPE_TEST } });
if (envA.hash !== envB.hash) throw new Error(`expected stable envelope hash, got ${envA.hash} vs ${envB.hash}`);
if (verifyEnvelope(envA, envB).ok !== true) throw new Error('expected identical envelopes to verify cleanly');
const decisionWithEnvelope = decide({ command: 'safe-tool tracked.txt', targetPath: path.join(f15Repo, 'tracked.txt'), tool: 'Bash', branch: 'feature/f15', projectRoot: f15Repo, envelope: envA });
if (decisionWithEnvelope.envelope?.hash !== envA.hash) throw new Error('expected additive decision.envelope field');

step('f15-envelope-divergence-floor');
const envChangedPath = buildEnvelope({ harness: 'claude', command: 'safe-tool tracked.txt', cwd: f15Repo, targetPath: path.join(f15Repo, 'tracked.txt'), projectRoot: f15Repo, env: { ...baseEnv, HORUS_ENVELOPE_TEST: 'beta' }, persistEnvBaseline: false, envBaseline: { PATH: baseEnv.PATH, BASH_ALIASES: baseEnv.BASH_ALIASES, HORUS_ENVELOPE_TEST: baseEnv.HORUS_ENVELOPE_TEST } });
const diverged = decide({ command: 'safe-tool tracked.txt', targetPath: path.join(f15Repo, 'tracked.txt'), tool: 'Bash', branch: 'feature/f15', projectRoot: f15Repo, envelope: envA, observedEnvelope: envChangedPath });
if (diverged.action !== 'block') throw new Error(`expected F15 block, got ${diverged.action}`);
if (diverged.decisionSource !== 'execution-envelope-diverged') throw new Error(`expected F15 source, got ${diverged.decisionSource}`);
if (diverged.floorFired !== 'execution-envelope') throw new Error(`expected F15 floor, got ${diverged.floorFired}`);
if (diverged.envelopeVerification?.reason !== 'env-diff') throw new Error(`expected env-diff mismatch, got ${diverged.envelopeVerification?.reason}`);

console.log('runtime-core-node-check: ok');
NODE
pass 'runtime scoring, learned policy, suggestions, and session behavior'

# classifyPathSensitivity unit tests
HOME="$tmp_home" HORUS_STATE_DIR="$tmp_home" node - <<'NODE2' "$root" || exit 1
const path = require('path');
const root = process.argv[2];
const { classifyPathSensitivity } = require(path.join(root, 'claude/hooks/hook-utils.js'));

const highCases = [
  ['~/.ssh/id_rsa',                   'high'],
  ['~/.aws/credentials',              'high'],
  ['/home/user/.gnupg/secring.gpg',   'high'],
  ['~/.config/gcloud/credentials.db', 'high'],
  ['/home/user/.docker/config/config.json', 'high'],
];
const medCases = [
  ['./.env',         'medium'],
  ['./.env.local',   'medium'],
  ['project/.env.prod',    'medium'],
  ['config/.env.staging', 'medium'],
];
const lowCases = [
  ['./README.md',    'low'],
  ['./src/index.ts', 'low'],
  ['/tmp/build.log', 'low'],
];
for (const [p, expected] of [...highCases, ...medCases, ...lowCases]) {
  const actual = classifyPathSensitivity(p);
  if (actual !== expected) throw new Error(`classifyPathSensitivity('${p}'): expected '${expected}', got '${actual}'`);
}
console.log('classifyPathSensitivity: ok');
NODE2
pass 'classifyPathSensitivity low/medium/high classification'

printf '\nRuntime core checks passed.\n'
