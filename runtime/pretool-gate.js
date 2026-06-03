#!/usr/bin/env node
"use strict";

// ---------------------------------------------------------------------------
// pretool-gate.js — Single enforcement spine for all harness adapters.
//
// All three harnesses (claude, openclaw, opencode) delegate here for:
//   - dangerous-command pattern scanning
//   - runtime.decide() with unified policy and trajectory tracking
//   - enforce / warn mode based on LILARA_ENFORCE
//   - kill-switch check
//
// Each adapter is responsible only for extracting the command + cwd strings
// in a harness-specific way, then calling runPreToolGate().
//
// Zero external dependencies — only Node.js builtins and local runtime modules.
// ---------------------------------------------------------------------------

const fs   = require("fs");
const path = require("path");
const { decide }      = require("./decision-engine");
const { discover }    = require("./context-discovery");
const { build: buildEnvelope, rememberPending } = require("./envelope");
const { scanSecrets } = require("./secret-scan");
const { build: buildIr } = require("./action-ir");
const { extractCommand, normalizeCommand } = require("./command-normalize");

// 0.2.0 consent gate — loaded lazily so the gate is completely inert when
// LILARA_CONSENT is unset (no performance cost on the hot path).
let _consentGrantStore = null;
let _consentTransport  = null;
function _requireConsentGrantStore() {
  if (!_consentGrantStore) _consentGrantStore = require("./consent/grant-store");
  return _consentGrantStore;
}
function _requireConsentTransport() {
  if (!_consentTransport) _consentTransport = require("./consent/transport");
  return _consentTransport;
}
const { projectScope: _projectScope } = require("./project-scope");
const { mintOperatorToken: _mintOperatorToken,
        consumeScopedOperatorToken: _consumeScopedOperatorToken } = require("./contract");

// ---------------------------------------------------------------------------
// Dangerous pattern loading
// ---------------------------------------------------------------------------

const PATTERN_FILE = path.join(__dirname, "..", "claude", "hooks", "dangerous-patterns.json");

const FALLBACK_PATTERNS = [
  { name: "rm recursive force",         severity: "critical", reason: "Recursive forced deletion is irreversible.",                                regex: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive)\b/ },
  { name: "git push force",             severity: "critical", reason: "Force push can destroy shared history.",                                     regex: /\bgit\s+push\b.*(-f\b|--force\b|--force-with-lease\b)/ },
  { name: "curl pipe to shell",         severity: "critical", reason: "Executes untrusted remote code — violates no-unreviewed-remote-execution.",  regex: /\bcurl\b.*\|\s*(ba)?sh\b|\bwget\b.*\|\s*(ba)?sh\b/ },
  { name: "DROP DATABASE / DROP TABLE", severity: "critical", reason: "Destroys database objects irreversibly.",                                     regex: /\b(DROP\s+(DATABASE|TABLE|SCHEMA)|TRUNCATE\s+TABLE)\b/i },
  { name: "npx -y auto-download",       severity: "high",     reason: "Downloads and executes remote npm packages without review.",                 regex: /\bnpx\s+(-y\b|--yes\b)/ },
  { name: "sudo generic elevation",     severity: "medium",   reason: "Elevated privilege execution — confirm this is intentional.",                regex: /^\s*sudo\s+/ },
];

const SEVERITY_RANK  = { critical: 3, high: 2, medium: 1 };
const SEVERITY_LABEL = { critical: "CRITICAL", high: "HIGH", medium: "WARN" };

let _patterns = null;

function loadPatterns() {
  if (_patterns !== null) return _patterns;
  try {
    const raw  = fs.readFileSync(PATTERN_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data.patterns) && data.patterns.length > 0) {
      _patterns = data.patterns.map(({ name, pattern, severity, reason, flags }) => ({
        name,
        severity: severity || "medium",
        reason:   reason  || "",
        regex:    new RegExp(pattern, flags || ""),
      }));
      return _patterns;
    }
  } catch { /* file missing or malformed — use fallback */ }
  _patterns = FALLBACK_PATTERNS;
  return _patterns;
}

// ---------------------------------------------------------------------------
// Inline payload + path classifiers (no dep on claude/hooks/hook-utils)
// ---------------------------------------------------------------------------

function classifyCommandPayload(command) {
  const text = String(command || "");
  if (
    /api[_-]?key\s*[=:]/i.test(text) || /password\s*[=:]/i.test(text) ||
    /secret\s*[=:]/i.test(text) || /auth[_-]?token\s*[=:]/i.test(text) ||
    /-----BEGIN\s+(RSA|EC|OPENSSH)?\s*PRIVATE/i.test(text) ||
    /AWS_SECRET_ACCESS_KEY/i.test(text) || /GITHUB_TOKEN|GH_TOKEN/i.test(text) ||
    /customer\s+(data|pii|email|list)/i.test(text)
  ) return "C";
  if (
    /internal[_-]?(only|project|memo)/i.test(text) || /private[_-]?repo/i.test(text) ||
    /security[_-]?incident/i.test(text) || /non[_-]?public/i.test(text) ||
    /financial[_-]?(data|report)/i.test(text)
  ) return "B";
  return "A";
}

function classifyPathSensitivity(targetPath) {
  const p = String(targetPath || "").replace(/\\/g, "/");
  if (
    /\/\.ssh\b/.test(p) || /\/\.aws\b/.test(p) || /\/\.gnupg\b/.test(p) ||
    /\/\.config\/(gcloud|op|1password|bitwarden)\b/i.test(p) ||
    /\/\.password-store\b/.test(p) || /\/\.kube\b/.test(p) ||
    /\/\.docker\/config\b/.test(p) || /\/(vault|secrets?)\b/i.test(p) ||
    /\/(id_rsa|id_ed25519|id_ecdsa)\b/.test(p) || /\/(payments?|billing)\b/i.test(p) ||
    /\/private[-_]?key\b/i.test(p) || /\/(Cookies|Login Data|Web Data)\b/.test(p)
  ) return "high";
  if (
    /\/\.env[^/]*$/.test(p) || /\/\.envrc$/.test(p) ||
    /\/(prod(uction)?|staging|infra|terraform|k8s|kubernetes)\b/i.test(p) ||
    /\/(internal|confidential)\b/i.test(p) || /\bconfig\.(json|yml|yaml|toml)$/.test(p)
  ) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Main gate function
// ---------------------------------------------------------------------------

/**
 * Run the pre-tool enforcement gate.
 *
 * @param {object} input
 * @param {string}  input.harness   — "claude" | "opencode" | "openclaw" | ...
 * @param {string}  input.tool      — tool name as reported by the harness
 * @param {string}  input.command   — the shell command string to scan
 * @param {string}  input.cwd       — working directory (for context discovery)
 * @param {*}       input.rawInput  — parsed stdin payload (for journaling)
 * @param {number}  [input.sessionRisk] — optional pre-computed session risk (0–3)
 *
 * @returns {{ exitCode: 0|2, stderrLines: string[], logAction: string|null, logHitName: string|null }}
 */
function isCriticalEnvelopeRecheck(decision, payloadClass) {
  if (!decision || ["block", "escalate"].includes(decision.action)) return false;
  if (payloadClass === "C") return true;
  return Array.isArray(decision.reasonCodes) && decision.reasonCodes.includes("protected-branch");
}

function runPreToolGate({ harness, tool, command, cwd, rawInput, sessionRisk = 0, envelopeReporting = false, ir = null, trustMeta = null, outputChannels = null, harnessVersion = null }) {
  const stderrLines = [];
  const emit = (msg) => stderrLines.push(msg);
  const ENFORCE = process.env.LILARA_ENFORCE === "1";

  // Kill-switch: block all tool calls immediately (floor F1).
  if (process.env.LILARA_KILL_SWITCH === "1") {
    return { exitCode: 2, stderrLines: ["[Lilara] Kill-switch engaged — all tool calls blocked."], logAction: "BLOCK", logHitName: null };
  }

  // Primary path: the adapter resolved the command via its own extractor.
  // Backstop (ADR-008): if the adapter handed us an empty string but the raw
  // payload carries the command under any ADR-007 §4.2 alias (cmd,
  // args.command, args.tool_input.command, …), recover it here so the gate
  // cannot be silently bypassed by an adapter whose precedence ladder is
  // incomplete. This is intentionally redundant with hook-utils.commandFrom
  // — defense in depth, not single-point-of-truth.
  let cmd = String(command || "").trim();
  if (!cmd && rawInput && typeof rawInput === "object") {
    cmd = String(extractCommand(rawInput) || "").trim();
  }
  if (!cmd) return { exitCode: 0, stderrLines: [], logAction: null, logHitName: null };

  // Dangerous pattern scan — collect all hits. Hits annotate the decision
  // but do NOT short-circuit it; decide() runs unconditionally on every call.
  const patterns = loadPatterns();
  const cmdNorm = normalizeCommand(cmd);
  const normDiffers = cmdNorm !== cmd;
  const hits = patterns.filter(({ regex }) =>
    regex.test(cmd) || (normDiffers && regex.test(cmdNorm)));
  hits.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  const hit = hits.length > 0 ? hits[0] : null;

  // Emit pattern-hit warning before calling decide().
  if (hit) {
    const label = SEVERITY_LABEL[hit.severity] || "WARN";
    emit(`[Lilara] [${label}] Dangerous command pattern: "${hit.name}"`);
    if (hit.reason) emit(`[Lilara] Reason: ${hit.reason}`);
    emit(`[Lilara] Command: ${cmd.slice(0, 200)}${cmd.length > 200 ? "…" : ""}`);
  }

  const targetPath      = String(cwd || "");
  let   payloadClass    = classifyCommandPayload(cmd);
  const pathSensitivity = classifyPathSensitivity(targetPath);

  // Cross-harness secret scan — 23 token patterns (API keys, tokens, private keys).
  // Runs for every harness, not just Claude. Upgrades payloadClass to C on a hit
  // so the decision-engine floor (step 4) fires identically across all harnesses.
  const secretHit = scanSecrets(cmd);
  if (secretHit) {
    emit(`[Lilara] Possible ${secretHit.name} detected in command.`);
    emit("[Lilara] Remove secrets before submitting. Prefer local env files that are not shared.");
    payloadClass = "C";
  }

  // Runtime decision — runs on every tool call (not just pattern-matched ones).
  // Non-pattern commands still go through contract scope, payload-class,
  // session-risk, and strict-mode checks.
  let decision;
  let discovered;
  let envelope = null;
  try {
    discovered = discover({ targetPath, branch: String(rawInput?.branch || "").trim() });
    if (envelopeReporting) {
      envelope = buildEnvelope({
        harness: String(harness || ""),
        tool: String(tool || "Bash"),
        command: cmd,
        cwd: targetPath || discovered.projectRoot || process.cwd(),
        targetPath,
        projectRoot: discovered.projectRoot,
        sessionId: rawInput?.session_id || rawInput?.sessionId,
        trackPaths: rawInput?.track_paths || rawInput?.trackPaths,
        aliases: rawInput?.aliases,
      });
      if (rawInput?.tool_use_id) rememberPending(rawInput.tool_use_id, envelope);
    }
    // Lilara ADR-007 PR-B: build the canonical IR and pass it to decide(). The
    // gate is the back-compat shim — adapters that don't pre-build an IR get
    // one synthesized here from the same flat fields decide() reads. The IR
    // is additive: floors still read flat fields; decide() only journals
    // irHash (gated behind LILARA_IR_JOURNAL=1).
    const gateIr = ir || buildIr(rawInput, {
      harness:        String(harness || ""),
      tool:           String(tool || "Bash"),
      command:        cmd,
      cwd:            targetPath,
      projectRoot:    discovered.projectRoot,
      branch:         discovered.branch,
      harnessVersion,
      trustMeta,
      outputChannels,
    });

    // 0.2.0: load the active consent grant and inject it + the current
    // timestamp so decide() can run the grant-suppression block deterministically.
    // Both are loaded HERE (at the impure boundary), never inside decide() itself.
    let consentGrant = null;
    const nowMs = Date.now();
    if (process.env.LILARA_CONSENT && process.env.LILARA_CONSENT !== "off") {
      try {
        const gs = _requireConsentGrantStore();
        const ps = _projectScope({ projectRoot: discovered.projectRoot });
        consentGrant = gs.loadActiveGrant(
          ps,
          rawInput?.session_id || rawInput?.sessionId || null,
          nowMs,
        );
      } catch { /* grant store unavailable — proceed without grant (fail-open for store error, not security failure) */ }
    }

    decision = decide({
      harness:     String(harness || ""),
      tool:        String(tool || "Bash"),
      command:     cmd,
      targetPath,
      branch:      discovered.branch,
      projectRoot: discovered.projectRoot,
      configPath:  discovered.configPath,
      payloadClass,
      sessionRisk,
      pathSensitivity,
      envelope,
      ir: gateIr,
      notes: hit ? `${harness}-gate:${hit.name}` : `${harness}-gate`,
      // Consent gate injected fields (pure-boundary contract):
      consentGrant,
      now: nowMs,
    });

    if (envelopeReporting && envelope && isCriticalEnvelopeRecheck(decision, payloadClass)) {
      const observedEnvelope = buildEnvelope({
        harness: String(harness || ""),
        tool: String(tool || "Bash"),
        command: cmd,
        cwd: targetPath || discovered.projectRoot || process.cwd(),
        targetPath,
        projectRoot: discovered.projectRoot,
        sessionId: rawInput?.session_id || rawInput?.sessionId,
        trackPaths: rawInput?.track_paths || rawInput?.trackPaths,
        aliases: rawInput?.aliases,
      });
      decision = decide({
        harness:     String(harness || ""),
        tool:        String(tool || "Bash"),
        command:     cmd,
        targetPath,
        branch:      discovered.branch,
        projectRoot: discovered.projectRoot,
        configPath:  discovered.configPath,
        payloadClass,
        sessionRisk,
        pathSensitivity,
        envelope,
        observedEnvelope,
        ir: gateIr,
        notes: `${harness}-gate:pre-exec-recheck`,
      });
    }
  } catch (runtimeErr) {
    const errMsg = runtimeErr instanceof Error ? runtimeErr.message : String(runtimeErr);
    emit(`[Lilara] WARNING: runtime decision engine unavailable (${errMsg}). Applying severity fallback.`);
    if (ENFORCE) {
      const closeReasons = [];
      if (hit && ["critical", "high", "medium"].includes(hit.severity)) closeReasons.push(`pattern:${hit.severity}`);
      if (secretHit) closeReasons.push("secret-payload");
      if (pathSensitivity === "high") closeReasons.push("sensitive-path");
      if (closeReasons.length > 0) {
        emit(`[Lilara] BLOCKED — runtime unavailable under LILARA_ENFORCE=1 (signals: ${closeReasons.join(",")}).`);
        return { exitCode: 2, stderrLines, logAction: "BLOCK", logHitName: hit?.name || secretHit?.name || null };
      }
    }
    emit("[Lilara] Proceeding in warn mode (runtime unavailable). Set LILARA_ENFORCE=1 to tighten behavior.");
    return { exitCode: 0, stderrLines, logAction: "WARN", logHitName: hit?.name || secretHit?.name || null };
  }

  // Enforce-mode block — check first so blocking output is unambiguous.
  if (ENFORCE && decision.enforcementAction === "block") {
    if (payloadClass !== "A") emit(`[Lilara] Payload class: ${payloadClass}`);
    if (pathSensitivity !== "low") emit(`[Lilara] Sensitive path detected (${pathSensitivity}): ${targetPath.slice(0, 120)}`);
    if (sessionRisk > 0) emit(`[Lilara] Session risk: ${sessionRisk}`);
    const primaryCode = Array.isArray(decision.reasonCodes) && decision.reasonCodes[0] ? ` [${decision.reasonCodes[0]}]` : "";
    emit(`[Lilara] Runtime decision: ${decision.action} (risk=${decision.riskLevel}:${decision.riskScore}, source=${decision.decisionSource})${primaryCode}`);
    emit(`[Lilara] Explanation: ${decision.explanation}`);
    emit("[Lilara] BLOCKED by runtime policy.");
    emit("[Lilara] To proceed, get explicit approval or adjust local learned policy intentionally.");
    return { exitCode: 2, stderrLines, logAction: "BLOCK", logHitName: hit?.name || secretHit?.name || null };
  }

  // ── 0.2.0 Consent gate ──────────────────────────────────────────────────
  // When a floor emits enforcementAction:"consent-required", stop and ask the
  // human at the controlling terminal. The gate is active ONLY when
  // LILARA_CONSENT is set to "interactive" or "block" (not "off"/unset).
  //
  // Backward-compat: when LILARA_CONSENT is unset/"off", treat "consent-required"
  // exactly like "block" (applies ENFORCE check — identical to pre-0.2.0 behaviour).
  const _CONSENT_MODE = String(process.env.LILARA_CONSENT || "off").trim().toLowerCase();
  if (decision.enforcementAction === "consent-required") {
    if (_CONSENT_MODE === "off" || !process.env.LILARA_CONSENT) {
      // Consent disabled — behave as if enforcementAction were "block".
      if (ENFORCE) {
        const primaryCode = Array.isArray(decision.reasonCodes) && decision.reasonCodes[0] ? ` [${decision.reasonCodes[0]}]` : "";
        emit(`[Lilara] Runtime decision: ${decision.action} (risk=${decision.riskLevel}:${decision.riskScore}, source=${decision.decisionSource})${primaryCode}`);
        emit(`[Lilara] Explanation: ${decision.explanation}`);
        emit("[Lilara] BLOCKED by runtime policy (set LILARA_CONSENT=interactive to enable stop-and-ask).");
        return { exitCode: 2, stderrLines, logAction: "BLOCK", logHitName: hit?.name || secretHit?.name || null };
      }
      // In warn mode with consent off, fall through to the warn branch below.
    } else {
      // Consent is enabled — stop and ask.
      const tr = _requireConsentTransport();
      const promptObj = tr.buildConsentPrompt(decision, {
        tool:    String(tool || "Bash"),
        command: cmd,
      });
      const { decision: consentDecision, grantScopes } = tr.requestConsent(promptObj, { mode: _CONSENT_MODE });

      if (consentDecision === "approve") {
        // Scope-shaped floors (F18/F20): widen the session grant for future calls.
        // One-shot floors (F4/F19): mint+consume the floor's existing scoped operator token.
        if (tr.isOneShot(decision.floorFired)) {
          // One-shot: mint and immediately consume the scoped operator token.
          try {
            const tokenScope = decision.floorFired === "secret-class-C"
              ? "class-c-review-demote"
              : "output-exfil-review-demote";
            const tok = _mintOperatorToken("consent-approved", tokenScope);
            _consumeScopedOperatorToken(tok, tokenScope);
          } catch { /* token machinery unavailable — proceeding (operator approved) */ }
        } else {
          // Scope-shaped: mint a session grant.
          try {
            const gs = _requireConsentGrantStore();
            const ps = _projectScope({ projectRoot: discovered.projectRoot });
            gs.mintConsentGrant(grantScopes || {}, {
              projectScope: ps,
              sessionId:    rawInput?.session_id || rawInput?.sessionId || null,
              ttlMs:        3600000, // 1-hour session grant
              floorCodes:   decision.code ? [decision.code] : [],
            });
          } catch { /* grant mint failed — one-time consent only */ }
        }
        emit(`[Lilara] Consent granted by operator — proceeding.`);
        return { exitCode: 0, stderrLines, logAction: "CONSENT", logHitName: hit?.name || secretHit?.name || null };
      } else {
        // Denied by human or fail-closed (no TTY).
        const primaryCode = Array.isArray(decision.reasonCodes) && decision.reasonCodes[0] ? ` [${decision.reasonCodes[0]}]` : "";
        emit(`[Lilara] Runtime decision: ${decision.action} (risk=${decision.riskLevel}:${decision.riskScore}, source=${decision.decisionSource})${primaryCode}`);
        emit(`[Lilara] Explanation: ${decision.explanation}`);
        emit("[Lilara] BLOCKED — consent denied.");
        return { exitCode: 2, stderrLines, logAction: "BLOCK", logHitName: hit?.name || secretHit?.name || null };
      }
    }
  }

  // Silent pass: no dangerous-command hit, no secret hit, and decision is allow.
  if (!hit && !secretHit && decision.action === "allow") {
    return { exitCode: 0, stderrLines: [], logAction: null, logHitName: null };
  }

  // Emit decision context for all other cases (pattern hit, or non-allow decision).
  if (payloadClass !== "A") emit(`[Lilara] Payload class: ${payloadClass}`);
  if (pathSensitivity !== "low") emit(`[Lilara] Sensitive path detected (${pathSensitivity}): ${targetPath.slice(0, 120)}`);
  if (sessionRisk > 0) emit(`[Lilara] Session risk: ${sessionRisk}`);
  emit(`[Lilara] Runtime decision: ${decision.action} (risk=${decision.riskLevel}:${decision.riskScore}, source=${decision.decisionSource})`);
  emit(`[Lilara] Explanation: ${decision.explanation}`);
  if (decision.envelope?.hash) emit(`[Lilara] Execution envelope: ${decision.envelope.hash}`);

  if (decision.action === "escalate") {
    emit("[Lilara] ESCALATION ROUTE: human gate required — do not auto-allow.");
  }
  const routeLane = decision.workflowRoute?.lane;
  if (routeLane && routeLane !== "direct") {
    emit(`[Lilara] Workflow route: ${routeLane} → ${decision.workflowRoute?.suggestedTarget || "—"}`);
  }

  // Additional guidance (warn mode).
  if (discovered && discovered.branch) emit(`[Lilara] Detected branch: ${discovered.branch}`);
  if (decision.promotionGuidance && decision.promotionGuidance.stage !== "new") {
    emit(`[Lilara] Promotion: [${decision.promotionGuidance.stage}] ${decision.promotionGuidance.guidance}`);
    if (decision.promotionGuidance.cliHint) emit(`[Lilara] Promotion CLI: ${decision.promotionGuidance.cliHint}`);
  }
  if (decision.pendingSuggestion) {
    emit(`[Lilara] Pending local suggestion: ./scripts/lilara-cli.sh runtime accept '${decision.pendingSuggestion}'`);
  }
  if (decision.actionPlan?.summary) emit(`[Lilara] Action plan: ${decision.actionPlan.summary}`);
  if (Array.isArray(decision.actionPlan?.commands)) {
    for (const c of decision.actionPlan.commands.slice(0, 3)) emit(`[Lilara] Suggested command: ${c}`);
  }
  if (decision.actionPlan?.reviewType) emit(`[Lilara] Review type: ${decision.actionPlan.reviewType}`);
  if (Array.isArray(decision.actionPlan?.modificationHints)) {
    for (const h of decision.actionPlan.modificationHints.slice(0, 3)) emit(`[Lilara] Modification hint: ${h}`);
  }

  // Final log action for the adapter to record.
  let logAction;
  if (decision.action === "allow" && decision.decisionSource === "learned-allow") {
    emit("[Lilara] Learned allow matched, proceeding in bounded-autonomy mode.");
    logAction = "PASS";
  } else if (["route", "require-tests", "require-review", "modify"].includes(decision.action)) {
    emit(`[Lilara] ${decision.action} — proceeding in warn mode.`);
    logAction = "WARN";
  } else {
    emit("[Lilara] Proceeding in warn mode. Set LILARA_ENFORCE=1 to tighten behavior.");
    logAction = "WARN";
  }

  return { exitCode: 0, stderrLines, logAction, logHitName: hit?.name || secretHit?.name || null };
}

module.exports = { runPreToolGate };
