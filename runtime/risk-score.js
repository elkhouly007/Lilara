#!/usr/bin/env node
"use strict";

const { globMatch }  = require("./glob-match");
const { detectBypassPatterns } = require("./shell-bypass-detector");
const { normalizeCommand }     = require("./command-normalize");

function normalize(input = {}) {
  return {
    command: String(input.command || "").trim(),
    targetPath: String(input.targetPath || "").trim(),
    payloadClass: String(input.payloadClass || "A").trim().toUpperCase(),
    branch: String(input.branch || "").trim(),
    protectedBranch: Boolean(input.protectedBranch),
    repeatedApprovals: Number(input.repeatedApprovals || 0),
    sessionRisk: Number(input.sessionRisk || 0),
    trustPosture: String(input.trustPosture || "balanced").trim(),
    sensitivePathPatterns: Array.isArray(input.sensitivePathPatterns) ? input.sensitivePathPatterns.map(String) : [],
    protectedBranches: Array.isArray(input.protectedBranches) ? input.protectedBranches.map(String) : [],
    projectScope: String(input.projectScope || "global").trim(),
  };
}

function score(input = {}) {
  const ctx = normalize(input);
  let value = 0;
  const reasons = [];

  if (ctx.command) value += 1;

  // Dual-path matching (ADR-008): every destructive-verb predicate is tested
  // against BOTH the raw command and its NFKC + confusables-folded form.
  // Defeats Unicode look-alike bypass (Cyrillic 'рm', full-width 'ｒｍ',
  // Greek-letter substitution in 'git push', etc.) while keeping the ASCII
  // regexes themselves unchanged for human review and historical parity.
  const cmdRaw  = ctx.command;
  const cmdNorm = normalizeCommand(cmdRaw);
  const normDiffers = cmdNorm !== cmdRaw;
  const matches = (re) => re.test(cmdRaw) || (normDiffers && re.test(cmdNorm));

  // Match rm with -rf/-r flags in any position (e.g. rm --no-preserve-root -rf /)
  if (matches(/\brm\s+(?:\S+\s+)*-[A-Za-z]*r[A-Za-z]*f\b|\brm\s+-{1,2}recursive\b|\brm\b.*--recursive\b/)) {
    value += 6;
    reasons.push("destructive-delete-pattern");
  }
  // dd writing to a device or file is a disk-overwrite risk
  if (matches(/\bdd\s+/) && matches(/\bof=/)) {
    value += 8;
    reasons.push("disk-write-pattern");
  }
  if (matches(/\bgit\s+push\b.*(--force|-f\b|--force-with-lease\b)/)) {
    value += 6;
    reasons.push("force-push-pattern");
  }
  if (matches(/\bcurl\b.*\|\s*(ba)?sh\b|\bwget\b.*\|\s*(ba)?sh\b/)) {
    value += 7;
    reasons.push("remote-exec-pattern");
  }
  if (matches(/\bnpx\s+(-y\b|--yes\b)/)) {
    value += 4;
    reasons.push("auto-download-pattern");
  }
  if (matches(/\bsudo\b/)) {
    value += 3;
    reasons.push("privilege-elevation");
  }
  if (matches(/\b(DROP\s+(DATABASE|TABLE|SCHEMA)|TRUNCATE\s+TABLE)\b/i)) {
    value += 7;
    reasons.push("destructive-database-pattern");
  }
  // Global package install (npm/pip/gem install -g/--global) — system-wide mutation
  if (matches(/\b(npm|yarn)\s+(install|add|i)\b.*\s(-g|--global)\b|\b(npm|yarn)\s+(-g|--global)\s+(install|add|i)\b/) ||
      matches(/\b(pip3?|gem)\s+install\b.*(--user|-U)\s+/)) {
    value += 3;
    reasons.push("global-package-install");
  }
  // Hard reset — destroys local commit history irreversibly
  if (matches(/\bgit\s+reset\s+--hard\b/)) {
    value += 4;
    reasons.push("hard-reset-pattern");
  }
  // Kubernetes resource deletion — may affect running workloads
  if (matches(/\bkubectl\s+(delete|remove)\b/)) {
    value += 4;
    reasons.push("kubectl-delete-pattern");
  }
  // git clean -f — permanently removes untracked files
  if (matches(/\bgit\s+clean\b.*-[A-Za-z]*f/)) {
    value += 3;
    reasons.push("git-clean-pattern");
  }
  // chmod with world-write or 777 — broad permission mutation
  if (matches(/\bchmod\b.*(777|666|o\+w|a\+w|ugo\+w)/)) {
    value += 3;
    reasons.push("broad-permission-pattern");
  }

  if (ctx.targetPath === "/" || ctx.targetPath === "/*") {
    value += 4;
    reasons.push("filesystem-root-target");
  }
  // Detect filesystem root as rm target from command string (e.g. rm -rf /)
  if (!reasons.includes("filesystem-root-target") &&
      matches(/\brm\b/) && matches(/(?:^|\s)\/\s*$/)) {
    value += 4;
    reasons.push("filesystem-root-target");
  }
  const sensitivePattern = ctx.sensitivePathPatterns.length > 0
    ? new RegExp(`(${ctx.sensitivePathPatterns.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i")
    : /\b(prod|production|secrets?|credentials?|\.env|terraform|infra)\b/i;
  if (sensitivePattern.test(ctx.targetPath)) {
    value += 3;
    reasons.push("sensitive-target-path");
  }

  if (ctx.payloadClass === "B") {
    value += 2;
    reasons.push("payload-class-b");
  }
  if (ctx.payloadClass === "C") {
    value += 4;
    reasons.push("payload-class-c");
  }

  const branchProtected = ctx.protectedBranch || (ctx.branch && ctx.protectedBranches.some((p) => globMatch(ctx.branch, p)));
  if (branchProtected) {
    value += 3;
    reasons.push("protected-branch");
  }

  if (ctx.sessionRisk > 0) {
    value += Math.min(3, ctx.sessionRisk);
    reasons.push("session-risk");
  }

  const pathSensitivity = String(input.pathSensitivity || "low").toLowerCase();
  if (pathSensitivity === "high") {
    value += 2;
    reasons.push("path-sensitivity-high");
  } else if (pathSensitivity === "medium") {
    value += 1;
    reasons.push("path-sensitivity-medium");
  }

  // ── Shell-AST bypass detection ───────────────────────────────────────────
  // Catches bypass patterns that pure-regex matchers miss (base64-pipe, IFS,
  // eval+sub, variable-as-command, network process substitution).
  // Added after all regex checks so it only fires on genuine gaps.
  const ast = detectBypassPatterns(ctx.command);
  if (ast.hasBase64Pipe) {
    value += 7;
    reasons.push("base64-pipe-exec");
  }
  if (ast.hasIfsBypass) {
    value += 7;
    reasons.push("shell-ast-ifs-bypass");
  }
  if (ast.hasEvalDynamic) {
    value += 7;
    reasons.push("eval-dynamic-exec");
  }
  if (ast.hasVariableAsCommand) {
    value += 5;
    reasons.push("shell-ast-variable-cmd");
  }
  if (ast.hasNetworkProcessSub) {
    value += 5;
    reasons.push("shell-ast-network-proc-sub");
  }
  // isUnresolvable: command substitution present but no named bypass pattern fired.
  // The substituted value is opaque at analysis time — fail-safe-up per plan §A1.
  if (ast.isUnresolvable) {
    value += 5;
    reasons.push("shell-ast-unresolvable");
  }

  if (ctx.repeatedApprovals >= 3 && value > 0) {
    value -= 1;
    reasons.push("repeated-approval-history");
  }

  if (ctx.trustPosture === "strict") {
    value += 1;
    reasons.push("strict-trust-posture");
  } else if (ctx.trustPosture === "relaxed" && value > 0) {
    value -= 1;
    reasons.push("relaxed-trust-posture");
  }

  value = Math.max(0, Math.min(10, value));

  let level = "low";
  if (value >= 8) level = "critical";
  else if (value >= 6) level = "high";
  else if (value >= 3) level = "medium";

  return { score: value, level, reasons, context: ctx };
}

module.exports = { score };
