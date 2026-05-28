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
    hasExplicitProtectedBranches: Boolean(input.hasExplicitProtectedBranches),
    branchExplicit: Boolean(input.branchExplicit),
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
  // SUID/SGID bit — privilege escalation persistence
  // Matches symbolic forms (u+s, g+s, o+s) and 4-digit octal with setuid/setgid leading digit ([4-7]).
  // No collision with broad-permission-pattern: that matches 3-digit 777/666 and o+w; this matches u+s
  // and [4-7]nnn. chmod 4777 intentionally fires both → score 9 → critical (correct: world-writable setuid).
  if (matches(/\bchmod\b(?:\s+-[A-Za-z]+)*\s+(?:[ugo]\+s|\b[4-7][0-7]{3}\b)/)) {
    value += 6;
    reasons.push("suid-chmod-pattern");
  }

  // Reverse shell: bash /dev/tcp redirect, netcat -e exec, socat exec backdoor.
  // /dev/tcp/host/port arm also catches data-out redirections (cat > /dev/tcp/...).
  if (matches(/\/dev\/tcp\/[\w.-]+\/\d+/) ||
      matches(/\bnc\b(?:\s+-[A-Za-z]+)*\s+-[A-Za-z]*e[A-Za-z]*\s+\/(usr\/)?bin\/(ba)?sh\b/) ||
      matches(/\bsocat\b[^|]*\bexec:["']?\/(usr\/)?bin\/(ba)?sh\b/i)) {
    value += 9;
    reasons.push("reverse-shell-pattern");
  }

  // SSH backdoor: writing or appending to authorized_keys installs a persistent backdoor key.
  if (matches(/(?:>>|>)\s*\S*authorized_keys\b/) ||
      matches(/\btee\b(?:\s+-[A-Za-z]+)*\s+\S*authorized_keys\b/)) {
    value += 7;
    reasons.push("authorized-keys-modification");
  }

  // Sensitive-file content piped to a network tool (exfiltration).
  // _toNetwork is reused by the env-exfil check below.
  const _sensitiveRead = matches(/\bcat\s+\S*(?:\/etc\/(?:passwd|shadow|sudoers|hosts)\b|\.ssh\/id_(?:rsa|ed25519|ecdsa|dsa)\b|\.aws\/credentials\b|\.gnupg\b|\.netrc\b|\/bash_history\b|\.env(?:\.[\w.-]+)?(?:\s|$|\|))/);
  const _toNetwork     = matches(/\|\s*(?:curl|wget|nc|ncat|socat)\b/);
  if (_sensitiveRead && _toNetwork) {
    value += 8;
    reasons.push("sensitive-file-network-exfil");
  }

  // Environment dump piped to a network tool — sends all process secrets to a remote host.
  const _envDump = matches(/\b(?:env|printenv|export\s+-p)\s*\|/);
  if (_envDump && _toNetwork) {
    value += 7;
    reasons.push("env-exfil-pattern");
  }

  // Programmatic crontab installation via stdin pipe — persistence vector.
  if (matches(/\|\s*crontab\s+-(?:\s|$|;|&|\|)/) ||
      matches(/\bcrontab\s+<\s*\S/)) {
    value += 5;
    reasons.push("persistence-crontab");
  }

  // Shell startup file modification — persistence via init file append/overwrite.
  // Scored lower (+4) because legitimate setup scripts (PATH, NVM, aliases) also write these files.
  // When combined with a remote-exec payload in the echoed string, scores stack to escalate.
  if (matches(/(?:>>|>)\s*\S*\/\.(?:bashrc|bash_profile|zshrc|profile|zprofile|bash_logout|inputrc|bash_aliases)\b/) ||
      matches(/\btee\b(?:\s+-[A-Za-z]+)*\s+\S*\/\.(?:bashrc|bash_profile|zshrc|profile|zprofile|bash_logout|inputrc|bash_aliases)\b/)) {
    value += 4;
    reasons.push("shell-startup-modification");
  }

  // Interpreter shelling out to the OS — defeats command-string regex matchers by wrapping
  // destructive calls inside python/perl/node/ruby inline scripts.
  // Note: existing regex predicates match the raw command string without parsing string literals,
  // so a payload like python3 -c "os.system('rm -rf /')" will also fire destructive-delete-pattern
  // in addition to this one — the stacked score is intentional (the command IS doubly dangerous).
  const _interpInvoke = matches(/\bpython\d*\s+(?:-\w+\s+)*-c\b|\bperl\s+(?:-\w+\s+)*-e\b|\bnode\s+(?:-\w+\s+)*-e\b|\bruby\s+(?:-\w+\s+)*-e\b/);
  const _sysCall      = matches(/\bos\.system\b|\bsubprocess\b|\b__import__\s*\(\s*["']os["']|\bchild_process\b|\bexecSync\b|\bspawnSync\b|\bKernel\.system\b|\bpopen\b|\bsystem\s*\(\s*["']/);
  if (_interpInvoke && _sysCall) {
    value += 5;
    reasons.push("interpreter-exec-system");
  }

  // ── Docker / container-escape and privilege-escalation (docker-security) ────
  // Container runtime escapes that give a container effective host-root access.
  // Scored alongside reverse-shell (+9) and disk-write (+8): the blast radius is
  // equivalent — full host compromise. ADR-008 dual-path: every check goes through
  // matches() for Unicode-bypass resistance. Per ADR-008 §6.3, docker/podman/
  // nsenter vocabulary letters fall within the existing CONFUSABLES coverage.
  const _containerCmd = matches(/\b(docker|podman|nerdctl)\b/);

  // --privileged: all Linux capabilities + host device access — root on host.
  // Scored at +9 (= reverse-shell tier) because the host is fully compromised.
  if (_containerCmd && matches(/--privileged\b/)) {
    value += 9;
    reasons.push("docker-privileged-pattern");
  }

  // Container runtime socket bind-mounted into a container (-v …docker.sock or
  // --volume=…docker.sock). Gives the container full control of the host daemon
  // — trivial host escape via a new privileged container. No _containerCmd gate:
  // the socket path is self-identifying and the risk is the same regardless of
  // which runtime issued the mount.
  if (matches(/-v\s+[^:]*(?:docker|containerd|podman)\.sock\b/) ||
      matches(/--volume[= ][^:]*(?:docker|containerd|podman)\.sock\b/)) {
    value += 9;
    reasons.push("docker-socket-mount-pattern");
  }

  // Host root or critical system directories bind-mounted into a container.
  // -v /:/host, -v /etc:/etc, -v /proc:..., -v /sys:..., -v /var/run:...
  // Read/write access to the host filesystem enables backdoor installation,
  // credential theft, and cgroup/namespace escape. Score +8 = disk-write tier.
  // Note: -v ./relpath or named volumes (no leading /) are excluded by the regex.
  if (_containerCmd && (
      matches(/-v\s+\/(?::|root[/:]|etc[/:]|proc[/:]|sys[/:]|var\/run[/:])/) ||
      matches(/--volume[= ]\/(?::|root[/:]|etc[/:]|proc[/:]|sys[/:]|var\/run[/:])/))) {
    value += 8;
    reasons.push("docker-host-mount-pattern");
  }

  // Escape-grade Linux capabilities. SYS_ADMIN alone is sufficient for cgroup
  // namespace escape; ALL grants every capability; SYS_PTRACE enables process
  // injection into host processes; SYS_MODULE allows kernel module loading;
  // DAC_READ_SEARCH bypasses discretionary access enforcement.
  // Note: --cap-drop ALL (safe, capability reduction) is not matched.
  if (_containerCmd && matches(/--cap-add[= ](ALL|SYS_ADMIN|SYS_PTRACE|SYS_MODULE|DAC_READ_SEARCH)\b/i)) {
    value += 8;
    reasons.push("docker-cap-add-pattern");
  }

  // Host PID or user-namespace sharing. --pid=host exposes all host processes
  // (enabling nsenter into PID 1 without extra tools); --userns=host runs as
  // the host UID directly, defeating container user isolation.
  if (_containerCmd && matches(/--pid[= ]host\b|--userns[= ]host\b/)) {
    value += 8;
    reasons.push("docker-host-namespace-pattern");
  }

  // nsenter targeting host init (PID 1) — direct host-namespace breakout primitive.
  // Classic privileged-container or --pid=host escape: enters the host mount/net/pid
  // namespace by attaching to PID 1. Scored +8: requires the caller already be in
  // a position to run nsenter (elevated or inside a privileged container).
  if (matches(/\bnsenter\b/) && matches(/-t\s*1\b|--target[= ]\s*1\b/)) {
    value += 8;
    reasons.push("container-namespace-escape-pattern");
  }

  // Disabling seccomp or AppArmor weakens container isolation by removing the
  // syscall / MAC filter. Scored high (+6 → value 7 with base → high/escalate)
  // rather than critical: alone it is not an escape, but it removes a
  // defence-in-depth layer. Stacks to critical with any +1 context modifier.
  if (_containerCmd && matches(/--security-opt[= ](seccomp|apparmor)=unconfined\b/i)) {
    value += 6;
    reasons.push("docker-unconfined-pattern");
  }

  // Host network namespace shared with container. Medium signal (+3) on its own
  // (route/warn), but stacks with privileged/cap-add/pid=host to push into
  // critical. Included as a standing signal so combinations are escalated even
  // when a more-dangerous flag is detected only via the normalised arm.
  if (_containerCmd && matches(/--net(?:work)?[= ]host\b/)) {
    value += 3;
    reasons.push("docker-host-network-pattern");
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

  const branchProtected = ctx.protectedBranch || (
    ctx.branch
    && ctx.protectedBranches.some((p) => globMatch(ctx.branch, p))
    && (ctx.hasExplicitProtectedBranches || ctx.branchExplicit)
  );
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
